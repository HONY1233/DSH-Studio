import assert from 'node:assert/strict'
import test from 'node:test'

import { selectRendererEntry } from '../../../apps/renderer/src/workbench/entry.js'

test('renderer 默认走旧版回退入口', () => {
  assert.equal(selectRendererEntry(''), 'legacy')
  assert.equal(selectRendererEntry('?workbench=0'), 'legacy')
  assert.equal(selectRendererEntry('?workbench=true'), 'legacy')
})

test('renderer 只有显式 workbench=1 才启用新工作台', () => {
  assert.equal(selectRendererEntry('?workbench=1'), 'workbench')
  assert.equal(selectRendererEntry('?foo=bar&workbench=1'), 'workbench')
})
