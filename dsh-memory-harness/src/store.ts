/**
 * MemoryStore：MEMORY/USER 持久化存储层。
 *
 * 纯 TS、无 dsh 依赖，可独立单测。`target='memory'` 与 `target='user'` 均已启用
 * （M1b：USER 槽位开启，userFile/userLimit 生效）。
 *
 * 文件格式（对齐 Hermes MEMORY.md）：条目以独占一行的 `§` 分隔，多行条目保留内部换行。
 * usage = 条目内容字符数之和（不含分隔符）。
 *
 * @module dsh-memory-harness
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 记忆目标：P0 仅 'memory'。 */
export type MemoryTarget = 'memory' | 'user'

/** 条目分隔符：文件中独占一行的 `§`。 */
const SEPARATOR = '§'

/** 读盘→解析后的快照。 */
export interface MemorySnapshot {
  target: MemoryTarget
  entries: string[]
  usage: number
  limit: number
}

/** 一次写操作的结果（模型可见的规范值）。 */
export interface WriteResult {
  success: boolean
  /** 本次操作后的 usage（条目内容字符数）。 */
  usage: number
  /** 该目标的容量上限。 */
  limit: number
  /** 'no-duplicate'：内容已存在，未重复写入。 */
  note?: 'no-duplicate'
  /** 失败原因（over-limit / not-found / target-deferred / empty-content）。 */
  error?: string
  /** 超限时返回当前条目，供模型当回合自整理后重试。 */
  currentEntries?: string[]
}

/** 可注入的文件系统接口，便于单测与跨平台适配。 */
export interface MemoryFs {
  existsSync(path: string): boolean
  mkdirSync(path: string, opts?: { recursive?: boolean }): unknown
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
  renameSync(oldPath: string, newPath: string): void
}

const nodeFs: MemoryFs = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
}

/** 解析文件文本为条目列表（纯函数）。 */
export function parseEntries(text: string): string[] {
  return text
    .split(`\n${SEPARATOR}\n`)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}

/** 序列化条目列表为文件文本（纯函数，D14：无容量表头/时间戳/路径）。 */
export function serializeEntries(entries: readonly string[]): string {
  return entries
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .join(`\n${SEPARATOR}\n`)
}

/** 条目内容字符数之和（不含分隔符）。 */
function usageOf(entries: readonly string[]): number {
  return entries.reduce((sum, entry) => sum + entry.length, 0)
}

/** 原子写：先写临时文件再 rename，杜绝半写态（D28）。 */
function atomicWrite(fs: MemoryFs, file: string, content: string): void {
  const dir = dirname(file)
  if (dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

export class MemoryStore {
  constructor(
    private readonly memoryFile: string,
    private readonly userFile: string,
    private readonly memoryLimit: number,
    private readonly userLimit: number,
    private readonly fs: MemoryFs = nodeFs,
    /** 绑定的档案 ID（'default' 或 profile 名）；跨档案写保护（D23/v08 S1）据此校验。 */
    readonly archiveId = 'default',
  ) {}

  /** 跨档案写保护（防御性）：校验传入档案 ID 与 store 绑定档案一致，写他档拒绝。 */
  assertArchive(expected: string): void {
    if (expected !== this.archiveId) {
      throw new Error(`memory archive mismatch: store bound to "${this.archiveId}", got "${expected}"`)
    }
  }

  /** 读盘→解析→快照（MEMORY 与 USER 均启用）。 */
  snapshot(target: MemoryTarget = 'memory'): MemorySnapshot {
    const entries = this.isSupported(target) ? this.readEntries(target) : []
    return {
      target,
      entries,
      usage: usageOf(entries),
      limit: this.limitFor(target),
    }
  }

  add(target: MemoryTarget, content: string): WriteResult {
    const deferred = this.deferred(target)
    if (deferred !== undefined) return deferred
    const entry = content.trim()
    if (entry.length === 0) {
      return this.failure(target, 'empty-content: content must be a non-empty string')
    }
    const entries = this.readEntries(target)
    if (entries.includes(entry)) {
      return { success: true, usage: usageOf(entries), limit: this.limitFor(target), note: 'no-duplicate' }
    }
    const next = [...entries, entry]
    return this.commit(target, next, entries)
  }

  replace(target: MemoryTarget, oldSubstr: string, content: string): WriteResult {
    const deferred = this.deferred(target)
    if (deferred !== undefined) return deferred
    const entry = content.trim()
    if (entry.length === 0) {
      return this.failure(target, 'empty-content: content must be a non-empty string')
    }
    const entries = this.readEntries(target)
    const index = entries.findIndex(e => e.includes(oldSubstr))
    if (index === -1) {
      return this.failure(target, `not-found: no entry contains ${JSON.stringify(oldSubstr)}`)
    }
    const next = entries.slice()
    next[index] = entry
    return this.commit(target, next, entries)
  }

  remove(target: MemoryTarget, oldSubstr: string): WriteResult {
    const deferred = this.deferred(target)
    if (deferred !== undefined) return deferred
    const entries = this.readEntries(target)
    const index = entries.findIndex(e => e.includes(oldSubstr))
    if (index === -1) {
      return this.failure(target, `not-found: no entry contains ${JSON.stringify(oldSubstr)}`)
    }
    const next = entries.filter((_, i) => i !== index)
    this.writeEntries(target, next)
    return { success: true, usage: usageOf(next), limit: this.limitFor(target) }
  }

  usage(target: MemoryTarget): { chars: number; limit: number } {
    const entries = this.isSupported(target) ? this.readEntries(target) : []
    return { chars: usageOf(entries), limit: this.limitFor(target) }
  }

  private isSupported(target: MemoryTarget): boolean {
    return target === 'memory' || target === 'user'
  }

  private deferred(target: MemoryTarget): WriteResult | undefined {
    if (this.isSupported(target)) return undefined
    return {
      success: false,
      usage: 0,
      limit: this.limitFor(target),
      error: `unsupported target ${JSON.stringify(target)}; supported: memory, user`,
    }
  }

  private failure(target: MemoryTarget, error: string): WriteResult {
    const entries = this.readEntries(target)
    return { success: false, usage: usageOf(entries), limit: this.limitFor(target), error }
  }

  /** 容量校验 + 原子落盘；超限返回当前条目供模型自整理。 */
  private commit(target: MemoryTarget, next: string[], current: string[]): WriteResult {
    const usage = usageOf(next)
    if (usage > this.limitFor(target)) {
      return {
        success: false,
        usage: usageOf(current),
        limit: this.limitFor(target),
        error: `over-limit: would exceed the configured ${this.limitFor(target)}-character limit`,
        currentEntries: current,
      }
    }
    this.writeEntries(target, next)
    return { success: true, usage, limit: this.limitFor(target) }
  }

  private readEntries(target: MemoryTarget): string[] {
    const file = this.fileFor(target)
    if (!this.fs.existsSync(file)) return []
    return parseEntries(this.fs.readFileSync(file, 'utf8'))
  }

  private writeEntries(target: MemoryTarget, entries: string[]): void {
    atomicWrite(this.fs, this.fileFor(target), serializeEntries(entries))
  }

  private fileFor(target: MemoryTarget): string {
    return target === 'memory' ? this.memoryFile : this.userFile
  }

  private limitFor(target: MemoryTarget): number {
    return target === 'memory' ? this.memoryLimit : this.userLimit
  }
}
