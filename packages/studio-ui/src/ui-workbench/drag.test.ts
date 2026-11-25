import { describe, expect, it } from 'vitest'

import { type TabId } from '../workbench/index.js'

import { DRAG_THRESHOLD, beginDrag, dragPreview, dropDrag, moveDrag } from './drag.js'

const WORK = { x: 0, y: 0, w: 1200, h: 800 }
const tabId = 't1' as TabId

function session() {
  return beginDrag({ tabId, from: 'pane-1', start: { x: 300, y: 300 }, size: { w: 480, h: 360 } })
}

describe('beginDrag', () => {
  it('浮窗矩形按抓取点锚定', () => {
    const s = session()
    expect(s.active).toBe(false)
    expect(s.rect).toEqual({ x: 300 - 24, y: 300 - 16, w: 480, h: 360 })
  })
})

describe('moveDrag', () => {
  it('未越过阈值不算拖动', () => {
    const s = moveDrag(session(), { x: 303, y: 302 }, WORK)
    expect(s.active).toBe(false)
    expect(dragPreview(s)).toBeUndefined()
  })

  it('越过阈值后激活，浮窗 1:1 跟随指针', () => {
    const s = moveDrag(session(), { x: 340, y: 330 }, WORK)
    expect(s.active).toBe(true)
    expect(s.rect.x).toBe(340 - 24)
    expect(s.rect.y).toBe(330 - 16)
  })

  it('靠近角落时给出落区而不是浮窗预览', () => {
    const s = moveDrag(session(), { x: 30, y: 30 }, WORK)
    expect(s.zone?.corner).toBe('tl')
    expect(dragPreview(s)?.kind).toBe('zone')
  })

  it('按住修饰键时暂停吸附，退化为自由浮窗', () => {
    const s = moveDrag(session(), { x: 30, y: 30 }, WORK, { modifierPaused: true })
    expect(s.zone).toBeUndefined()
    expect(dragPreview(s)?.kind).toBe('float')
  })

  it('浮窗预览被钳进工作区', () => {
    const s = moveDrag(session(), { x: 5000, y: 5000 }, WORK)
    expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(WORK.w)
    expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(WORK.h)
  })

  it('拖动中保持上一落区（sticky 缓冲）', () => {
    const near = moveDrag(session(), { x: 30, y: 400 }, WORK)
    expect(near.zone?.region).toBe('left')
    const slipped = moveDrag(near, { x: 110, y: 400 }, WORK)
    expect(slipped.zone?.region).toBe('left')
  })
})

describe('dropDrag', () => {
  it('没到阈值就松手 = click，不产生任何结果', () => {
    expect(dropDrag(session())).toBeUndefined()
  })

  it('落在落区上返回停靠目标', () => {
    const s = moveDrag(session(), { x: 30, y: 30 }, WORK)
    expect(dropDrag(s)).toEqual({ dest: { to: 'corner', corner: 'tl' } })
  })

  it('落在空白处返回浮窗矩形', () => {
    const s = moveDrag(session(), { x: 600, y: 400 }, WORK)
    const result = dropDrag(s)
    expect(result?.dest).toBeUndefined()
    expect(result?.rect?.w).toBe(480)
  })

  it('阈值常量与文档一致', () => {
    expect(DRAG_THRESHOLD).toBe(6)
  })
})
