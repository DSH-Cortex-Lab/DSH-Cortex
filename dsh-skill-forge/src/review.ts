/**
 * ReviewEngine：后台自动 review（D5/D6/D16/D27）。会话结束后把「最近 K 轮逐字 + 早期摘要」喂给
 * （可配便宜）模型，一次 digest 三路输出：①技能候选→forge.create→staged；②MEMORY 更新建议→store
 * 增/改/删；③USER 更新建议（M1b 预留）。跑在 `ctx.jobs` 后台，去重 + no-change 两道质量过滤（D7）。
 *
 * 生效语义（v08 S4）：review 落盘的 MEMORY/USER 仅【下会话】生效（快照已在首 step 注入，会话内不重读）。
 *
 * @module dsh-skill-forge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
// 加载 base 模块，供 JobKindMap 增强（review kind）+ Context.jobs 类型
import type {} from '@deepseek-ai/dsh-jobs'
// 加载 `compaction/summary` 会话事件类型（D22 摘要复用）
import type {} from '@deepseek-ai/dsh-compaction'
import { SkillForge } from './forge.ts'
import {
  buildConversationDigest,
  buildReviewPrompt,
  isDuplicate,
  parseReviewOutput,
  renderDigest,
  type ConversationDigest,
  type DigestEntry,
  type MemoryUpdate,
  type ReviewOutput,
} from '@deepseek-ai/dsh-review-core'

/**
 * review 写 MEMORY 所需的最小 store 接口（避免 skill-forge 硬依赖 dsh-memory-harness）。
 * 由组合层把 dsh-memory-harness 的 MemoryStore 适配进来（或 P2 抽 review-core 共享）。
 */
export interface MemoryStoreLike {
  snapshot(target: 'memory' | 'user'): { entries: string[] }
  add(target: 'memory' | 'user', content: string): { success: boolean }
  replace(target: 'memory' | 'user', oldSubstr: string, content: string): { success: boolean }
  remove(target: 'memory' | 'user', oldSubstr: string): { success: boolean }
}

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    review: 'review'
  }
}

export interface ReviewConfig {
  reviewEnabled: boolean
  reviewTrigger: 'turn-end' | 'batch' | 'session-end' | 'idle'
  reviewRecentTurns: number
  reviewModel?: string
  reviewMinResultChars: number
  dedupeSimilarity: number
}

/** 从会话事件投影 digest 条目（dsh 事件 → DigestEntry，集成层）。 */
export function projectEntries(session: Session): DigestEntry[] {
  const entries: DigestEntry[] = []
  for (const event of session.events) {
    if (event.type === 'user/message') {
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text.length > 0) entries.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text.length > 0) entries.push({ role: 'assistant', text })
    }
  }
  return entries
}

/** 从会话日志提取既有 compaction 摘要（D22：复用，不额外调 LLM）。取最后一条 `compaction/summary` 的文本。 */
export function extractEarlySummary(session: Session): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === undefined || event.type !== 'compaction/summary') continue
    const text = event.data.summary.filter(block => block.type === 'text').map(block => block.text).join('').trim()
    if (text.length > 0) return text
  }
  return undefined
}

async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

export class ReviewEngine {
  constructor(
    private readonly ctx: Context,
    private readonly forge: SkillForge,
    private readonly store: MemoryStoreLike | undefined,
    private readonly config: ReviewConfig,
    private readonly provider: string,
    private readonly model: string,
    /** v08 S4-2：review 落盘 MEMORY/USER 同样 append memory/write 审计事件（由组合层接线到 memory 插件）。 */
    private readonly onMemoryWrite?: (update: MemoryUpdate) => void,
  ) {}

  /** 已触发过 review 的会话（idle 触发去重用）。 */
  private readonly reviewed = new Set<SessionId>()

