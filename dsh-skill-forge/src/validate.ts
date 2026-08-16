/**
 * SKILL.md 结构校验与 frontmatter 解析/渲染（纯函数、自包含，无外部依赖）。
 *
 * - 技能名 kebab-case：`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（与 `@deepseek-ai/dsh-skill` 的 `isSkillName` 一致）。
 * - frontmatter 必填 name/description，可选 whenToUse；布尔字段 disable-model-invocation / user-invocable
 *   由 skill-filesystem 负责，本写端 P0 不生成（默认全可用）。
 * - 渲染用 JSON 字符串（合法 YAML 双引号标量），能被 skill-filesystem 的 `parseYaml` 正确读回。
 * - 解析为自包含的 `key: value` 标量解析器：支持本写端格式 + 简单外部 frontmatter。
 *   复杂 YAML（多行 `|`/`>` 块、嵌套 map）P0 不支持——如需解析任意外部技能，M3 再引入 `yaml`。
 *
 * @module dsh-skill-forge
 */

export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 技能名是否为合法 kebab-case。 */
export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/** 写端关心的 frontmatter 字段。 */
export interface SkillFrontmatter {
  name: string
  description: string
  whenToUse?: string
}

/** 一次 create 的输入。 */
export interface SkillInput {
  name: string
  description: string
  whenToUse?: string
  /** body markdown（P0 必填非空）。 */
  content: string
}

/** 解析后的 SKILL.md 文本（frontmatter 数据 + body）。 */
export interface ParsedSkillFile {
  data: Record<string, unknown>
  body: string
}

/**
 * 解析 SKILL.md 的 YAML frontmatter（`---` 定界 + `key: value` 标量行）。
 * 无 `---` 开头或找不到闭合定界时返回 undefined。
 */
export function parseFrontmatter(raw: string): ParsedSkillFile | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const closing = findClosingFrontmatter(raw, firstLineEnd + 1)
  if (closing === undefined) return undefined
  const yamlText = raw.slice(firstLineEnd + 1, closing.start)
  const data = parseScalarLines(yamlText)
  return { data, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** 解析 `key: value` 标量行（忽略空行与 `#` 注释）。 */
function parseScalarLines(text: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    if (key.length === 0) continue
    data[key] = decodeScalar(line.slice(idx + 1).trim())
  }
  return data
}

/** 解码一个 YAML 标量：双引号(JSON)、单引号、布尔、空、裸标量。 */
function decodeScalar(raw: string): unknown {
  if (raw.length === 0) return ''
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  if (raw === 'true' || raw === 'True' || raw === 'TRUE') return true
  if (raw === 'false' || raw === 'False' || raw === 'FALSE') return false
  if (raw === 'null' || raw === '~') return null
  return raw
}

/**
 * 渲染 SKILL.md（frontmatter + body）。
 * 字符串字段用 JSON 字符串（合法 YAML 双引号标量）；name/description 在前，whenToUse 可选；
 * body 保留内部换行、两端 trim。
 */
export function renderSkillFile(frontmatter: SkillFrontmatter, body: string): string {
  const lines = ['---']
  lines.push(`name: ${JSON.stringify(frontmatter.name)}`)
  lines.push(`description: ${JSON.stringify(frontmatter.description)}`)
  if (frontmatter.whenToUse !== undefined && frontmatter.whenToUse.length > 0) {
    lines.push(`whenToUse: ${JSON.stringify(frontmatter.whenToUse)}`)
  }
  lines.push('---')
  return lines.join('\n') + '\n\n' + body.trim() + '\n'
}

/** 校验一次 create/patch 的输入，返回错误列表（空 = 合法）。 */
export function validateSkillInput(input: SkillInput): string[] {
  const errors: string[] = []
  if (!isSkillName(input.name)) {
    errors.push(`invalid skill name "${input.name}" (must be kebab-case: ${SKILL_NAME})`)
  }
  if (typeof input.description !== 'string' || input.description.trim().length === 0) {
    errors.push('description must be a non-empty string')
  }
  if (input.whenToUse !== undefined && typeof input.whenToUse !== 'string') {
    errors.push('whenToUse must be a string when present')
  }
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    errors.push('content must be a non-empty string')
  }
  return errors
}
