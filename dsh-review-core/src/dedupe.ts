/**
 * 去重（D7/D22）：Jaccard 相似度（字符 3-gram），≥ 阈值跳过。
 *
 * @module dsh-review-core
 */

function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const set = new Set<string>()
  for (let i = 0; i < normalized.length - 2; i += 1) {
    set.add(normalized.slice(i, i + 3))
  }
  return set
}

export function similarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  const union = new Set([...left, ...right]).size
  return intersection / union
}

export function isDuplicate(candidate: string, existing: readonly string[], threshold = 0.8): boolean {
  return existing.some(item => similarity(candidate, item) >= threshold)
}
