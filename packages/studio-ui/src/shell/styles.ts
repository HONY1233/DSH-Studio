/**
 * 插件自带的最小样式。
 *
 * 只有两样东西需要全局注入：
 * 1) 流式光标的关键帧动画（内联 style 里只能引用名字，定义不了 keyframes）；
 * 2) 滚动条细化 —— 主区与面板都是独立滚动容器，默认滚动条在深色主题下太抢眼。
 *
 * 其余样式一律走内联对象：工作台的组件散在六层包里，全局类名会让"谁负责这个元素"
 * 变得难以定位，而且容易和 DSH 官方主题变量打架。
 */

const STYLE_ID = '@studio/ui-shell/base.css'

const CSS = `
@keyframes studio-caret {
  0%, 49% { opacity: .55 }
  50%, 100% { opacity: 0 }
}

/* 主区与面板的滚动条：细、半透明、悬停才明显 */
[data-testid="conversation-body"]::-webkit-scrollbar,
[data-panel-id]::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
[data-testid="conversation-body"]::-webkit-scrollbar-thumb,
[data-panel-id]::-webkit-scrollbar-thumb {
  background: var(--color-border-secondary, rgba(0, 0, 0, .16));
  border-radius: 4px;
}
[data-testid="conversation-body"]::-webkit-scrollbar-thumb:hover,
[data-panel-id]::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-primary, rgba(0, 0, 0, .28));
}
[data-testid="conversation-body"]::-webkit-scrollbar-track,
[data-panel-id]::-webkit-scrollbar-track {
  background: transparent;
}
`

export function injectStudioStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@studio/ui-shell'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
