/**
 * SkillForge 运行时验证（沙箱内直接 `node tests/forge.runtime.mjs` 运行）。
 * 加载 tsc 编译产物 `.runtime/{forge,validate}.js`（ESM），进程内断言（无 node:test，避免子进程 spawn EPERM）。
 * 用例与 tests/forge.spec.ts（vitest）一致。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillForge } from '../.runtime/forge.js'
import { isSkillName, parseFrontmatter, renderSkillFile, validateSkillInput } from '../.runtime/validate.js'

let passed = 0
const failures = []

function check(name, fn) {
  return (async () => {
    try {
      await fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (err) {
      failures.push(name)
      console.log(`FAIL ${name}: ${err.message}`)
    }
  })()
}

async function withForge(fn, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-'))
  const root = join(dir, 'skills')
  const staged = join(dir, 'staged')
  mkdirSync(root, { recursive: true })
  const forge = new SkillForge([{ path: root }], staged, undefined, opts.maxBytes ?? Number.POSITIVE_INFINITY)
  try {
    await fn(forge, dir, root, staged)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const cases = []

cases.push(check('isSkillName accepts kebab-case and rejects others', async () => {
  assert.equal(isSkillName('my-skill'), true)
  assert.equal(isSkillName('a1-b2-c3'), true)
  assert.equal(isSkillName('My-Skill'), false)
  assert.equal(isSkillName('a--b'), false)
  assert.equal(isSkillName('-a'), false)
  assert.equal(isSkillName('a-'), false)
}))

cases.push(check('renderSkillFile → parseFrontmatter round-trips', async () => {
  const text = renderSkillFile(
    { name: 'my-skill', description: 'A description: with colon', whenToUse: 'when x' },
    'body line\nsecond line',
  )
  const parsed = parseFrontmatter(text)
  assert.ok(parsed)
  assert.equal(parsed.data.name, 'my-skill')
  assert.equal(parsed.data.description, 'A description: with colon')
  assert.equal(parsed.data.whenToUse, 'when x')
  assert.equal(parsed.body.trim(), 'body line\nsecond line')
}))

cases.push(check('validateSkillInput flags invalid input', async () => {
  assert.equal(validateSkillInput({ name: 'My-Skill', description: 'd', content: 'b' }).length, 1)
  assert.equal(validateSkillInput({ name: 'ok', description: '', content: 'b' }).length, 1)
  assert.equal(validateSkillInput({ name: 'ok', description: 'd', content: '  ' }).length, 1)
  assert.equal(validateSkillInput({ name: 'ok', description: 'd', content: 'b' }).length, 0)
}))

cases.push(check('create writes stagedDir/<name>/SKILL.md with valid frontmatter', async () => {
  await withForge(async (forge, dir, root, staged) => {
    const result = await forge.create({ name: 'my-skill', description: 'desc', content: 'body' })
    assert.equal(result.success, true)
    const path = join(staged, 'my-skill', 'SKILL.md')
    assert.equal(existsSync(path), true)
    const parsed = parseFrontmatter(readFileSync(path, 'utf8'))
    assert.equal(parsed.data.name, 'my-skill')
    assert.equal(parsed.data.description, 'desc')
    assert.equal(parsed.body.trim(), 'body')
    // 会话内目录消息不变：尚未 promote，扫描根无此技能
    assert.equal(existsSync(join(root, 'my-skill', 'SKILL.md')), false)
  })
}))

cases.push(check('patch updates description/whenToUse/body in staged', async () => {
  await withForge(async (forge, dir, root, staged) => {
    await forge.create({ name: 'my-skill', description: 'old', content: 'old body' })
    const result = await forge.patch('my-skill', { description: 'new', bodyPatch: 'new body' })
    assert.equal(result.success, true)
    const parsed = parseFrontmatter(readFileSync(join(staged, 'my-skill', 'SKILL.md'), 'utf8'))
    assert.equal(parsed.data.description, 'new')
    assert.equal(parsed.body.trim(), 'new body')
  })
}))

cases.push(check('patch on unknown skill fails', async () => {
  await withForge(async (forge) => {
    const result = await forge.patch('nope', { description: 'x' })
    assert.equal(result.success, false)
    assert.ok(result.error.includes('not found'))
  })
}))

cases.push(check('delete writes a marker and promote removes it from root', async () => {
  await withForge(async (forge, dir, root, staged) => {
    await forge.create({ name: 'gone-skill', description: 'd', content: 'b' })
    await forge.promote() // 先落回 root
    assert.equal(existsSync(join(root, 'gone-skill', 'SKILL.md')), true)
    const del = await forge.delete('gone-skill')
    assert.equal(del.success, true)
    assert.equal(existsSync(join(staged, 'gone-skill.delete')), true)
    await forge.promote() // 应用删除
    assert.equal(existsSync(join(root, 'gone-skill')), false)
  })
}))

cases.push(check('promote moves all staged skills and clears staged', async () => {
  await withForge(async (forge, dir, root, staged) => {
    await forge.create({ name: 'a-skill', description: 'd', content: 'b' })
    await forge.create({ name: 'b-skill', description: 'd', content: 'b' })
    const result = await forge.promote()
    assert.equal(result.success, true)
    assert.equal(existsSync(join(root, 'a-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(root, 'b-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(staged, 'a-skill')), false)
    assert.equal(existsSync(join(staged, 'b-skill')), false)
  })
}))

cases.push(check('create over maxBytes is rejected', async () => {
  await withForge(async (forge, dir, root, staged) => {
    const result = await forge.create({ name: 'big-skill', description: 'd', content: 'x'.repeat(500) })
    assert.equal(result.success, false)
    assert.ok(result.error.includes('limit'))
    assert.equal(existsSync(join(staged, 'big-skill', 'SKILL.md')), false)
  }, { maxBytes: 100 })
}))

cases.push(check('invalid skill name rejected at create', async () => {
  await withForge(async (forge) => {
    const result = await forge.create({ name: 'Bad-Name', description: 'd', content: 'b' })
    assert.equal(result.success, false)
    assert.ok(result.error.includes('invalid skill name'))
  })
}))

await Promise.all(cases)
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
