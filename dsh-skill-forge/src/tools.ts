/**
 * 技能写端工具：skill_create / skill_patch / skill_edit / skill_delete（一律写 staged，D3/D19）
 * + skill_promote（显式会话边界 promote，D19/D25 的显式路径）。
 *
 * 每次成功写 append `skill/write` 审计事件（log-only）。工具 schema/描述不含运行时数据（D17）。
 *
 * @module dsh-skill-forge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session'
import { SkillForge, type ForgeResult } from './forge.ts'

/** 一次技能写操作的审计载荷（log-only，不进模型可见历史）。 */
export interface SkillWriteEvent {
  /** 写操作类型。 */
  action: 'create' | 'patch' | 'edit' | 'delete'
  /** 技能名（kebab-case）。 */
  name: string
  /** 落盘路径（staged 路径）。 */
  path?: string
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'skill/write': SkillWriteEvent
  }
}

const FORGE_OUTPUT = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      success: { type: 'boolean' as const, required: true },
      name: { type: 'string' as const, required: true },
      path: { type: 'string' as const },
      error: { type: 'string' as const },
    },
  } satisfies ObjectValueSchemaSpec,
  render: (_args: unknown, value: ForgeResult) => [{ type: 'text' as const, text: renderForgeResult(value) }],
}

export function registerSkillTools(ctx: Context, forge: SkillForge): void {
  ctx.tools.register(defineTool({
    name: 'skill_create',
    description: 'Create a new skill from scratch. Skills are reusable, task-specific instruction files; this only stages the skill — it becomes visible to the model after a session-boundary promote.',
    parameters: {
      name: { type: 'string', required: true, description: 'kebab-case skill name (lowercase letters, digits, single hyphens).' },
      description: { type: 'string', required: true, description: 'One-sentence summary shown in the available-skills catalog.' },
      whenToUse: { type: 'string', description: 'Optional guidance on when this skill applies.' },
      content: { type: 'string', required: true, description: 'The skill body as Markdown instructions.' },
    },
    output: FORGE_OUTPUT,
    async execute(args, exec) {
      const result = await forge.create({
        name: args.name,
        description: args.description,
        ...(args.whenToUse !== undefined ? { whenToUse: args.whenToUse } : {}),
        content: args.content,
      })
      if (result.success) audit(exec.agent, 'create', args.name, result)
      return result
    },
    presentCall: args => ({ card: 'generic', title: 'skill_create', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'skill_patch',
    description: 'Update a skill. Change its description and/or whenToUse (frontmatter), and optionally replace its body. Stages the change; visible after the next promote.',
    parameters: {
      name: { type: 'string', required: true, description: 'kebab-case skill name.' },
      description: { type: 'string', description: 'New one-sentence catalog description.' },
      whenToUse: { type: 'string', description: 'New when-to-use guidance.' },
      bodyPatch: { type: 'string', description: 'New full body Markdown (replaces the current body).' },
    },
    output: FORGE_OUTPUT,
    async execute(args, exec) {
      const result = await forge.patch(args.name, {
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.whenToUse !== undefined ? { whenToUse: args.whenToUse } : {}),
        ...(args.bodyPatch !== undefined ? { bodyPatch: args.bodyPatch } : {}),
      })
      if (result.success) audit(exec.agent, 'patch', args.name, result)
      return result
    },
    presentCall: args => ({ card: 'generic', title: 'skill_patch', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'skill_edit',
    description: 'Replace the body of an existing skill while keeping its frontmatter (name/description/whenToUse). Stages the change; visible after the next promote.',
    parameters: {
      name: { type: 'string', required: true, description: 'kebab-case skill name.' },
      content: { type: 'string', required: true, description: 'The new body Markdown.' },
    },
    output: FORGE_OUTPUT,
    async execute(args, exec) {
      const result = await forge.patch(args.name, { bodyPatch: args.content })
      if (result.success) audit(exec.agent, 'edit', args.name, result)
      return result
    },
    presentCall: args => ({ card: 'generic', title: 'skill_edit', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'skill_delete',
    description: 'Delete a skill. Marks it for removal; the file is removed from the scan root at the next session-boundary promote.',
    parameters: {
      name: { type: 'string', required: true, description: 'kebab-case skill name.' },
    },
    output: FORGE_OUTPUT,
    async execute(args, exec) {
      const result = await forge.delete(args.name)
      if (result.success) audit(exec.agent, 'delete', args.name, result)
      return result
    },
    presentCall: args => ({ card: 'generic', title: 'skill_delete', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'skill_promote',
    description: 'Promote all staged skill changes (creates/patches/edits/deletes) into the skill scan root now. Normally this happens automatically at the session boundary.',
    parameters: {
      name: { type: 'string', description: 'Optional: promote only this one skill name.' },
    },
    output: FORGE_OUTPUT,
    async execute(args) {
      const result = await forge.promote(args.name)
      return result
    },
    presentCall: args => ({ card: 'generic', title: 'skill_promote', kind: 'other', rawInput: args.name }),
  }))
}

/** D2/D18：审计事件（log-only），仅成功写时 append；非 agent 调用者无 session，跳过。 */
function audit(agent: Agent | undefined, action: SkillWriteEvent['action'], name: string, result: ForgeResult): void {
  if (agent === undefined) return
  agent.session.append('skill/write', { action, name, ...(result.path !== undefined ? { path: result.path } : {}) })
}

function renderForgeResult(value: ForgeResult): string {
  if (value.success) {
    return value.path !== undefined
      ? `Skill "${value.name}" staged at ${value.path}. It becomes visible after promote.`
      : `Skill "${value.name}" updated.`
  }
  return `Skill write failed: ${value.error ?? 'unknown error'}`
}
