/**
 * @dsh-cortex/dsh-cortex-ui — host 端（当前为骨架占位）。
 *
 * v0.1：纯 UI 骨架（页面切换），host 无行为。后续各 tab 功能接入时，
 * 在此注册 host API（记忆/技能/人格数据通道）与 ctx 服务。
 */
export const name = '@dsh-cortex/dsh-cortex-ui'

export function apply(): void {
  // 骨架阶段：host 无逻辑；面板数据通道在功能 tab 落地时逐块添加
}
