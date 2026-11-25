/**
 * 租约注册表的纯逻辑测试 —— 不依赖 React、不依赖 jsdom。
 *
 * 重点覆盖三件真实会出事的事：
 * 1) 多个视图共享一条底层引用（否则流翻倍）；
 * 2) 搬家（卸载 + 挂载落在同一微任务内）不掉连接；
 * 3) 真关掉以后确实 release，且 map 里不残留。
 */

import { describe, expect, it, vi } from 'vitest'

import { SessionLeaseRegistry } from './leases.js'
import { createFakeSessionPort, settle, tick } from './testing.js'

describe('SessionLeaseRegistry 引用计数', () => {
  it('同一会话的多个视图只 retain 一次', () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const a = registry.acquire('s1', 'workbench:pane')
    const b = registry.acquire('s1', 'workbench:float')

    expect(calls).toHaveLength(1)
    expect(registry.size).toBe(1)
    expect(registry.inspect('s1')?.refCount).toBe(2)
    expect(a.current().generation).toBe(b.current().generation)
  })

  it('sources 按来源分别计数', () => {
    const { port } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1', 'workbench:pane')
    registry.acquire('s1', 'workbench:pane')
    registry.acquire('s1', 'workbench:preview')

    const sources = registry.inspect('s1')?.sources ?? []
    expect(sources).toContainEqual({ source: 'workbench:pane', count: 2 })
    expect(sources).toContainEqual({ source: 'workbench:preview', count: 1 })
  })

  it('释放其中一份不动底层引用', () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const a = registry.acquire('s1')
    registry.acquire('s1')
    a.release()

    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.inspect('s1')?.refCount).toBe(1)
  })

  it('计数归零先进入 draining，宽限期结束才 release 并删表', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const lease = registry.acquire('s1')
    lease.release()

    expect(registry.inspect('s1')?.draining).toBe(true)
    expect(calls[0]?.releaseCount).toBe(0)

    await tick()

    expect(calls[0]?.releaseCount).toBe(1)
    expect(registry.size).toBe(0)
    // 表里已经没有这一代，但持有过它的 lease 仍能读到最终状态。
    expect(registry.inspect('s1')).toBeUndefined()
    expect(lease.current().closed).toBe(true)
  })

  it('幂等释放不会把计数打成负数', () => {
    const { port } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const lease = registry.acquire('s1')
    lease.release()
    lease.release()
    lease.release()

    expect(registry.inspect('s1')?.refCount).toBe(0)
  })

  it('不同会话互不影响', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1')
    registry.acquire('s2').release()

    await tick()

    expect(registry.size).toBe(1)
    expect(registry.inspect('s1')?.refCount).toBe(1)
    expect(calls.filter((c) => c.target === 's2')[0]?.releaseCount).toBe(1)
  })
})

describe('搬家不重连（宽限期复用）', () => {
  it('宽限期内重新 acquire 拿回同一代', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1').release()
    // React 的卸载与挂载都在同一宏任务里，中间不会有微任务插队。
    const again = registry.acquire('s1', 'workbench:float')

    expect(again.current().generation).toBe(1)
    expect(calls).toHaveLength(1)
    expect(registry.inspect('s1')?.refCount).toBe(1)

    await tick()

    // 旧回调已作废，不该把活着的这一代关掉。
    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.size).toBe(1)
  })

  it('连续搬三次仍然只有一条底层引用', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    let lease = registry.acquire('s1', 'workbench:pane')
    for (const source of ['workbench:float', 'workbench:pinned', 'workbench:pane']) {
      lease.release() // 旧位置卸载 → 计数归零
      lease = registry.acquire('s1', source) // 同一宏任务内新位置挂载
    }

    await tick()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.size).toBe(1)
    expect(lease.current().generation).toBe(1)
  })

  it('宽限期过了再 acquire 就是新的一代', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1').release()
    await tick()

    const fresh = registry.acquire('s1')
    expect(fresh.current().generation).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('timeout 策略下宽限期按毫秒走', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port, grace: { kind: 'timeout', ms: 5 } })

    registry.acquire('s1').release()
    const again = registry.acquire('s1')

    expect(again.current().generation).toBe(1)

    await settle()
    expect(calls[0]?.releaseCount).toBe(0)
    expect(registry.size).toBe(1)
  })
})

