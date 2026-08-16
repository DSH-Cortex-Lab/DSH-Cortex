/**
 * ReviewEngine：后台自动 review（v2 定稿，见 docs/自动技能化机制设计.md）。
 *
 * 触发：`cadence`（默认）——每个 agent 会话空闲时检查节律计数：自上次 checkpoint 以来
 * 每 reviewTurnInterval（默认 10）个用户轮 或 每 reviewToolInterval（默认 10）次工具调用
 * 触发一次后台 review；`session-end`——会话销毁时触发；`off`——关闭。
 * 同一会话同一时刻只允许一个 review job（activeJobs 去重），checkpoint 持久化到
 * `$DSH_HOME/pending/review-checkpoints.json`（跨 web 重启存活，不重复消费已处理段落）。
 *
 * 输入：checkpoint 以来的增量轮次 + 最近 reviewRecentTurns 轮尾窗 + 既有 compaction 摘要；
 * 现有技能目录（name: description）并入 prompt，供模型优先复用已有技能名。
 *
 * 输出：一次 digest 三路输出。写入层去重（D-c）：技能同名 → forge.merge 合并；
 * 描述相似度 ≥ dedupeSimilarity → 跳过；no-change → 零写入。MEMORY/USER 维持既有过滤。
 *
 * 生效语义（v08 S4）：review 落盘的 MEMORY/USER 仅【下会话】生效（快照已在首 step 注入，会话内不重读）。
 *
 * @module dsh-skill-forge
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
// 加载 base 模块，供 JobKindMap 增强（review kind）+ Context.jobs 类型
import type {} from '@deepseek-ai/dsh-jobs'
// 加载 `compaction/summary` 会话事件类型（D22 摘要复用）
import type {} from '@deepseek-ai/dsh-compaction'
import { SkillForge } from './forge.ts'

// 自定义 job kind：dsh 的 JobKindMap 需声明合并扩展（types.ts: "Plugins extend this map by declaration merging"）
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    review: 'review'
  }
}

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
} from '@dsh-cortex/dsh-review-core'

/**
 * review 写 MEMORY 所需的最小 store 接口（避免 skill-forge 硬依赖 dsh-memory-harness）。
 * 由组合层把 dsh-memory-harness 的 MemoryStore 适配进来（ctx.provide('memoryStore')）。
 */
export interface MemoryStoreLike {
  snapshot(target: 'memory' | 'user'): { entries: string[] }
  add(target: 'memory' | 'user', content: string): { success: boolean }
  replace(target: 'memory' | 'user', oldSubstr: string, content: string): { success: boolean }
  remove(target: 'memory' | 'user', oldSubstr: string): { success: boolean }
}

export interface ReviewConfig {
  reviewEnabled: boolean
  reviewTrigger: 'cadence' | 'session-end' | 'off'
  /** 节律：自上次 checkpoint 以来每 N 个用户轮触发（记忆路）。 */
  reviewTurnInterval: number
  /** 节律：自上次 checkpoint 以来每 N 次工具调用触发（技能路）。 */
  reviewToolInterval: number
  reviewRecentTurns: number
  reviewModel?: string
  reviewMinResultChars: number
  dedupeSimilarity: number
}

/** 持久化 checkpoint：按 sessionId 记录上次 review 消费到的进度（v2 节律机制）。 */
export interface ReviewCheckpoint {
  /** 已消费的用户轮总数。 */
  lastUserTurns: number
  /** 已消费的工具调用总数。 */
  lastToolCalls: number
  /** 已消费的事件数（session.events.length 的旧值，作为增量切窗索引）。 */
  lastEventSeq: number
  /** 上次 review 输入（增量部分）的摘要。 */
  lastDigest: string
}

/** 现有技能目录的一行（写入层去重用）。 */
export interface SkillCatalogRow {
  name: string
  description: string
}

/**
 * 纯函数：统计会话内的用户轮数 / 工具调用数 / 事件总数。
 * 与 checkpoint 的差值即"自上次总结以来"的节律增量。
 */
export function countTurnSignals(events: readonly SessionEvent[]): { userTurns: number; toolCalls: number; lastEventSeq: number } {
  let userTurns = 0
  let toolCalls = 0
  for (const event of events) {
    if (event.type === 'user/message') userTurns += 1
    else if (event.type === 'tool/call') toolCalls += 1
  }
  return { userTurns, toolCalls, lastEventSeq: events.length }
}

/** 从会话事件投影 digest 条目（dsh 事件 → DigestEntry，集成层；seq 记事件在日志中的位置，供增量切窗）。 */
export function projectEntries(session: Session): DigestEntry[] {
  const entries: DigestEntry[] = []
  session.events.forEach((event, index) => {
    if (event.type === 'user/message') {
      const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text.length > 0) entries.push({ role: 'user', text, seq: index })
    } else if (event.type === 'assistant/message') {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text.length > 0) entries.push({ role: 'assistant', text, seq: index })
    }
  })
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

/** 增量条目（自 checkpoint 以来的新 digest 条目）。 */
export function incrementalEntries(entries: readonly DigestEntry[], lastEventSeq: number): DigestEntry[] {
  return entries.filter(entry => (entry.seq ?? 0) >= lastEventSeq)
}

