/**
 * dsh-memory-harness ① 层验收（进程内组装 + MockAdapter，确定性、无网络、无 API key）。
 *
 * 覆盖计划 §8 记忆插件验收 1/2/3/5/6/7 的行为层断言：
 *   验收 1/2  跨会话记忆生效 + 非显式内容不可见
 *   验收 3    容量超限报错（工具层，配合 store.spec.ts 的单测）
 *   验收 5    会话中途写后下一条请求即见（D20 快照 update）
 *   验收 6    快照渲染为纯函数（同文件→同字节）
 *   验收 7    SOUL 懒重载（D13/D28）
 *
 * 运行方式（必须在 harness monorepo 内，vitest + dsh-* + mock-adapter 可解析）：
 *   pnpm vitest run tests/memory-harness.spec.ts
 *
 * 依赖说明：
 *   - `MockAdapter/textResponse/toolCallResponse` 复用 `packages/core/agent-loop/tests/mock-adapter.ts`
 *     （相对路径按本包在 monorepo 中的实际位置调整）。
 *   - `import * as MemoryHarness from 'dsh-memory-harness'` 的 specifier 需改成包实际安装名
 *     （如 vendor 后为 `@dsh-cortex/dsh-memory-harness`）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as MemoryHarness from '@dsh-cortex/dsh-memory-harness'
import { SoulProvider, CoreProvider, CORE_PERSONALITY_TEXT } from '@dsh-cortex/dsh-memory-harness'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let seq = 0
let homes: string[] = []

beforeEach(() => { homes = [] })
afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

/** 独立临时 home（模拟 $DSH_HOME），隔离真实环境。 */
function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
  homes.push(h)
  return h
}

/** 预置 MEMORY.md（便于触发非空快照注入）。 */
function seedMemory(home: string, text: string): void {
  mkdirSync(join(home, 'memories'), { recursive: true })
  writeFileSync(join(home, 'memories', 'MEMORY.md'), text)
}

function memoryFile(home: string): string {
  return join(home, 'memories', 'MEMORY.md')
}

/**
 * 组装一个最小可用的 dsh 上下文 + 一个 mock 驱动的 agent。
 * 每次调用 = 一个独立会话（独立 Context + SessionId），通过共享 home 实现跨会话文件持久化。
 */
