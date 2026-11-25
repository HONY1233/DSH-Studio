/**
 * 浏览器半（spike）。
 *
 * 形式与 DSH 官方 UI 包完全一致：用 window.__ModuleLoader__ 注册一个工厂，
 * 导出 `inject`（依赖的 client 服务）与 `apply(ctx)`。
 * 不依赖构建工具，手写即可 —— 这是本次 spike 要验证的核心结论。
 *
 * 验证点：
 *   1. 包能被打进 boot graph（能被浏览器加载）
 *   2. ctx.slots 服务可用
 *   3. 注册到真实 slot 后组件能被渲染
 */
window.__ModuleLoader__.load({
  id: 'dsh-studio-ui-spike',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var inject = ['slots']

    function SpikeRow() {
      return React.createElement(
        'div',
        {
          style: {
            padding: '8px 10px',
            fontSize: '13px',
            color: 'var(--dsw-alias-label-secondary, #888)',
          },
          title: 'dsh-studio spike placeholder',
        },
        'STUDIO SPIKE · slot ok',
      )
    }

    function apply(ctx) {
      console.log('[dsh-studio-ui-spike] client half loaded')
      try {
        ctx.slots.inject('sidebar.panellist.actions', function () {
          return ctx.slots.register(
            { name: 'sidebar.panellist.actions', id: 'studio-spike' },
            SpikeRow,
          )
        })
        console.log('[dsh-studio-ui-spike] slot registered')
      } catch (error) {
        console.error('[dsh-studio-ui-spike] slot registration failed', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
