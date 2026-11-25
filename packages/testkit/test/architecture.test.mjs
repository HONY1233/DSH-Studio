import test from 'node:test'
import assert from 'node:assert/strict'

import { RULES, violationsInText } from '../scripts/check-architecture.mjs'

const studioRule = RULES.find((rule) => rule.name === 'packages/studio-ui')
const file = 'packages/studio-ui/src/example.ts'

test('architecture：studio-ui 有独立的渲染层依赖边界', () => {
  assert.ok(studioRule, '必须登记 packages/studio-ui')
  assert.equal(studioRule.builtins, true)
  assert.deepEqual(studioRule.dirs, ['packages/studio-ui/src'])
  for (const name of ['electron', '@dsh-studio/runtime-client', '@dsh-studio/host-services']) {
    assert.ok(studioRule.forbid.some(([forbidden]) => forbidden === name), `必须禁止 ${name}`)
  }
})

test('architecture：studio-ui 允许 React、相对导入和注入端口', () => {
  const source = [
    "import { useMemo } from 'react'",
    "import type { CSSProperties } from 'react'",
    "import { createSessionPort } from '../ui-session-views/client.js'",
    "export const inject = ['slots', 'sessions']",
  ].join('\n')
  assert.deepEqual(violationsInText(file, source, [studioRule]), [])
})

test('architecture：studio-ui 禁止 Node 内建模块及 node: 前缀', () => {
  const source = [
    "import { readFileSync } from 'node:fs'",
    "import { DatabaseSync } from 'node:sqlite'",
    "import { join } from 'path'",
  ].join('\n')
  const violations = violationsInText(file, source, [studioRule])
  assert.equal(violations.length, 3)
  assert.deepEqual(violations.map((item) => item.line), [1, 2, 3])
  assert.ok(violations.every((item) => item.reason.includes('Node 内建模块')))
})

test('architecture：studio-ui 禁止直连 Electron、Runtime 和 Host 服务', () => {
  const source = [
    "import { app } from 'electron'",
    "import { RuntimeClient } from '@dsh-studio/runtime-client'",
    "import { createHostServices } from '@dsh-studio/host-services/index.js'",
  ].join('\n')
  const violations = violationsInText(file, source, [studioRule])
  assert.equal(violations.length, 3)
  assert.deepEqual(violations.map((item) => item.line), [1, 2, 3])
})
