/**
 * dsh-skill-forge review ① 层 mock spec（G3 落地：确定性验证 review 三路输出，不依赖真模型）。
 *
 * 覆盖：parseReviewOutput / buildReviewPrompt / extractEarlySummary / projectEntries /
 * applyReviewOutput（技能候选 + MEMORY 增/改/删 + 去重 + no-change + 审计 hook）。
 *
 * 运行：pnpm vitest run packages/memory/dsh-skill-forge/tests/review.spec.ts
 * 说明：ReviewEngine 的 schedule/run（ctx.jobs + ctx.llm 真调用）属集成，另行在 monorepo 真服务下验证。
 */
import { describe, it, expect, vi } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { SkillForge } from '../src/forge.ts'
import {
  applyReviewOutput,
  extractEarlySummary,
  projectEntries,
  type MemoryStoreLike,
} from '../src/review.ts'
import {
  buildReviewPrompt,
  parseReviewOutput,
  type MemoryUpdate,
  type ReviewOutput,
} from '@deepseek-ai/dsh-review-core'

function fakeSession(events: unknown[]): Session {
  return { events } as unknown as Session
}

function fakeStore(entries: string[] = []): MemoryStoreLike & { add: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  const store = {
    entries,
    snapshot: () => ({ entries: [...store.entries] }),
    add: vi.fn((_t: string, content: string) => { store.entries.push(content); return { success: true } }),
    replace: vi.fn((_t: string, oldSubstr: string, content: string) => { const i = store.entries.findIndex(e => e.includes(oldSubstr)); if (i >= 0) store.entries[i] = content; return { success: i >= 0 } }),
    remove: vi.fn((_t: string, oldSubstr: string) => { const i = store.entries.findIndex(e => e.includes(oldSubstr)); if (i >= 0) store.entries.splice(i, 1); return { success: i >= 0 } }),
  }
  return store
}

function fakeForge(): { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(async () => ({ success: true, name: '', path: '' })) }
}

describe('review ① 层 mock spec', () => {
  it('parseReviewOutput 解析三路 JSON（含围栏容忍与非法输入）', () => {
    const output = parseReviewOutput('{"skill":{"name":"s","description":"d","content":"c"},"memory":[{"action":"add","content":"f"}],"user":[]}')
    expect(output?.skillCandidate?.name).toBe('s')
    expect(output?.memoryUpdates).toHaveLength(1)
    expect(parseReviewOutput('```json\n{"skill":null,"memory":[],"user":[]}\n```')?.memoryUpdates).toEqual([])
    expect(parseReviewOutput('not json')).toBeUndefined()
  })

  it('buildReviewPrompt 含三路形状与画像抽取规则', () => {
    const prompt = buildReviewPrompt('digest')
    expect(prompt.system).toContain('"skill"')
    expect(prompt.system).toContain('never inferred')
    expect(prompt.user).toBe('digest')
  })

  it('extractEarlySummary 取最后一条 compaction/summary 的文本（D22）', () => {
    const session = fakeSession([
      { type: 'compaction/start' },
      { type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'earlier' }] } },
      { type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'latest summary' }] } },
    ])
    expect(extractEarlySummary(session)).toBe('latest summary')
    expect(extractEarlySummary(fakeSession([{ type: 'user/message' }]))).toBeUndefined()
  })

  it('projectEntries 只取 user/assistant 文本消息', () => {
    const session = fakeSession([
      { type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'resp' }] } } },
      { type: 'tool/call' },
    ])
    const entries = projectEntries(session)
    expect(entries).toEqual([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'resp' }])
  })

  it('applyReviewOutput：技能候选→forge.create；MEMORY add→store.add', async () => {
    const forge = fakeForge()
    const store = fakeStore()
    const output: ReviewOutput = {
      skillCandidate: { name: 's', description: 'd', content: 'x'.repeat(300) },
      memoryUpdates: [{ action: 'add', target: 'memory', content: 'fact' }],
      userUpdates: [],
    }
    applyReviewOutput(output, forge as unknown as SkillForge, store, { reviewMinResultChars: 200, dedupeSimilarity: 0.8 })
    expect(forge.create).toHaveBeenCalledTimes(1)
    expect(store.add).toHaveBeenCalledWith('memory', 'fact')
  })

  it('applyReviewOutput：reviewMinResultChars 过滤短技能、去重跳过重复 MEMORY、no-change 零写入', () => {
    const forge = fakeForge()
    const store = fakeStore(['existing fact'])
    const output: ReviewOutput = {
      skillCandidate: { name: 'short', description: 'd', content: 'too short' }, // < 200 chars
      memoryUpdates: [
        { action: 'add', target: 'memory', content: 'existing fact' }, // 重复
        { action: 'add', target: 'memory', content: 'new fact' },
      ],
      userUpdates: [],
    }
    applyReviewOutput(output, forge as unknown as SkillForge, store, { reviewMinResultChars: 200, dedupeSimilarity: 0.8 })
    expect(forge.create).not.toHaveBeenCalled() // 短技能被过滤
    expect(store.add).toHaveBeenCalledTimes(1) // 只有 new fact（existing fact 去重跳过）
    expect(store.add).toHaveBeenCalledWith('memory', 'new fact')
    // no-change：空数组
    const forge2 = fakeForge()
    const store2 = fakeStore()
    applyReviewOutput({ memoryUpdates: [], userUpdates: [] }, forge2 as unknown as SkillForge, store2, { reviewMinResultChars: 200, dedupeSimilarity: 0.8 })
    expect(forge2.create).not.toHaveBeenCalled()
    expect(store2.add).not.toHaveBeenCalled()
  })

  it('applyReviewOutput：MEMORY remove/replace 走 store + 成功时审计 hook', () => {
    const store = fakeStore(['old fact'])
    const onWrite = vi.fn<(u: MemoryUpdate) => void>()
    const output: ReviewOutput = {
      memoryUpdates: [
        { action: 'replace', target: 'memory', oldText: 'old', content: 'new fact' },
        { action: 'remove', target: 'memory', oldText: 'new fact' },
      ],
      userUpdates: [],
    }
    applyReviewOutput(output, fakeForge() as unknown as SkillForge, store, { reviewMinResultChars: 200, dedupeSimilarity: 0.8 }, onWrite)
    expect(store.replace).toHaveBeenCalledWith('memory', 'old', 'new fact')
    expect(store.remove).toHaveBeenCalledWith('memory', 'new fact')
    expect(onWrite).toHaveBeenCalledTimes(2)
  })
})
