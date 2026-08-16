/**
 * 会话边界 promote（D19/D25）：最后一个 live session 离开后，把 staged 落回扫描根。
 *
 * 崩溃清扫（下一会话启动检测 stagedDir 残留 → 询问/自动 promote）后移至 M4。
 *
 * @module dsh-skill-forge
 */

import type { Context } from '@deepseek-ai/cordis'
import { SkillForge } from './forge.ts'

export function applyPromote(ctx: Context, forge: SkillForge): void {
  ctx.on('session/disposed', () => {
    // 延迟到本次同步 dispose 完成后再判断（D25：promote 前检查无其他 live session）
    Promise.resolve().then(() => {
      if (ctx.sessions.list().length === 0) {
        void forge.promote().catch((error: unknown) => {
          ctx.logger.warn('dsh-skill-forge promote failed: %o', error)
        })
      }
    })
  })
}

/**
 * 崩溃残留清扫（D19/验收 16）：下一会话启动（apply，尚无 live session）时检测 stagedDir 非空
 * → 自动 promote，无孤儿技能。D7 取消默认门控，故不询问直接自动 promote。
 */
export function cleanupStagedOnStartup(ctx: Context, forge: SkillForge): void {
  void forge.promote().then((result) => {
    if (!result.success) ctx.logger.warn('dsh-skill-forge startup cleanup failed: %s', result.error)
  })
}