  /** 触发：session-end（session/disposed）或 idle（agent/status，去重）。turn-end/batch 默认禁用（D5/R5）。 */
  attach(): void {
    if (!this.config.reviewEnabled) return
    if (this.config.reviewTrigger === 'session-end') {
      this.ctx.on('session/disposed', session => this.reviewSession(session))
    } else if (this.config.reviewTrigger === 'idle') {
      this.ctx.on('agent/status', ({ agent, status }) => {
        if (status !== 'idle') return
        const session = agent.session
        if (this.reviewed.has(session.id)) return
        this.reviewed.add(session.id)
        this.reviewSession(session)
      })
    }
    // 'turn-end' / 'batch' 默认不接（高频 review 驱逐主会话 KV，R5）
  }

  private reviewSession(session: Session): void {
    const entries = projectEntries(session)
    if (entries.length === 0) return
    const digest = buildConversationDigest(entries, this.config.reviewRecentTurns, extractEarlySummary(session))
    void this.schedule(digest)
  }

  /** 后台 job（ctx.jobs；D5 不阻塞 agent 循环）。 */
  private schedule(digest: ConversationDigest): void {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) return
    jobs.start({
      kind: 'review',
      label: 'session review',
      run: () => {
        let cancelled = false
        const done = this.run(digest).then(
          output => (cancelled ? { status: 'killed' as const } : { status: 'completed' as const, detail: summarize(output) }),
          error => ({ status: 'failed' as const, detail: String(error) }),
        )
        return { cancel() { cancelled = true }, done }
      },
    })
  }

  /** 一次 review：digest → 模型 → 解析 → 应用（三路输出）。 */
  private async run(digest: ConversationDigest): Promise<ReviewOutput> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) throw new Error('llm service unavailable for review')
    const prompt = buildReviewPrompt(renderDigest(digest))
    const text = await collectText(llm.stream({
      provider: this.provider,
      model: this.model,
      system: prompt.system,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt.user }],
        source: { kind: 'plugin', plugin: 'dsh-skill-forge' },
      })],
    }))
    const output = parseReviewOutput(text)
    if (output === undefined) {
      throw new Error('review output was not parseable JSON')
    }
    this.apply(output)
    return output
  }

  /** 应用三路输出（D7：去重 + no-change 两道非审批质量过滤）。 */
  private apply(output: ReviewOutput): void {
    applyReviewOutput(output, this.forge, this.store, this.config, this.onMemoryWrite)
  }
}

function summarize(output: ReviewOutput): string {
  const skill = output.skillCandidate !== undefined ? 1 : 0
  return `skill=${skill} memory=${output.memoryUpdates.length} user=${output.userUpdates.length}`
}

/**
 * 应用 review 三路输出（独立导出，便于确定性单测）：
 * ① 技能候选 → forge.create → staged；② MEMORY 增/改/删（去重 + no-change）；③ USER 预留（M1b）。
 */
export function applyReviewOutput(
  output: ReviewOutput,
  forge: SkillForge,
  store: MemoryStoreLike | undefined,
  config: { reviewMinResultChars: number; dedupeSimilarity: number },
  onMemoryWrite?: (update: MemoryUpdate) => void,
): void {
  const skill = output.skillCandidate
  if (skill !== undefined && skill.content.length >= config.reviewMinResultChars) {
    void forge.create({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
      content: skill.content,
    })
  }
  if (store === undefined) return
  const memoryEntries = store.snapshot('memory').entries
  for (const update of output.memoryUpdates) {
    if (update.action === 'add') {
      if (isDuplicate(update.content, memoryEntries, config.dedupeSimilarity)) continue
      if (store.add('memory', update.content).success) onMemoryWrite?.(update)
    } else if (update.action === 'remove' && update.oldText !== undefined) {
      if (store.remove('memory', update.oldText).success) onMemoryWrite?.(update)
    } else if (update.action === 'replace' && update.oldText !== undefined) {
      if (store.replace('memory', update.oldText, update.content).success) onMemoryWrite?.(update)
    }
  }
}
