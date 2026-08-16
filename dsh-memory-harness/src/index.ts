/**
 * dsh-memory-harness —— dsh 记忆管理插件（P1：MEMORY + SOUL + 档案隔离 + 安全扫描；USER 后移）。
 *
 * 纯插件叠加，通过 profile `dsh.profile.bundles` 或 cordis.patch.yml 装配（计划 §1.3）。
 *
 * @module dsh-memory-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryStore } from './store.ts'
import { applySnapshot } from './snapshot.ts'
import { registerMemoryTools } from './tools.ts'
import { SoulProvider } from './soul.ts'
import {
  DEFAULT_ARCHIVE,
  resolveArchiveId,
  resolveHomePath,
  resolveMemoryPaths,
  resolveProcessProfile,
} from './profile.ts'

export { MemoryStore, parseEntries, serializeEntries } from './store.ts'
export type { MemorySnapshot, MemoryTarget, WriteResult, MemoryFs } from './store.ts'
export { renderMemorySnapshot, applySnapshot } from './snapshot.ts'
export type { MemorySnapshotSource } from './snapshot.ts'
export { SoulProvider, CORE_PERSONALITY_TEXT } from './soul.ts'
// 安全扫描来自共享基建 dsh-review-core（G4）
export { scanSecrets, hasSecrets } from '@deepseek-ai/dsh-review-core'
export type { SecretKind } from '@deepseek-ai/dsh-review-core'
export {
  DEFAULT_ARCHIVE,
  resolveArchiveId,
  resolveHomePath,
  resolveMemoryPaths,
  resolveProcessProfile,
} from './profile.ts'
export type { ArchiveId, MemoryPaths } from './profile.ts'
export type { MemoryWriteEvent } from './tools.ts'

export const name = 'dsh-memory-harness'

/** 硬依赖：工具注册 + 人格 section 注册。 */
export const inject = ['tools', 'systemPrompt']

/** 模型可见配置（D17：描述不含运行时数据，schema 字段本身稳定）。 */
export interface Config {
  memoryLimit: number
  userLimit: number
  includeSoul: boolean
  includeSnapshot: boolean
  writeApproval: boolean
  homePath?: string
  profile?: string
}

/** Schemastery 配置（D7：writeApproval 默认 false，即全自动落盘）。 */
export const Config: z<Config> = z.object({
  memoryLimit: z.number().default(2200),
  userLimit: z.number().default(1375),
  includeSoul: z.boolean().default(true),
  includeSnapshot: z.boolean().default(true),
  writeApproval: z.boolean().default(false),
  homePath: z.string().default(''),
  profile: z.string().default(''),
})

export function apply(ctx: Context, config: Config): void {
  const homePath = resolveHomePath(config.homePath)
  // v08 S1：档案解析优先级 = 插件配置档案 > 启动 profile（ctx.baseUrl 推导）> default。
  const processProfile = resolveProcessProfile(ctx.baseUrl, homePath)
  const archiveId = resolveArchiveId(config.profile, processProfile)
  const paths = resolveMemoryPaths(homePath, archiveId === DEFAULT_ARCHIVE ? undefined : archiveId)
  const store = new MemoryStore(
    paths.memoryFile,
    paths.userFile,
    config.memoryLimit,
    config.userLimit,
    undefined,
    archiveId,
  )
  if (config.includeSnapshot) applySnapshot(ctx, store)
  registerMemoryTools(ctx, store)
  if (config.includeSoul) new SoulProvider(paths.soulFile).register(ctx)
}
