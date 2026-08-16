/**
 * SkillForge：技能落盘引擎（纯 TS，无 dsh 依赖，可独立单测）。
 *
 * D3/D19：写端一律进 staged 目录（扫描根之外，Chokidar 不监视）；promote 在会话边界执行，
 * 把 staged 内容原子落回扫描根（此时才触发 skills/change → 目录消息更新）。
 *
 * @module dsh-skill-forge
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSkillName, parseFrontmatter, renderSkillFile, validateSkillInput, type SkillFrontmatter, type SkillInput } from './validate.ts'

/** 一个技能扫描根（promote 目标 = 首个根）。 */
export interface SkillRoot {
  path: string
}

export interface ForgeInput extends SkillInput {}

export interface ForgePatch {
  description?: string
  whenToUse?: string
  /** P0：全文替换 body；diff 语义后移（M3）。 */
  bodyPatch?: string
}

export interface ForgeResult {
  success: boolean
  name: string
  /** 落盘路径（staged 或 promote 后的扫描根）。 */
  path?: string
  error?: string
}

/** 可注入的文件系统接口，便于单测。 */
export interface ForgeFs {
  existsSync(path: string): boolean
  mkdirSync(path: string, opts?: { recursive?: boolean }): unknown
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
  renameSync(oldPath: string, newPath: string): void
  rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void
  readdirSync(path: string): string[]
}

const nodeFs: ForgeFs = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
}

const DELETE_SUFFIX = '.delete'

export class SkillForge {
  constructor(
    private readonly roots: SkillRoot[],
    private readonly stagedDir: string,
    private readonly fs: ForgeFs = nodeFs,
    private readonly maxBytes = Number.POSITIVE_INFINITY,
  ) {}

  /** 新建技能：校验 → 渲染 → 原子写 stagedDir/<name>/SKILL.md。 */
  async create(input: ForgeInput): Promise<ForgeResult> {
    const errors = validateSkillInput(input)
    if (errors.length > 0) return { success: false, name: input.name, error: errors.join('; ') }
    const text = renderSkillFile(
      { name: input.name, description: input.description, ...(input.whenToUse !== undefined ? { whenToUse: input.whenToUse } : {}) },
      input.content,
    )
    if (text.length > this.maxBytes) {
      return { success: false, name: input.name, error: `skill exceeds the ${this.maxBytes}-byte limit` }
    }
    const path = this.stagedSkillPath(input.name)
    this.atomicWrite(path, text)
    return { success: true, name: input.name, path }
  }

  /** 补丁：读现有（staged 优先，再扫描根）→ 合并 frontmatter/body → 写 staged。 */
  async patch(name: string, patch: ForgePatch): Promise<ForgeResult> {
    const existing = this.readExisting(name)
    if (existing === undefined) return { success: false, name, error: `skill "${name}" not found` }
    const description = patch.description !== undefined ? patch.description : existing.frontmatter.description
    const whenToUse = patch.whenToUse !== undefined ? patch.whenToUse : existing.frontmatter.whenToUse
    const body = patch.bodyPatch !== undefined ? patch.bodyPatch : existing.body
    const frontmatter: SkillFrontmatter = {
      name,
      description,
      ...(whenToUse !== undefined ? { whenToUse } : {}),
    }
    const errors = validateSkillInput({ name, description, ...(whenToUse !== undefined ? { whenToUse } : {}), content: body })
    if (errors.length > 0) return { success: false, name, error: errors.join('; ') }
    const text = renderSkillFile(frontmatter, body)
    if (text.length > this.maxBytes) {
      return { success: false, name, error: `skill exceeds the ${this.maxBytes}-byte limit` }
    }
    const path = this.stagedSkillPath(name)
    this.atomicWrite(path, text)
    return { success: true, name, path }
  }

  /** 标记删除：写 stagedDir/<name>.delete 标记，会话边界 promote 时才从扫描根移除（D19）。 */
  async delete(name: string): Promise<ForgeResult> {
    if (!isSkillName(name)) return { success: false, name, error: `invalid skill name "${name}"` }
    const marker = this.stagedDeletePath(name)
    this.atomicWrite(marker, JSON.stringify({ name }))
    return { success: true, name, path: marker }
  }

