/**
 * @studio/ui-shell 的浏览器半测试。
 *
 * 直接验证 client.js 在模拟 ModuleLoader / React runtime 下的行为：
 *   1. loader 包装与 exports 形状；
 *   2. 只依赖 loader 提供的 react / react-dom 运行时；
 *   3. 同时注册 main.conversation 与 sidebar，且 priority 能 shadow 官方槽；
 *   4. sidebar 渲染真实会话列表、新建入口与折叠态。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = resolve(HERE, '../../studio-ui/lib/client.js')

const mockReact = {
  Fragment: Symbol('Fragment'),
  Component: class Component {},
  createContext: () => ({ Provider: Symbol('ContextProvider') }),
  createElement(type, props, ...children) {
    const explicit = children.flat(Infinity)
    const nested = props?.children
    return {
      type,
      props: props ?? {},
      children: explicit.length > 0 ? explicit : nested === undefined ? [] : [nested].flat(Infinity),
    }
  },
  useCallback: (callback) => callback,
  useContext: () => null,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const mockJsxRuntime = {
  Fragment: mockReact.Fragment,
  jsx: (type, props, key) => mockReact.createElement(type, { ...props, key }),
  jsxs: (type, props, key) => mockReact.createElement(type, { ...props, key }),
}
// 工作台把会话正文 portal 到稳定的 DOM host 上，避免跨 pane 移动时重建。
// 真机上 react-dom 由 loader 注入；这里只模拟 portal 的单节点透传。
const mockReactDom = {
  createPortal: (node) => node,
}

function runtimeRequire(name) {
  if (name === 'react') return mockReact
  if (name === 'react/jsx-runtime') return mockJsxRuntime
  if (name === 'react-dom') return mockReactDom
  throw new Error(`未预期的运行时依赖：${name}（应用 loader 注入，测试只允许 react 运行时）`)
}

function loadRegistration() {
  const code = readFileSync(CLIENT_PATH, 'utf8')
  let registration = null
  const sandbox = {
    window: { __ModuleLoader__: { load(reg) { registration = reg } } },
    console: { log() {}, error() {}, warn() {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: CLIENT_PATH })
  assert.ok(registration, 'client.js 必须调用 window.__ModuleLoader__.load')
  return registration
}

function loadExports(registration) {
  return registration.factory(runtimeRequire)
}

function collectText(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node.type === 'function') return collectText(node.type(node.props))
  return collectText(node.children)
}

function sessionList() {
  const snapshot = {
    ids: ['session-demo'],
    byId: { 'session-demo': { displayTitle: '重构 DSH 前端适配层' } },
  }
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
  }
}

function makeCtx() {
  const registered = []
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(typeof name, 'string')
        return callback()
      },
      register(definition, Component) {
        registered.push({ definition, Component })
        return () => {}
      },
    },
    sessions: {
      list: sessionList(),
      create: async () => 'session-demo',
      retain: () => ({
        binding: { sessionId: 'session-demo' },
        ready: Promise.resolve({ sessionId: 'session-demo' }),
        release() {},
      }),
    },
  }
  return { ctx, registered }
}

function sidebarRegistration(registered) {
  const row = registered.find(({ definition }) => definition.name === 'sidebar')
  assert.ok(row, '必须注册 sidebar')
  return row
}

test('client.js：ModuleLoader 注册的 id 正确', () => {
  const reg = loadRegistration()
  assert.equal(reg.id, '@studio/ui-shell')
  assert.equal(typeof reg.factory, 'function')
})

test('client.js：只依赖 loader 提供的 React 运行时', () => {
  const reg = loadRegistration()
  const seen = []
  reg.factory((name) => {
    seen.push(name)
    return runtimeRequire(name)
  })
  assert.deepEqual(seen, ['react', 'react/jsx-runtime', 'react-dom'])
})

test('exports：导出 inject 与 apply，并声明 slots / sessions', () => {
  const mod = loadExports(loadRegistration())
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.inject.includes('slots'))
  assert.ok(mod.inject.includes('sessions'))
  assert.equal(typeof mod.apply, 'function')
})

test('apply：注册 main.conversation 与 sidebar 两个真实槽位', () => {
  const mod = loadExports(loadRegistration())
  const { ctx, registered } = makeCtx()
  mod.apply(ctx)

  assert.equal(registered.length, 2)
  assert.deepEqual(registered.map(({ definition }) => [definition.name, definition.key, definition.id]), [
    ['main', 'conversation', undefined],
    ['sidebar', undefined, 'studio-sidebar'],
  ])
})

test('apply：两个槽位 priority 均小于 0 才能 shadow 官方占用', () => {
  const mod = loadExports(loadRegistration())
  const { ctx, registered } = makeCtx()
  mod.apply(ctx)
  for (const { definition } of registered) {
    assert.equal(typeof definition.priority, 'number')
    assert.ok(definition.priority < 0, `${definition.name} priority 必须 < 0`)
  }
})

test('apply：槽未声明时等待 inject，不直接 register', () => {
  const mod = loadExports(loadRegistration())
  const injectCalls = []
  let registerCalls = 0
  const ctx = {
    slots: {
      inject(name, _callback) { injectCalls.push(name) },
      register() { registerCalls += 1 },
    },
    sessions: { list: sessionList() },
  }
  mod.apply(ctx)
  assert.deepEqual(injectCalls, ['main', 'sidebar'])
  assert.equal(registerCalls, 0)
})

test('sidebar：渲染品牌名、真实会话条目、新建和设置入口', () => {
  const mod = loadExports(loadRegistration())
  const { ctx, registered } = makeCtx()
  mod.apply(ctx)
  const { Component } = sidebarRegistration(registered)
  const text = collectText(Component({}))

  assert.ok(text.includes('Stock Workbench'))
  assert.ok(text.includes('新建会话'))
  assert.ok(text.includes('重构 DSH 前端适配层'))
  assert.ok(text.includes('设置'))
})

test('sidebar：折叠态返回最小渲染，不崩', () => {
  const mod = loadExports(loadRegistration())
  const { ctx, registered } = makeCtx()
  mod.apply(ctx)
  const { Component } = sidebarRegistration(registered)
  const tree = Component({ collapsed: true })
  assert.ok(tree)
  assert.equal(collectText(tree), 'W')
})
