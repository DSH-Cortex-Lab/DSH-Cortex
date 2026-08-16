/**
 * ProfileService + security 运行时验证（沙箱内 `node tests/profile.runtime.mjs`）。
 * 加载 tsc 编译产物 `.runtime/{profile,security}.js`，进程内断言。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveProcessProfile, resolveArchiveId, resolveMemoryPaths, DEFAULT_ARCHIVE } from '../.runtime/profile.js'
import { scanSecrets, hasSecrets } from '../.runtime/security.js'

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (err) {
    failures.push(name)
    console.log(`FAIL ${name}: ${err.message}`)
  }
}

const home = mkdtempSync(join(tmpdir(), 'memprofile-'))
try {
  const profileUrl = pathToFileURL(join(home, 'profiles', 'myprof')).href + '/'

  check('resolveProcessProfile 从 ctx.baseUrl 推导 profile 名', () => {
    assert.equal(resolveProcessProfile(profileUrl, home), 'myprof')
  })

  check('resolveProcessProfile 对非 profile 目录返回 undefined', () => {
    assert.equal(resolveProcessProfile(pathToFileURL(home).href + '/', home), undefined)
    assert.equal(resolveProcessProfile(undefined, home), undefined)
  })

  check('resolveArchiveId 优先级：配置 > 启动 profile > default', () => {
    assert.equal(resolveArchiveId('A', 'B'), 'A')
    assert.equal(resolveArchiveId(undefined, 'B'), 'B')
    assert.equal(resolveArchiveId(undefined, undefined), DEFAULT_ARCHIVE)
  })

  check('resolveMemoryPaths 区分 default 与 profile 目录', () => {
    const def = resolveMemoryPaths(home)
    const prof = resolveMemoryPaths(home, 'myprof')
    assert.equal(def.memoryFile, join(home, 'memories', 'MEMORY.md'))
    assert.equal(def.soulFile, join(home, 'SOUL.md'))
    assert.equal(prof.memoryFile, join(home, 'profiles', 'myprof', 'memories', 'MEMORY.md'))
    assert.equal(prof.soulFile, join(home, 'profiles', 'myprof', 'SOUL.md'))
  })

  check('scanSecrets 命中常见密钥模式', () => {
    assert.deepEqual(scanSecrets('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key'])
    assert.ok(scanSecrets('sk-abcdefghijklmnopqrstuvwxyz123456').includes('openai-key'))
    assert.ok(scanSecrets('api_key: abcdefghijklmnop').includes('generic-api-key'))
    assert.ok(hasSecrets('-----BEGIN RSA PRIVATE KEY-----'))
  })

  check('scanSecrets 对干净文本返回空', () => {
    assert.deepEqual(scanSecrets('hello world, no secrets here'), [])
    assert.equal(hasSecrets('just a normal sentence'), false)
  })
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
