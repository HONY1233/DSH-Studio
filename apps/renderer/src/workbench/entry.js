/**
 * 渲染入口开关：默认保持旧版 App，只有显式 `?workbench=1` 才启用新工作台。
 * 纯函数单独导出，便于在 Node 测试中锁定“默认回退、不双写”的语义。
 */
export function selectRendererEntry(search = '') {
  return new URLSearchParams(search).get('workbench') === '1' ? 'workbench' : 'legacy'
}
