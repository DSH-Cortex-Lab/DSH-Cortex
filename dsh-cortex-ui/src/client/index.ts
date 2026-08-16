/**
 * @dsh-cortex/dsh-cortex-ui — 浏览器端：侧栏"设置上方"入口 + 全屏 overlay 管理面板。
 *
 * 五 tab：人格 / 记忆 / 用户画像 / 技能 / MCP。
 * 数据通道：GET /cortex/api/status + POST /cortex/api/soul（webServer 路由，
 * preset 层实例注册）；轮询 5s 刷新。
 *
 * 入口：sidebar.footer.action（官方注释：Footer actions stack above Settings）
 * 样式对齐 ui-settings 的 trigger 行：14px、圆角 12、悬停
 * var(--dsw-alias-interactive-bg-hover) 方块；折叠态 36x36 圆形。
 * 面板：全屏 fixed overlay，Esc / 关闭按钮退出。
 * 构建：npm run build:client（tsdown → lib/client.js）。
 */
import { createElement, Fragment, useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconCordisPluginOutline14, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

type ClientContext = {
  [key: string]: any
}

export const inject = ['slots']

/** 五个 tab（后续逐块补功能；无 emoji） */
const TABS = [
  { id: 'persona', label: '人格' },
  { id: 'memory', label: '记忆' },
  { id: 'user', label: '用户画像' },
  { id: 'skill', label: '技能' },
  { id: 'mcp', label: 'MCP' },
] as const

type TabId = typeof TABS[number]['id']

// ── host 数据形状 ──
interface SkillRow {
  name: string
  description: string
  whenToUse: string
  source: string
  provider: string
  modelInvocable: boolean
  userInvocable: boolean
}
interface McpRow {
  serverName: string
  transport: string
  endpoint: string
  enabled: boolean
}
interface CortexStatus {
  ok: boolean
  soul: string
  soulPath: string
  core: string
  skills: SkillRow[]
  mcp: McpRow[]
  updatedAt: number
}

/** 拉取 + 5s 轮询 host 状态（面板级共享 hook） */
function useCortexStatus(): { status: CortexStatus | null; error: string; refresh: () => void } {
  const [status, setStatus] = useState<CortexStatus | null>(null)
  const [error, setError] = useState('')
  const refresh = (): void => {
    fetch('/cortex/api/status')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d: CortexStatus) => { setStatus(d); setError('') })
      .catch((e) => setError(String(e)))
  }
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { status, error, refresh }
}

// ── 入口行样式（对齐 ui-settings 的 .trigger）──
const triggerStyle: React.CSSProperties = {
  flex: 'none', display: 'flex', alignItems: 'center', gap: 8,
  width: 'calc(100% + 8px)', height: 34, margin: '4px -4px 4px',
  padding: '6px 2px 6px 10px', boxSizing: 'border-box', border: 'none',
  borderRadius: 12, background: 'transparent', cursor: 'pointer',
  overflow: 'hidden', color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit', fontSize: 14, lineHeight: '22px',
}
const triggerRailStyle: React.CSSProperties = {
  ...triggerStyle,
  width: 36, height: 36, margin: '8px 0 10px',
  justifyContent: 'center', gap: 0, padding: 0, borderRadius: '50%',
}

// ── 面板样式（对齐 ui-settings SettingsPanel）──
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
  alignItems: 'center', justifyContent: 'center',
}
const mask: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'var(--dsw-alias-bg-mask-1)', backdropFilter: 'var(--dsw-mask-blur)',
}
const panel: React.CSSProperties = {
  position: 'relative', zIndex: 1, display: 'flex',
  width: 800, height: 'min(800px, calc(100vh - 48px))',
  maxWidth: 'calc(100vw - 48px)',
  borderRadius: 24, overflow: 'hidden',
  background: 'var(--dsw-alias-bg-layer-2)', boxShadow: 'var(--dsw-shadow-lv3)',
}
const nav: React.CSSProperties = {
  flex: 'none', display: 'flex', flexDirection: 'column', gap: 18,
  width: 188, padding: '22px 12px 0', boxSizing: 'border-box',
}
const navTitle: React.CSSProperties = {
  padding: '0 12px', fontSize: 16, lineHeight: '24px', fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
}
const navCell = (active: boolean): React.CSSProperties => ({
  padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer',
  textAlign: 'left', fontSize: 14, lineHeight: '34px', borderRadius: 8,
  color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
  fontWeight: active ? 600 : 400,
})
const content: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
}
const header: React.CSSProperties = {
  flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  gap: 8, height: 54, padding: '20px 14px 8px 10px', boxSizing: 'border-box',
}
const options: React.CSSProperties = {
  flex: 1, minHeight: 0, padding: '0 24px 24px', overflowY: 'auto',
}
const closeBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, border: 'none', borderRadius: 28,
  background: 'transparent', cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)',
}

