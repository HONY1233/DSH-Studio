// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloneContentPreview } from './preview.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cloneContentPreview', () => {
  it('复制表单状态和滚动位置，同时移除身份信息与活跃内容', () => {
    const source = document.createElement('div')
    source.id = 'source-panel'
    const input = document.createElement('input')
    input.id = 'draft'
    input.value = 'old'
    const textarea = document.createElement('textarea')
    textarea.id = 'notes'
    textarea.value = 'old notes'
    const select = document.createElement('select')
    select.id = 'choice'
    for (const [value, label] of [['a', 'A'], ['b', 'B']]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      select.appendChild(option)
    }
    const iframe = document.createElement('iframe')
    iframe.src = 'https://example.invalid'
    const scroller = document.createElement('div')
    scroller.id = 'scroller'
    scroller.style.overflow = 'auto'
    const body = document.createElement('div')
    body.style.height = '200px'
    body.textContent = 'body'
    scroller.appendChild(body)
    source.append(input, textarea, select, iframe, scroller)
    document.body.appendChild(source)
    input.value = '中文草稿'
    textarea.value = '保留备注'
    select.selectedIndex = 1
    scroller.scrollTop = 48
    scroller.scrollLeft = 12

    const clone = cloneContentPreview(source)

    expect(clone.querySelector('input')?.value).toBe('中文草稿')
    expect(clone.querySelector('textarea')?.value).toBe('保留备注')
    expect(clone.querySelector('select')?.selectedIndex).toBe(1)
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.querySelector('iframe')).toBeNull()
    expect(clone.hasAttribute('inert')).toBe(true)
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    const clonedScroller = clone.querySelector('[style*="overflow"]') as HTMLDivElement
    expect(clonedScroller.scrollTop).toBe(48)
    expect(clonedScroller.scrollLeft).toBe(12)
    expect(source.querySelector('iframe')).not.toBeNull()
    expect(input.value).toBe('中文草稿')
    source.remove()
  })

  it('可复制二维 canvas 位图', () => {
    const source = document.createElement('canvas')
    source.width = 20
    source.height = 10
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
    )

    const clone = cloneContentPreview(source) as HTMLCanvasElement

    expect(clone.width).toBe(20)
    expect(clone.height).toBe(10)
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0)
  })
})
