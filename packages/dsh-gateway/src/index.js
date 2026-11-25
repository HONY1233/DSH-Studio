/**
 * @dsh-studio/dsh-gateway
 *
 * DSH Web Host API 的适配层。G1 阶段逐块落地：
 *   wire/         报文编解码 + 错误码表      ✅
 *   supervisor/   进程守护 / token 抓取 / Cookie  ✅
 *   transport.js  HTTP unary + mux 长活连接    ← 下一步
 *   projector/    事件 → 读模型
 *   commands.js   CommandMap
 */

export * from './wire/index.js'
export * from './supervisor/launch.js'
export {
  createSupervisor,
  SupervisorState,
} from './supervisor/index.js'
