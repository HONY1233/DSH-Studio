import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Atomic, owner-only draft persistence in Electron's per-user data directory. */
export function createFileDraftStore(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('draft file path is required')
  return {
    async load() {
      try {
        return await readFile(filePath, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    async save(serialized) {
      await mkdir(dirname(filePath), { recursive: true })
      const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, filePath)
      } finally {
        await unlink(temporary).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    },
  }
}
