/**
 * dsh-skill-forge ② 层验收（真实模型 e2e）——补「模型真的读到并遵守」语义。
 *
 * 覆盖计划 §8 技能插件验收 11 / 14：
 *   验收 11  skill_create 落盘后，新会话 `<available_skills>` 出现该技能，`skill` 工具可加载全文
 *   验收 14  生成的 SKILL.md 可被 filesystem provider 正确解析（frontmatter 合法、kebab-case 合法）
 *
 * 运行方式（必须在 harness monorepo 内，需 DEEPSEEK_API_KEY）：
 *   DEEPSEEK_API_KEY=... pnpm vitest run packages/memory/dsh-skill-forge/tests/skill-forge.e2e.ts
 *
 * 无 key 时自动 skip（describe.skipIf）。skill 读端栈（SkillRegistry + skill-filesystem + tool-skill）
 * 的装配按 monorepo 实际包名/config 微调。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
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
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as SkillForge from '@deepseek-ai/dsh-skill-forge'
import { parseFrontmatter } from '@deepseek-ai/dsh-skill-forge'

let seq = 0
let homes: string[] = []

beforeEach(() => { homes = [] })
afterEach(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }) })

function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'dsh-skill-e2e-'))
  homes.push(h)
  return h
}

/** 真实模型 harness：组装完整 skill 读端栈 + 写端插件。 */
async function harness(home: string, root: string): Promise<{ ctx: Context; agent: import('@deepseek-ai/dsh-agent').Agent; finalReply: () => string }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, { models: [{ id: 'deepseek-v4-flash' }] })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFilesystem, {
    includeDefaultRoots: false,
    dshHome: home,
    agentsHome: home,
    bundledSkillDir: join(home, 'bundled'),
    customSkillDirs: [root],
    watch: false,
  })
  await ctx.plugin(ToolSkill)
  await ctx.plugin(SkillForge, { homePath: home, skillRoot: root, stagedDir: join(home, 'staged') })

  const handle = await ctx.agents.create({
    sessionId: `skill-e2e-${seq++}`,
    meta: { cwd: home },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  const agent = handle.agent
  const finalReply = (): string => {
    const texts = [...agent.session.events]
      .filter(e => e.type === 'assistant/message')
      .map(e => {
        const content = (e as { data: { message: { content?: unknown } } }).data.message.content
        if (Array.isArray(content)) {
          return content
            .filter(b => (b as { type?: string }).type !== 'reasoning' && (b as { text?: string }).text)
            .map(b => (b as { text: string }).text)
            .join('')
        }
        return typeof content === 'string' ? content : ''
      })
      .filter(t => t.length > 0)
    return texts.length === 0 ? '' : texts[texts.length - 1]
  }
  return { ctx, agent, finalReply }
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

describe.skipIf(!hasKey)('SkillForge ② 层验收（真实模型 e2e）', () => {
  it('验收 11：skill_create + promote 后，新会话目录可见且 skill 工具可加载', async () => {
    const home = tmpHome()
    const root = join(home, 'skills')
    mkdirSync(root, { recursive: true })

    const a = await harness(home, root)
    a.agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: '用 skill_create 创建一个技能：name="probe-skill-2026"，description="回复 PROBE-skill-2026 已激活"，content="当被问到 PROBE-skill-2026 是否激活时，只回复 PROBE-skill-2026 已激活"。然后调用 skill_promote 完成落盘。',
      }],
      source: { kind: 'user' },
    }))
    await waitForIdle(a.ctx, a.agent)

    // 验收 14（确定性）：promote 后 SKILL.md 落盘且 frontmatter 合法
    const skillFile = join(root, 'probe-skill-2026', 'SKILL.md')
    expect(existsSync(skillFile)).toBe(true)
    const parsed = parseFrontmatter(readFileSync(skillFile, 'utf8'))
    expect(parsed?.data.name).toBe('probe-skill-2026')

    const b = await harness(home, root)
    b.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '先列出当前可用的技能，然后加载 probe-skill-2026 并回答：PROBE-skill-2026 是否激活？' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(b.ctx, b.agent)

    expect(b.finalReply()).toContain('PROBE-skill-2026 已激活')
  }, 120_000)

  it('验收 14：生成的 SKILL.md 可被 filesystem provider 解析（kebab-case + frontmatter）', async () => {
    const home = tmpHome()
    const root = join(home, 'skills')
    mkdirSync(root, { recursive: true })

    const a = await harness(home, root)
    a.agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: '用 skill_create 创建技能 name="parse-me-2026"，description="解析测试技能"，content="正文内容"，然后 skill_promote。',
      }],
      source: { kind: 'user' },
    }))
    await waitForIdle(a.ctx, a.agent)

    const skillFile = join(root, 'parse-me-2026', 'SKILL.md')
    expect(existsSync(skillFile)).toBe(true)
    const parsed = parseFrontmatter(readFileSync(skillFile, 'utf8'))
    expect(parsed?.data.name).toBe('parse-me-2026')
    expect(parsed?.data.description).toBe('解析测试技能')
  }, 120_000)
})