/** 增量输入的摘要（checkpoint.lastDigest 持久化用）。 */
function digestOf(entries: readonly DigestEntry[]): string {
  const canonical = entries.map(entry => `${entry.role}:${entry.text}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

export class ReviewEngine {
  /** 已消费进度（sessionId → checkpoint）；从 checkpoint 文件加载，review 后写回。 */
  private readonly checkpoints = new Map<string, ReviewCheckpoint>()

  /** 进行中的 review job（job 去重：同一会话同一时刻只跑一个）。 */
  private readonly activeJobs = new Set<SessionId>()

  constructor(
    private readonly ctx: Context,
    private readonly forge: SkillForge,
    private readonly store: MemoryStoreLike | undefined,
    private readonly config: ReviewConfig,
    private readonly provider: string,
    private readonly model: string,
    /** checkpoint 持久化文件（$DSH_HOME/pending/review-checkpoints.json）。 */
    private readonly checkpointFile: string,
    /** v08 S4-2：review 落盘 MEMORY/USER 同样 append memory/write 审计事件（由组合层接线到 memory 插件）。 */
    private readonly onMemoryWrite?: (update: MemoryUpdate) => void,
  ) {
    this.loadCheckpoints()
  }

  /** 触发接线（v2）：cadence = 空闲节律检查；session-end = 会话销毁；off = 不触发。 */
  attach(): void {
    if (!this.config.reviewEnabled || this.config.reviewTrigger === 'off') return
    if (this.config.reviewTrigger === 'session-end') {
      this.ctx.on('session/disposed', session => this.reviewSession(undefined, session))
      return
    }
    this.ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      const session = agent.session
      if (this.activeJobs.has(session.id)) return
      const checkpoint = this.checkpoints.get(session.id)
      const signals = countTurnSignals(session.events)
      const deltaUser = signals.userTurns - (checkpoint?.lastUserTurns ?? 0)
      const deltaTools = signals.toolCalls - (checkpoint?.lastToolCalls ?? 0)
      if (deltaUser < this.config.reviewTurnInterval && deltaTools < this.config.reviewToolInterval) return
      const reason = deltaUser >= this.config.reviewTurnInterval ? 'turn' : 'tool'
      this.activeJobs.add(session.id)
      this.log('review triggered (reason=%s, session=%s, deltaUser=%d, deltaTools=%d)', reason, session.id, deltaUser, deltaTools)
      this.reviewSession(agent, session)
    })
  }

  private reviewSession(agent: Agent | undefined, session: Session): void {
    const entries = projectEntries(session)
    if (entries.length === 0) {
      this.activeJobs.delete(session.id)
      return
    }
    const checkpoint = this.checkpoints.get(session.id)
    const incremental = incrementalEntries(entries, checkpoint?.lastEventSeq ?? 0)
    if (checkpoint !== undefined && incremental.length === 0) {
      // 无新增内容（会话 resume 等场景）：不重复消费
      this.activeJobs.delete(session.id)
      return
    }
    const digest = buildConversationDigest(entries, this.config.reviewRecentTurns, extractEarlySummary(session))
    if (incremental.length > 0) digest.incremental = incremental
    void this.schedule(agent, session, digest, checkpoint)
  }

  /** 后台 job（ctx.jobs；D5 不阻塞 agent 循环；job 进行中去重 + 失败不重试风暴）。 */
  private schedule(agent: Agent | undefined, session: Session, digest: ConversationDigest, checkpoint: ReviewCheckpoint | undefined): void {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) {
      this.activeJobs.delete(session.id)
      return
    }
    jobs.start({
      kind: 'review',
      label: 'session review',
      run: () => {
        let cancelled = false
        const done = this.run(agent, session, digest, checkpoint).then(
          output => (cancelled ? { status: 'killed' as const } : { status: 'completed' as const, detail: summarize(output) }),
          error => ({ status: 'failed' as const, detail: String(error) }),
        )
        return { cancel() { cancelled = true }, done }
      },
    })
  }

  /** 一次 review：目录 → prompt → 模型 → 解析 → 应用（三路输出）→ checkpoint 落盘。 */
  private async run(
    agent: Agent | undefined,
    session: Session,
    digest: ConversationDigest,
    checkpoint: ReviewCheckpoint | undefined,
  ): Promise<ReviewOutput> {
    try {
      const catalog = await this.loadCatalog(agent)
      const catalogText = catalog.map(row => `${row.name}: ${row.description}`).join('\n')
      const llm = this.ctx.get('llm')
      if (llm === undefined) throw new Error('llm service unavailable for review')
      const prompt = buildReviewPrompt(renderDigest(digest), catalogText)
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
      this.apply(output, catalog)

      // checkpoint 以本次 review 运行时的会话进度为准（job 运行与会话继续并发安全）
      const signals = countTurnSignals(session.events)
      const incremental = digest.incremental ?? []
      const currentDigest = digestOf(incremental)
      this.checkpoints.set(session.id, {
        lastUserTurns: signals.userTurns,
        lastToolCalls: signals.toolCalls,
        lastEventSeq: signals.lastEventSeq,
        lastDigest: checkpoint?.lastDigest === currentDigest ? checkpoint.lastDigest : currentDigest,
      })
      this.persistCheckpoints()
      this.log('review completed: %s', summarize(output))
      return output
    } finally {
      this.activeJobs.delete(session.id)
    }
  }

  /** 现有技能目录（写入层去重用；缺 agent 或查询失败降级为空目录，仅失去去重不丢功能）。 */
  private async loadCatalog(agent: Agent | undefined): Promise<SkillCatalogRow[]> {
    try {
      const skills = this.ctx.get('skills') as {
        list: (options?: unknown) => Promise<Array<{ name: string; description: string }>>
      } | undefined
      if (skills === undefined || typeof skills.list !== 'function') return []
      const options = agent !== undefined
        ? { scope: (agent as unknown) ?? undefined, cwd: agent.session?.header?.cwd ?? process.cwd() }
        : undefined
      const rows = await skills.list(options)
      return rows.map(s => ({ name: s.name, description: s.description }))
    } catch {
      return []
    }
  }

  /** 应用三路输出（D-c 写入层去重：同名 merge、相似跳过、no-change 零写入）。 */
  private apply(output: ReviewOutput, catalog: readonly SkillCatalogRow[]): void {
    applyReviewOutput(output, this.forge, this.store, {
      reviewMinResultChars: this.config.reviewMinResultChars,
      dedupeSimilarity: this.config.dedupeSimilarity,
      catalog,
    }, this.onMemoryWrite)
  }

  private loadCheckpoints(): void {
    try {
      if (!existsSync(this.checkpointFile)) return
      const raw = JSON.parse(readFileSync(this.checkpointFile, 'utf8')) as Record<string, unknown>
      for (const [id, value] of Object.entries(raw)) {
        const c = value as Partial<ReviewCheckpoint>
        if (
          typeof c.lastUserTurns === 'number'
          && typeof c.lastToolCalls === 'number'
          && typeof c.lastEventSeq === 'number'
          && typeof c.lastDigest === 'string'
        ) {
          this.checkpoints.set(id, {
            lastUserTurns: c.lastUserTurns,
            lastToolCalls: c.lastToolCalls,
            lastEventSeq: c.lastEventSeq,
            lastDigest: c.lastDigest,
          })
        }
      }
    } catch { /* checkpoint 损坏 → 全部从零（首轮 review 全量） */ }
  }

  private persistCheckpoints(): void {
    try {
      const dir = dirname(this.checkpointFile)
      if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data: Record<string, ReviewCheckpoint> = {}
      for (const [id, c] of this.checkpoints) data[id] = c
      const tmp = `${this.checkpointFile}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
      renameSync(tmp, this.checkpointFile)
    } catch (e) {
      this.ctx.logger?.warn?.('dsh-skill-forge checkpoint persist failed: %o', e)
    }
  }

  private log(message: string, ...args: unknown[]): void {
    this.ctx.logger?.info?.(`dsh-skill-forge ${message}`, ...args)
  }
}

