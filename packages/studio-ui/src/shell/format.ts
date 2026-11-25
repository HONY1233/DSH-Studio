/**
 * 展示用的小格式化工具。
 *
 * 单独成文件是为了避免 `attachment-view ↔ image-lightbox` 的循环依赖：
 * 两边都要格式化字节数，互相 import 会踩 ESM 的 TDZ（const 导出在循环里
 * 可能还没初始化就被读了）。
 */

/** 人类可读的字节数。K/M/G 用 1024 进制（和文件管理器一致）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // 小于 10 保留一位小数（1.4 MB），否则取整（128 MB）。
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${text} ${units[unit]}`
}
