/**
 * JSONL UsageLedger repository with injected IO (X1.8).
 *
 * The pure core never imports node:fs. Electron Main can later provide an IO
 * adapter; tests use an in-memory adapter to exercise truncation, disk-full,
 * compaction and backup behavior without pretending a production store exists.
 */
import {
  ControlError,
  ControlErrorCode,
  isPlainRecord,
} from './control.js'
import {
  createUsageLedger,
  ingestUsage,
  reportUsageCorruption,
  serializeUsageLedger,
  usageLedgerReport,
} from './ledger.js'
import { rawUsageHash } from './usage.js'

const REPOSITORY_FORMAT = 'dsh-usage-jsonl'
const REPOSITORY_VERSION = 1

function storageFailure(message, error) {
  return new ControlError(ControlErrorCode.STORAGE_FAILED, message, {
    causeCode: error?.code ?? null,
    causeMessage: error?.message ?? null,
  })
}

function isMissing(error) {
  return error?.code === 'ENOENT'
}

function canonicalRecord(record) {
  const {
    active,
    supersededBy,
    supersedes,
    ledgerFingerprint,
    ...payload
  } = record
  return payload
}

function rowHash(row) {
  return rawUsageHash(row)
}

export function createJsonlUsageRepository({ io, now, filePath = 'usage.jsonl' } = {}) {
  if (!isPlainRecord(io)
    || typeof io.read !== 'function'
    || typeof io.append !== 'function'
    || typeof io.atomicWrite !== 'function'
    || typeof io.copy !== 'function') {
    throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'repository 需要 read/append/atomicWrite/copy IO 适配器')
  }
  if (typeof now !== 'function') throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'repository 需要 now() 时间源')
  if (typeof filePath !== 'string' || !filePath) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'filePath 不能为空')
  let ledger = createUsageLedger()
  let loaded = false
  let writeGeneration = 0

  function requireLoaded() {
    if (!loaded) throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, '请先 load repository')
  }

  function parseLine(line, lineNumber, reportedAt) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      return reportUsageCorruption(ledger, {
        recordId: null,
        reason: 'invalid-json',
        message: `JSONL 第 ${lineNumber} 行损坏`,
        recordHash: rawUsageHash(line),
        reportedAt,
        line: lineNumber,
      })
    }
    if (!isPlainRecord(row) || row.format !== REPOSITORY_FORMAT || row.version !== REPOSITORY_VERSION) {
      return reportUsageCorruption(ledger, {
        recordId: null,
        reason: 'invalid-row',
        message: `JSONL 第 ${lineNumber} 行格式或版本不受支持`,
        recordHash: rowHash(row),
        reportedAt,
        line: lineNumber,
      })
    }
    if (row.kind === 'corruption') {
      const corruption = row.corruption
      if (!isPlainRecord(corruption)
        || typeof corruption.reason !== 'string'
        || typeof corruption.message !== 'string'
        || typeof corruption.reportedAt !== 'string') {
        return reportUsageCorruption(ledger, {
          recordId: null,
          reason: 'invalid-corruption-row',
          message: `JSONL 第 ${lineNumber} 行的损坏报告无效`,
          recordHash: rowHash(row),
          reportedAt,
          line: lineNumber,
        })
      }
      return reportUsageCorruption(ledger, { ...corruption, line: corruption.line ?? lineNumber })
    }
    if (row.kind !== 'usage' || !isPlainRecord(row.record)) {
      return reportUsageCorruption(ledger, {
        recordId: isPlainRecord(row.record) && typeof row.record.usageId === 'string' ? row.record.usageId : null,
        reason: 'invalid-row',
        message: `JSONL 第 ${lineNumber} 行格式不受支持`,
        recordHash: rowHash(row),
        reportedAt,
        line: lineNumber,
      })
    }
    return ingestUsage(ledger, row.record, reportedAt).state
  }

  function load() {
    const reportedAt = now()
    let text = ''
    try {
      text = io.read(filePath)
    } catch (error) {
      if (!isMissing(error)) throw storageFailure('读取用量 repository 失败', error)
    }
    if (typeof text !== 'string') throw storageFailure('用量 repository 读取结果不是字符串', null)
    ledger = createUsageLedger()
    const lines = text.length > 0 ? text.split('\n') : []
    if (lines.length > 0 && lines.at(-1) === '') lines.pop()
    for (let index = 0; index < lines.length; index += 1) {
      ledger = parseLine(lines[index], index + 1, reportedAt)
    }
    loaded = true
    return usageLedgerReport(ledger)
  }

  function append(rawRecord) {
    requireLoaded()
    const reportedAt = now()
    const preview = ingestUsage(ledger, rawRecord, reportedAt)
    if (preview.status !== 'accepted' && preview.status !== 'pending-correction') return preview
    const row = { format: REPOSITORY_FORMAT, version: REPOSITORY_VERSION, kind: 'usage', record: canonicalRecord(rawRecord) }
    const line = `${JSON.stringify(row)}\n`
    try {
      io.append(filePath, line)
    } catch (error) {
      throw storageFailure('追加用量记录失败；内存账本未推进', error)
    }
    ledger = preview.state
    return preview
  }

  function backup(backupPath) {
    requireLoaded()
    if (typeof backupPath !== 'string' || !backupPath) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'backupPath 不能为空')
    }
    try {
      io.copy(filePath, backupPath)
    } catch (error) {
      throw storageFailure('备份用量 repository 失败', error)
    }
    return { backupPath }
  }

  function compact(backupPath) {
    requireLoaded()
    if (typeof backupPath !== 'string' || !backupPath) {
      throw new ControlError(ControlErrorCode.INVALID_ARGUMENT, 'compact 必须指定 backupPath')
    }
    try {
      io.read(filePath)
    } catch (error) {
      throw storageFailure('压缩前无法读取原 repository；已停止', error)
    }
    backup(backupPath)
    const records = [
      ...Object.values(ledger.records).map(canonicalRecord),
      ...Object.values(ledger.pendingCorrections).map(canonicalRecord),
    ].sort((left, right) => left.usageId.localeCompare(right.usageId))
    const corruptions = [...ledger.corruptions].sort((left, right) => left.corruptionId.localeCompare(right.corruptionId))
    const rows = [
      ...records.map((record) => ({ format: REPOSITORY_FORMAT, version: REPOSITORY_VERSION, kind: 'usage', record })),
      ...corruptions.map((corruption) => ({ format: REPOSITORY_FORMAT, version: REPOSITORY_VERSION, kind: 'corruption', corruption })),
    ]
    const text = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '')
    writeGeneration += 1
    const tempPath = `${filePath}.tmp-${writeGeneration}`
    try {
      io.atomicWrite(tempPath, filePath, text)
    } catch (error) {
      try {
        io.remove?.(tempPath)
      } catch {
        // The original file remains authoritative; cleanup failure is visible only as a temp artifact.
      }
      throw storageFailure('压缩写入失败；原 repository 未被替换', error)
    }
    const reportedAt = now()
    let rebuilt = createUsageLedger()
    for (const record of records) rebuilt = ingestUsage(rebuilt, record, reportedAt).state
    for (const corruption of corruptions) rebuilt = reportUsageCorruption(rebuilt, corruption)
    ledger = rebuilt
    return {
      backupPath,
      records: records.length,
      corruptions: corruptions.length,
      revision: ledger.revision,
    }
  }

  return {
    load,
    append,
    backup,
    compact,
    snapshot() {
      requireLoaded()
      return serializeUsageLedger(ledger)
    },
    report() {
      requireLoaded()
      return usageLedgerReport(ledger)
    },
  }
}
