/**
 * SnapshotService：记忆快照的 durable user/message 注入（D1/D10/D15/D20）。
 *
 * 对齐 tool-skill 目录 update 机制（`packages/skill/tool-skill/src/index.ts`）：
 * 每 pre-step 重快照文件内容 → 计算条目 digest → 仅当可见 digest 变化时才注入/替换快照消息。
 * 效果：首 step 注入初始快照；记忆工具写入后，下一条请求重快照检测到变化即注入 update 消息（D20）。
 *
 * @module dsh-memory-harness
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { MemoryStore } from './store.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'memory-snapshot': MemorySnapshotSource
  }
}

/** 快照消息的 source（D14：entries 为文件内容纯投影，不含容量表头/时间戳/路径）。 */
export interface MemorySnapshotSource {
  readonly kind: 'memory-snapshot'
  readonly form: 'snapshot'
  /** 标记为 replacement（本会话内已发布过快照）。 */
  readonly update?: true
  readonly entries: readonly string[]
}

/** 快照渲染模板（D14/R3：固定表头 + 条目 + `§` 分隔，纯函数，无易变字段）。 */
const HEADER = '── MEMORY (agent notes) ──'

/** 渲染快照文本（纯函数：只含条目文本 + 固定分隔，禁止时间戳/绝对路径/随机 ID）。 */
export function renderMemorySnapshot(entries: readonly string[]): string {
  return HEADER + '\n' + entries.join('\n§\n')
}

/**
 * 注入顺序（D15/D21）：baseline → catalog → memory。
 * 本监听器按 bundle 装配顺序在 tool-skill 之后注册（计划要求 memory 插件固定装配在
 * agent-instructions/tool-skill 之后），且始终把快照 append 到消息末尾——天然排在 catalog 之后。
 * 跨组合前缀分叉只能靠这个强制装配约束保证（监听器按注册顺序执行）。
 */
export function applySnapshot(ctx: Context, store: MemoryStore): void {
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal.throwIfAborted()
    const entries = store.snapshot('memory').entries
    const digest = digestEntries(entries)
    const history = snapshotHistory(agent)
    const existing = snapshotMessage(decision.messages)
    if (history.visibleDigest === digest) {
      return existing === undefined
        ? decision
        : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    if (existing !== undefined && digestEntries(existing.entries) === digest) return decision
    if (!history.published && entries.length === 0) {
      return existing === undefined
        ? decision
        : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    const message = createSnapshotMessage(entries, history.published)
    return {
      kind: 'enter',
      messages: existing === undefined
        ? [...decision.messages, message]
        : decision.messages.map(m => m.id === existing.message.id ? message : m),
    }
  })
}

function createSnapshotMessage(entries: readonly string[], update: boolean): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: renderMemorySnapshot(entries) }],
    source: {
      kind: 'memory-snapshot',
      form: 'snapshot',
      ...(update ? { update: true } : {}),
      entries: [...entries],
    },
  })
}

/** 条目身份摘要（对齐 tool-skill digest：逐条 JSON 化，避免分隔符歧义）。 */
function digestEntries(entries: readonly string[]): string {
  const canonical = entries.map(entry => JSON.stringify(entry)).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

function readSnapshotEntries(source: unknown): readonly string[] | undefined {
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: string[] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'string') return undefined
    readable.push(entry)
  }
  return readable
}

function snapshotHistory(agent: Agent): { visibleDigest?: string; published: boolean } {
  const visible = new Set(agent.session.surface.nodes)
  const events = agent.session.events
  let published = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type !== 'user/message' || event.data.source.kind !== 'memory-snapshot') continue
    const entries = readSnapshotEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestEntries(entries)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

function snapshotMessage(
  messages: readonly UserMessage[],
): { message: UserMessage; entries: readonly string[] } | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'memory-snapshot') continue
    const entries = readSnapshotEntries(message.source)
    if (entries !== undefined) return { message, entries }
  }
  return undefined
}