// ── 人格 tab：Agent 预设同款卡片排版 ──
const section: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720,
  color: 'var(--dsw-alias-label-primary)',
}
const title: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600 }
const intro: React.CSSProperties = { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }
const group: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const groupExtra: React.CSSProperties = { ...group, marginTop: 20 }
const groupHead: React.CSSProperties = {
  margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--dsw-alias-label-tertiary)',
}
const cards: React.CSSProperties = {
  listStyle: 'none', margin: 0, padding: 0, display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))',
  gridAutoRows: '1fr', gap: 12,
}
const card: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
  display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
}
const cardMain: React.CSSProperties = {
  flex: 1, appearance: 'none', border: 0, background: 'none',
  font: 'inherit', color: 'inherit', textAlign: 'left',
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '14px 16px 12px', borderRadius: '12px 12px 0 0',
}
const cardHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const cardName: React.CSSProperties = { fontSize: 15, fontWeight: 600, lineHeight: 1.4 }
const badge: React.CSSProperties = {
  borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
  whiteSpace: 'nowrap', fontWeight: 500,
  border: '1px solid var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
}
const inUse: React.CSSProperties = {
  ...badge, marginLeft: 'auto', border: 'none',
  background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)',
}
const cardDesc: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)',
  minHeight: 42, overflow: 'hidden', overflowWrap: 'anywhere',
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4,
} as React.CSSProperties
const cardId: React.CSSProperties = {
  marginTop: 'auto',
  fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 11, color: 'var(--dsw-alias-label-dimmed)',
  overflowWrap: 'anywhere',
}
const cardFoot: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 2, padding: '6px 10px',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

/** 人格 tab（排版还原；编辑写入后续接入） */
function PersonaTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  const soulPath = status?.soulPath ?? ''
  const soulChars = status?.soul?.length ?? 0
  return createElement('div', { style: section },
    createElement('h2', { style: title }, '人格'),
    createElement('p', { style: intro },
      '人格分两层：SOUL 是档案级人格；core:personality 是机器级公共底线人格。编辑与保存功能后续接入，当前为排版预览。'),
    createElement('section', { style: group },
      createElement('h3', { style: groupHead }, '档案人格'),
      createElement('ul', { style: cards },
        createElement('li', { style: card },
          createElement('div', { style: cardMain },
            createElement('span', { style: cardHead },
              createElement('span', { style: cardName }, 'SOUL'),
              createElement('span', { style: badge }, '档案级'),
              createElement('span', { style: inUse }, status ? '懒重载生效中' : '加载中…'),
            ),
            createElement('span', { style: cardDesc },
              '定义「我是谁、我怎么说」——身份、行为准则、沟通风格。每次会话按 SOUL.md 懒重载，改文件即时生效。'),
            createElement('code', { style: cardId }, soulPath || '（未连接 host 桥）'),
          ),
          createElement('div', { style: cardFoot },
            createElement('span', { style: { ...badge, border: 'none' } }, soulChars + ' 字符'),
          ),
        ),
      ),
    ),
    createElement('section', { style: groupExtra },
      createElement('h3', { style: groupHead }, '公共底线人格'),
      createElement('ul', { style: cards },
        createElement('li', { style: card },
          createElement('div', { style: cardMain },
            createElement('span', { style: cardHead },
              createElement('span', { style: cardName }, 'core:personality'),
              createElement('span', { style: badge }, '机器级 · 只读'),
            ),
            createElement('span', { style: cardDesc },
              '机器级静态人格，所有档案与 agent 共享（order -90），单一来源，不可在此编辑。'),
            createElement('code', { style: cardId }, 'order -90 · 全局静态 · 来源：dsh-memory-harness'),
          ),
          createElement('div', { style: cardFoot },
            createElement('span', { style: { ...badge, border: 'none' } }, status?.core ? '已加载' : '未提供'),
          ),
        ),
      ),
    ),
  )
}

