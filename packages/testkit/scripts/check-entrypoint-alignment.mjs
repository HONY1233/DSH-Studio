/**
 * 入口对齐审计：渲染层调用的每个 query / command 必须在桥里有 `case`，
 * 或者有显式的中文不可用说明。两者都没有 = 点了只会弹兜底文案的坏入口。
 *
 * 用法：node packages/testkit/scripts/check-entrypoint-alignment.mjs
 * 有沉默接口时退出码为 1，可以直接挂进 `npm run check`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const RENDERER = join(root, 'apps/renderer-omp/src')
const BRIDGE = join(root, 'apps/desktop/src/studio-bridge.js')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

const queries = new Set()
const commands = new Set()
for (const file of walk(RENDERER)) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/(?:journal|client)?\.?query\(\s*"([a-zA-Z][\w.]*)"/g)) queries.add(match[1])
  for (const match of text.matchAll(/(?:journal|client)?\.?command\(\s*"([a-zA-Z][\w.]*)"/g)) commands.add(match[1])
}

const bridge = readFileSync(BRIDGE, 'utf8')
const cases = new Set([...bridge.matchAll(/case '([a-zA-Z][\w.]*)':/g)].map((match) => match[1]))
const reasons = new Set([...bridge.matchAll(/^\s*'([a-zA-Z][\w.]*)':\s*'[^']*',\s*$/gm)].map((match) => match[1]))

const silent = (set) => [...set].filter((name) => !cases.has(name) && !reasons.has(name)).sort()

const silentQueries = silent(queries)
const silentCommands = silent(commands)

console.log(`[entrypoints] renderer: ${queries.size} queries / ${commands.size} commands`)
console.log(`[entrypoints] bridge: ${cases.size} cases / ${reasons.size} explicit reasons`)

if (silentQueries.length === 0 && silentCommands.length === 0) {
  console.log('[entrypoints] PASS · 没有沉默接口')
  process.exit(0)
}

console.error('[entrypoints] FAIL · 以下接口既没有实现也没有中文说明：')
for (const name of silentQueries) console.error(`  query   ${name}`)
for (const name of silentCommands) console.error(`  command ${name}`)
process.exit(1)
