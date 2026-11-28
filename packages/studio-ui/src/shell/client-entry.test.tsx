import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type StudioClientContext } from './client-entry.js'
import type { RawSessionEventWindow } from './event-adapter.js'

const debugGlobal = globalThis as typeof globalThis & { __STUDIO_DEBUG__?: unknown }

function harness() {
  const disposers: (() => void)[] = []
  const releases: string[] = []
  const listeners = new Set<() => void>()
  const window: RawSessionEventWindow = { entries: [], hasMore: false, revision: 0 }
  const source = {
    getSnapshot: () => window,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }),
  }
  const binding = { sessionId: 'session-a', openState: 'ready' as const, eventSource: source }
  const ctx = {
    slots: {
      inject: (_key: string, callback: () => (() => void) | Iterable<() => void>) => callback(),
      register: () => () => {},
    },
    sessions: {
      list: {},
      create: async () => 'session-a',
      retain: (target: string) => {
        const scoped = { ...binding, sessionId: target }
        return { sessionId: target, binding: scoped, ready: Promise.resolve(scoped), release: () => { releases.push(target) } }
      },
    },
    effect: (setup: () => () => void) => {
      const dispose = setup()
      if (dispose) disposers.push(dispose)
    },
  } as unknown as StudioClientContext
  apply(ctx)
  return { disposers, releases, listeners, source }
}

afterEach(() => {
  delete debugGlobal.__STUDIO_DEBUG__
  vi.restoreAllMocks()
})

describe('studio plugin shared lifecycle', () => {
  it('unload disposes the shared event source, owner store, leases, and its own debug hook', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { disposers, releases, listeners, source } = harness()
    const debug = debugGlobal.__STUDIO_DEBUG__ as {
      hub: { attach(sessionId: string, source: unknown): () => void; size: number }
      leases: { acquire(target: string): { release(): void }; size: number }
      ownerStore: { subscribe(listener: () => void): () => void }
    }
    const detach = debug.hub.attach('session-a', source)
    const lease = debug.leases.acquire('session-a')
    const unsubscribe = debug.ownerStore.subscribe(() => {})
    expect(source.subscribe).toHaveBeenCalledOnce()
    expect(debug.hub.size).toBe(1)
    expect(debug.leases.size).toBe(1)

    for (const dispose of disposers.reverse()) dispose()

    expect(listeners.size).toBe(0)
    expect(detach).toBeTypeOf('function')
    expect(unsubscribe).toBeTypeOf('function')
    expect(releases).toEqual(['session-a'])
    expect(debug.hub.size).toBe(0)
    expect(debug.leases.size).toBe(0)
    expect(debugGlobal.__STUDIO_DEBUG__).toBeUndefined()
  })

  it('unload does not remove a newer plugin generation debug hook', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { disposers } = harness()
    const replacement = { generation: 'newer' }
    debugGlobal.__STUDIO_DEBUG__ = replacement
    for (const dispose of disposers.reverse()) dispose()
    expect(debugGlobal.__STUDIO_DEBUG__).toBe(replacement)
  })
})
