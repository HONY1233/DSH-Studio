import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Synchronous, single-key file adapter so native window state commits before shutdown. */
export function createNativeWindowFileStorage(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Native window state path is required')
  const temporaryPath = `${filePath}.tmp`
  return {
    getItem() {
      try {
        return readFileSync(filePath, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    setItem(_key, value) {
      if (typeof value !== 'string') throw new TypeError('Native window state must be a string')
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(temporaryPath, value, 'utf8')
      renameSync(temporaryPath, filePath)
    },
  }
}
