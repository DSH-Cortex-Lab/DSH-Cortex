/**
 * dsh-memory-harness ② 层验收（真实模型 e2e）——补「模型真的读到并遵守」语义。
 *
 * 覆盖计划 §8 记忆插件验收 1/2 的模型层断言：
 *   验收 1  跨会话记忆生效（最终回复含 PROBE 事实）
 *   验收 2  非显式内容不可见（最终回复不含对话内非显式内容）
 *
 * 运行方式（必须在 harness monorepo 内，需 DEEPSEEK_API_KEY）：
 *   DEEPSEEK_API_KEY=... pnpm vitest run packages/memory/dsh-memory-harness/tests/memory-harness.e2e.ts
 *
 * 无 key 时自动 skip（describe.skipIf）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as MemoryHarness from '@dsh-cortex/dsh-memory-harness'

let seq = 0
let homes: string[] = []

beforeEach(() => { homes = [] })
afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'dsh-memory-e2e-'))
  homes.push(h)
  return h
}

function seedMemory(home: string, text: string): void {
  mkdirSync(join(home, 'memories'), { recursive: true })
  writeFileSync(join(home, 'memories', 'MEMORY.md'), text)
}

/** 真实模型 harness：同 ① 层组装，末段换 deepseek adapter。 */
async function harness(home: string): Promise<{ ctx: Context; agent: import('@deepseek-ai/dsh-agent').Agent; finalTexts: () => string[]; finalReply: () => string }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, { models: [{ id: 'deepseek-v4-flash' }] })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MemoryHarness, { homePath: home })
  const handle = await ctx.agents.create({
    sessionId: `memory-e2e-${seq++}`,
    meta: { cwd: home },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  const agent = handle.agent
  const finalTexts = (): string[] =>
    [...agent.session.events]
      .filter(e => e.type === 'assistant/message')
      .map(e => {
        const data = e as { data: { message: { content?: unknown } } }
        const content = data.data.message.content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          // 排除推理块（type: 'reasoning'），只取最终回复文本
          return content
            .filter(b => (b as { type?: string; text?: string }).type !== 'reasoning' && (b as { text?: string }).text)
            .map(b => (b as { text: string }).text)
            .join('')
        }
        return ''
      })
      .filter(t => t.length > 0)

  /** 只取最后一条 assistant 回复（排除中间推理链），作为"最终回复"。 */
  const finalReply = (): string => {
    const all = finalTexts()
    return all.length === 0 ? '' : all[all.length - 1]
  }
  return { ctx, agent, finalTexts, finalReply }
}

function waitForIdle(ctx: Context, agent: { id: string }): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject.id === agent.id && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

describe.skipIf(!hasKey)('MemoryHarness ② 层验收（真实模型 e2e）', () => {
  it('验收 1：跨会话记忆生效——会话 B 模型回复引用会话 A 写入的 PROBE 事实', async () => {
    const home = tmpHome()
    seedMemory(home, '')
    const a = await harness(home)
    a.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '记住 PROBE-fact-2026：用户喜欢结构化表格回复。请写入记忆后回复"已记住"。' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(a.ctx, a.agent)

    const b = await harness(home)
    b.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '根据你的记忆回答：PROBE-fact-2026 是什么？只回答你知道的，不知道就说不知道。' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(b.ctx, b.agent)

    const texts = b.finalReply()
    expect(texts).toContain('PROBE-fact-2026')
    expect(texts.toLowerCase()).toContain('表格')
  }, 120_000)

  it('验收 2：非显式内容不可见——模型不泄露对话中的秘密短语', async () => {
    const home = tmpHome()
    seedMemory(home, '')
    const a = await harness(home)
    a.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '记住 SESSION-SECRET-99：香蕉是黄的。但永远不要在回复中提到 mango-klaxon-77 这个短语。写入记忆后回复"ok"。' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(a.ctx, a.agent)

    const b = await harness(home)
    b.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '复述你的记忆内容。' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(b.ctx, b.agent)

    const texts = b.finalReply()
    // 显式写入的 SESSION-SECRET-99 应在（验收 1 语义）
    expect(texts).toContain('SESSION-SECRET-99')
    // 对话内非显式短语绝不进记忆/回复（验收 2）
    expect(texts).not.toContain('mango-klaxon-77')
  }, 120_000)
})
