/**
 * dsh-skill-forge ① 层验收（进程内组装 + MockAdapter，确定性、无网络）。
 *
 * 覆盖计划 §8 技能插件验收 11/14/15：
 *   验收 15  skill_create 写 staged（会话内目录消息不变）；promote 后才落回扫描根
 *   验收 14  生成的 SKILL.md frontmatter 合法、kebab-case 合法
 *   验收 11  promote 后新会话目录可见（需 skill 读端栈）
 *
 * 运行：pnpm vitest run packages/memory/dsh-skill-forge/tests/skill-forge.spec.ts
 * 依赖：复用 packages/core/agent-loop/tests/mock-adapter.ts；包名按 vendor 后实际名调整。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as SkillForge from '@deepseek-ai/dsh-skill-forge'
import { parseFrontmatter } from '@deepseek-ai/dsh-skill-forge'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let seq = 0
let homes: string[] = []

beforeEach(() => { homes = [] })
afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'dsh-skill-spec-'))
  homes.push(h)
  return h
}

/** 组装写端插件 + mock（不接 skill 读端栈，专测 forge/tools 行为）。 */
async function harness(
  home: string,
  root: string,
  staged: string,
  script: ConstructorParameters<typeof MockAdapter>[0],
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
  await ctx.plugin(SkillForge, { homePath: home, skillRoot: root, stagedDir: staged })
  const handle = await ctx.agents.create({
    sessionId: SessionId(`skill-spec-${seq++}`),
    meta: { cwd: home },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  return { ctx, agent: handle.agent, adapter }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function followup(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('SkillForge ① 层验收', () => {
  it('验收 15：skill_create 写 staged，扫描根不可见（会话内目录消息不变，D19）', async () => {
    const home = tmpHome()
    const root = join(home, 'skills')
    const staged = join(home, 'staged')
    mkdirSync(root, { recursive: true })

    const { ctx, agent } = await harness(home, root, staged, [
      toolCallResponse('c1', 'skill_create', { name: 'probe-skill', description: 'desc', content: 'body' }),
      textResponse('created'),
    ])
    followup(agent, 'create a skill named probe-skill')
    await waitForIdle(ctx, agent)

    expect(existsSync(join(staged, 'probe-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'probe-skill', 'SKILL.md'))).toBe(false)
  })

  it('验收 14/15：skill_create + skill_promote 后落回扫描根，frontmatter 合法', async () => {
    const home = tmpHome()
    const root = join(home, 'skills')
    const staged = join(home, 'staged')
    mkdirSync(root, { recursive: true })

    const { ctx, agent } = await harness(home, root, staged, [
      toolCallResponse('c1', 'skill_create', { name: 'probe-skill', description: 'A desc: with colon', content: 'body line\nsecond' }),
      toolCallResponse('c2', 'skill_promote', {}),
      textResponse('promoted'),
    ])
    followup(agent, 'create and promote a skill named probe-skill')
    await waitForIdle(ctx, agent)

    const file = join(root, 'probe-skill', 'SKILL.md')
    expect(existsSync(file)).toBe(true)
    expect(existsSync(join(staged, 'probe-skill'))).toBe(false) // staged 清空
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'))
    expect(parsed?.data.name).toBe('probe-skill')
    expect(parsed?.data.description).toBe('A desc: with colon')
    expect(parsed?.body.trim()).toBe('body line\nsecond')
  })

  it('验收 14：非法技能名在 create 即被拒，不落 staged', async () => {
    const home = tmpHome()
    const root = join(home, 'skills')
    const staged = join(home, 'staged')
    mkdirSync(root, { recursive: true })

    const { ctx, agent } = await harness(home, root, staged, [
      toolCallResponse('c1', 'skill_create', { name: 'Bad-Name', description: 'd', content: 'b' }),
      textResponse('done'),
    ])
    followup(agent, 'create a skill with invalid name')
    await waitForIdle(ctx, agent)

    expect(existsSync(join(staged, 'Bad-Name', 'SKILL.md'))).toBe(false)
  })
})
