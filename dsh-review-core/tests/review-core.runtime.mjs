/**
 * dsh-review-core 运行时验证（沙箱内 `node tests/review-core.runtime.mjs`）。
 * 加载 tsc 编译产物 `.runtime/index.js`（ESM），进程内断言。
 */
import assert from 'node:assert/strict'
import {
  buildConversationDigest,
  renderDigest,
  similarity,
  isDuplicate,
  scanSecrets,
  buildReviewPrompt,
  parseReviewOutput,
} from '../.runtime/index.js'

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

check('digest：保留最近 K 轮并截断早期', () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `m${i}` }))
  const digest = buildConversationDigest(entries, 3, 'summary')
  assert.equal(digest.truncated, true)
  assert.equal(digest.summary, 'summary')
  assert.equal(digest.recent.length, 6)
})

check('digest：无截断不带 summary', () => {
  const digest = buildConversationDigest([{ role: 'user', text: 'a' }], 5, 'unused')
  assert.equal(digest.truncated, false)
  assert.equal(digest.summary, undefined)
})

check('renderDigest 含摘要与最近对话', () => {
  const text = renderDigest({ recent: [{ role: 'user', text: 'hi' }], summary: 's', truncated: true })
  assert.ok(text.includes('s') && text.includes('[user] hi'))
})

check('similarity/isDuplicate', () => {
  assert.equal(similarity('a b c', 'a b c'), 1)
  const existing = ['write a python script to sort a list']
  assert.equal(isDuplicate('write a python script to sort the list', existing), true)
  assert.equal(isDuplicate('bake a cake', existing), false)
})

check('scanSecrets 命中与干净文本', () => {
  assert.deepEqual(scanSecrets('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key'])
  assert.deepEqual(scanSecrets('clean text'), [])
})

check('parseReviewOutput 解析三路 JSON', () => {
  const json = JSON.stringify({
    skill: { name: 'my-skill', description: 'd', content: 'body' },
    memory: [{ action: 'add', content: 'fact X' }],
    user: [],
  })
  const output = parseReviewOutput(json)
  assert.equal(output.skillCandidate.name, 'my-skill')
  assert.equal(output.memoryUpdates.length, 1)
  assert.equal(output.memoryUpdates[0].content, 'fact X')
  assert.deepEqual(output.userUpdates, [])
})

check('parseReviewOutput 容忍 ```json 围栏', () => {
  const output = parseReviewOutput('```json\n{"skill":null,"memory":[],"user":[]}\n```')
  assert.equal(output.skillCandidate, undefined)
  assert.deepEqual(output.memoryUpdates, [])
})

check('parseReviewOutput 对非法输出返回 undefined', () => {
  assert.equal(parseReviewOutput('not json'), undefined)
  assert.equal(parseReviewOutput(''), undefined)
})

check('buildReviewPrompt 含画像抽取规则', () => {
  const prompt = buildReviewPrompt('digest text')
  assert.ok(prompt.system.includes('never inferred from behavior'))
  assert.equal(prompt.user, 'digest text')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log('failures:', failures.join(', '))
  process.exit(1)
}
