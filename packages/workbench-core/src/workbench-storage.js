/** Versioned workbench persistence with injected atomic IO (X2.9). */
import { ControlError, ControlErrorCode, cloneJson, isPlainRecord } from './control.js'
import {
  WORKBENCH_SCHEMA_VERSION,
  createWorkbenchLayout,
  validateWorkbenchLayout,
} from './workbench-schema.js'

export const WORKBENCH_STORAGE_FORMAT = 'dsh-workbench-layout'
export const WORKBENCH_STORAGE_VERSION = 1

function corrupt(message, details = {}) {
  return new ControlError(ControlErrorCode.CORRUPT_RECORD, message, details)
}

function invalid(message, details = {}) {
  return new ControlError(ControlErrorCode.INVALID_ARGUMENT, message, details)
}

function storageFailure(message, error) {
  return new ControlError(ControlErrorCode.STORAGE_FAILED, message, {
    causeCode: error?.code ?? null,
    causeMessage: error?.message ?? null,
  })
}

function parseJson(text, label) {
  if (typeof text !== 'string') throw corrupt(`${label} 必须是 JSON 字符串`)
  try {
    return JSON.parse(text)
  } catch {
    throw corrupt(`${label} 不是合法 JSON`)
  }
}

export function serializeWorkbenchSnapshot(layout, savedAt) {
  validateWorkbenchLayout(layout)
  if (typeof savedAt !== 'string' || !savedAt) throw invalid('savedAt 必须是非空时间字符串')
  return JSON.stringify({
    format: WORKBENCH_STORAGE_FORMAT,
    version: WORKBENCH_STORAGE_VERSION,
    revision: layout.revision,
    savedAt,
    layout: cloneJson(layout),
  })
}

export function migrateWorkbenchSnapshot(input) {
  const value = typeof input === 'string' ? parseJson(input, 'workbench snapshot') : input
  if (!isPlainRecord(value)) throw corrupt('workbench snapshot 必须是对象')
  if (value.format === WORKBENCH_STORAGE_FORMAT) {
    if (value.version !== WORKBENCH_STORAGE_VERSION) {
      throw corrupt(`不支持的 workbench storage version: ${value.version}`)
    }
    if (!isPlainRecord(value.layout)) throw corrupt('workbench snapshot 缺少 layout')
    try {
      validateWorkbenchLayout(value.layout)
    } catch (error) {
      throw corrupt(`workbench layout 无效: ${error.message}`)
    }
    if (value.revision !== value.layout.revision) throw corrupt('snapshot.revision 与 layout.revision 不一致')
    return { layout: cloneJson(value.layout), migrations: [], savedAt: value.savedAt ?? null }
  }
  if (value.format == null && (value.version === 0 || value.version === undefined) && isPlainRecord(value.root)) {
    const layout = createWorkbenchLayout(value.root, value.floats ?? [], {
      revision: 0,
      focusedId: value.focusedId,
      minimized: value.minimized ?? [],
    })
    return { layout, migrations: ['legacy-unversioned-to-v1'], savedAt: value.savedAt ?? null }
  }
  throw corrupt('workbench snapshot 格式或版本不受支持')
}

export function restoreWorkbenchSnapshot(input) {
  return migrateWorkbenchSnapshot(input).layout
}

