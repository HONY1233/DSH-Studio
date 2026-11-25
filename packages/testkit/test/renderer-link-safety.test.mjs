import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import {
  normalizeExtensionUrl,
  normalizeExternalBrowserUrl,
  normalizeExternalUrl,
  normalizeMailtoUrl,
} from '../../../apps/renderer-omp/src/browser/urlSafety.ts'

const source = relative => readFileSync(new URL(`../../../apps/renderer-omp/src/${relative}`, import.meta.url), 'utf8')

test('strict external URLs accept only explicit HTTP(S) and return the normalized value', () => {
  assert.equal(normalizeExternalUrl(' https://example.com/a?b=1#c '), 'https://example.com/a?b=1#c')
  assert.equal(normalizeExternalUrl('http://localhost:5174/'), 'http://localhost:5174/')
  assert.equal(normalizeExternalUrl('https://[::1]:8443/path'), 'https://[::1]:8443/path')
  assert.equal(normalizeExternalUrl('https://例子.测试/路径'), 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84')
})

test('dangerous, credentialed, malformed, control, and oversized external URLs fail closed', () => {
  for (const raw of [
    '', '   ', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///C:/Windows/win.ini',
    'custom://danger', 'mailto:user@example.com', '//example.com/path', 'example.com/path',
    'https://user:pass@example.com', 'https://user@example.com', 'https://:pass@example.com',
    'https://', 'https:///example.com', 'https://?example.com', 'https://example.com:bad/',
    'https://example.com/\nfoo', 'https://example.com/\tfoo', 'https://example.com/\u0000foo',
    'https://example.com/\u007ffoo', 'https://example.com/a b', 'https://example.com\\@evil.test/',
    'https:example.com', 'https:\\example.com', 'a'.repeat(8193), null, undefined, 42, {},
  ]) assert.equal(normalizeExternalUrl(raw), null, JSON.stringify(raw))
})

test('address-bar normalization adds HTTPS only to bare hosts and never repairs unsafe schemes', () => {
  assert.equal(normalizeExternalBrowserUrl(' example.com/path '), 'https://example.com/path')
  assert.equal(normalizeExternalBrowserUrl('localhost:5174'), 'https://localhost:5174/')
  assert.equal(normalizeExternalBrowserUrl('http://example.com'), 'http://example.com/')
  for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', 'https:443', 'mailto:user@example.com', 'https://user:pass@example.com']) {
    assert.equal(normalizeExternalBrowserUrl(raw), null, raw)
  }
})

test('mailto links are parsed separately and reject empty or control-containing targets', () => {
  assert.equal(normalizeMailtoUrl(' mailto:user@example.com?subject=Hello '), 'mailto:user@example.com?subject=Hello')
  for (const raw of ['mailto:', 'mailto:user@example.com\r\nBcc:other@example.com', 'mailto://user:pass@example.com', 'https://example.com', 'javascript:alert(1)']) {
    assert.equal(normalizeMailtoUrl(raw), null, raw)
  }
})

test('extension routing accepts only structural custom schemes and blocks script/data/local URLs even if registered', () => {
  assert.equal(normalizeExtensionUrl('vscode://file/path:1:2'), 'vscode://file/path:1:2')
  assert.equal(normalizeExtensionUrl('custom:open?x=1'), 'custom:open?x=1')
  for (const raw of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'livescript:alert(1)', 'mocha:alert(1)', 'data:text/html,x', 'file:///tmp/x', 'about:blank', 'blob:https://example.com/id', 'https://example.com', 'mailto:user@example.com', 'custom://bad\npath', 'not a uri']) {
    assert.equal(normalizeExtensionUrl(raw), null, raw)
  }
})

test('shared browser link boundary normalizes activation and never renders an unchecked href', () => {
  const text = source('browser/browserLinks.tsx')
  assert.match(text, /const safeUrl = normalizeExternalUrl\(url\)/)
  assert.match(text, /globalThis\.ompStudioChrome\?\.openUrl/)
  assert.match(text, /void openUrl\(\{ url \}\)/)
  assert.match(text, /globalThis\.open\(url, "_blank", "noopener,noreferrer"\)/)
  assert.match(text, /const safeHref = normalizeExternalUrl\(href\)/)
  assert.match(text, /<a href=\{safeHref\}/)
  assert.match(text, /<a href=\{mailto\}/)
  assert.match(text, /onClick\?\.\(event\)/)
  assert.match(text, /if \(event\.defaultPrevented\) return/)
  assert.match(text, /event\.preventDefault\(\)/)
  assert.match(text, /openMailtoLink\(mailto\)/)
  assert.doesNotMatch(text, /<a href=\{href\}/)
  assert.match(source('browser/terminalBrowserLinks.ts'), /activate: \(\) => openBrowserLink\(url\)/)
})

