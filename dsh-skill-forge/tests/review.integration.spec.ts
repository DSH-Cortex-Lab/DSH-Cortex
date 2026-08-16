/**
 * G3 集成验证：ReviewEngine 在真实 services（jobs + llm + session）下的触发→落盘链路。
 *
 * 不依赖真模型：MockAdapter 脚本化 review 输出 JSON，断言：
 *   - session/disposed 触发 reviewSession
 *   - ctx.llm.stream 被调用（reviewProvider/reviewModel 生效）
 *   - parseReviewOutput → applyReviewOutput 三路落盘（技能候选 → forge.create staged）
 *
 * 运行：pnpm vitest run packages/memory/dsh-skill-forge/tests/review.integration.spec.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JobsRuntime from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import * as SkillForge from '@dsh-cortex/dsh-skill-forge'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let seq = 0
let homes: string[] = []

beforeEach(() => { homes = [] })
afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'dsh-review-int-'))
  homes.push(h)
  return h
}

const REVIEW_JSON = JSON.stringify({
  skill: {
    name: 'reviewed-workflow',
    description: 'Review-generated workflow skill',
    content: 'Steps: 1. plan 2. execute 3. verify',
  },
  memory: [],
  user: [],
})

/** 真服务 harness：jobs + llm + session + agent + skill-forge（reviewEnabled）。 */
async function harness(home: string): Promise<{ ctx: Context; root: string; staged: string; adapter: MockAdapter }> {
  const root = join(home, 'skills')
  const staged = join(home, 'staged')
  mkdirSync(root, { recursive: true })
  mkdirSync(staged, { recursive: true })

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(JobsRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolJobs)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SkillForge, {
    homePath: home,
    skillRoot: root,
    stagedDir: staged,
    reviewEnabled: true,
    reviewTrigger: 'session-end',
    reviewProvider: 'mock',
    reviewModel: 'mock-model',
    reviewRecentTurns: 10,
    reviewMinResultChars: 10,
    dedupeSimilarity: 0.8,
  })

  // MockAdapter 脚本：第 1 次 = 主 agent 任务文本回复；第 2 次 = review 三路 JSON
  const adapter = new MockAdapter([
    textResponse('task done'),
    textResponse(REVIEW_JSON),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)

  return { ctx, root, staged, adapter }
}

describe('G3 集成：ReviewEngine 真服务触发→落盘', () => {
  it('session/disposed 触发 review → 技能候选落盘 staged + llm.stream 被调用', async () => {
    const home = tmpHome()
    const { ctx, root, staged, adapter } = await harness(home)

    // 创建 agent 并跑一步
    const handle = await ctx.agents.create({
      sessionId: `review-int-${seq++}`,
      meta: { cwd: home },
      agentOptions: { provider: 'mock', model: 'mock-model' },
    })
    const agent = handle.agent
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '任务：总结可复用流程' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    // 记录 review 调用前的请求数
    const before = adapter.requests.length

    // dispose agent → agent/disposed + session/disposed → review 调度（jobs 后台）
    // 【G3 关键发现】session/disposed 触发时 agent 已 dispose，jobs.start(owner=agent) 会抛错
    //   "agent is not the registered agent instance (background job owner must be live)"
    //   → review 在 session-end 触发 + jobs owner 生命周期的设计冲突（真实缺陷，待修复）
    let disposed = false
    ctx.on('session/disposed', () => { disposed = true })
    await handle.dispose()
    expect(disposed).toBe(true)
    // 等待后台 job 完成（轮询 staged 文件出现）
    const deadline = Date.now() + 5000
    while (!existsSync(join(staged, 'reviewed-workflow', 'SKILL.md')) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100))
    }

    // 【G3 集成验证】session/disposed 触发 → review 调度（jobs.start 不传 owner，jobs-local 允许）→
    //   ctx.llm.stream → parseReviewOutput → applyReviewOutput → 技能候选落盘 staged。
    // 验证通过标准：staged 出现 reviewed-workflow（尚未 promote，扫描根无）。
    expect(existsSync(join(staged, 'reviewed-workflow', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'reviewed-workflow', 'SKILL.md'))).toBe(false)
  }, 30_000)
})
