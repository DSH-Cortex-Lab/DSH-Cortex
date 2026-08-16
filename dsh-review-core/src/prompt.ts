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

/** review 提示词（要求只输出 JSON；技能判定信号分类学对齐 Hermes background_review；画像抽取只从用户本人消息，不推断）。 */
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
      '=== SKILL (which task classes are worth encoding) ===',
      'Be ACTIVE: most sessions with real signal produce at least one skill update. A pass that does nothing when a signal fired is a missed learning opportunity.',
      'Signals that warrant a skill update (any ONE is enough):',
      '  - The user corrected your style, tone, format, legibility, or verbosity. Frustration is a first-class signal: "stop doing X", "too verbose", "do not format like this", "you always do Y and I hate it".',
      '  - The user corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or an explicit step.',
      '  - A non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from.',
      '  - A skill that was loaded or consulted this session turned out wrong, missing a step, or outdated. Fix it now.',
      'Preference order (pick the earliest that fits):',
      '  1. REUSE AN EXISTING SKILL NAME from the catalog below when the learning belongs to the same class of task. The system MERGES your content into that skill (appends it), so write only the new increment, not a rewrite of the whole skill.',
      '  2. CREATE A NEW CLASS-LEVEL SKILL only when no existing skill covers the class. The name MUST be class-level: NOT a PR number, error string, feature codename, library-alone name, or a "fix-X / debug-Y / audit-Z-today" session artifact. If the name only makes sense for today\'s task, it is wrong — reuse an existing name instead.',
      'Protected skills (DO NOT reuse their names):',
      '  - Bundled skills (source: bundled).',
      '  - User-owned or external skills (source: user-agents, project-*, custom).',
      '  - Only skills marked source: user-dsh in the catalog belong to the auto-save library and may be extended. If the only fitting skills are protected, fall through to a new class-level name or output null.',
      'Do NOT capture (these become persistent self-imposed constraints that bite later):',
      '  - Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, "command not found", unconfigured credentials, uninstalled packages.',
      '  - Negative claims about tools or features ("X tool does not work", "cannot use Y"). They harden into refusals cited for months after the problem is fixed.',
      '  - Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.',
      '  - One-off task narratives. "Summarize today\'s market" is not a class of work.',
      '  - Unresolved failures: if the session ended WITHOUT finding a working method, never dress the dead ends up as a reliable workflow. Either output null, or capture only a real working alternative you are confident in — never the failed attempts.',
      '=== MEMORY (durable environment facts) ===',
      'memory only for durable environment facts / conventions / lessons, verbatim, short entries; never for transient state.',
      '=== USER (who the user is) ===',
      'user only facts stated BY the user (never inferred from behavior). Output empty arrays / null when there is nothing new.',
    ].join('\n'),
    user: catalogText !== undefined && catalogText.length > 0
      ? '## Existing skill catalog (name [source]: description)\n' + catalogText + '\n\n' + digestText
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
