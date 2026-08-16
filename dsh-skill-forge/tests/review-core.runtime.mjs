/**
 * digest + dedupe + security 运行时验证（沙箱内 `node tests/review-core.runtime.mjs`）。
 * 加载 tsc 编译产物 `.runtime/{digest,dedupe,security}.js`。
 */
import assert from 'node:assert/strict'
import { buildConversationDigest, renderDigest } from '../.runtime/digest.js'
import { similarity, isDuplicate } from '../.runtime/dedupe.js'
import { scanSecrets } from '../.runtime/security.js'

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

check('buildConversationDigest 保留最近 K 轮并截断早期', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `msg-${i}` }))
  const digest = buildConversationDigest(entries, 3, 'earlier summary')
  assert.equal(digest.truncated, true)
  assert.equal(digest.summary, 'earlier summary')
  assert.equal(digest.recent.length, 6) // 3 轮 * 2 条
  assert.equal(digest.recent[0].text, 'msg-4')
})

check('buildConversationDigest 无截断时不带 summary', () => {
  const entries = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }]
  const digest = buildConversationDigest(entries, 5, 'unused')
  assert.equal(digest.truncated, false)
  assert.equal(digest.summary, undefined)
  assert.equal(digest.recent.length, 2)
})

check('renderDigest 含摘要与最近对话', () => {
  const text = renderDigest({ recent: [{ role: 'user', text: 'hi' }], summary: 'summary line', truncated: true })
  assert.ok(text.includes('summary line'))
  assert.ok(text.includes('[user] hi'))
})

check('similarity：相同文本=1，无关文本 < 0.8', () => {
  assert.equal(similarity('write a python script', 'write a python script'), 1)
  assert.ok(similarity('write a python script', 'completely different topic about cooking') < 0.3)
})

check('isDuplicate：相似度 ≥ 阈值判定重复', () => {
  const existing = ['write a python script to sort a list']
  assert.equal(isDuplicate('write a python script to sort a list', existing), true)
  assert.equal(isDuplicate('write a python script to sort the list', existing), true)
  assert.equal(isDuplicate('bake a chocolate cake', existing), false)
})

check('security scanSecrets 复用（skill-forge 侧）', () => {
  assert.deepEqual(scanSecrets('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key'])
  assert.deepEqual(scanSecrets('clean text'), [])
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
