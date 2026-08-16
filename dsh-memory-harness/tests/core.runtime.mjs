/**
 * CoreProvider / SoulProvider 运行时验证（沙箱内 `node tests/core.runtime.mjs`）。
 * 覆盖 core 可编辑改造的验收项：默认模板初始化 / 懒重载 / 字节稳定 / 文件缺失降级。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreProvider, SoulProvider, CORE_PERSONALITY_TEXT } from '../.runtime/soul.js'

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

/** 每个用例独立临时目录，隔离落盘。 */
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-core-'))
  return {
    dir,
    coreFile: join(dir, 'core-personality.md'),
    soulFile: join(dir, 'SOUL.md'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const cases = []

cases.push(check('CoreProvider.init 首次启动自动写默认模板', () => {
  const t = tmp()
  try {
    const core = new CoreProvider(t.coreFile)
    core.init()
    assert.equal(existsSync(t.coreFile), true)
    assert.equal(readFileSync(t.coreFile, 'utf8'), CORE_PERSONALITY_TEXT)
  } finally {
    t.cleanup()
  }
}))

cases.push(check('CoreProvider.frozenFor 返回默认内容（init 后）', () => {
  const t = tmp()
  try {
    const core = new CoreProvider(t.coreFile)
    core.init()
    assert.equal(core.frozenFor(), CORE_PERSONALITY_TEXT)
  } finally {
    t.cleanup()
  }
}))

cases.push(check('CoreProvider 懒重载：改文件 → 新内容', async () => {
  const t = tmp()
  try {
    const core = new CoreProvider(t.coreFile)
    core.init()
    assert.equal(core.frozenFor(), CORE_PERSONALITY_TEXT)
    await new Promise(r => setTimeout(r, 25))
    writeFileSync(t.coreFile, 'custom baseline')
    assert.equal(core.frozenFor(), 'custom baseline')
  } finally {
    t.cleanup()
  }
}))

cases.push(check('CoreProvider 未改动字节稳定（缓存命中）', () => {
  const t = tmp()
  try {
    const core = new CoreProvider(t.coreFile)
    core.init()
    assert.equal(core.frozenFor(), core.frozenFor())
  } finally {
    t.cleanup()
  }
}))

cases.push(check('CoreProvider 文件被删 → 降级返回默认文本', () => {
  const t = tmp()
  try {
    const core = new CoreProvider(t.coreFile)
    core.init()
    rmSync(t.coreFile, { force: true })
    assert.equal(core.frozenFor(), CORE_PERSONALITY_TEXT)
  } finally {
    t.cleanup()
  }
}))

cases.push(check('SoulProvider 文件缺失返回空人格（保持原语义）', () => {
  const t = tmp()
  try {
    const soul = new SoulProvider(t.soulFile)
    assert.equal(soul.frozenFor(), '')
  } finally {
    t.cleanup()
  }
}))

cases.push(check('SoulProvider 懒重载：写文件 → 新内容', async () => {
  const t = tmp()
  try {
    const soul = new SoulProvider(t.soulFile)
    writeFileSync(t.soulFile, 'soul v1')
    assert.equal(soul.frozenFor(), 'soul v1')
    await new Promise(r => setTimeout(r, 25))
    writeFileSync(t.soulFile, 'soul v2')
    assert.equal(soul.frozenFor(), 'soul v2')
  } finally {
    t.cleanup()
  }
}))

await Promise.all(cases)
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
