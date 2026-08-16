/**
 * dsh-review-core —— dsh-memory-harness 与 dsh-skill-forge 共享的 review 基建（纯 TS，无 dsh 依赖）。
 *
 * 计划 §6「共享基建（P2 抽取）」：digest 构造 / 去重 / 安全扫描 / review prompt 模板与三路输出解析。
 * 两个插件从本包导入（P2 抽取后）；当前仓库内存/技能包内的同名副本在链接时移除。
 *
 * @module dsh-review-core
 */

export { buildConversationDigest, renderDigest } from './digest.ts'
export type { ConversationDigest, DigestEntry } from './digest.ts'
export { similarity, isDuplicate } from './dedupe.ts'
export { scanSecrets, hasSecrets } from './security.ts'
export type { SecretKind } from './security.ts'
export { buildReviewPrompt, parseReviewOutput } from './prompt.ts'
export type { ReviewOutput, SkillCandidate, MemoryUpdate } from './prompt.ts'
