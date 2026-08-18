/**
 * @dsh-cortex/dsh-cortex-ui — host 端：管理面板数据桥。
 *
 * 双装配（同一包装配在 include 层 + preset 层）：
 * - include 层实例：提供 client 端（dsh.client 声明），其世界拿不到 live agents；
 * - preset 层实例：能看到 skills/agents/webServer（host 单例），负责数据桥。
 *
 * 数据通道：webServer HTTP（settings 通道有实例隔离问题——include/preset 子世界
 * 注册的 namespace 对根 settings 不可见）。client 端 fetch 下列路由：
 * - GET  /cortex/api/status → { soul, soulPath, user, userPath, memory, memoryPath, core, corePath, skills, mcp, updatedAt }
 * - POST /cortex/api/soul   → { soul } 写 SOUL.md（原子写，memory 插件懒重载生效）
 * - POST /cortex/api/core   → { core } 写 core-personality.md（原子写，懒重载生效）
 * - POST /cortex/api/user   → { user } 写 USER.md（原子写，用户画像手动编辑通道）
 * - POST /cortex/api/memory → { memory } 写 MEMORY.md（原子写，记忆手动编辑通道）
 * - POST /cortex/api/skill/locate → { name, open } 解析技能本地路径（skills.get），
 *   open=true 时在系统文件管理器定位（explorer /select）
 * - GET  /cortex/api/staged → 待入库技能清单（pending/skills-staged）
 * - POST /cortex/api/staged/promote → { name } 入库到 $DSH_HOME/skills
 * - POST /cortex/api/staged/discard → { name } 丢弃（删除 staged 目录）
 */
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, readdirSync, statSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
// skills/change 事件声明合并（ctx.on）
import type {} from '@deepseek-ai/dsh-skill'
import {
  CORE_PERSONALITY_TEXT,
  resolveCoreFile,
  resolveHomePath,
  resolveMemoryPaths,
  resolveProcessProfile,
} from '@dsh-cortex/dsh-memory-harness'

export const name = '@dsh-cortex/dsh-cortex-ui'
// preset 层可见 host 单例（skills/agents/webServer 均已验证或预期）；
// include 层这些服务不可用，桥由"live agents 可见性"门控。
export const inject = ['skills', 'agents', 'webServer']

export interface SkillRow {
  name: string
  description: string
  whenToUse: string
  source: string
  provider: string
  modelInvocable: boolean
  userInvocable: boolean
}
export interface McpRow {
  serverName: string
  transport: string
  endpoint: string
  enabled: boolean
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
  }): () => void
}

function atomicWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    writeFileSync(file, text, 'utf8')
  }
}

/** skills.get() 返回的 definition 里带 path（SKILL.md 绝对路径）与 resourceBase（技能目录）。 */
interface SkillDefinitionLike {
  path?: string
  resourceBase?: { kind?: string; path?: string; url?: string }
}

/**
 * 按技能名解析本地文件位置：遍历 live agents，用各 agent 的 scope+cwd 调
 * skills.get()（filesystem provider 在 preset 层，不带 scope 查不到）。
 * 优先 SKILL.md 绝对路径（path），退回技能目录（resourceBase.directory）。
 */
async function resolveSkillPath(ctx: Context, name: string, log: (m: string) => void): Promise<string | undefined> {
  const registry = (ctx as unknown as {
    skills?: { get: (n: string, o?: unknown) => Promise<SkillDefinitionLike | undefined> }
  }).skills
  if (!registry || typeof registry.get !== 'function') {
    log('skills.get 不可用，无法解析技能位置')
    return undefined
  }
  const agentsSvc = (ctx as unknown as {
    agents?: { list: () => Array<{ session?: { header?: { cwd?: string } } }> }
  }).agents
  const liveAgents = agentsSvc?.list?.() ?? []
  for (const agent of liveAgents) {
    try {
      const def = await registry.get(name, {
        scope: (agent as unknown) ?? undefined,
        cwd: agent?.session?.header?.cwd ?? process.cwd(),
      })
      if (!def) continue
      const dir = def.resourceBase?.kind === 'directory' ? def.resourceBase.path : undefined
      const p = def.path ?? dir
      if (p !== undefined && p.length > 0) return p
    } catch (e) {
      log('skills.get(' + name + ') error: ' + String(e))
    }
  }
  return undefined
}

