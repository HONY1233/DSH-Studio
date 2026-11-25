/**
 * 三态读模型单测。
 *
 * 核心约束：empty() 与 unavailable() 必须带原因，否则抛错。
 * 这条是「防止空数据被当成正常数据」的机械保障。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Provenance,
  dataOr,
  empty,
  isReadState,
  ready,
  unavailable,
} from '@dsh-studio/contract'

test('ready 带来源与时间戳', () => {
  const r = ready({ a: 1 }, Provenance.host)
  assert.equal(r.state, 'ready')
  assert.deepEqual(r.data, { a: 1 })
  assert.equal(r.source, 'host')
  assert.ok(Date.parse(r.generatedAt) > 0)
})

test('ready 默认来源是 runtime', () => {
  assert.equal(ready({}).source, 'runtime')
})

test('empty 必须给 reason，否则抛错', () => {
  assert.throws(() => empty(''), /必须给出 reason/)
  assert.throws(() => empty(undefined), /必须给出 reason/)
})

test('empty 可以带 howToProduce', () => {
  const r = empty('本会话还没有产生用量', { howToProduce: '发一条消息' })
  assert.equal(r.state, 'empty')
  assert.equal(r.reason, '本会话还没有产生用量')
  assert.equal(r.howToProduce, '发一条消息')
  assert.equal(r.source, 'runtime')
})

test('unavailable 必须给 reason，可带替代做法', () => {
  assert.throws(() => unavailable(''), /必须给出 reason/)
  const r = unavailable('DSH 没有模型适配层', '在运行时页直接选模型')
  assert.equal(r.state, 'unavailable')
  assert.equal(r.alternative, '在运行时页直接选模型')
})

test('isReadState 能识别三种合法形态并拒绝其它', () => {
  assert.equal(isReadState(ready([])), true)
  assert.equal(isReadState(empty('no data')), true)
  assert.equal(isReadState(unavailable('nope')), true)

  assert.equal(isReadState([]), false)
  assert.equal(isReadState(null), false)
  assert.equal(isReadState({ state: 'ready' }), false, 'ready 缺少 source/data')
  assert.equal(isReadState({ state: 'empty' }), false, 'empty 缺 reason')
  assert.equal(isReadState({ state: 'weird' }), false)
})

test('dataOr 只在 ready 时取数据', () => {
  assert.deepEqual(dataOr(ready([1, 2]), []), [1, 2])
  assert.deepEqual(dataOr(empty('none'), []), [])
  assert.equal(dataOr(unavailable('no'), 'fallback'), 'fallback')
  assert.equal(dataOr(null, 'x'), 'x')
})
