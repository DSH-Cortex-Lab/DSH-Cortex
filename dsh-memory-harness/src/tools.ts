/**
 * 记忆三工具：memory_add / memory_replace / memory_remove。
 *
 * 写后快照更新由 SnapshotService 在下一条请求重快照时生效（D20）。
 * 工具 schema/描述不含运行时数据（D17）。
 *
 * 审计说明（B2 决策 2026-08-20）：不再 append `memory/write` 自定义会话事件——
 * dsh 读侧只认官方事件类型（或 ignorable 标记），自定义事件会导致会话 resume
 * 直接失败（SessionFormatUnsupportedError）。写入留痕由官方 tool/call + tool/result
 * 事件天然覆盖（参数与返回值完整），无需自定义审计事件。
 *
 * @module dsh-memory-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MemoryStore, type WriteResult } from './store.ts'

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
    execute(args) {
      return Promise.resolve(store.add(args.target, args.content))
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
    execute(args) {
      return Promise.resolve(store.replace(args.target, args.old_text, args.content))
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
    execute(args) {
      return Promise.resolve(store.remove(args.target, args.old_text))
    },
    presentCall: args => ({ card: 'generic', title: 'memory_remove', kind: 'other', rawInput: args.old_text }),
  }))
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
    return `Memory is over the ${value.limit}-byte limit (current usage ${value.usage} bytes). Current entries:\n${list}\nConsolidate or remove entries, then retry.`
  }
  return `Memory write failed: ${value.error ?? 'unknown error'}`
}
