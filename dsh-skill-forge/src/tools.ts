/**
 * 技能写端工具：skill_create / skill_patch / skill_edit / skill_delete（一律写 staged，D3/D19）。
 *
 * 人控入库（D-d 修订）：不注册 skill_promote——入库唯一入口是管理面板的「入库」按钮，
 * agent 无法自行把 staged 落回扫描根（防止绕过人工审批）。
 *
 * 审计说明（B2 决策 2026-08-20）：不再 append `skill/write` 自定义会话事件——
 * dsh 读侧只认官方事件类型（或 ignorable 标记），自定义事件会导致会话 resume
 * 直接失败（SessionFormatUnsupportedError）。写入留痕由官方 tool/call + tool/result
 * 事件天然覆盖，无需自定义审计事件。工具 schema/描述不含运行时数据（D17）。
 *
 * @module dsh-skill-forge
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { SkillForge, type ForgeResult } from './forge.ts'

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
    async execute(args) {
      return forge.create({
        name: args.name,
        description: args.description,
        ...(args.whenToUse !== undefined ? { whenToUse: args.whenToUse } : {}),
        content: args.content,
      })
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
    async execute(args) {
      return forge.patch(args.name, {
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.whenToUse !== undefined ? { whenToUse: args.whenToUse } : {}),
        ...(args.bodyPatch !== undefined ? { bodyPatch: args.bodyPatch } : {}),
      })
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
    async execute(args) {
      return forge.patch(args.name, { bodyPatch: args.content })
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
    async execute(args) {
      return forge.delete(args.name)
    },
    presentCall: args => ({ card: 'generic', title: 'skill_delete', kind: 'other', rawInput: args.name }),
  }))
}

function renderForgeResult(value: ForgeResult): string {
  if (value.success) {
    return value.path !== undefined
      ? `Skill "${value.name}" staged at ${value.path}. It becomes visible after promote.`
      : `Skill "${value.name}" updated.`
  }
  return `Skill write failed: ${value.error ?? 'unknown error'}`
}
