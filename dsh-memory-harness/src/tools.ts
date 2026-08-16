/**
 * 记忆三工具：memory_add / memory_replace / memory_remove。
 *
 * 每次成功写 append `memory/write` 审计事件（D2 双写、D18 log-only）；写后快照更新由
 * SnapshotService 在下一条请求重快照时生效（D20）。工具 schema/描述不含运行时数据（D17）。
 *
 * @module dsh-memory-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session'
import { MemoryStore, type WriteResult } from './store.ts'

/** 一次记忆写操作的审计载荷（D18：仅审计，不进模型可见历史）。 */
export interface MemoryWriteEvent {
  /** 操作类型。 */
  action: 'add' | 'replace' | 'remove'
  /** 目标档案：P0 仅 'memory'；'user' 后移（M1b）。 */
  target: 'memory' | 'user'
  /** 本次写的内容：add/replace 为新条目文本，remove 为被删条目的定位子串。 */
  content: string
  /** 写入后的 usage（条目内容字符数）。 */
  usage: number
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'memory/write': MemoryWriteEvent
  }
}

const TARGET_SCHEMA = {
  type: 'string' as const,
  required: true as const,
  enum: ['memory', 'user'] as const,
  description: 'Which memory to write. P0 supports "memory" only; "user" is reserved for a later milestone.',
}

const WRITE_OUTPUT = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      success: { type: 'boolean' as const, required: true },
      usage: { type: 'integer' as const, required: true },
      limit: { type: 'integer' as const, required: true },
      note: { type: 'string' as const, enum: ['no-duplicate'] as const },
      error: { type: 'string' as const },
      currentEntries: { type: 'array' as const, items: { type: 'string' as const } },
    },
  } satisfies ObjectValueSchemaSpec,
  render: (_args: unknown, value: WriteResult) => [{ type: 'text' as const, text: renderWriteResult(value) }],
}

export function registerMemoryTools(ctx: Context, store: MemoryStore): void {
  ctx.tools.register(defineTool({
    name: 'memory_add',
    description: 'Append one entry to persistent memory. Memory is a cross-session scratchpad of environment facts, conventions, and lessons; it contains only what you explicitly write (conversation is not recorded automatically). If the write would exceed the configured limit, the call returns the current entries so you can consolidate and retry.',
    parameters: {
      target: TARGET_SCHEMA,
      content: { type: 'string', required: true, description: 'The entry text to append.' },
    },
    output: WRITE_OUTPUT,
    execute(args, exec) {
      const result = store.add(args.target, args.content)
      if (result.success) auditMemoryWrite(exec.agent, 'add', args.target, args.content, result.usage)
      return Promise.resolve(result)
    },
    presentCall: args => ({ card: 'generic', title: 'memory_add', kind: 'other', rawInput: args.content }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_replace',
    description: 'Replace one memory entry. Locate the entry by a substring of its current text (old_text) and provide the replacement content.',
    parameters: {
      target: TARGET_SCHEMA,
      old_text: { type: 'string', required: true, description: 'A substring identifying the entry to replace.' },
      content: { type: 'string', required: true, description: 'The new entry text.' },
    },
    output: WRITE_OUTPUT,
    execute(args, exec) {
      const result = store.replace(args.target, args.old_text, args.content)
      if (result.success) auditMemoryWrite(exec.agent, 'replace', args.target, args.content, result.usage)
      return Promise.resolve(result)
    },
    presentCall: args => ({ card: 'generic', title: 'memory_replace', kind: 'other', rawInput: args.old_text }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_remove',
    description: 'Remove one memory entry. Locate the entry by a substring of its current text (old_text).',
    parameters: {
      target: TARGET_SCHEMA,
      old_text: { type: 'string', required: true, description: 'A substring identifying the entry to remove.' },
    },
    output: WRITE_OUTPUT,
    execute(args, exec) {
      const result = store.remove(args.target, args.old_text)
      if (result.success) auditMemoryWrite(exec.agent, 'remove', args.target, args.old_text, result.usage)
      return Promise.resolve(result)
    },
    presentCall: args => ({ card: 'generic', title: 'memory_remove', kind: 'other', rawInput: args.old_text }),
  }))
}

/** D2/D18：审计事件（log-only），仅成功写时 append；非 agent 调用者无 session，跳过。 */
function auditMemoryWrite(
  agent: Agent | undefined,
  action: MemoryWriteEvent['action'],
  target: MemoryWriteEvent['target'],
  content: string,
  usage: number,
): void {
  if (agent === undefined) return
  agent.session.append('memory/write', { action, target, content, usage })
}

function renderWriteResult(value: WriteResult): string {
  if (value.success) {
    return value.note === 'no-duplicate'
      ? `Memory unchanged (duplicate entry). usage=${value.usage}/${value.limit}.`
      : `Memory updated. usage=${value.usage}/${value.limit}.`
  }
  if (value.error !== undefined && value.error.startsWith('over-limit')) {
    const entries = value.currentEntries ?? []
    const list = entries.length === 0
      ? '(empty)'
      : entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n')
    return `Memory is over the ${value.limit}-character limit (current usage ${value.usage}). Current entries:\n${list}\nConsolidate or remove entries, then retry.`
  }
  return `Memory write failed: ${value.error ?? 'unknown error'}`
}
