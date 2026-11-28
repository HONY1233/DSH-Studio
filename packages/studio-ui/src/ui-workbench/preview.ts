const BLOCKED_PREVIEW_SELECTOR = [
  'script',
  'iframe',
  'webview',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'style',
  'audio',
  'video',
  'source',
].join(', ')

const WORKBENCH_METADATA = [
  'data-tab-content-host',
  'data-tab-panel',
  'data-tab-id',
  'data-pane-id',
  'data-drop-host',
  'data-drop-region',
  'data-testid',
]

function copyCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
  if (source.width === 0 || source.height === 0) return
  target.width = source.width
  target.height = source.height
  const context = target.getContext('2d')
  if (!context) return
  try {
    context.drawImage(source, 0, 0)
  } catch {
    // WebGL/tainted canvas 无法可靠复制时保留空白画布，不影响拖动。
  }
}

function copyFormState(source: Element, target: Element): void {
  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
    if (source.type !== 'file') target.value = source.value
    target.checked = source.checked
    target.indeterminate = source.indeterminate
    return
  }
  if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
    target.value = source.value
    return
  }
  if (source instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
    target.selectedIndex = source.selectedIndex
    const sourceOptions = Array.from(source.options)
    const targetOptions = Array.from(target.options)
    for (let index = 0; index < targetOptions.length; index += 1) {
      targetOptions[index].selected = sourceOptions[index]?.selected ?? false
    }
  }
}

/** 克隆当前正文作为惰性预览；不复制事件、脚本或会重新加载的嵌入内容。 */
export function cloneContentPreview(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const sources = [source, ...Array.from(source.querySelectorAll('*'))]
  const targets = [clone, ...Array.from(clone.querySelectorAll('*'))]

  for (let index = 0; index < sources.length; index += 1) {
    const original = sources[index]
    const copied = targets[index]
    if (!(original instanceof HTMLElement) || !(copied instanceof HTMLElement)) continue

    copyFormState(original, copied)
    copied.scrollTop = original.scrollTop
    copied.scrollLeft = original.scrollLeft
    if (original instanceof HTMLCanvasElement && copied instanceof HTMLCanvasElement) {
      copyCanvas(original, copied)
    }

    copied.removeAttribute('id')
    copied.removeAttribute('for')
    copied.removeAttribute('aria-labelledby')
    copied.removeAttribute('aria-describedby')
    copied.removeAttribute('aria-controls')
    copied.removeAttribute('headers')
    copied.removeAttribute('autofocus')
    for (const attribute of WORKBENCH_METADATA) copied.removeAttribute(attribute)
  }

  clone.querySelectorAll(BLOCKED_PREVIEW_SELECTOR).forEach((node) => node.remove())
  clone.setAttribute('data-drag-preview-content', 'true')
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.style.pointerEvents = 'none'
  clone.style.userSelect = 'none'
  return clone
}
