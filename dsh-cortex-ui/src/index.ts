/**
 * @dsh-cortex/dsh-cortex-ui — host 端：管理面板数据桥。
 *
 * 双装配（同一包装配在 include 层 + preset 层）：
 * - include 层实例：提供 client 端（dsh.client 声明），其世界拿不到 live agents；
 * - preset 层实例：能看到 skills/agents/webServer（host 单例），负责数据桥。
 *
 * 数据通道：webServer HTTP（settings 通道有实例隔离问题——include/preset 子世界
 * 注册的 namespace 对根 settings 不可见）。client 端 fetch 下列路由：
 * - GET  /cortex/api/status → { soul, soulPath, core, skills, mcp, updatedAt }
 * - POST /cortex/api/soul   → { soul } 写 SOUL.md（原子写，memory 插件懒重载生效）
 * - POST /cortex/api/skill/locate → { name, open } 解析技能本地路径（skills.get），
 *   open=true 时在系统文件管理器定位（explorer /select）
 */
import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
// skills/change 事件声明合并（ctx.on）
import type {} from '@deepseek-ai/dsh-skill'
import { CORE_PERSONALITY_TEXT } from '@dsh-cortex/dsh-memory-harness'

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

export function apply(ctx: Context, _config: unknown = {}): void {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const soulPath = join(dshHome, 'SOUL.md')
  const logFile = join(dshHome, 'super-injector', 'dsh-cortex-ui.log')
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
    void initHostBridge(ctx, soulPath, log)
  }

  startHostBridge()
  const bridgeTimer = setInterval(startHostBridge, 5000)
  ctx.effect(() => () => { clearInterval(bridgeTimer) })
}

/** preset 层实例：内存状态 + webServer 路由 + SOUL.md 同步 + skill/MCP 快照 */
async function initHostBridge(ctx: Context, soulPath: string, log: (m: string) => void): Promise<void> {
  const state = {
    soul: '',
    soulPath,
    core: CORE_PERSONALITY_TEXT,
    skills: [] as SkillRow[],
    mcp: [] as McpRow[],
    updatedAt: 0,
  }

  // 初始读 SOUL.md
  try {
    state.soul = existsSync(soulPath) ? readFileSync(soulPath, 'utf8') : ''
  } catch (e) {
    log('soul init error: ' + String(e))
  }

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
  const webServer = (ctx as unknown as { webServer?: WebServerLike }).webServer
  if (!webServer || typeof webServer.register !== 'function') {
    log('webServer 不可用（preset 层也拿不到）——UI 将无数据')
    return
  }

  const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const statusBody = (): unknown => ({
    ok: true,
    soul: state.soul,
    soulPath: state.soulPath,
    core: state.core,
    skills: state.skills,
    mcp: state.mcp,
    updatedAt: state.updatedAt,
  })

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
          state.soul = text
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

  log('webServer 路由已注册（/cortex/api/status + /cortex/api/soul + /cortex/api/skill/locate）')
}