describe('打开结果', () => {
  it('ready 解析后状态变为 ready 并通知订阅者', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })
    const listener = vi.fn()
    registry.subscribe(listener)

    const lease = registry.acquire('s1')
    expect(lease.current().status).toBe('opening')

    calls[0]?.resolve({ title: '设计评审' })
    await tick()

    expect(lease.current().status).toBe('ready')
    expect(lease.current().binding?.title).toBe('设计评审')
    expect(listener).toHaveBeenCalled()
  })

  it('binding.openState 为 error 时状态是 error', async () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    const lease = registry.acquire('s1')
    calls[0]?.resolve({ openState: 'error', error: '日志损坏' })
    await tick()

    expect(lease.current().status).toBe('error')
    expect(lease.current().error).toBe('日志损坏')
  })

  it('ready 拒绝时上报 onError 并停在 error', async () => {
    const { port, calls } = createFakeSessionPort()
    const onError = vi.fn()
    const registry = new SessionLeaseRegistry({ port, onError })

    const lease = registry.acquire('s1')
    calls[0]?.reject(new Error('连接断开'))
    await tick()

    expect(lease.current().status).toBe('error')
    expect(lease.current().error).toBe('连接断开')
    expect(onError).toHaveBeenCalledWith('s1', expect.any(Error))
  })

  it('已关闭的那一代拒绝时不再上报（避免关窗刷错误）', async () => {
    const { port, calls } = createFakeSessionPort()
    const onError = vi.fn()
    const registry = new SessionLeaseRegistry({ port, onError })

    registry.acquire('s1').release()
    await tick()
    calls[0]?.reject(new Error('引用提前释放'))
    await tick()

    expect(onError).not.toHaveBeenCalled()
  })

  it('port.retain 同步抛错时降级为 error，不炸掉整棵树', () => {
    const { port } = createFakeSessionPort({
      retain() {
        throw new Error('会话不存在')
      },
    })
    const registry = new SessionLeaseRegistry({ port })

    const lease = registry.acquire('ghost')
    expect(lease.current().status).toBe('error')
    expect(lease.current().error).toBe('会话不存在')
  })

  it('retain 失败的那一代也能正常释放', async () => {
    const { port } = createFakeSessionPort({
      retain() {
        throw new Error('boom')
      },
    })
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('ghost').release()
    await tick()

    expect(registry.size).toBe(0)
  })
})

describe('收口动作', () => {
  it('flush 立即结束宽限期', () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1').release()
    registry.flush()

    expect(calls[0]?.releaseCount).toBe(1)
    expect(registry.size).toBe(0)
  })

  it('flush 不碰仍被持有的代', () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1')
    registry.acquire('s2').release()
    registry.flush()

    expect(registry.size).toBe(1)
    expect(calls.filter((c) => c.target === 's1')[0]?.releaseCount).toBe(0)
  })

  it('dispose 释放全部并禁止再 acquire', () => {
    const { port, calls } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1')
    registry.acquire('s2')
    registry.dispose()

    expect(calls.every((c) => c.releaseCount === 1)).toBe(true)
    expect(registry.size).toBe(0)
    expect(() => registry.acquire('s1')).toThrow(/dispose/)
  })

  it('snapshot 按打开顺序给出每一代', () => {
    const { port } = createFakeSessionPort()
    const registry = new SessionLeaseRegistry({ port })

    registry.acquire('s1', 'workbench:pane')
    registry.acquire('s2', 'workbench:pinned')

    expect(registry.snapshot().map((v) => v.target)).toEqual(['s1', 's2'])
  })
})