/** 在系统文件管理器里定位文件（win32: explorer /select；darwin: open -R；linux: xdg-open 目录）。 */
function revealInExplorer(target: string): boolean {
  try {
    let child
    if (process.platform === 'win32') {
      child = spawn('explorer.exe', ['/select,', target], { stdio: 'ignore', detached: true })
    } else if (process.platform === 'darwin') {
      child = spawn('open', ['-R', target], { stdio: 'ignore', detached: true })
    } else {
      child = spawn('xdg-open', [dirname(target)], { stdio: 'ignore', detached: true })
    }
    child.unref()
    return true
  } catch {
    return false
  }
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 解码 frontmatter 标量：渲染端用 JSON 双引号（renderSkillFile），裸正则会带引号捕获，需剥掉。 */
function unquoteScalar(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t)
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  return t
}

/** 待入库清单（pending/skills-staged：技能项 + 删除标记项，按生成时间倒序）。 */
function listStaged(stagedDir: string): Array<{ name: string; description: string; createdAt: number; kind: 'skill' | 'delete' }> {
  const rows: Array<{ name: string; description: string; createdAt: number; kind: 'skill' | 'delete' }> = []
  try {
    if (!existsSync(stagedDir)) return rows
    for (const entry of readdirSync(stagedDir)) {
      const skillPath = join(stagedDir, entry, 'SKILL.md')
      if (existsSync(skillPath)) {
        try {
          const raw = readFileSync(skillPath, 'utf8')
          const name = unquoteScalar(/^name:\s*(.+)$/m.exec(raw)?.[1] ?? entry)
          const description = unquoteScalar(/^description:\s*(.+)$/m.exec(raw)?.[1] ?? '')
          rows.push({ name, description, createdAt: statSync(skillPath).mtimeMs, kind: 'skill' })
        } catch { /* 单个技能不可读则跳过 */ }
        continue
      }
      if (entry.endsWith('.delete')) {
        // skill_delete 产生的删除标记：待用户确认后从技能根移除
        const name = entry.slice(0, -'.delete'.length)
        if (SKILL_NAME_RE.test(name)) {
          rows.push({ name, description: '', createdAt: statSync(join(stagedDir, entry)).mtimeMs, kind: 'delete' })
        }
      }
    }
  } catch { /* staged 不可读 → 空清单 */ }
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows
}

export function apply(ctx: Context, _config: unknown = {}): void {
  // 与 memory 插件同款路径解析：homePath = DSH_HOME > ~/.dsh；
  // 档案 = ctx.baseUrl 推导（preset 层通常在 profiles 之外 → default 档案）。
  const homePath = resolveHomePath()
  const processProfile = resolveProcessProfile(ctx.baseUrl, homePath)
  const memoryPaths = resolveMemoryPaths(homePath, processProfile)
  const soulPath = memoryPaths.soulFile
  const userPath = memoryPaths.userFile
  const memoryPath = memoryPaths.memoryFile
  // core-personality.md 固定在 $DSH_HOME 根（全局、跨档案，不随 profile）
  const corePath = resolveCoreFile(homePath)
  // 容量上限持久化文件（与 memory 插件 apply 时读取的路径一致）
  const limitsPath = join(homePath, 'cortex-limits.json')
  // 待入库技能目录与技能根（与 dsh-skill-forge 默认一致：pending/skills-staged → skills）
  const stagedPath = join(homePath, 'pending', 'skills-staged')
  const skillRootPath = join(homePath, 'skills')
  const logFile = join(homePath, 'super-injector', 'dsh-cortex-ui.log')
  const log = (msg: string): void => {
    try {
      mkdirSync(dirname(logFile), { recursive: true })
      appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + msg + '\n')
    } catch { /* 日志失败静默 */ }
  }

  let bridgeStarted = false
  const startHostBridge = (): void => {
    if (bridgeStarted) return
    const agentsSvc = (ctx as unknown as { agents?: { list: () => unknown[] } }).agents
    const liveAgents = agentsSvc?.list?.() ?? []
    if (liveAgents.length === 0) return
    bridgeStarted = true
    log('host 桥启动（live agents: ' + liveAgents.length + '）')
    void initHostBridge(ctx, soulPath, userPath, memoryPath, corePath, limitsPath, stagedPath, skillRootPath, log)
  }

  startHostBridge()
  const bridgeTimer = setInterval(startHostBridge, 5000)
  ctx.effect(() => () => { clearInterval(bridgeTimer) })
}