async function harness(
  home: string,
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: Record<string, unknown> = {},
): Promise<{ ctx: Context; agent: Agent; adapter: MockAdapter }> {
  const adapter = new MockAdapter(script)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(MemoryHarness, { homePath: home, ...config })
  const handle = await ctx.agents.create({
    sessionId: SessionId(`memory-spec-${seq++}`),
    meta: { cwd: home },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  return { ctx, agent: handle.agent, adapter }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function followup(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** 提取会话日志中的所有 memory-snapshot 消息（初始/update 均含）。 */
function snapshotMessages(events: SessionEvent[]): Array<{ entries: string[]; update: boolean }> {
  const result: Array<{ entries: string[]; update: boolean }> = []
  for (const event of events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'memory-snapshot') continue
    const entries = (event.data.source.entries ?? []) as string[]
    result.push({ entries, update: event.data.source.update === true })
  }
  return result
}

/** 提取最近一条 memory-snapshot 消息的渲染文本。 */
function snapshotText(agent: Agent): string {
  return [...agent.session.events]
    .filter(e => e.type === 'user/message' && e.data.source.kind === 'memory-snapshot')
    .map(e => e.type === 'user/message' ? e.data.content.filter(b => b.type === 'text').map(b => b.text).join('') : '')
    .join('')
}

describe('MemoryHarness ① 层验收', () => {
  describe('SOUL 懒重载（验收 7 · D13/D28）', () => {
    it('未变 mtime → 字节缓存；变了 → 重读新文本', async () => {
      const home = tmpHome()
      const soulFile = join(home, 'SOUL.md')
      writeFileSync(soulFile, 'v1')
      const soul = new SoulProvider(soulFile)
      expect(soul.frozenFor()).toBe('v1')
      expect(soul.frozenFor()).toBe('v1') // 缓存命中，字节稳定
      await new Promise(r => setTimeout(r, 25)) // 确保 mtime 前进（跨时钟 tick）
      writeFileSync(soulFile, 'v2')
      expect(soul.frozenFor()).toBe('v2') // 变了才重读
    })

    it('文件缺失 → 空人格，不抛异常', () => {
      const soul = new SoulProvider(join(tmpHome(), 'SOUL.md'))
      expect(soul.frozenFor()).toBe('')
    })
  })

  describe('core:personality 可编辑（懒重载 + 默认模板初始化）', () => {
    it('首次启动无 core-personality.md → init 自动写默认模板', () => {
      const home = tmpHome()
      const coreFile = join(home, 'core-personality.md')
      const core = new CoreProvider(coreFile)
      core.init()
      expect(readFileSync(coreFile, 'utf8')).toBe(CORE_PERSONALITY_TEXT)
    })

    it('懒重载：改文件 → 新内容；未改字节稳定', async () => {
      const home = tmpHome()
      const coreFile = join(home, 'core-personality.md')
      const core = new CoreProvider(coreFile)
      core.init()
      expect(core.frozenFor()).toBe(CORE_PERSONALITY_TEXT)
      expect(core.frozenFor()).toBe(CORE_PERSONALITY_TEXT) // 缓存命中
      await new Promise(r => setTimeout(r, 25))
      writeFileSync(coreFile, 'custom baseline')
      expect(core.frozenFor()).toBe('custom baseline')
    })

    it('文件被删 → 降级返回默认文本', () => {
      const home = tmpHome()
      const coreFile = join(home, 'core-personality.md')
      const core = new CoreProvider(coreFile)
      core.init()
      rmSync(coreFile, { force: true })
      expect(core.frozenFor()).toBe(CORE_PERSONALITY_TEXT)
    })
  })

  describe('core 接线（apply 注册 + 首次初始化）', () => {
    it('harness 装配后自动生成 core-personality.md（默认模板）', async () => {
      const home = tmpHome()
      await harness(home, [textResponse('ack')])
      expect(readFileSync(join(home, 'core-personality.md'), 'utf8')).toBe(CORE_PERSONALITY_TEXT)
    })
  })

  describe('快照注入（验收 1/6）', () => {
    it('首 step 注入 MEMORY 快照，且字节为纯函数渲染', async () => {
      const home = tmpHome()
      seedMemory(home, 'entry-one')
      const { ctx, agent } = await harness(home, [textResponse('ack')])
      followup(agent, 'hello')
      await waitForIdle(ctx, agent)

      const snaps = snapshotMessages([...agent.session.events])
      expect(snaps.length).toBe(1)
      expect(snaps[0].update).toBe(false)
      expect(snaps[0].entries).toEqual(['entry-one'])
      // D14：渲染 = 表头 + 条目 + §，纯函数（同文件→同字节）
      const text = [...agent.session.events]
        .filter(e => e.type === 'user/message' && e.data.source.kind === 'memory-snapshot')
        .map(e => e.type === 'user/message' ? e.data.content.filter(b => b.type === 'text').map(b => b.text).join('') : '')
        .join('')
      expect(text).toBe('── MEMORY (agent notes) ──\nentry-one')
    })
  })

  describe('USER 画像注入（M1b）', () => {
    it('USER.md 有内容时，首 step 快照含 USER PROFILE 段（在 MEMORY 段之前）', async () => {
      const home = tmpHome()
      seedMemory(home, 'entry-one')
      writeFileSync(join(home, 'memories', 'USER.md'), '用户叫蓝天')
      const { ctx, agent } = await harness(home, [textResponse('ack')])
      followup(agent, 'hello')
      await waitForIdle(ctx, agent)

      const text = snapshotText(agent)
      expect(text).toBe('── USER PROFILE ──\n用户叫蓝天\n\n── MEMORY (agent notes) ──\nentry-one')
    })

    it('USER.md 为空时省略 USER 段（字节稳定）', async () => {
      const home = tmpHome()
      seedMemory(home, 'entry-one')
      const { ctx, agent } = await harness(home, [textResponse('ack')])
      followup(agent, 'hello')
      await waitForIdle(ctx, agent)

      expect(snapshotText(agent)).toBe('── MEMORY (agent notes) ──\nentry-one')
    })
  })

  describe('写后 update（验收 5 · D20）', () => {
    it('会话中途 memory_add 后，下一条请求注入 update 快照', async () => {
      const home = tmpHome()
      seedMemory(home, 'entry1')
      const { ctx, agent } = await harness(home, [
        toolCallResponse('c1', 'memory_add', { target: 'memory', content: 'entry2' }),
        textResponse('step1-done'),
        textResponse('step2-done'),
      ])
      followup(agent, 'add entry2 to memory')
      await waitForIdle(ctx, agent)
      followup(agent, 'what do you remember now?')
      await waitForIdle(ctx, agent)

      const snaps = snapshotMessages([...agent.session.events])
      expect(snaps.length).toBe(2) // 初始 + update
      expect(snaps[0].entries).toEqual(['entry1'])
      expect(snaps[1].update).toBe(true)
      expect(snaps[1].entries).toEqual(['entry1', 'entry2'])
    })
  })

  describe('跨会话记忆（验收 1/2）', () => {
    it('会话 A 写入的事实，会话 B（同档案）首条请求可见；非显式内容不可见', async () => {
      const home = tmpHome()
      // 会话 A：调用 memory_add 写入 fact-X
      const a = await harness(home, [
        toolCallResponse('c1', 'memory_add', { target: 'memory', content: 'fact-X' }),
        textResponse('done'),
      ])
      followup(a.agent, 'remember fact-X, but never mention the phrase banana-secret-42')
      await waitForIdle(a.ctx, a.agent)

      // 会话 B：全新会话、同 home，读盘注入
      const b = await harness(home, [textResponse('ack')])
      followup(b.agent, 'what is in memory?')
      await waitForIdle(b.ctx, b.agent)

      const snaps = snapshotMessages([...b.agent.session.events])
      expect(snaps.length).toBeGreaterThanOrEqual(1)
      const entries = snaps[snaps.length - 1].entries
      expect(entries).toContain('fact-X')
      // 验收 2：只含显式写入，对话文本（banana-secret-42）绝不在快照里
      expect(entries.join('\n')).not.toContain('banana-secret-42')
    })
  })

  describe('容量超限（验收 3 · 工具层）', () => {
    it('超限 memory_add 被拒且落盘不变', async () => {
      const home = tmpHome()
      seedMemory(home, 'aaaaaaaaaa') // 10 chars
      const { ctx, agent } = await harness(home, [
        toolCallResponse('c1', 'memory_add', { target: 'memory', content: 'bbbbbbbbbbbb' }), // +12 > 20
        textResponse('done'),
      ], { memoryLimit: 20 })
      followup(agent, 'add a long entry')
      await waitForIdle(ctx, agent)

      // 落盘仍只有原条目（超限 add 未写入）
      expect(readFileSync(memoryFile(home), 'utf8')).toBe('aaaaaaaaaa')
    })
  })
})
