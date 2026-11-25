import { describe, expect, it } from 'vitest'

import {
  type Tab,
  type TabId,
  createMint,
  makeTab,
  panes,
  view,
} from './layout.js'
import { TEMPLATES, buildTemplate, eligibleTemplates } from './templates.js'
import {
  FACTORY_PRESETS,
  buildFactoryPreset,
  decode,
  encode,
  fingerprintOf,
  presetsKey,
  storageKey,
} from './presets.js'

function tabs(n: number): Tab[] {
  const mint = createMint('tab')
  return Array.from({ length: n }, (_, i) => makeTab(mint.tab(), { kind: 'panel', contentId: `p${i}`, instanceId: `p${i}` }))
}

function mintFor() {
  const mint = createMint('m')
  let paneSeq = 0
  let splitSeq = 0
  return {
    pane: () => mint.pane(),
    split: () => {
      const id = mint.split()
      splitSeq += 1
      return id
    },
    get paneCount() {
      return paneSeq
    },
    get splitCount() {
      return splitSeq
    },
    tick() {
      paneSeq += 1
    },
  }
}

describe('buildTemplate', () => {
  it('六个模板全部可构造，且不丢 tab', () => {
    const seed = tabs(6)
    for (const spec of TEMPLATES) {
      const node = buildTemplate(spec.id, seed, mintFor())
      const all = panes(node).flatMap((p) => p.tabs.map((t) => t.id as TabId))
      expect(all).toHaveLength(6)
      expect(new Set(all).size).toBe(6)
    }
  })

  it('四宫格产生四个 pane', () => {
    const node = buildTemplate('quad', tabs(4), mintFor())
    expect(panes(node)).toHaveLength(4)
  })

  it('左右各半的比例正确', () => {
    const node = buildTemplate('columns-2', tabs(2), mintFor())
    expect(node.kind).toBe('split')
    if (node.kind === 'split') expect(node.sizes).toEqual([0.5, 0.5])
  })

  it('tab 少于槽位时保留空 pane（留给后续拖入）', () => {
    const node = buildTemplate('quad', tabs(1), mintFor())
    const all = panes(node)
    expect(all).toHaveLength(4)
    expect(all.filter((p) => p.tabs.length === 0)).toHaveLength(3)
  })

  it('视图折叠后空 pane 不参与渲染', () => {
    const node = buildTemplate('quad', tabs(1), mintFor())
    const seed = panes(node)[0]?.id
    expect(seed).toBeDefined()
    if (!seed) return
    const collapsed = view({ version: 2, root: node, floats: [], minimized: [] }, seed)
    expect(panes(collapsed.root).filter((p) => p.tabs.length > 0)).toHaveLength(1)
  })
})

describe('eligibleTemplates', () => {
  it('窄窗口只开放单列能容纳的模板', () => {
    expect(eligibleTemplates({ w: 500, h: 600 })).toHaveLength(0)
  })

  it('宽窗口开放全部', () => {
    expect(eligibleTemplates({ w: 1600, h: 1000 })).toHaveLength(TEMPLATES.length)
  })
})

describe('持久化', () => {
  it('真实键与预览键前缀不同', () => {
    const scope = { hostId: 'local', workspaceId: 'w1', sessionId: 's1' }
    expect(storageKey(scope)).toBe('dsh.workbench.v2:local:w1:s1')
    expect(storageKey({ ...scope, preview: true })).toBe('dsh.workbench.dev.v2:local:w1:s1')
    expect(presetsKey()).not.toBe(presetsKey(true))
  })

  it('会话 id 带特殊字符不产生键碰撞', () => {
    const a = storageKey({ hostId: 'h', workspaceId: 'w', sessionId: 'a:b' })
    const b = storageKey({ hostId: 'h', workspaceId: 'w', sessionId: 'a%3Ab' })
    expect(a).not.toBe(b)
  })

  it('指纹与顺序无关', () => {
    expect(fingerprintOf(['a', 'b'])).toBe(fingerprintOf(['b', 'a']))
    expect(fingerprintOf(['a', 'b'])).not.toBe(fingerprintOf(['a', 'b', 'c']))
  })

  it('指纹不匹配时丢弃布局', () => {
    const layout = buildFactoryPreset('default', tabs(2), mintFor())
    const raw = encode(layout, 'fp-1')
    expect(decode(raw, 'fp-2', { aliveInstances: () => true })).toBeUndefined()
    expect(decode(raw, 'fp-1', { aliveInstances: () => true })).toBeDefined()
  })

  it('已卸载面板被静默剔除，不清空整份布局', () => {
    const layout = buildFactoryPreset('default', tabs(2), mintFor())
    const raw = encode(layout, 'fp')
    const decoded = decode(raw, 'fp', { aliveInstances: (id) => id === 'p0' })
    expect(decoded).toBeDefined()
    const kept = panes(decoded?.root ?? layout.root).flatMap((p) => p.tabs)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.ref.instanceId).toBe('p0')
  })

  it('结构损坏时回退 undefined', () => {
    expect(decode(null, 'fp', { aliveInstances: () => true })).toBeUndefined()
    expect(decode({ version: 2, fingerprint: 'fp' }, 'fp', { aliveInstances: () => true })).toBeUndefined()
  })
})

describe('出厂预设', () => {
  it('三个预设都可构造', () => {
    for (const preset of FACTORY_PRESETS) {
      const layout = buildFactoryPreset(preset.id, tabs(3), mintFor())
      expect(layout.version).toBe(2)
      expect(panes(layout.root).length).toBeGreaterThanOrEqual(2)
    }
  })
})