/** mtime 懒重读文件缓存（与 memory 插件同款：文件没变零成本，变了才重读）。 */
function makeFileWatcher(log: (m: string) => void): (path: string, fallback: string) => string {
  const cache = new Map<string, { mtime: number; text: string }>()
  return (path, fallback) => {
    try {
      if (!existsSync(path)) {
        cache.delete(path)
        return fallback
      }
      const mtime = statSync(path).mtimeMs
      const hit = cache.get(path)
      if (hit !== undefined && hit.mtime === mtime) return hit.text
      const text = readFileSync(path, 'utf8')
      cache.set(path, { mtime, text })
      return text
    } catch (e) {
      log('file reload error (' + path + '): ' + String(e))
      cache.delete(path)
      return fallback
    }
  }
}

/** preset 层实例：内存状态 + webServer 路由 + SOUL/USER/MEMORY/core 同步 + 容量上限 + staged 管理 + skill/MCP 快照 */
async function initHostBridge(ctx: Context, soulPath: string, userPath: string, memoryPath: string, corePath: string, limitsPath: string, stagedPath: string, skillRootPath: string, log: (m: string) => void): Promise<void> {
  const state = {
    soulPath,
    userPath,
    memoryPath,
    corePath,
    skills: [] as SkillRow[],
    mcp: [] as McpRow[],
    updatedAt: 0,
  }

  // 面板侧实时读取：每次 status 请求按 mtime 懒重读（外部写入/工具写入即时可见）
  const readFile = makeFileWatcher(log)

  // ── skill / MCP 快照 ──
  const refreshInventory = async (): Promise<void> => {
    try {
      const skills: SkillRow[] = []
      const registry = (ctx as unknown as {
        skills?: { list: (options?: unknown) => Promise<Array<{
          name: string
          description: string
          whenToUse?: string
          source: string
          provider: string
          invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
        }>> }
      }).skills
      if (registry && typeof registry.list === 'function') {
        const agentsSvc = (ctx as unknown as {
          agents?: { list: () => Array<{ session?: { header?: { cwd?: string } } }> }
        }).agents
        const liveAgents = agentsSvc?.list?.() ?? []
        const merged = new Map<string, SkillRow>()
        for (const agent of liveAgents) {
          try {
            const perAgent = await registry.list({
              scope: (agent as unknown) ?? undefined,
              cwd: agent?.session?.header?.cwd ?? process.cwd(),
            })
            for (const s of perAgent) {
              if (!merged.has(s.name)) {
                merged.set(s.name, {
                  name: s.name,
                  description: s.description,
                  whenToUse: s.whenToUse ?? '',
                  source: s.source,
                  provider: s.provider,
                  modelInvocable: s.invocation?.modelInvocable ?? false,
                  userInvocable: s.invocation?.userInvocable ?? false,
                })
              }
            }
          } catch (e) {
            log('skills.list error: ' + String(e))
          }
        }
        for (const s of merged.values()) skills.push(s)
      }
      const mcp: McpRow[] = []
      const loader = ctx.get('loader') as { entries: () => Iterable<{
        options?: { name?: unknown; config?: unknown; disabled?: unknown }
        fiber?: unknown
      }> } | undefined
      if (loader && typeof loader.entries === 'function') {
        for (const entry of loader.entries()) {
          if (String(entry.options?.name ?? '') !== 'mcp-client') continue
          const cfg = (entry.options?.config ?? {}) as {
            serverName?: string
            transport?: string
            url?: string
            command?: string
          }
          mcp.push({
            serverName: cfg.serverName ?? '',
            transport: cfg.transport ?? 'stdio',
            endpoint: cfg.transport === 'streamable-http' ? (cfg.url ?? '') : (cfg.command ?? ''),
            enabled: entry.fiber !== undefined && entry.options?.disabled !== true,
          })
        }
      }
      mcp.sort((a, b) => a.serverName.localeCompare(b.serverName))
      state.skills = skills
      state.mcp = mcp
      state.updatedAt = Date.now()
      log('inventory refreshed: ' + skills.length + ' skills, ' + mcp.length + ' mcp')
    } catch (e) {
      log('inventory refresh error: ' + String(e))
    }
  }

  await refreshInventory()
  ctx.on('skills/change', () => { void refreshInventory() })
  const timer = setInterval(() => { void refreshInventory() }, 30_000)
  ctx.effect(() => () => { clearInterval(timer) })

  // ── webServer 路由 ──
  const webServerRaw = (ctx as unknown as { webServer?: WebServerLike }).webServer
  if (!webServerRaw || typeof webServerRaw.register !== 'function') {
    log('webServer 不可用（preset 层也拿不到）——UI 将无数据')
    return
  }
  // 防重复装配护盾：若本插件被第二个装配源重复加载，第二个实例注册同名路由会抛
  // 'duplicate exact route' 并 fatal 整个 DSH——这里静默跳过，让第一个实例继续服务。
  const webServer: WebServerLike = {
    register: (route) => {
      try {
        return webServerRaw.register(route)
      } catch (e) {
        log('route register skipped (' + route.path + ', duplicate assembly?): ' + String(e))
        return () => {}
      }
    },
  }

  const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  // ── 诊断：loader 装配行清单 + 关键服务可见性（排查 preset 层装配问题）──
  const probeService = (name: string): string => {
    try {
      const s = ctx.get(name)
      return s === undefined ? 'undefined' : 'object:' + typeof s
    } catch (e) {
      return 'throw:' + String(e)
    }
  }
  const loaderDiag = ctx.get('loader') as {
    entries: () => Iterable<{ options?: { name?: unknown; id?: unknown; disabled?: unknown }; fiber?: unknown }>
  } | undefined
  const loaderRows: unknown[] = []
  if (loaderDiag && typeof loaderDiag.entries === 'function') {
    for (const entry of loaderDiag.entries()) {
      const opts = (entry.options ?? {}) as { name?: unknown; id?: unknown; disabled?: unknown }
      loaderRows.push({
        id: String(opts.id ?? ''),
        name: String(opts.name ?? ''),
        fiber: entry.fiber !== undefined,
        disabled: opts.disabled === true,
      })
    }
  }
  const debugBody = (): {
    ok: boolean
    services: Record<string, string>
    loaderRows: unknown[]
    state: Record<string, string>
  } => ({
    ok: true,
    services: {
      tools: probeService('tools'),
      systemPrompt: probeService('systemPrompt'),
      skills: probeService('skills'),
      agents: probeService('agents'),
      webServer: probeService('webServer'),
      loader: probeService('loader'),
    },
    loaderRows,
    state: {
      soulPath: state.soulPath,
      userPath: state.userPath,
      memoryPath: state.memoryPath,
      corePath: state.corePath,
    },
  })
  log('diagnostic: services=' + JSON.stringify(debugBody().services) + ' loaderRows=' + JSON.stringify(loaderRows))
  log('diagnostic paths: soul=' + state.soulPath + ' user=' + state.userPath + ' memory=' + state.memoryPath + ' core=' + state.corePath)

  /** memory-harness 经 bundle 层提供的组合服务（root 层，include 子树可读父级服务）。 */
  interface MemoryStoreSvc {
    usage: (target: string) => { chars: number; limit: number }
    setLimits: (memoryLimit: number, userLimit: number) => void
  }
  const memoryStore = ctx.get('memoryStore') as MemoryStoreSvc | undefined

  const statusBody = (): unknown => ({
    ok: true,
    soul: readFile(soulPath, ''),
    soulPath: state.soulPath,
    user: readFile(userPath, ''),
    userPath: state.userPath,
    memory: readFile(memoryPath, ''),
    memoryPath: state.memoryPath,
    core: readFile(corePath, CORE_PERSONALITY_TEXT),
    corePath: state.corePath,
    memoryLimit: memoryStore?.usage('memory').limit ?? 0,
    userLimit: memoryStore?.usage('user').limit ?? 0,
    staged: listStaged(stagedPath),
    skills: state.skills,
    mcp: state.mcp,
    updatedAt: state.updatedAt,
  })

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/debug',
    handler: (_req, res) => json(res, 200, debugBody()),
  }), 'dsh-cortex-ui: debug route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/status',
    handler: (_req, res) => json(res, 200, statusBody()),
  }), 'dsh-cortex-ui: status route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/soul',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data)
          const text = String(body.soul ?? '')
          atomicWrite(soulPath, text)
          log('SOUL.md written via API (' + text.length + ' chars)')
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: soul route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/core',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data)
          const text = String(body.core ?? '')
          atomicWrite(corePath, text)
          log('core-personality.md written via API (' + text.length + ' chars)')
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: core route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/user',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data)
          const text = String(body.user ?? '')
          atomicWrite(userPath, text)
          log('USER.md written via API (' + text.length + ' chars)')
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: user route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/memory',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data)
          const text = String(body.memory ?? '')
          atomicWrite(memoryPath, text)
          log('MEMORY.md written via API (' + text.length + ' chars)')
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: memory route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/limits',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data) as { memoryLimit?: unknown; userLimit?: unknown }
          const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 100000
          if (body.memoryLimit !== undefined && !valid(body.memoryLimit)) {
            json(res, 400, { ok: false, error: 'memoryLimit must be an integer between 100 and 100000' })
            return
          }
          if (body.userLimit !== undefined && !valid(body.userLimit)) {
            json(res, 400, { ok: false, error: 'userLimit must be an integer between 100 and 100000' })
            return
          }
          const current = {
            memoryLimit: memoryStore?.usage('memory').limit ?? 0,
            userLimit: memoryStore?.usage('user').limit ?? 0,
          }
          const next = {
            memoryLimit: body.memoryLimit === undefined ? current.memoryLimit : body.memoryLimit,
            userLimit: body.userLimit === undefined ? current.userLimit : body.userLimit,
          }
          // 持久化（memory 插件重启时读取）+ 运行时即时生效
          atomicWrite(limitsPath, JSON.stringify(next, null, 2) + '\n')
          memoryStore?.setLimits(next.memoryLimit, next.userLimit)
          log('limits updated: memory=' + next.memoryLimit + ' user=' + next.userLimit)
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: limits route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/staged',
    handler: (_req, res) => json(res, 200, { ok: true, staged: listStaged(stagedPath) }),
  }), 'dsh-cortex-ui: staged list route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/staged/promote',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data) as { name?: unknown }
          const name = String(body.name ?? '').trim()
          if (!SKILL_NAME_RE.test(name)) {
            json(res, 400, { ok: false, error: 'invalid skill name' })
            return
          }
          const src = join(stagedPath, name, 'SKILL.md')
          const marker = join(stagedPath, `${name}.delete`)
          if (existsSync(src)) {
            // 入库：原子写 $DSH_HOME/skills/<name>/SKILL.md（skill-filesystem 会经 Chokidar 触发 skills/change）
            atomicWrite(join(skillRootPath, name, 'SKILL.md'), readFileSync(src, 'utf8'))
            rmSync(dirname(src), { recursive: true, force: true })
            log('staged promote: ' + name)
            json(res, 200, statusBody())
            return
          }
          if (existsSync(marker)) {
            // 删除标记经用户确认：从技能根移除
            rmSync(join(skillRootPath, name), { recursive: true, force: true })
            rmSync(marker, { force: true })
            log('staged delete applied: ' + name)
            json(res, 200, statusBody())
            return
          }
          json(res, 404, { ok: false, error: 'staged skill not found' })
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: staged promote route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/staged/discard',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        try {
          const body = JSON.parse(data) as { name?: unknown }
          const name = String(body.name ?? '').trim()
          if (!SKILL_NAME_RE.test(name)) {
            json(res, 400, { ok: false, error: 'invalid skill name' })
            return
          }
          rmSync(join(stagedPath, name), { recursive: true, force: true })
          rmSync(join(stagedPath, `${name}.delete`), { force: true })
          log('staged discard: ' + name)
          json(res, 200, statusBody())
        } catch (e) {
          json(res, 400, { ok: false, error: String(e) })
        }
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: staged discard route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cortex/api/skill/locate',
    handler: (req, res) => {
      let data = ''
      req.on('data', (c: Buffer) => { data += c.toString('utf8') })
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(data) as { name?: unknown; open?: unknown }
            const name = String(body.name ?? '').trim()
            const row = name.length > 0 ? state.skills.find((s) => s.name === name) : undefined
            if (row === undefined) {
              json(res, 404, { ok: false, error: 'skill not found' })
              return
            }
            // 路径只在 host 侧按注册表解析，客户端只能传技能名
            const path = await resolveSkillPath(ctx, name, log)
            if (path === undefined) {
              json(res, 404, { ok: false, error: 'no local file location' })
              return
            }
            const opened = body.open === true ? revealInExplorer(path) : false
            log('skill locate: ' + name + ' -> ' + path + (opened ? ' (opened)' : ''))
            json(res, 200, { ok: true, path, opened })
          } catch (e) {
            json(res, 400, { ok: false, error: String(e) })
          }
        })()
      })
      req.on('error', () => json(res, 500, { ok: false, error: 'read error' }))
    },
  }), 'dsh-cortex-ui: skill locate route')

  log('webServer 路由已注册（/cortex/api/status + soul + core + user + memory + limits + staged(+promote/discard) + skill/locate + debug）')
}
