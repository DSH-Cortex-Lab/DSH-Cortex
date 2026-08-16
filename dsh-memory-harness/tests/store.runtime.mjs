/**
 * MemoryStore 运行时验证（沙箱内直接 `node tests/store.runtime.mjs` 运行）。
 *
 * 加载 tsc 编译产物 `.runtime/store.js`（ESM），进程内断言（不经过 node:test，避免子进程
 * spawn 触发沙箱命名管道 EPERM）。用例与 tests/store.spec.ts（vitest）一致。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, parseEntries, serializeEntries } from '../.runtime/store.js'

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

function withStore(fn, limit = 100) {
  const dir = mkdtempSync(join(tmpdir(), 'memstore-'))
  try {
    const store = new MemoryStore(join(dir, 'MEMORY.md'), join(dir, 'USER.md'), limit, 50)
    fn(store, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

check('adds one entry and persists it', () => {
  withStore((s, dir) => {
    const result = s.add('memory', 'hello world')
    assert.equal(result.success, true)
    assert.equal(result.usage, 11)
    assert.deepEqual(s.snapshot().entries, ['hello world'])
    assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), 'hello world')
  })
})

check('separates multiple entries with § and round-trips', () => {
  withStore((s, dir) => {
    s.add('memory', 'one')
    s.add('memory', 'two')
    assert.deepEqual(s.snapshot().entries, ['one', 'two'])
    assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), 'one\n§\ntwo')
  })
})

check('dedupes identical entries with no-duplicate', () => {
  withStore((s) => {
    s.add('memory', 'same')
    const result = s.add('memory', 'same')
    assert.equal(result.success, true)
    assert.equal(result.note, 'no-duplicate')
    assert.deepEqual(s.snapshot().entries, ['same'])
  })
})

check('rejects over-limit add and returns current entries', () => {
  withStore((s) => {
    assert.equal(s.add('memory', 'aaaaaaaaaa').success, true)
    const over = s.add('memory', 'bbbbbbbbbbbb')
    assert.equal(over.success, false)
    assert.ok(over.error.includes('over-limit'))
    assert.deepEqual(over.currentEntries, ['aaaaaaaaaa'])
    assert.deepEqual(s.snapshot().entries, ['aaaaaaaaaa'])
  }, 20)
})

check('replaces an entry located by substring', () => {
  withStore((s) => {
    s.add('memory', 'old fact about mars')
    const result = s.replace('memory', 'mars', 'new fact about mars')
    assert.equal(result.success, true)
    assert.deepEqual(s.snapshot().entries, ['new fact about mars'])
  })
})

check('removes an entry located by substring', () => {
  withStore((s) => {
    s.add('memory', 'keep me')
    s.add('memory', 'drop this')
    const result = s.remove('memory', 'drop')
    assert.equal(result.success, true)
    assert.deepEqual(s.snapshot().entries, ['keep me'])
  })
})

check('returns not-found for an unknown substring', () => {
  withStore((s) => {
    const result = s.replace('memory', 'nope', 'x')
    assert.equal(result.success, false)
    assert.ok(result.error.includes('not-found'))
  })
})

check('rejects empty content', () => {
  withStore((s) => {
    const result = s.add('memory', '   ')
    assert.equal(result.success, false)
    assert.ok(result.error.includes('empty-content'))
  })
})

check('supports target=user (M1b enabled)', () => {
  withStore((s) => {
    const result = s.add('user', '用户叫蓝天')
    assert.equal(result.success, true)
    assert.deepEqual(s.snapshot('user').entries, ['用户叫蓝天'])
    assert.deepEqual(s.snapshot('memory').entries, [])
  })
})

check('round-trips multiline entries via parse/serialize', () => {
  const entries = ['line1\nline2', 'plain']
  assert.deepEqual(parseEntries(serializeEntries(entries)), entries)
})

check('reads empty state for a missing file', () => {
  withStore((s) => {
    assert.deepEqual(s.snapshot().entries, [])
    assert.deepEqual(s.usage('memory'), { chars: 0, limit: 100 })
  })
})

check('writes atomically (no leftover tmp file)', () => {
  withStore((s) => {
    s.add('memory', 'atomic')
    assert.deepEqual(s.snapshot().entries, ['atomic'])
  })
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