test('Markdown, resources, citations, GitHub, update, and extension links share the strict boundary', () => {
  const markdown = source('conversation/markdown.tsx')
  assert.match(markdown, /normalizeExternalUrl\(url\) !== null/)
  assert.match(markdown, /normalizeMailtoUrl\(url\) !== null/)
  assert.match(markdown, /urlTransform=\{markdownUrlTransform\}/)
  assert.match(markdown, /normalizeExtensionUrl\(value\) !== null/)
  assert.match(markdown, /<img src=\{safeUrl\}/)

  const resources = source('capabilities/ResourceMarkdown.tsx')
  assert.match(resources, /normalizeExternalUrl\(raw\) \?\? normalizeMailtoUrl\(raw\)/)
  assert.match(resources, /<a href=\{safeHref\}/)
  assert.doesNotMatch(resources, /\^\(\?:https\?/)

  const citations = source('conversation/ToolBody.tsx')
  assert.match(citations, /const normalizeUrl = normalizeExternalBrowserUrl/)
  assert.match(citations, /<SafeExternalLink key=\{index\}/)

  const github = source('git/GitHubPanel.tsx')
  assert.equal((github.match(/<SafeExternalLink/g) ?? []).length, 4)
  assert.doesNotMatch(github, /<a href=\{/)

  const update = source('AppUpdateDialog.tsx')
  assert.match(update, /normalizeExternalUrl\(update\.manualInstallUrl\)/)
  assert.match(update, /normalizeExternalUrl\(update\.htmlUrl\)/)
  assert.match(update, /<SafeExternalLink/)

  const extensions = source('conversation/ExtensionLinks.tsx')
  assert.match(extensions, /normalizeExtensionUrl\(href\)/)
  assert.match(extensions, /owner\.activate\?\.\(extensionUrl\)/)

  assert.match(source('models/WebSearchPanel.tsx'), /const keyUrl = normalizeExternalUrl\(keyState\?\.keyUrl\)/)
  assert.match(source('skillshare/SkillsharePane.tsx'), /const actionUrl = normalizeExternalUrl\(action\?\.link\)/)
})

function rendererSourceFiles() {
  const root = new URL('../../../apps/renderer-omp/src/', import.meta.url)
  const files = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory)
      if (entry.isDirectory()) pending.push(url)
      else if (/\.(?:tsx?|jsx?)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) files.push(url)
    }
  }
  return files
}

test('all remaining raw anchors and window.open calls are normalized values or intentional internal/native links', () => {
  for (const file of rendererSourceFiles()) {
    const relative = file.pathname.split('/renderer-omp/src/')[1]
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/<a\b[^>]*?\bhref=(?:"([^"]*)"|\{([^}]+)\})/gu)) {
      const [, literal, expression] = match
      if (literal !== undefined) {
        assert.ok(literal.startsWith('#'), `${relative}: unchecked literal anchor ${literal}`)
        continue
      }
      const value = expression.trim()
      if (relative === 'files/fileLinks.tsx' && value === 'href') continue
      assert.ok(value === 'safeHref' || value === 'mailto' || /^[`'"]#/u.test(value), `${relative}: unchecked anchor expression ${value}`)
    }
    for (const match of text.matchAll(/window\.open\(([^,\n]+)/gu)) {
      const target = match[1].trim()
      if (relative === 'dock/NativeFloat.tsx' && target === 'ticket.url') {
        assert.match(text, /prepareFloatWindow!/u)
        continue
      }
      assert.equal(target, 'safeUrl', `${relative}: unchecked window.open target ${target}`)
    }
  }
  const localFiles = source('files/fileLinks.tsx')
  assert.match(localFiles, /parseFileReference\(href/)
  assert.match(localFiles, /event\.preventDefault\(\)/)
})