// ── 清单 tab（skill / MCP）：复刻设置"插件"页清单——搜索框 + 计数 + 卡片 + 展开 ──
const searchBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
  padding: '7px 12px', background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-tertiary)', marginBottom: 14,
}
const searchInput: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
}
const catalogHeading: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
}
const catalogTitle: React.CSSProperties = { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }
const catalogCount: React.CSSProperties = {
  borderRadius: 999, padding: '0 8px', fontSize: 11, lineHeight: '18px',
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)',
}
const listCards: React.CSSProperties = {
  listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8,
}
const rowCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden',
}
const rowContent: React.CSSProperties = {
  width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit',
  color: 'inherit', textAlign: 'left', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
}
const rowTitle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const rowTrailing: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }
const rowTag = (ok: boolean): React.CSSProperties => ({
  borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap',
  border: '1px solid var(--dsw-alias-border-l2)',
  color: ok ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)',
})
const rowDetails: React.CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '12px 14px',
  display: 'flex', flexDirection: 'column', gap: 6,
}
const rowDetailText: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: 0 }
const rowDetailCode: React.CSSProperties = {
  fontFamily: 'var(--dsw-font-mono, ui-monospace, Menlo, monospace)', fontSize: 11,
  color: 'var(--dsw-alias-label-dimmed)', overflowWrap: 'anywhere',
}
const statusText: React.CSSProperties = { margin: '0 0 14px', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }

/** 通用可搜索清单（复刻插件清单页） */
function SearchableList({ heading, rows, matches, renderTitle, renderTags, renderDetails }: {
  heading: string
  rows: { key: string }[]
  matches: (row: any, q: string) => boolean
  renderTitle: (row: any) => string
  renderTags: (row: any) => Array<React.ReactElement | null>
  renderDetails: (row: any) => React.ReactElement
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const q = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => rows.filter((r) => matches(r, q)), [rows, q, matches])
  return createElement('div', null,
    createElement('label', { style: searchBox },
      createElement(IconSearchOutline16, { size: 14 }),
      createElement('input', {
        type: 'search',
        style: searchInput,
        value: query,
        placeholder: '搜索',
        'aria-label': '搜索',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
      })),
    createElement('div', { style: catalogHeading },
      createElement('h3', { style: catalogTitle }, heading),
      createElement('span', { style: catalogCount }, String(filtered.length))),
    rows.length === 0
      ? createElement('p', { style: statusText }, '暂无条目')
      : filtered.length === 0
        ? createElement('p', { style: statusText }, '无匹配结果')
        : createElement('ul', { style: listCards },
          filtered.map((row) => {
            const open = expanded === row.key
            return createElement('li', { style: rowCard, key: row.key },
              createElement('button', {
                type: 'button',
                style: rowContent,
                'aria-expanded': open,
                onClick: () => setExpanded(open ? null : row.key),
              },
                createElement('strong', { style: rowTitle }, renderTitle(row)),
                createElement('span', { style: rowTrailing },
                  ...renderTags(row),
                  createElement(IconChevronDownOutline14, { size: 12 }))),
              open ? createElement('div', { style: rowDetails }, renderDetails(row)) : null)
          }))
  )
}

/** 技能 tab：ctx.skills 快照清单 */
function SkillTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  const rows = (status?.skills ?? []).map((s) => ({ key: s.name, ...s }))
  return createElement('div', null,
    createElement('p', { style: statusText },
      '来自 ctx.skills 读端（filesystem provider 扫描 $DSH_HOME/skills、项目 .dsh/skills、~/.agents 与 bundled 技能，rank 100–600）。'),
    createElement(SearchableList, {
      heading: '技能目录',
      rows,
      matches: (row, q) => row.name.toLocaleLowerCase().includes(q)
        || row.description.toLocaleLowerCase().includes(q)
        || row.whenToUse.toLocaleLowerCase().includes(q),
      renderTitle: (row) => row.name,
      renderTags: (row) => [
        createElement('span', { key: 'src', style: rowTag(true) }, String(row.source)),
        row.modelInvocable ? createElement('span', { key: 'm', style: rowTag(true) }, '模型可调用') : null,
        row.userInvocable ? createElement('span', { key: 'u', style: rowTag(true) }, '用户可调用') : null,
      ],
      renderDetails: (row) => createElement('div', null,
        createElement('p', { style: rowDetailText }, row.description || '（无描述）'),
        row.whenToUse ? createElement('p', { style: rowDetailText }, row.whenToUse) : null,
        createElement('code', { style: rowDetailCode }, 'provider: ' + row.provider + ' · source: ' + row.source)),
    }))
}

