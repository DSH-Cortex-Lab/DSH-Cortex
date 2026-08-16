/**
 * SkillForge 单测（vitest）：frontmatter 生成/解析 round-trip、staged 写入、patch、delete、promote、maxBytes。
 * 运行：pnpm vitest run tests/forge.spec.ts（需 monorepo 环境）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillForge } from '../src/forge.ts'
import { isSkillName, parseFrontmatter, renderSkillFile, validateSkillInput } from '../src/validate.ts'

describe('SkillForge', () => {
  let dir: string
  let root: string
  let staged: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-'))
    root = join(dir, 'skills')
    staged = join(dir, 'staged')
    mkdirSync(root, { recursive: true })
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const forge = (maxBytes = Number.POSITIVE_INFINITY) => new SkillForge([{ path: root }], staged, undefined, maxBytes)

  it('isSkillName accepts kebab-case and rejects others', () => {
    expect(isSkillName('my-skill')).toBe(true)
    expect(isSkillName('a1-b2-c3')).toBe(true)
    expect(isSkillName('My-Skill')).toBe(false)
    expect(isSkillName('a--b')).toBe(false)
  })

  it('renderSkillFile → parseFrontmatter round-trips (含冒号/多行)', () => {
    const text = renderSkillFile(
      { name: 'my-skill', description: 'A desc: with colon', whenToUse: 'when x' },
      'line1\nline2',
    )
    const parsed = parseFrontmatter(text)
    expect(parsed?.data.name).toBe('my-skill')
    expect(parsed?.data.description).toBe('A desc: with colon')
    expect(parsed?.data.whenToUse).toBe('when x')
    expect(parsed?.body.trim()).toBe('line1\nline2')
  })

  it('validateSkillInput flags invalid input', () => {
    expect(validateSkillInput({ name: 'ok', description: 'd', content: 'b' })).toEqual([])
    expect(validateSkillInput({ name: 'Bad', description: 'd', content: 'b' }).length).toBe(1)
    expect(validateSkillInput({ name: 'ok', description: '', content: 'b' }).length).toBe(1)
    expect(validateSkillInput({ name: 'ok', description: 'd', content: ' ' }).length).toBe(1)
  })

  it('create 写 staged，promote 前扫描根不可见（D3/D19）', async () => {
    const f = forge()
    const result = await f.create({ name: 'my-skill', description: 'desc', content: 'body' })
    expect(result.success).toBe(true)
    expect(existsSync(join(staged, 'my-skill', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'my-skill', 'SKILL.md'))).toBe(false)
  })

  it('patch 更新 description/body', async () => {
    const f = forge()
    await f.create({ name: 'my-skill', description: 'old', content: 'old body' })
    const result = await f.patch('my-skill', { description: 'new', bodyPatch: 'new body' })
    expect(result.success).toBe(true)
    const parsed = parseFrontmatter(readFileSync(join(staged, 'my-skill', 'SKILL.md'), 'utf8'))
    expect(parsed?.data.description).toBe('new')
    expect(parsed?.body.trim()).toBe('new body')
  })

  it('delete 写标记，promote 后才从根移除（D19）', async () => {
    const f = forge()
    await f.create({ name: 'gone', description: 'd', content: 'b' })
    await f.promote()
    expect(existsSync(join(root, 'gone', 'SKILL.md'))).toBe(true)
    await f.delete('gone')
    expect(existsSync(join(staged, 'gone.delete'))).toBe(true)
    await f.promote()
    expect(existsSync(join(root, 'gone'))).toBe(false)
  })

  it('promote 批量落回并清空 staged', async () => {
    const f = forge()
    await f.create({ name: 'a', description: 'd', content: 'b' })
    await f.create({ name: 'b', description: 'd', content: 'b' })
    await f.promote()
    expect(existsSync(join(root, 'a', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'b', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(staged, 'a'))).toBe(false)
  })

  it('create 超 maxBytes 被拒', async () => {
    const f = forge(100)
    const result = await f.create({ name: 'big', description: 'd', content: 'x'.repeat(500) })
    expect(result.success).toBe(false)
    expect(result.error).toContain('limit')
  })
})
