// @vitest-environment jsdom
/**
 * 工具调用渲染。
 *
 * 三条重点：
 * - 收起态只一行，但摘要要挑出最有信息量的参数（`path` / `command` …）；
 * - **非法 JSON 也要能看**（模型确实会产出坏 JSON，这时原样显示比空白强）；
 * - 展开才渲染参数与结果，收起时不占版面（一次任务几十个调用）。
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ToolCallState } from '../session-derived/conversation.js'
import {
  defaultToolCallLabels,
  prettyArguments,
  summarizeArguments,
  ToolCallView,
} from './tool-call-view.js'

const base: ToolCallState = {
  callId: 'c1',
  name: 'read_file',
  arguments: '{"path":"src/app.ts","limit":100}',
  status: 'running',
}

describe('summarizeArguments', () => {
  it('优先取 path / command 这类有信息量的键', () => {
    expect(summarizeArguments('{"path":"src/app.ts","limit":100}')).toBe('src/app.ts')
    expect(summarizeArguments('{"command":"ls -la"}')).toBe('ls -la')
    expect(summarizeArguments('{"pattern":"TODO","glob":"*.ts"}')).toBe('TODO')
  })

  it('没有常用键时取第一个字符串值', () => {
    expect(summarizeArguments('{"foo":"bar","n":1}')).toBe('bar')
  })

  it('只有数字/布尔时列出键名', () => {
    expect(summarizeArguments('{"a":1,"b":true}')).toBe('{a, b}')
  })

  it('数组给项数', () => {
    expect(summarizeArguments('[1,2,3]')).toBe('[3 项]')
  })

  it('空参数给空串', () => {
    expect(summarizeArguments('')).toBe('')
    expect(summarizeArguments('   ')).toBe('')
  })

  it('非法 JSON 原样显示（截到 80 字符）—— 不能变成空白', () => {
    expect(summarizeArguments('{"path": broken')).toBe('{"path": broken')
    const long = `{"broken": ${'x'.repeat(200)}`
    const out = summarizeArguments(long)
    expect(out.length).toBeLessThanOrEqual(81)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('prettyArguments', () => {
  it('合法 JSON 缩进美化', () => {
    expect(prettyArguments('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  it('非法 JSON 原样返回，不抛错', () => {
    expect(prettyArguments('{oops')).toBe('{oops')
    expect(prettyArguments('')).toBe('')
  })
})

describe('ToolCallView', () => {
  it('收起态显示工具名、摘要与状态，不渲染详情', () => {
    render(<ToolCallView tool={base} />)

    const chip = screen.getByTestId('tool-call')
    expect(chip.getAttribute('data-status')).toBe('running')
    expect(chip.textContent).toContain('read_file')
    expect(chip.textContent).toContain('src/app.ts')
    expect(chip.textContent).toContain('运行中')
    expect(screen.queryByTestId('tool-call-detail')).toBeNull()
  })

  it('点击展开后出现参数与结果区', () => {
    render(<ToolCallView tool={{ ...base, status: 'done', result: '文件内容' }} />)

    fireEvent.click(screen.getByRole('button'))
    const detail = screen.getByTestId('tool-call-detail')
    expect(detail.textContent).toContain('参数')
    expect(detail.textContent).toContain('"path": "src/app.ts"') // 已美化
    expect(detail.textContent).toContain('文件内容')
    expect(screen.getByTestId('tool-call').getAttribute('data-expanded')).toBe('true')
  })

  it('再点一次收起', () => {
    render(<ToolCallView tool={base} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('tool-call-detail')).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('tool-call-detail')).toBeNull()
  })

  it('error 状态展开后结果用错误码与失败文案', () => {
    render(<ToolCallView tool={{ ...base, status: 'error', error: 'ENOENT' }} />)

    expect(screen.getByTestId('tool-call').textContent).toContain('失败')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('tool-call-detail').textContent).toContain('ENOENT')
  })

  it('运行中展开时结果区提示"运行中"而不是空白', () => {
    render(<ToolCallView tool={base} />)
    fireEvent.click(screen.getByRole('button'))
    const detail = screen.getByTestId('tool-call-detail')
    expect(detail.textContent).toContain('运行中')
  })

  it('完成后没有输出时给占位文案', () => {
    render(<ToolCallView tool={{ ...base, status: 'done', result: '' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('tool-call-detail').textContent).toContain('没有输出')
  })

  it('没有参数时不渲染参数区', () => {
    render(<ToolCallView tool={{ ...base, arguments: '' }} />)
    fireEvent.click(screen.getByRole('button'))
    const detail = screen.getByTestId('tool-call-detail')
    expect(detail.textContent).not.toContain('参数')
    // 结果区仍在，形状不破
    expect(detail.textContent).toContain('结果')
  })

  it('工具名缺失时显示占位而不是空白 chip', () => {
    render(<ToolCallView tool={{ ...base, name: '' }} />)
    expect(screen.getByTestId('tool-call').textContent).toContain('tool')
  })

  it('无障碍：按钮的 aria-expanded 与展开状态一致', () => {
    render(<ToolCallView tool={base} />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe(defaultToolCallLabels.expand)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe(defaultToolCallLabels.collapse)
  })

  it('自定义文案生效', () => {
    render(
      <ToolCallView
        tool={{ ...base, status: 'done' }}
        labels={{ ...defaultToolCallLabels, done: 'DONE', result: 'OUTPUT' }}
      />,
    )
    expect(screen.getByTestId('tool-call').textContent).toContain('DONE')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('tool-call-detail').textContent).toContain('OUTPUT')
  })
})

// ---------------------------------------------------------------- 结果全文

/** 展开 chip，再返回结果区 pre 的文本。 */
function openDetail(): string {
  fireEvent.click(screen.getByRole("button"))
  return screen.getByTestId("tool-call-detail").textContent ?? ""
}

