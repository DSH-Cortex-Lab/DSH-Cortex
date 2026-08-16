/**
 * dsh-skill-forge —— dsh 自动技能化插件（P1：SkillForge + 四写端工具 + promote + 后台 review 三路输出）。
 *
 * 纯插件叠加，通过 profile `dsh.profile.bundles` 或 cordis.patch.yml 装配（计划 §1.3）。
 *
 * @module dsh-skill-forge
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SkillForge } from './forge.ts'
import { registerSkillTools } from './tools.ts'
import { applyPromote, cleanupStagedOnStartup } from './promote.ts'
import { ReviewEngine, type MemoryStoreLike } from './review.ts'

export { SkillForge } from './forge.ts'
export type { SkillRoot, ForgeInput, ForgePatch, ForgeResult, ForgeFs } from './forge.ts'
export { isSkillName, SKILL_NAME, parseFrontmatter, renderSkillFile, validateSkillInput } from './validate.ts'
export type { SkillFrontmatter, SkillInput } from './validate.ts'
// 共享基建（G4：从 dsh-review-core 导入，本包不再保留副本）
export {
  buildConversationDigest,
  renderDigest,
  similarity,
  isDuplicate,
  scanSecrets,
  hasSecrets,
  buildReviewPrompt,
  parseReviewOutput,
} from '@dsh-cortex/dsh-review-core'
export type { ConversationDigest, DigestEntry, SecretKind, ReviewOutput, SkillCandidate, MemoryUpdate } from '@dsh-cortex/dsh-review-core'
// 本包 review 集成层
export { ReviewEngine, applyReviewOutput, projectEntries, extractEarlySummary } from './review.ts'
export type { ReviewConfig, MemoryStoreLike } from './review.ts'
export type { SkillWriteEvent } from './tools.ts'

export const name = 'dsh-skill-forge'

/** 硬依赖：工具注册 + 会话边界 promote 需要 sessions；后台 review 需要 jobs + llm。 */
export const inject = ['tools', 'sessions']

/** 模型可见配置（D17：schema 字段稳定，不含运行时数据）。字符串字段有 `.default('')`，恒为 string。 */
export interface Config {
  writeApproval: boolean
  defaultRoot: 'project' | 'user' | 'custom'
  maxSkillBytes: number
  homePath: string
  skillRoot: string
  stagedDir: string
  // review（v2 定稿：节律触发 + checkpoint，见 docs/自动技能化机制设计.md）
  reviewEnabled: boolean
  reviewTrigger: 'cadence' | 'session-end' | 'off'
  reviewTurnInterval: number
  reviewToolInterval: number
  reviewRecentTurns: number
  reviewMinResultChars: number
  dedupeSimilarity: number
  reviewProvider: string
  reviewModel: string
}

/** Schemastery 配置（字符串可选字段用 `.default('')` 表示未设置——schemastery 无 `.optional()`）。 */
export const Config: z<Config> = z.object({
  writeApproval: z.boolean().default(false),
  defaultRoot: z.union([z.const('project'), z.const('user'), z.const('custom')]).default('user'),
  maxSkillBytes: z.number().default(32768),
  homePath: z.string().default(''),
  skillRoot: z.string().default(''),
  stagedDir: z.string().default(''),
  reviewEnabled: z.boolean().default(true),
  reviewTrigger: z.union([z.const('cadence'), z.const('session-end'), z.const('off')]).default('cadence'),
  reviewTurnInterval: z.number().default(10),
  reviewToolInterval: z.number().default(10),
  reviewRecentTurns: z.number().default(8),
  reviewMinResultChars: z.number().default(200),
  dedupeSimilarity: z.number().default(0.8),
  reviewProvider: z.string().default(''),
  reviewModel: z.string().default(''),
})

export function apply(ctx: Context, config: Config): void {
  const homePath = resolveHomePath(config.homePath)
  const skillRoot = config.skillRoot.length > 0 ? config.skillRoot : join(homePath, 'skills')
  const stagedDir = config.stagedDir.length > 0 ? config.stagedDir : join(homePath, 'pending', 'skills-staged')
  const checkpointFile = join(homePath, 'pending', 'review-checkpoints.json')
  const forge = new SkillForge([{ path: skillRoot }], stagedDir, undefined, config.maxSkillBytes)
  registerSkillTools(ctx, forge)
  applyPromote(ctx, forge)
  cleanupStagedOnStartup(ctx, forge)

  // 后台 review（v2：cadence 节律触发；D5 ctx.jobs 后台，不阻塞 agent 循环）
  // MEMORY 三路输出②需组合层 `ctx.provide('memoryStore', store)`（dsh-memory-harness 提供），缺省则仅技能路输出。
  if (config.reviewEnabled && config.reviewTrigger !== 'off' && config.reviewProvider.length > 0 && config.reviewModel.length > 0) {
    const memoryStore = ctx.get('memoryStore') as MemoryStoreLike | undefined
    const engine = new ReviewEngine(
      ctx,
      forge,
      memoryStore,
      {
        reviewEnabled: config.reviewEnabled,
        reviewTrigger: config.reviewTrigger,
        reviewTurnInterval: config.reviewTurnInterval,
        reviewToolInterval: config.reviewToolInterval,
        reviewRecentTurns: config.reviewRecentTurns,
        reviewMinResultChars: config.reviewMinResultChars,
        dedupeSimilarity: config.dedupeSimilarity,
        reviewModel: config.reviewModel,
      },
      config.reviewProvider,
      config.reviewModel,
      checkpointFile,
    )
    engine.attach()
  }
}

function resolveHomePath(configHomePath: string): string {
  if (configHomePath.length > 0) return configHomePath
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.length > 0) return envHome
  return join(homedir(), '.dsh')
}
