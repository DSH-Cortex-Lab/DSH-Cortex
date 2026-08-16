/**
 * SoulProvider：SOUL.md → system prompt section（D26 方案 A）+ core:personality 静态底线。
 *
 * 人格顺序（D26 方案 A）：soul(order -200) → identity(-100, 原生) → core:personality(-90) → persona(0, 原生)。
 * 懒重载（D13/D28）：每请求前 statSync 检查 mtime，没变零成本，变了才 readFileSync 重读；
 * mtime 变了但内容相同 → 不产生新文本。同步实现，满足 section.text 同步回调约束（v08 S2）。
 *
 * D23：防御性 frozenByScope（Map<scope, {text,mtime}>）——同进程多 agent 共享同一档案冻结
 * （内容相同，键控无害）；档案按进程定位（apply 时解析一次，D24）。
 *
 * @module dsh-memory-harness
 */

import { readFileSync, statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/**
 * 插件自带静态公共底线人格（D12：name='core:personality'，order=-90，纯静态文本，
 * 天然对所有 agent 生效、不受 agent persona shadow 影响）。部署可按需替换此文本。
 */
export const CORE_PERSONALITY_TEXT = [
  'You are a careful, direct assistant. Prefer accurate answers over speed; verify before claiming success; ask one concise question when a decision would materially change the outcome.',
].join('\n')

const DEFAULT_SCOPE = Symbol('dsh-memory-harness.default-scope')

export class SoulProvider {
  /** D23：防御性键控；同一档案（进程级）下内容相同，键控无害。 */
  private readonly frozenByScope = new Map<unknown, { text: string; mtime: number }>()

  constructor(private readonly soulFile: string) {}

  /**
   * 变化感知懒重载。同步实现（statSync/readFileSync），禁止在 text provider 内使用异步 API
   * （section.text 是同步回调，await 会得到 undefined/时序错误，v08 S2）。
   */
  frozenFor(scope?: AssembleContext['scope']): string {
    const key = scope ?? DEFAULT_SCOPE
    const frozen = this.frozenByScope.get(key)
    let mtime: number
    try {
      mtime = statSync(this.soulFile).mtimeMs
    } catch {
      // 文件不存在/不可读 → 清该 scope 缓存，返回空人格
      this.frozenByScope.delete(key)
      return ''
    }
    if (frozen !== undefined && frozen.mtime === mtime) return frozen.text
    // 原子读：一次性读入内存快照，杜绝半写态（D28）
    const text = readFileSync(this.soulFile, 'utf8')
    if (frozen !== undefined && frozen.text === text) {
      // D28 双重校验：mtime 变但内容未变 → 仅刷新 mtime，不产生新文本
      this.frozenByScope.set(key, { text: frozen.text, mtime })
      return frozen.text
    }
    this.frozenByScope.set(key, { text, mtime })
    return text
  }

  register(ctx: Context): void {
    ctx.systemPrompt.section({
      name: 'soul',
      order: -200,
      text: context => this.frozenFor(context.scope),
    })
    ctx.systemPrompt.section({
      name: 'core:personality',
      order: -90,
      text: CORE_PERSONALITY_TEXT,
    })
  }
}
