import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/x0/display-recovery.json', import.meta.url), 'utf8'))

function validRect(rect) {
  return rect
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))
    && Number.isInteger(rect.x)
    && Number.isInteger(rect.y)
    && Number.isInteger(rect.width)
    && Number.isInteger(rect.height)
    && rect.width > 0
    && rect.height > 0
}

function contains(outer, inner) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
}

function displaysFor(testCase) {
  const overrides = new Map((testCase.displayOverrides ?? []).map((display) => [display.id, display]))
  return fixture.displays
    .filter((display) => testCase.availableDisplayIds.includes(display.id))
    .map((display) => overrides.get(display.id) ?? display)
}

test('display recovery fixture：显示器 workArea 必须位于 bounds 内', () => {
  assert.equal(fixture.units, 'Electron DIP')
  for (const display of fixture.displays) {
    assert.ok(validRect(display.bounds), `${display.label} bounds 非法`)
    assert.ok(validRect(display.workArea), `${display.label} workArea 非法`)
    assert.ok(contains(display.bounds, display.workArea), `${display.label} workArea 越出 bounds`)
    assert.ok(display.scaleFactor > 0)
  }
})

test('display recovery fixture：覆盖双屏、负坐标、DPI、旋转、拔屏与非法几何', () => {
  assert.deepEqual(
    [...fixture.cases.map((item) => item.id)].sort(),
    [
      'dpi-change-keeps-dip-geometry',
      'invalid-bounds-are-rejected',
      'negative-coordinate-restore',
      'offscreen-window-clamps-to-work-area',
      'oversized-window-fits-work-area',
      'removed-display-falls-back-to-primary',
      'right-hidpi-restore',
      'rotated-display-rereads-geometry',
    ].sort(),
  )
  assert.ok(fixture.policy.some((line) => line.includes('负坐标合法')))
  assert.ok(fixture.policy.some((line) => line.includes('scaleFactor 变化不直接乘算')))
  assert.ok(fixture.policy.some((line) => line.includes('拔屏')))
})

test('display recovery fixture：每个成功结果都完整落在目标 workArea 内', () => {
  for (const testCase of fixture.cases) {
    if (testCase.expectedError) continue
    const display = displaysFor(testCase).find((item) => item.id === testCase.expectedDisplayId)
    assert.ok(display, `${testCase.id} 目标显示器不存在`)
    assert.ok(validRect(testCase.expectedBounds), `${testCase.id} expectedBounds 非法`)
    assert.ok(
      contains(display.workArea, testCase.expectedBounds),
      `${testCase.id} 恢复结果越出 display ${display.id} workArea`,
    )
  }
})

test('display recovery fixture：关键恢复结果与安全回退已冻结', () => {
  const byId = new Map(fixture.cases.map((item) => [item.id, item]))
  assert.deepEqual(byId.get('negative-coordinate-restore').expectedBounds, {
    x: -1500, y: -100, width: 900, height: 700,
  })
  assert.equal(byId.get('removed-display-falls-back-to-primary').expectedDisplayId, 1)
  assert.deepEqual(byId.get('oversized-window-fits-work-area').expectedBounds, {
    x: 1920, y: 48, width: 2560, height: 1352,
  })
  assert.equal(byId.get('invalid-bounds-are-rejected').expectedError, 'INVALID_WINDOW_BOUNDS')
})