  /**
   * 会话边界 promote：把 staged 技能原子落回首个扫描根、应用删除标记，然后清空 staged。
   * 落回会触发 skill-filesystem 的 Chokidar 监视 → `skills/change` → 目录消息更新（D3）。
   */
  async promote(name?: string): Promise<ForgeResult> {
    const targetRoot = this.roots[0]?.path
    if (targetRoot === undefined) return { success: false, name: name ?? '', error: 'no target skill root configured' }
    const filter = name !== undefined ? new Set([name]) : undefined
    let promoted = 0
    for (const skill of this.listStagedSkills()) {
      if (filter !== undefined && !filter.has(skill.name)) continue
      const dest = join(targetRoot, skill.name, 'SKILL.md')
      this.atomicWrite(dest, this.fs.readFileSync(skill.path, 'utf8'))
      this.fs.rmSync(dirname(skill.path), { recursive: true, force: true })
      promoted += 1
    }
    for (const marker of this.listStagedDeletes()) {
      if (filter !== undefined && !filter.has(marker.name)) continue
      this.fs.rmSync(join(targetRoot, marker.name), { recursive: true, force: true })
      this.fs.rmSync(marker.path, { force: true })
      promoted += 1
    }
    return {
      success: true,
      name: name ?? '',
      path: targetRoot,
      ...(promoted === 0 ? { error: 'nothing staged to promote' } : {}),
    }
  }

  // ---- 内部 ----

  private stagedSkillPath(name: string): string {
    return join(this.stagedDir, name, 'SKILL.md')
  }

  private stagedDeletePath(name: string): string {
    return join(this.stagedDir, `${name}${DELETE_SUFFIX}`)
  }

  /** staged 优先，再按 roots 顺序查找 <name>/SKILL.md 或 <name>.md。 */
  private readExisting(name: string): { frontmatter: SkillFrontmatter; body: string; path: string } | undefined {
    const staged = this.stagedSkillPath(name)
    if (this.fs.existsSync(staged)) return this.parseExisting(staged, name)
    for (const root of this.roots) {
      const dir = join(root.path, name, 'SKILL.md')
      if (this.fs.existsSync(dir)) return this.parseExisting(dir, name)
      const flat = join(root.path, `${name}.md`)
      if (this.fs.existsSync(flat)) return this.parseExisting(flat, name)
    }
    return undefined
  }

  private parseExisting(path: string, name: string): { frontmatter: SkillFrontmatter; body: string; path: string } | undefined {
    const parsed = parseFrontmatter(this.fs.readFileSync(path, 'utf8'))
    if (parsed === undefined) return undefined
    const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
    const whenToUse = typeof parsed.data.whenToUse === 'string' ? parsed.data.whenToUse : undefined
    return {
      frontmatter: { name, description, ...(whenToUse !== undefined ? { whenToUse } : {}) },
      body: parsed.body.trim(),
      path,
    }
  }

  private listStagedSkills(): Array<{ name: string; path: string }> {
    if (!this.fs.existsSync(this.stagedDir)) return []
    const result: Array<{ name: string; path: string }> = []
    for (const entry of this.fs.readdirSync(this.stagedDir)) {
      if (entry.endsWith(DELETE_SUFFIX)) continue
      const skillPath = join(this.stagedDir, entry, 'SKILL.md')
      if (this.fs.existsSync(skillPath)) result.push({ name: entry, path: skillPath })
    }
    return result
  }

  private listStagedDeletes(): Array<{ name: string; path: string }> {
    if (!this.fs.existsSync(this.stagedDir)) return []
    const result: Array<{ name: string; path: string }> = []
    for (const entry of this.fs.readdirSync(this.stagedDir)) {
      if (!entry.endsWith(DELETE_SUFFIX)) continue
      result.push({ name: entry.slice(0, -DELETE_SUFFIX.length), path: join(this.stagedDir, entry) })
    }
    return result
  }

  /** 原子写：先写 .tmp 再 rename（D28 半写态防护）。 */
  private atomicWrite(file: string, content: string): void {
    const dir = dirname(file)
    if (dir !== '.' && !this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    this.fs.writeFileSync(tmp, content, 'utf8')
    this.fs.renameSync(tmp, file)
  }
}