function summarize(output: ReviewOutput): string {
  const skill = output.skillCandidate !== undefined ? 1 : 0
  return `skill=${skill} memory=${output.memoryUpdates.length} user=${output.userUpdates.length}`
}

/** applyReviewOutput 的配置（含 v2 写入层去重所需的现有目录）。 */
export interface ApplyReviewConfig {
  reviewMinResultChars: number
  dedupeSimilarity: number
  /** 现有技能目录（v2 写入层去重：同名 merge、描述相似跳过）。 */
  catalog?: readonly SkillCatalogRow[]
}

/**
 * 应用 review 三路输出（独立导出，便于确定性单测）：
 * ① 技能候选：同名 → forge.merge（合并进既有技能）；描述相似 ≥ 阈值 → 跳过；否则 forge.create → staged；
 * ② MEMORY 增/改/删（去重 + no-change）；③ USER 预留（M1b）。
 * 自动生成技能保持双重标识：名字 `-auto-save` 后缀 + 描述 `(Auto-save)` 后缀。
 */
export function applyReviewOutput(
  output: ReviewOutput,
  forge: SkillForge,
  store: MemoryStoreLike | undefined,
  config: ApplyReviewConfig,
  onMemoryWrite?: (update: MemoryUpdate) => void,
): void {
  const skill = output.skillCandidate
  if (skill !== undefined && skill.content.length >= config.reviewMinResultChars) {
    const name = skill.name.replace(/-auto-save$/, '') + '-auto-save'
    const description = skill.description.replace(/\s*\(Auto-save\)\s*$/, '') + ' (Auto-save)'
    const catalog = config.catalog ?? []
    const sameName = catalog.some(row => row.name === name)
    const similar = !sameName && catalog.some(row => isDuplicate(skill.description, [row.description], config.dedupeSimilarity))
    if (sameName) {
      void forge.merge(name, { description, content: skill.content })
    } else if (!similar) {
      void forge.create({
        name,
        description,
        ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
        content: skill.content,
      })
    }
    // similar → 跳过（写入层去重，防止同一经验重复生成技能）
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