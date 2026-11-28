import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  reduceWindowLifecycle,
  windowLifecycleProjection,
} from '../../workbench-core/src/index.js'

function nativeWindow(id) {
  return {
    id,
    title: id,
    geometry: { x: 0, y: 0, width: 640, height: 480, displayId: 'primary' },
    maximized: false,
    minimized: false,
    topmost: false,
    attachedTo: null,
  }
}

test('XC-01 internal and native adapters share close/minimize/maximize/restore semantics', () => {
  let internal = [{ id: 'shared', content: 'kept' }]
  let native = [nativeWindow('shared')]
  const apply = (op) => {
    internal = reduceWindowLifecycle(internal, op)
    native = reduceWindowLifecycle(native, op)
  }
  for (const op of [
    { kind: 'minimize', id: 'shared' },
    { kind: 'maximize', id: 'shared' },
    { kind: 'restore', id: 'shared' },
    { kind: 'setTopmost', id: 'shared', topmost: true },
    { kind: 'attach', id: 'shared', attachedTo: 'main' },
    { kind: 'detach', id: 'shared' },
  ]) {
    apply(op)
    assert.deepEqual(windowLifecycleProjection(internal[0]), windowLifecycleProjection(native[0]))
  }
  assert.equal(internal[0].content, 'kept')
  apply({ kind: 'close', id: 'shared' })
  assert.deepEqual(internal, [])
  assert.deepEqual(native, [])
  apply({ kind: 'close', id: 'shared' })
  assert.deepEqual(internal, [])
  assert.deepEqual(native, [])
})

test('XC-01 closing a host detaches dependent windows without losing their payload', () => {
  const windows = [
    nativeWindow('host'),
    { ...nativeWindow('child'), attachedTo: 'host', title: 'Child payload' },
    { ...nativeWindow('other'), attachedTo: 'main' },
  ]
  const next = reduceWindowLifecycle(windows, { kind: 'close', id: 'host' })
  assert.deepEqual(next.map((item) => item.id), ['child', 'other'])
  assert.equal(next[0].attachedTo, null)
  assert.equal(next[0].title, 'Child payload')
  assert.equal(next[1].attachedTo, 'main')
  assert.equal(windows[1].attachedTo, 'host', 'reducer must not mutate its input')
})

test('XC-01 malformed and duplicate window operations fail closed', () => {
  assert.throws(() => reduceWindowLifecycle([], { kind: 'unknown' }), error => error.code === 'INVALID_WINDOW_OPERATION')
  assert.throws(() => reduceWindowLifecycle([], { kind: 'attach', id: 'child', attachedTo: 'child' }), /cannot host itself/)
  assert.throws(() => reduceWindowLifecycle([], { kind: 'setTopmost', id: 'child', topmost: 'yes' }), /boolean/)
  assert.throws(() => reduceWindowLifecycle([nativeWindow('same'), nativeWindow('same')], { kind: 'close', id: 'same' }), /Duplicate window id/)
})