export function createWorkbenchLayoutStore({ io, filePath = 'workbench-layout.json', now, backupPath } = {}) {
  if (!isPlainRecord(io)
    || typeof io.read !== 'function'
    || typeof io.atomicWrite !== 'function'
    || typeof io.copy !== 'function') {
    throw invalid('workbench store 需要 read/atomicWrite/copy IO 适配器')
  }
  if (typeof now !== 'function') throw invalid('workbench store 需要 now() 时间源')
  if (typeof filePath !== 'string' || !filePath) throw invalid('filePath 不能为空')
  const resolvedBackupPath = backupPath ?? `${filePath}.bak`
  let loaded = false
  let current = null
  let writeGeneration = 0
  let lastLoadReport = { recovered: false, corruption: null }

  function requireLoaded() {
    if (!loaded) throw invalid('请先 load workbench store')
  }

  function readMigrated(path) {
    const text = io.read(path)
    return migrateWorkbenchSnapshot(text)
  }

  function load() {
    const recovered = { recovered: false, corruption: null }
    try {
      const migrated = readMigrated(filePath)
      current = { layout: migrated.layout, savedAt: migrated.savedAt }
      loaded = true
      lastLoadReport = recovered
      return { snapshot: cloneJson(current), ...recovered }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        recovered.corruption = error instanceof ControlError ? error.toJSON() : { code: 'CORRUPT_RECORD', message: error.message }
        try {
          const backup = readMigrated(resolvedBackupPath)
          current = { layout: backup.layout, savedAt: backup.savedAt }
          loaded = true
          recovered.recovered = true
          lastLoadReport = recovered
          return { snapshot: cloneJson(current), ...recovered }
        } catch {
          loaded = true
          current = null
          lastLoadReport = recovered
          throw error
        }
      }
      current = null
      loaded = true
      lastLoadReport = recovered
      return { snapshot: null, ...recovered }
    }
  }

  function save(layout, { expectedRevision } = {}) {
    requireLoaded()
    validateWorkbenchLayout(layout)
    const actualRevision = current?.layout.revision ?? 0
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw invalid('expectedRevision 必须是非负安全整数')
    if (expectedRevision !== actualRevision) {
      throw new ControlError(ControlErrorCode.CONFLICT, 'workbench revision 冲突，拒绝覆盖', {
        expectedRevision,
        actualRevision,
      })
    }
    if (current && layout.revision !== actualRevision + 1) {
      throw invalid('保存 layout.revision 必须比当前 revision 大 1')
    }
    if (!current && layout.revision !== 0 && layout.revision !== 1) {
      throw invalid('首次保存的 layout.revision 必须是 0 或 1')
    }
    const savedAt = now()
    const text = serializeWorkbenchSnapshot(layout, savedAt)
    if (current) {
      try {
        io.copy(filePath, resolvedBackupPath)
      } catch (error) {
        throw storageFailure('备份当前 workbench 失败；未写入新布局', error)
      }
    }
    writeGeneration += 1
    const tempPath = `${filePath}.tmp-${writeGeneration}`
    try {
      io.atomicWrite(tempPath, filePath, text)
    } catch (error) {
      try {
        io.remove?.(tempPath)
      } catch {
        // Preserve the original storage failure; temp cleanup is best effort.
      }
      throw storageFailure('原子写入 workbench 失败；当前布局未被替换', error)
    }
    current = { layout: cloneJson(layout), savedAt }
    return cloneJson(current)
  }

  function backup(path = resolvedBackupPath) {
    requireLoaded()
    if (typeof path !== 'string' || !path) throw invalid('backup path 不能为空')
    try {
      if (current) io.copy(filePath, path)
      else throw new ControlError(ControlErrorCode.NOT_FOUND, '当前没有可备份的 workbench')
    } catch (error) {
      if (error instanceof ControlError) throw error
      throw storageFailure('备份 workbench 失败', error)
    }
    return { backupPath: path }
  }

  function restoreBackup(path = resolvedBackupPath, { expectedRevision } = {}) {
    requireLoaded()
    let migrated
    try {
      migrated = readMigrated(path)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new ControlError(ControlErrorCode.NOT_FOUND, 'workbench 备份不存在')
      throw error
    }
    const layout = cloneJson(migrated.layout)
    layout.revision = (current?.layout.revision ?? 0) + 1
    validateWorkbenchLayout(layout)
    return save(layout, { expectedRevision })
  }

  return {
    load,
    save,
    backup,
    restoreBackup,
    snapshot() {
      requireLoaded()
      return cloneJson(current)
    },
    report() {
      requireLoaded()
      return cloneJson(lastLoadReport)
    },
  }
}
