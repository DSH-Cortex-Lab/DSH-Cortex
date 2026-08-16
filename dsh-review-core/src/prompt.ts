/**
 * review 提示词模板 + 三路输出解析（D27：一次 digest 三路输出）。纯函数，可独立单测。
 *
 * @module dsh-review-core
 */

export interface SkillCandidate {
  name: string
  description: string
  whenToUse?: string
  content: string
}

export interface MemoryUpdate {
  action: 'add' | 'replace' | 'remove'
  target: 'memory' | 'user'
  content: string
  oldText?: string
}

/** 一次 digest 的三路输出（D27）：技能 / MEMORY / USER。 */
export interface ReviewOutput {
  skillCandidate?: SkillCandidate
  memoryUpdates: MemoryUpdate[]
  userUpdates: MemoryUpdate[]
}

/** review 提示词（要求只输出 JSON；画像抽取规则：只从用户本人消息抽取，不推断）。 */
export function buildReviewPrompt(digestText: string, catalogText?: string): { system: string; user: string } {
  return {
    system: [
      'You review a completed conversation and extract reusable, durable experience.',
      'Output ONLY a single JSON object with this exact shape, no prose, no markdown fences:',
      '{',
      '  "skill": {"name":"kebab-case","description":"one sentence","whenToUse":"optional","content":"markdown body"} | null,',
      '  "memory": [{"action":"add|replace|remove","content":"entry text","oldText":"optional, for replace/remove"}],',
      '  "user": [{"action":"add|replace|remove","content":"user-fact text","oldText":"optional"}]',
      '}',
      'Rules: skill only when the conversation demonstrates a reusable multi-step workflow; memory only for durable environment facts/conventions/lessons, verbatim; user only facts stated BY the user (never inferred from behavior). Output empty arrays / null when there is nothing new.',
      'Skill naming: prefer reusing an existing skill name from the catalog below when the new learning belongs to the same class of task; only invent a NEW name when no existing skill covers the class. Never name a skill after a one-off session artifact (PR number, error string, "fix-X-today").',
    ].join('\n'),
    user: catalogText !== undefined && catalogText.length > 0
      ? '## 现有技能目录（name: description）\n' + catalogText + '\n\n' + digestText
      : digestText,
  }
}

/** 解析 review 输出 JSON（容忍 ```json 围栏）。失败返回 undefined。 */
export function parseReviewOutput(text: string): ReviewOutput | undefined {
  const trimmed = text.trim()
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const data = parsed as Record<string, unknown>
  const skill = normalizeSkillCandidate(data.skill)
  const memoryUpdates = normalizeUpdates(data.memory, 'memory')
  const userUpdates = normalizeUpdates(data.user, 'user')
  return { ...(skill !== undefined ? { skillCandidate: skill } : {}), memoryUpdates, userUpdates }
}

function normalizeSkillCandidate(value: unknown): SkillCandidate | undefined {
  if (value === null || value === undefined || typeof value !== 'object') return undefined
  const data = value as Record<string, unknown>
  if (typeof data.name !== 'string' || typeof data.description !== 'string' || typeof data.content !== 'string') return undefined
  const whenToUse = typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? data.whenToUse : undefined
  return { name: data.name, description: data.description, ...(whenToUse !== undefined ? { whenToUse } : {}), content: data.content }
}

function normalizeUpdates(value: unknown, target: 'memory' | 'user'): MemoryUpdate[] {
  if (!Array.isArray(value)) return []
  const updates: MemoryUpdate[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const data = item as Record<string, unknown>
    if (data.action !== 'add' && data.action !== 'replace' && data.action !== 'remove') continue
    if (typeof data.content !== 'string' || data.content.length === 0) continue
    const oldText = typeof data.oldText === 'string' ? data.oldText : undefined
    updates.push({ action: data.action, target, content: data.content, ...(oldText !== undefined ? { oldText } : {}) })
  }
  return updates
}
