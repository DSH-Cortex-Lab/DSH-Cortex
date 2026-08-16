/**
 * 档案解析（v08 S1）：档案 = 进程级概念。
 *
 * 解析优先级：插件配置档案（Config.profile，agent 级可配）> 启动 profile（进程级，`dsh --profile`）> default。
 * - 启动 profile 通过 `ctx.baseUrl` 推导：boot 把 baseUrl 设为 profile 目录（`$DSH_HOME/profiles/<name>/`），
 *   见 `apps/cli/src/profile-boot.ts` + `vendor/cordis/src/context.ts:24`（`baseUrl?: string`）。
 * - 无 `DSH_PROFILE` 环境变量；scope 无档案字段，不可从 scope 反查。
 * - 多档案隔离由进程隔离保证（单进程内不存在多档案并发，D23/v08 S1）。
 *
 * @module dsh-memory-harness
 */

import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 档案 ID：profile 名或 'default'。 */
export type ArchiveId = string

export const DEFAULT_ARCHIVE = 'default'

/** 解析出的记忆/人格文件路径。 */
export interface MemoryPaths {
  soulFile: string
  memoryFile: string
  userFile: string
}

/**
 * 从 `ctx.baseUrl`（boot 设为 profile 目录的 file URL）推导启动 profile 名。
 * 仅当 baseUrl 位于 `$DSH_HOME/profiles/<name>/` 下时返回 `<name>`，否则 undefined。
 */
export function resolveProcessProfile(baseUrl: string | undefined, homePath: string): string | undefined {
  if (baseUrl === undefined || baseUrl.length === 0) return undefined
  let dir: string
  try {
    dir = fileURLToPath(baseUrl)
  } catch {
    return undefined
  }
  const profilesDir = join(homePath, 'profiles')
  const rel = relative(profilesDir, dir)
  if (rel === '' || rel.startsWith('..') || rel === '..') return undefined
  const name = rel.split(sep)[0]
  return name !== undefined && name.length > 0 ? name : undefined
}

/** 解析档案 ID：配置档案 > 启动 profile > default。 */
export function resolveArchiveId(configProfile: string | undefined, processProfile: string | undefined): ArchiveId {
  if (configProfile !== undefined && configProfile.length > 0) return configProfile
  if (processProfile !== undefined && processProfile.length > 0) return processProfile
  return DEFAULT_ARCHIVE
}

/**
 * 按档案定位三个文件（计划 §4.3 目录约定）：
 *   default → $DSH_HOME/SOUL.md + $DSH_HOME/memories/{MEMORY,USER}.md
 *   profile → $DSH_HOME/profiles/<name>/SOUL.md + …/memories/{MEMORY,USER}.md
 */
export function resolveMemoryPaths(homePath: string, profile?: string): MemoryPaths {
  const base = profile !== undefined && profile.length > 0
    ? join(homePath, 'profiles', profile)
    : homePath
  return {
    soulFile: join(base, 'SOUL.md'),
    memoryFile: join(base, 'memories', 'MEMORY.md'),
    userFile: join(base, 'memories', 'USER.md'),
  }
}

/** 解析 $DSH_HOME：Config.homePath > process.env.DSH_HOME > ~/.dsh。 */
export function resolveHomePath(configHomePath?: string): string {
  if (configHomePath !== undefined && configHomePath.length > 0) return configHomePath
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.length > 0) return envHome
  return join(homedir(), '.dsh')
}