/** MCP tab：loader 装配里的 mcp-client 实例清单 */
function McpTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  const rows = (status?.mcp ?? []).map((m) => ({ key: m.serverName, ...m }))
  return createElement('div', null,
    createElement('p', { style: statusText },
      '来自 loader 装配的 mcp-client 插件实例（每个实例连接一个 MCP 服务器，工具以 mcp__<server>__<tool> 暴露）。'),
    createElement(SearchableList, {
      heading: 'MCP 服务器',
      rows,
      matches: (row, q) => row.serverName.toLocaleLowerCase().includes(q)
        || row.endpoint.toLocaleLowerCase().includes(q),
      renderTitle: (row) => row.serverName || '（未命名）',
      renderTags: (row) => [
        createElement('span', { key: 't', style: rowTag(true) }, String(row.transport)),
        createElement('span', { key: 'e', style: rowTag(row.enabled) }, row.enabled ? '已启用' : '未启用'),
      ],
      renderDetails: (row) => createElement('div', null,
        createElement('code', { style: rowDetailCode }, row.endpoint || '（无端点信息）')),
    }))
}

/** 占位内容（未接功能的 tab） */
function TabPlaceholder({ tab }: { tab: TabId }): React.ReactElement {
  const meta = TABS.find((t) => t.id === tab)!
  return createElement('div', null,
    createElement('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, meta.label),
    createElement('p', { style: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 13, margin: 0 } },
      '功能开发中——后续在此接入' + meta.label + '管理能力。'),
  )
}

/** 全屏 overlay 面板：左侧 tab 导航 + 右侧内容区 */
function CortexPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<TabId>('persona')
  const [closeHover, setCloseHover] = useState(false)
  const { status, error } = useCortexStatus()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createElement('div', { style: overlay, onClick: onClose },
    createElement('div', { style: mask }),
    createElement('div', { style: panel, role: 'dialog', 'aria-modal': true, onClick: (e: React.MouseEvent) => e.stopPropagation() },
      createElement('div', { style: nav },
        createElement('div', { style: navTitle }, 'DSH-Cortex'),
        ...TABS.map((t) =>
          createElement('button', {
            key: t.id,
            style: navCell(tab === t.id),
            onClick: () => setTab(t.id),
          }, t.label)),
      ),
      createElement('div', { style: content },
        createElement('div', { style: header },
          createElement('div', { style: { display: 'flex' } }),
          createElement('button', {
            type: 'button',
            'aria-label': '关闭',
            style: { ...closeBtn, background: closeHover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent' },
            onMouseEnter: () => setCloseHover(true),
            onMouseLeave: () => setCloseHover(false),
            onClick: onClose,
          }, createElement(IconCloseOutline16, { size: 14 })),
        ),
        createElement('div', { style: options },
          error !== ''
            ? createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, '数据通道错误：' + error)
            : tab === 'persona'
              ? createElement(PersonaTab, { status })
              : tab === 'skill'
                ? createElement(SkillTab, { status })
                : tab === 'mcp'
                  ? createElement(McpTab, { status })
                  : createElement(TabPlaceholder, { tab }),
        ),
      ),
    ),
  )
}

/** 侧栏入口行（sidebar.footer.action：设置上方；无包裹层，触发范围与设置一致） */
function CortexEntry({ wide }: { wide: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const base = wide ? triggerStyle : triggerRailStyle
  return createElement(Fragment, null,
    createElement('button', {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      style: { ...base, background: hover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent' },
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onClick: () => setOpen(true),
    },
      createElement(IconCordisPluginOutline14, { size: wide ? 16 : 18 }),
      wide ? createElement('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap' } }, '插件管理') : null),
    open ? createElement(CortexPanel, { onClose: () => setOpen(false) }) : null,
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'cortex-manager',
      order: 0,
      label: () => '插件管理',
    }, CortexEntry),
  ), 'dsh-cortex-ui: sidebar entry')
}
