/**
 * 会话日志投影（D6/D22）：review 输入 = 最近 K 轮逐字 + 早期摘要（复用 compaction 摘要，不额外调 LLM）。
 * 纯函数，可独立单测。dsh 事件 → DigestEntry 的映射在 review 集成层完成。
 *
 * @module dsh-review-core
 */

export interface DigestEntry {
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** 来源事件序号（review 集成层填入；用于 checkpoint 增量切窗）。 */
  seq?: number
}

export interface ConversationDigest {
  recent: DigestEntry[]
  /** 自上次 review checkpoint 以来的增量轮次（v2 节律机制；首轮 review 缺省）。 */
  incremental?: DigestEntry[]
  summary?: string
  truncated: boolean
}

/** 保留最近 `recentTurns` 轮（每轮约 user+assistant 两条），更早内容折叠为 `earlySummary`。 */
export function buildConversationDigest(
  entries: readonly DigestEntry[],
  recentTurns: number,
  earlySummary?: string,
): ConversationDigest {
  const count = Math.max(1, Math.floor(recentTurns)) * 2
  const recent = entries.slice(-count)
  const truncated = entries.length > recent.length
  const summary = truncated ? earlySummary : undefined
  return {
    recent: [...recent],
    ...(summary !== undefined && summary.length > 0 ? { summary } : {}),
    truncated,
  }
}

/** 渲染为 review 模型可见纯文本（无时间戳/路径，纯函数；增量段在前）。 */
export function renderDigest(digest: ConversationDigest): string {
  const parts: string[] = []
  if (digest.incremental !== undefined && digest.incremental.length > 0) {
    parts.push('## 新增对话（自上次总结起）')
    for (const entry of digest.incremental) {
      parts.push(`[${entry.role}] ${entry.text}`)
    }
    parts.push('')
  }
  if (digest.summary !== undefined) {
    parts.push('## 早期会话摘要', digest.summary, '')
  }
  parts.push('## 最近对话')
  for (const entry of digest.recent) {
    parts.push(`[${entry.role}] ${entry.text}`)
  }
  return parts.join('\n')
}
