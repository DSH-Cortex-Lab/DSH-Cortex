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

/** 快照消息的 source（D14：entries/userEntries 为文件内容纯投影，不含容量表头/时间戳/路径）。 */
export interface MemorySnapshotSource {
  readonly kind: 'memory-snapshot'
  readonly form: 'snapshot'
  /** 标记为 replacement（本会话内已发布过快照）。 */
  readonly update?: true
  /** MEMORY 条目（§ 分隔）。 */
  readonly entries: readonly string[]
  /** USER 条目（M1b：用户画像段；旧事件缺省为空）。 */
  readonly userEntries?: readonly string[]
}

/** 快照渲染模板（D14/R3：固定表头 + 条目 + `§` 分隔，纯函数，无易变字段）。 */
const MEMORY_HEADER = '── MEMORY (agent notes) ──'
const USER_HEADER = '── USER PROFILE ──'

/**
 * 渲染快照文本（纯函数：只含条目文本 + 固定分隔，禁止时间戳/绝对路径/随机 ID）。
 * M1b：USER 段在 MEMORY 段之前；空段整段省略（字节稳定）。
 */
export function renderMemorySnapshot(entries: readonly string[], userEntries: readonly string[] = []): string {
  const sections: string[] = []
  if (userEntries.length > 0) sections.push(USER_HEADER + '\n' + userEntries.join('\n§\n'))
  sections.push(MEMORY_HEADER + '\n' + entries.join('\n§\n'))
  return sections.join('\n\n')
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
    const userEntries = store.snapshot('user').entries
    const digest = digestSnapshot(entries, userEntries)
    const history = snapshotHistory(agent)
    const existing = snapshotMessage(decision.messages)
    if (history.visibleDigest === digest) {
      return existing === undefined
        ? decision
        : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    if (existing !== undefined && digestSnapshot(existing.entries, existing.userEntries ?? []) === digest) return decision
    if (!history.published && entries.length === 0 && userEntries.length === 0) {
      return existing === undefined
        ? decision
        : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    const message = createSnapshotMessage(entries, userEntries, history.published)
    return {
      kind: 'enter',
      messages: existing === undefined
        ? [...decision.messages, message]
        : decision.messages.map(m => m.id === existing.message.id ? message : m),
    }
  })
}

function createSnapshotMessage(entries: readonly string[], userEntries: readonly string[], update: boolean): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: renderMemorySnapshot(entries, userEntries) }],
    source: {
      kind: 'memory-snapshot',
      form: 'snapshot',
      ...(update ? { update: true } : {}),
      entries: [...entries],
      userEntries: [...userEntries],
    },
  })
}

/** 快照身份摘要：MEMORY + USER 两份条目整体哈希（逐条 JSON 化，避免分隔符歧义）。 */
function digestSnapshot(entries: readonly string[], userEntries: readonly string[]): string {
  const canonical = JSON.stringify({
    memory: entries.map(entry => JSON.stringify(entry)),
    user: userEntries.map(entry => JSON.stringify(entry)),
  })
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

function readSnapshotUserEntries(source: unknown): readonly string[] {
  const userEntries = (source as { userEntries?: unknown }).userEntries
  if (!Array.isArray(userEntries)) return []
  const readable: string[] = []
  for (const entry of userEntries as readonly unknown[]) {
    if (typeof entry !== 'string') return []
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
    const userEntries = readSnapshotUserEntries(event.data.source)
    const digest = digestSnapshot(entries, userEntries)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

function snapshotMessage(
  messages: readonly UserMessage[],
): { message: UserMessage; entries: readonly string[]; userEntries: readonly string[] } | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'memory-snapshot') continue
    const entries = readSnapshotEntries(message.source)
    if (entries === undefined) continue
    return { message, entries, userEntries: readSnapshotUserEntries(message.source) }
  }
  return undefined
}