describe("结果全文查看", () => {
  it("短结果直接全给，不出现展开按钮", () => {
    render(<ToolCallView tool={{ ...base, status: "done", result: "文件内容" }} />)
    expect(openDetail()).toContain("文件内容")
    expect(screen.queryByTestId("tool-call-result-toggle")).toBeNull()
  })

  it("长结果默认只给前 400 字符，其余靠展开", () => {
    // 必须真超过 400：之前用 300 + 尾巴（共 308）测过一次，压根不触发展开
    const long = "a".repeat(600) + "TAIL在末尾"
    render(<ToolCallView tool={{ ...base, status: "done", result: long }} />)
    fireEvent.click(screen.getAllByRole("button")[0])
    const detail = screen.getByTestId("tool-call-detail")
    const before = detail.textContent ?? ""
    expect(before).not.toContain("TAIL在末尾")
    expect(before).toContain("展开全文")

    fireEvent.click(screen.getByTestId("tool-call-result-toggle"))
    expect(detail.textContent ?? "").toContain("TAIL在末尾")
    // 再点收起
    fireEvent.click(screen.getByTestId("tool-call-result-toggle"))
    expect(detail.textContent ?? "").not.toContain("TAIL在末尾")
  })

  it("按钮上的字符数用原文总长度，不是保留长度", () => {
    const huge = "b".repeat(25_000)
    render(
      <ToolCallView
        tool={{ ...base, status: "done", result: "b".repeat(20_000), resultChars: 25_000, resultClipped: true }}
      />,
    )
    fireEvent.click(screen.getAllByRole("button")[0])
    expect(screen.getByTestId("tool-call-result-toggle").textContent).toContain("25000")
    // 未展开时不该出现越界提示（还没到底，说了也是噪音）
    expect(screen.queryByTestId("tool-call-result-clipped")).toBeNull()
    void huge
  })

  it("越界时展开后明确说明剩下的在日志里", () => {
    render(
      <ToolCallView
        tool={{ ...base, status: "done", result: "c".repeat(500), resultChars: 42_000, resultClipped: true }}
      />,
    )
    fireEvent.click(screen.getAllByRole("button")[0])
    fireEvent.click(screen.getByTestId("tool-call-result-toggle"))
    const note = screen.getByTestId("tool-call-result-clipped")
    expect(note.textContent).toContain("42000")
    expect(note.textContent).toContain("会话日志")
  })

  it("错误码与结果正文同时显示，不互相遮蔽", () => {
    render(
      <ToolCallView tool={{ ...base, status: "error", error: "ENOENT", result: "命令失败" }} />,
    )
    fireEvent.click(screen.getAllByRole("button")[0])
    const detail = screen.getByTestId("tool-call-detail")
    expect(screen.getByTestId("tool-call-error").textContent).toBe("ENOENT")
    expect(detail.textContent ?? "").toContain("命令失败")
  })

  it("展开按钮的 aria-expanded 跟着状态走", () => {
    render(<ToolCallView tool={{ ...base, status: "done", result: "d".repeat(500) }} />)
    fireEvent.click(screen.getAllByRole("button")[0])
    const toggle = screen.getByTestId("tool-call-result-toggle")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(screen.getByTestId("tool-call-result-toggle").getAttribute("aria-expanded")).toBe("true")
  })
})
