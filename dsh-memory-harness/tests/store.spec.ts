/**
 * MemoryStore 单测（vitest）。纯逻辑：读写 / § 解析 / 容量预算 / 原子写 / 去重 / 错误分支。
 * MEMORY 与 USER 两个 target 均已启用（M1b）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, parseEntries, serializeEntries } from '../src/store.ts'

describe('MemoryStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'memstore-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const memoryFile = () => join(dir, 'MEMORY.md')
  const userFile = () => join(dir, 'USER.md')
  const store = (limit = 100) => new MemoryStore(memoryFile(), userFile(), limit, 50)

  it('adds one entry and persists it', () => {
    const s = store()
    const result = s.add('memory', 'hello world')
    expect(result.success).toBe(true)
    expect(result.usage).toBe(11)
    expect(s.snapshot().entries).toEqual(['hello world'])
    expect(readFileSync(memoryFile(), 'utf8')).toBe('hello world')
  })

  it('separates multiple entries with § and round-trips', () => {
    const s = store()
    s.add('memory', 'one')
    s.add('memory', 'two')
    expect(s.snapshot().entries).toEqual(['one', 'two'])
    expect(readFileSync(memoryFile(), 'utf8')).toBe('one\n§\ntwo')
  })

  it('dedupes identical entries with no-duplicate', () => {
    const s = store()
    s.add('memory', 'same')
    const result = s.add('memory', 'same')
    expect(result.success).toBe(true)
    expect(result.note).toBe('no-duplicate')
    expect(s.snapshot().entries).toEqual(['same'])
  })

  it('rejects over-limit add and returns current entries', () => {
    const s = store(20)
    const first = s.add('memory', 'aaaaaaaaaa') // 10 chars
    expect(first.success).toBe(true)
    const over = s.add('memory', 'bbbbbbbbbbbb') // +12 → 22 > 20
    expect(over.success).toBe(false)
    expect(over.error).toContain('over-limit')
    expect(over.currentEntries).toEqual(['aaaaaaaaaa'])
    // 落盘不变
    expect(s.snapshot().entries).toEqual(['aaaaaaaaaa'])
  })

  it('replaces an entry located by substring', () => {
    const s = store()
    s.add('memory', 'old fact about mars')
    const result = s.replace('memory', 'mars', 'new fact about mars')
    expect(result.success).toBe(true)
    expect(s.snapshot().entries).toEqual(['new fact about mars'])
  })

  it('removes an entry located by substring', () => {
    const s = store()
    s.add('memory', 'keep me')
    s.add('memory', 'drop this')
    const result = s.remove('memory', 'drop')
    expect(result.success).toBe(true)
    expect(s.snapshot().entries).toEqual(['keep me'])
  })

  it('returns not-found for an unknown substring', () => {
    const s = store()
    const result = s.replace('memory', 'nope', 'x')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not-found')
  })

  it('rejects empty content', () => {
    const s = store()
    const result = s.add('memory', '   ')
    expect(result.success).toBe(false)
    expect(result.error).toContain('empty-content')
  })

  it('supports target=user (M1b enabled)', () => {
    const s = store()
    const result = s.add('user', '用户叫蓝天')
    expect(result.success).toBe(true)
    expect(s.snapshot('user').entries).toEqual(['用户叫蓝天'])
    // 与 MEMORY 互不干扰
    expect(s.snapshot('memory').entries).toEqual([])
  })

  it('round-trips multiline entries via parse/serialize', () => {
    const entries = ['line1\nline2', 'plain']
    const text = serializeEntries(entries)
    expect(parseEntries(text)).toEqual(entries)
  })

  it('reads empty state for a missing file', () => {
    const s = store()
    expect(s.snapshot().entries).toEqual([])
    expect(s.usage('memory')).toEqual({ chars: 0, limit: 100 })
  })

  it('writes atomically (no leftover tmp file)', () => {
    const s = store()
    s.add('memory', 'atomic')
    expect(s.snapshot().entries).toEqual(['atomic'])
  })
})
