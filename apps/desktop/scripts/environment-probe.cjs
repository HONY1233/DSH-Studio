/* Electron Main-only, read-only environment probe for the X0 baseline. */
const { app, safeStorage, screen } = require('electron')

const result = {
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? null,
    node: process.versions.node ?? null,
    chrome: process.versions.chrome ?? null,
  },
  nodeSqlite: { available: false, databaseSync: false, error: null },
  safeStorage: { available: false, error: null },
  displays: { available: false, count: 0, displays: [], error: null },
}

function recordError(section, error) {
  section.error = error instanceof Error ? error.message : String(error)
}

async function probe() {
  await app.whenReady()

  try {
    const sqlite = require('node:sqlite')
    result.nodeSqlite.available = true
    result.nodeSqlite.databaseSync = typeof sqlite.DatabaseSync === 'function'
  } catch (error) {
    recordError(result.nodeSqlite, error)
  }

  try {
    result.safeStorage.available = safeStorage.isEncryptionAvailable()
  } catch (error) {
    recordError(result.safeStorage, error)
  }

  try {
    result.displays.available = true
    result.displays.displays = screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: display.label ?? null,
      bounds: { ...display.bounds },
      workArea: { ...display.workArea },
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      internal: display.internal,
    }))
    result.displays.count = result.displays.displays.length
  } catch (error) {
    recordError(result.displays, error)
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  app.quit()
}

probe().catch((error) => {
  process.stderr.write(`environment probe failed: ${error.stack ?? error}\n`)
  app.exit(1)
})
