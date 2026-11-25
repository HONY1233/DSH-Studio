// @vitest-environment jsdom
/**
 * 图片全屏查看（lightbox）。
 *
 * 重点是四件容易做漏的事：Esc / 点背景关闭、点图片**不**关闭、
 * 焦点进出、背景滚动锁。
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { defaultLightboxLabels, ImageLightbox } from './image-lightbox.js'

function open(overrides: Partial<{ name: string; bytes: number }> = {}) {
  const onClose = vi.fn()
  const view = render(<ImageLightbox url="blob:mock" onClose={onClose} {...overrides} />)
  return { onClose, ...view }
}

describe('ImageLightbox', () => {
  it('渲染遮罩、文件名与工具条', () => {
    open({ name: 'diagram.png', bytes: 4096 })

    expect(screen.getByTestId('image-lightbox').getAttribute('role')).toBe('dialog')
    expect(screen.getByTestId('image-lightbox').getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('diagram.png')).toBeDefined()
    expect(screen.getByText('4.0 KB')).toBeDefined()
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:mock')
  })

  it('没有文件名时用占位文案', () => {
    open()
    expect(screen.getByRole('img').getAttribute('alt')).toBe(defaultLightboxLabels.image)
  })

  it('另存是一个带 download 的链接（blob 没有可分享 URL，只能下载）', () => {
    open({ name: 'shot.png' })
    const save = screen.getByTestId('image-lightbox-save') as HTMLAnchorElement
    expect(save.getAttribute('href')).toBe('blob:mock')
    expect(save.getAttribute('download')).toBe('shot.png')
    expect(save.textContent).toBe(defaultLightboxLabels.save)
  })

  it('没有文件名时另存给默认文件名', () => {
    open()
    expect((screen.getByTestId('image-lightbox-save') as HTMLAnchorElement).getAttribute('download')).toBe('image.png')
  })

  it('Esc 关闭', () => {
    const { onClose } = open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点背景关闭', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByTestId('image-lightbox'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点图片本身不关闭（正在看图时误触很烦）', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点工具条不关闭', () => {
    const { onClose } = open({ name: 'a.png' })
    fireEvent.click(screen.getByText('a.png'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('关闭按钮可点，且打开时自动获得焦点', () => {
    const { onClose } = open()
    const close = screen.getByTestId('image-lightbox-close')
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('打开时锁住背景滚动，卸载后还原', () => {
    const before = document.body.style.overflow
    const { unmount } = render(<ImageLightbox url="blob:mock" onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe(before)
  })

  it('卸载后不再响应 Esc', () => {
    const onClose = vi.fn()
    const { unmount } = render(<ImageLightbox url="blob:mock" onClose={onClose} />)
    unmount()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('其它按键不触发关闭', () => {
    const { onClose } = open()
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('自定义文案生效', () => {
    render(
      <ImageLightbox
        url="blob:mock"
        name="x.png"
        onClose={() => {}}
        labels={{ close: 'CLOSE', save: 'SAVE', image: 'IMG', hint: 'HINT', pagesHint: 'PAGES', previous: 'PREV', next: 'NEXT' }}
      />,
    )
    expect(screen.getByTestId('image-lightbox-close').textContent).toBe('CLOSE')
    expect(screen.getByTestId('image-lightbox-save').textContent).toBe('SAVE')
    expect(screen.getByText('HINT')).toBeDefined()
  })
})

// ---------------------------------------------------------------- 多图翻页

const ITEMS = [
  { url: "blob:a", name: "a.png", bytes: 100 },
  { url: "blob:b", name: "b.png", bytes: 200 },
  { url: "blob:c", name: "c.png", bytes: 300 },
]

describe("ImageLightbox 多图", () => {
  it("单图不渲染翻页控件与计数", () => {
    open({ name: "one.png" })
    expect(screen.queryByTestId("image-lightbox-counter")).toBeNull()
    expect(screen.queryByTestId("image-lightbox-next")).toBeNull()
  })

  it("多图按 index 打开对应那张，并显示计数", () => {
    render(<ImageLightbox items={ITEMS} index={1} onClose={() => {}} />)
    expect(screen.getByTestId("image-lightbox-counter").textContent).toContain("2 / 3")
    expect(screen.getByAltText("b.png")).toBeDefined()
    // 另存指向当前这张
    expect(screen.getByTestId("image-lightbox-save").getAttribute("href")).toBe("blob:b")
  })

  it("点下一张/上一张按钮切换", () => {
    render(<ImageLightbox items={ITEMS} index={0} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId("image-lightbox-next"))
    expect(screen.getByAltText("b.png")).toBeDefined()
    fireEvent.click(screen.getByTestId("image-lightbox-prev"))
    expect(screen.getByAltText("a.png")).toBeDefined()
  })

  it("方向键翻页，两端不越界", () => {
    render(<ImageLightbox items={ITEMS} index={0} onClose={() => {}} />)
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(screen.getByAltText("a.png")).toBeDefined()
    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByAltText("c.png")).toBeDefined()
    expect(screen.getByTestId("image-lightbox-counter").textContent).toContain("3 / 3")
  })

  it("到边时按钮禁用（视觉与语义都要说清没有下一张）", () => {
    render(<ImageLightbox items={ITEMS} index={2} onClose={() => {}} />)
    expect((screen.getByTestId("image-lightbox-next") as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId("image-lightbox-prev") as HTMLButtonElement).disabled).toBe(false)
  })

  it("index 越界时夹到范围内，不渲染空图", () => {
    render(<ImageLightbox items={ITEMS} index={99} onClose={() => {}} />)
    expect(screen.getByAltText("c.png")).toBeDefined()
  })

  it("多图时提示文案换成含翻页说明的那条", () => {
    render(<ImageLightbox items={ITEMS} index={0} onClose={() => {}} />)
    expect(screen.getByTestId("image-lightbox").textContent).toContain("← → 切换")
  })

  it("翻页期间 Esc 仍然直接关闭", () => {
    const onClose = vi.fn()
    render(<ImageLightbox items={ITEMS} index={0} onClose={onClose} />)
    fireEvent.keyDown(window, { key: "ArrowRight" })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("空列表不渲染任何东西（不给空遮罩挡住整页）", () => {
    const { container } = render(<ImageLightbox items={[]} onClose={() => {}} />)
    expect(container.querySelector('[data-testid="image-lightbox"]')).toBeNull()
  })
})
