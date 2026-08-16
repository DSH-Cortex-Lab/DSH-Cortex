/**
 * 人格层：SOUL.md（档案人格）与 core-personality.md（机器底线，用户可编辑）→ system prompt section。
 *
 * 人格顺序（D26 方案 A）：soul(order -200) → identity(-100, 原生) → core:personality(-90) → persona(0, 原生)。
 * 懒重载（D13/D28）：每请求前 statSync 检查 mtime，没变零成本，变了才 readFileSync 重读；
 * mtime 变了但内容相同 → 不产生新文本。同步实现，满足 section.text 同步回调约束（v08 S2）。
 *
 * D23：防御性 frozenByScope（Map<scope, {text,mtime}>）——同进程多 agent 共享同一档案冻结。
 *
 * core 可编辑（评审结论）：core-personality.md 固定在 $DSH_HOME 根（全局，不随 profile），
 * 首次启动缺失时用 CORE_PERSONALITY_TEXT 默认模板初始化；仍禁动态变量、review 不写 core。
 *
 * @module dsh-memory-harness
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

/**
 * core 默认模板（首次启动写入 core-personality.md，之后用户可改）。
 * 纯静态文本、禁动态变量（D9）；跨档案全局生效、不受 agent persona shadow 影响（D12）。
 */
export const CORE_PERSONALITY_TEXT = [
  'You are a careful, direct assistant. Prefer accurate answers over speed; verify before claiming success; ask one concise question when a decision would materially change the outcome.',
].join('\n')

const DEFAULT_SCOPE = Symbol('dsh-memory-harness.default-scope')

/**
 * 文件型人格 provider：变化感知懒重载（D13/D28）。
 * defaultText 非空时，init() 会在文件缺失时原子写入默认模板（core 首次启动）；frozenFor 在文件
 * 仍缺失时降级返回 defaultText（SOUL defaultText='' 即返回空人格）。
 */
export class FilePersonalityProvider {
  /** D23：防御性键控；同进程多 agent 共享同一档案冻结。 */
  private readonly frozenByScope = new Map<unknown, { text: string; mtime: number }>()

  constructor(
    private readonly file: string,
    private readonly defaultText = '',
  ) {}

  /** 首次启动初始化：defaultText 非空且文件缺失 → 原子写默认模板。 */
  init(): void {
    if (this.defaultText.length === 0 || existsSync(this.file)) return
    try {
      const dir = dirname(this.file)
      if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, this.defaultText, 'utf8')
      renameSync(tmp, this.file)
    } catch {
      // 写失败忽略：frozenFor 会降级返回默认文本
    }
  }

  /**
   * 变化感知懒重载。同步实现（statSync/readFileSync），禁止在 text provider 内使用异步 API
   * （section.text 是同步回调，await 会得到 undefined/时序错误，v08 S2）。
   */
  frozenFor(scope?: AssembleContext['scope']): string {
    const key = scope ?? DEFAULT_SCOPE
    const frozen = this.frozenByScope.get(key)
    let mtime: number
    try {
      mtime = statSync(this.file).mtimeMs
    } catch {
      // 文件不存在/不可读 → 清该 scope 缓存，降级返回默认文本（SOUL 默认 '' = 空人格）
      this.frozenByScope.delete(key)
      return this.defaultText
    }
    if (frozen !== undefined && frozen.mtime === mtime) return frozen.text
    // 原子读：一次性读入内存快照，杜绝半写态（D28）
    const text = readFileSync(this.file, 'utf8')
    if (frozen !== undefined && frozen.text === text) {
      // D28 双重校验：mtime 变但内容未变 → 仅刷新 mtime，不产生新文本
      this.frozenByScope.set(key, { text: frozen.text, mtime })
      return frozen.text
    }
    this.frozenByScope.set(key, { text, mtime })
    return text
  }

  registerSection(ctx: Context, name: string, order: number): void {
    ctx.systemPrompt.section({
      name,
      order,
      text: context => this.frozenFor(context.scope),
    })
  }
}

/** SOUL（档案人格）：懒重载，文件缺失返回空人格（保持原 SOUL 语义）。 */
export class SoulProvider extends FilePersonalityProvider {
  constructor(soulFile: string) {
    super(soulFile)
  }

  register(ctx: Context): void {
    this.registerSection(ctx, 'soul', -200)
  }
}

/** core（机器底线，用户可编辑）：懒重载 + 首次启动写默认模板。 */
export class CoreProvider extends FilePersonalityProvider {
  constructor(coreFile: string) {
    super(coreFile, CORE_PERSONALITY_TEXT)
  }

  register(ctx: Context): void {
    this.init()
    this.registerSection(ctx, 'core:personality', -90)
  }
}
