/**
 * @dsh-cortex/dsh-cortex-ui — 浏览器端：侧栏"设置上方"入口 + 全屏 overlay 管理面板。
 *
 * 五 tab：人格 / 记忆 / 用户画像 / 技能 / MCP。
 * 数据通道：GET /cortex/api/status + POST /cortex/api/soul + POST /cortex/api/core +
 * POST /cortex/api/user + POST /cortex/api/memory +
 * POST /cortex/api/skill/locate（webServer 路由，preset 层实例注册）；轮询 5s 刷新。
 *
 * 入口：sidebar.footer.action（官方注释：Footer actions stack above Settings）
 * 样式对齐 ui-settings 的 trigger 行：14px、圆角 12、悬停
 * var(--dsw-alias-interactive-bg-hover) 方块；折叠态 36x36 圆形。
 * 面板：全屏 fixed overlay，Esc / 关闭按钮退出。
 * 构建：npm run build:client（tsdown → lib/client.js）。
 */
import { createElement, Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type * as React from 'react'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconCordisPluginOutline14,
  IconFolderOpenOutline16, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
// ctx.locale 的 Context 合并（dsh-client-locale 提供该服务）
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type CortexUiKey } from './locales.js'

type ClientContext = {
  [key: string]: any
}

/** 文案翻译函数（locale.bind 的稳定引用） */
type TFunc = (key: CortexUiKey) => string
/** locale 服务面（subscribe/getSnapshot 供 useSyncExternalStore） */
type LocaleFace = {
  subscribe: (fn: () => void) => () => void
  getSnapshot: () => { revision: number }
}

export const inject = ['slots', 'locale']

// 模块级单例：apply 时 bind 后写入；组件直接调用 t('key')。
// locale 切换由 revision 订阅触发重渲染（CortexPanel 内的 useLocaleRevision）。
let currentT: TFunc = ((key) => key) as TFunc
let localeFace: LocaleFace | null = null
const NOOP_FACE: LocaleFace = { subscribe: () => () => {}, getSnapshot: () => ({ revision: 0 }) }
const t: TFunc = (key) => currentT(key)

/** locale 切换时强制重渲染（revision 变化触发） */
function useLocaleRevision(): number {
  const face = localeFace ?? NOOP_FACE
  return useSyncExternalStore(face.subscribe, face.getSnapshot).revision
}

/** 六个 tab */
const TABS = [
  { id: 'persona', key: 'tab.persona' },
  { id: 'memory', key: 'tab.memory' },
  { id: 'user', key: 'tab.user' },
  { id: 'skill', key: 'tab.skill' },
  { id: 'mcp', key: 'tab.mcp' },
  { id: 'context', key: 'tab.context' },
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
interface StagedSkillRow {
  name: string
  description: string
  createdAt: number
  kind: 'skill' | 'delete'
}
interface ContextConfig {
  preset: 'deepseek' | 'gpt' | 'custom'
  thresholdRatio: number
}
interface CortexStatus {
  ok: boolean
  soul: string
  soulPath: string
  user: string
  userPath: string
  memory: string
  memoryPath: string
  memoryLimit: number
  userLimit: number
  core: string
  corePath: string
  context: ContextConfig
  staged: StagedSkillRow[]
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

// ── 人格 tab：两层人格排版（SOUL / core 各一个 FileEditor）──
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
const personaHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const cardName: React.CSSProperties = { fontSize: 15, fontWeight: 600, lineHeight: 1.4 }
const badge: React.CSSProperties = {
  borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
  whiteSpace: 'nowrap', fontWeight: 500,
  border: '1px solid var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** 人格 tab：SOUL（档案人格）与 core（机器底线）两层，均可编辑（FileEditor + 原子写 + 懒重载） */
function PersonaTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  return createElement('div', { style: section },
    createElement('h2', { style: title }, t('persona.title')),
    createElement('p', { style: intro },
      t('persona.intro')),
    createElement('section', { style: group },
      createElement('h3', { style: groupHead }, t('persona.groupArchive')),
      createElement('div', { style: personaHead },
        createElement('span', { style: cardName }, t('persona.soulName')),
        createElement('span', { style: badge }, t('persona.soulBadge')),
        createElement('span', { style: badge }, status ? t('persona.soulStatus') : t('list.loading')),
      ),
      createElement(FileEditor, {
        value: status?.soul ?? '',
        path: status?.soulPath ?? '',
        endpoint: '/cortex/api/soul',
        field: 'soul',
        placeholder: t('persona.soulPlaceholder'),
      }),
    ),
    createElement('section', { style: groupExtra },
      createElement('h3', { style: groupHead }, t('persona.groupBaseline')),
      createElement('div', { style: personaHead },
        createElement('span', { style: cardName }, t('persona.coreName')),
        createElement('span', { style: badge }, t('persona.coreBadge')),
      ),
      createElement('p', { style: intro }, t('persona.coreGuide')),
      createElement(FileEditor, {
        value: status?.core ?? '',
        path: status?.corePath ?? '',
        endpoint: '/cortex/api/core',
        field: 'core',
        placeholder: t('persona.corePlaceholder'),
      }),
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
// ── 技能定位（展开区内：位置 + 打开具体位置）──
const locateRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
}
const locateBtn: React.CSSProperties = {
  flexShrink: 0, appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 12, lineHeight: '18px', borderRadius: 8,
  padding: '3px 10px', cursor: 'pointer',
}

/**
 * 技能位置解析：mount 时先 open:false 解析路径用于展示；
 * 「打开具体位置」→ open:true，host 解析 + 文件管理器定位。
 */
function SkillLocate({ name }: { name: string }): React.ReactElement {
  const [loc, setLoc] = useState<{ phase: 'loading' | 'done' | 'error'; path: string; message: string }>(
    { phase: 'loading', path: '', message: '' })
  const call = (open: boolean): void => {
    setLoc((s) => ({ ...s, phase: 'loading' }))
    fetch('/cortex/api/skill/locate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, open }),
    }).then((r) => r.json().then((d: unknown) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        const data = d as { ok?: boolean; path?: string; error?: string }
        if (!ok || data.path === undefined || data.path === '') {
          setLoc({ phase: 'error', path: '', message: data.error ?? t('skill.locateFailed') })
        } else {
          setLoc({ phase: 'done', path: data.path, message: '' })
        }
      })
      .catch((e) => setLoc({ phase: 'error', path: '', message: String(e) }))
  }
  useEffect(() => { call(false) /* 展开即解析位置 */ }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return createElement('div', { style: locateRow },
    createElement(IconFolderOpenOutline16, { size: 14 }),
    createElement('code', { style: { ...rowDetailCode, flex: 1 } },
      loc.phase === 'loading' ? t('list.loading')
        : loc.phase === 'error' ? loc.message
          : loc.path),
    createElement('button', {
      type: 'button',
      style: { ...locateBtn, opacity: loc.phase === 'loading' ? 0.5 : 1 },
      disabled: loc.phase === 'loading',
      onClick: () => call(true),
    }, t('skill.locateOpen')))
}

// ── 用户画像编辑器（USER.md；SOUL/core 编辑器后续复用同款）──
const editorCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden',
  display: 'flex', flexDirection: 'column', maxWidth: 720,
}
const editorArea: React.CSSProperties = {
  width: '100%', minHeight: 340, padding: '12px 14px', boxSizing: 'border-box',
  border: 'none', outline: 'none', resize: 'vertical', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 13, lineHeight: 1.6,
}
const editorFoot: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}
const saveBtn: React.CSSProperties = {
  flexShrink: 0, appearance: 'none', border: 'none', borderRadius: 8,
  padding: '4px 14px', fontSize: 12, lineHeight: '18px', font: 'inherit',
  cursor: 'pointer',
  background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)',
}
const saveNote: React.CSSProperties = { flexShrink: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

interface FileEditorProps {
  value: string
  path: string
  endpoint: string
  field: string
  placeholder: string
}

/** 通用文件编辑器：轮询到的外部值仅在未编辑（!dirty）时镜像；保存走 POST endpoint。 */
function FileEditor({ value, path, endpoint, field, placeholder }: FileEditorProps): React.ReactElement {
  const [draft, setDraft] = useState(value)
  const [dirty, setDirty] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  // status 轮询刷新：未编辑状态下跟随外部值；编辑中（dirty）不被覆盖
  useEffect(() => {
    if (!dirty) setDraft(value)
  }, [value, dirty])

  // 「已保存」提示 2s 后回落
  useEffect(() => {
    if (phase !== 'saved') return
    const timer = setTimeout(() => setPhase('idle'), 2000)
    return () => clearTimeout(timer)
  }, [phase])

  const save = (): void => {
    setPhase('saving')
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: draft }),
    }).then((r) => r.json().then((d: unknown) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          const data = d as { error?: string }
          setPhase('error')
          setErrMsg(data.error ?? String(d))
          return
        }
        setDirty(false)
        setPhase('saved')
      })
      .catch((e) => { setPhase('error'); setErrMsg(String(e)) })
  }

  return createElement('div', { style: editorCard },
    createElement('textarea', {
      style: editorArea,
      value: draft,
      placeholder,
      'aria-label': placeholder,
      spellCheck: false,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(e.target.value)
        setDirty(true)
        if (phase === 'error' || phase === 'saved') setPhase('idle')
      },
    }),
    createElement('div', { style: editorFoot },
      createElement('code', { style: { ...rowDetailCode, flex: 1 } }, path || t('persona.noBridge')),
      phase === 'error' ? createElement('span', { style: { ...saveNote, color: 'var(--dsw-alias-state-error-primary)' } }, t('editor.saveFailed') + errMsg) : null,
      phase === 'saved' ? createElement('span', { style: saveNote }, t('editor.saved')) : null,
      createElement('span', { style: saveNote }, new TextEncoder().encode(draft).length + ' ' + t('editor.bytes')),
      createElement('button', {
        type: 'button',
        style: { ...saveBtn, opacity: phase === 'saving' ? 0.5 : 1 },
        disabled: phase === 'saving',
        onClick: save,
      }, phase === 'saving' ? t('editor.saving') : t('editor.save'))),
  )
}

// ── 容量上限设置（memory/user 各自一行：数值输入 + 保存）──
const limitRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, maxWidth: 720,
}
const limitInput: React.CSSProperties = {
  width: 96, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  padding: '4px 10px', fontSize: 13, background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)', outline: 'none', fontFamily: 'inherit',
}

/** 单个上限的编辑控件：POST /cortex/api/limits；输入中不被轮询覆盖（touched）。 */
function LimitControl({ value, field }: { value: number; field: 'memoryLimit' | 'userLimit' }): React.ReactElement {
  const [draft, setDraft] = useState(String(value))
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    if (!touched) setDraft(String(value))
  }, [value, touched])

  useEffect(() => {
    if (phase !== 'saved') return
    const timer = setTimeout(() => setPhase('idle'), 2000)
    return () => clearTimeout(timer)
  }, [phase])

  const save = (): void => {
    const num = Number(draft)
    if (!Number.isInteger(num) || num < 100 || num > 100000) {
      setPhase('error')
      setErrMsg(t('limit.invalid'))
      return
    }
    setPhase('saving')
    fetch('/cortex/api/limits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [field]: num }),
    }).then((r) => r.json().then((d: unknown) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          const data = d as { error?: string }
          setPhase('error')
          setErrMsg(data.error ?? String(d))
          return
        }
        setTouched(false)
        setPhase('saved')
      })
      .catch((e) => { setPhase('error'); setErrMsg(String(e)) })
  }

  return createElement('div', { style: limitRow },
    createElement('span', { style: saveNote }, t('limit.label')),
    createElement('input', {
      type: 'number',
      style: limitInput,
      value: draft,
      min: 100,
      max: 100000,
      step: 100,
      'aria-label': t('limit.label'),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraft(e.target.value)
        setTouched(true)
        if (phase !== 'idle') setPhase('idle')
      },
    }),
    phase === 'error' ? createElement('span', { style: { ...saveNote, color: 'var(--dsw-alias-state-error-primary)' } }, errMsg) : null,
    phase === 'saved' ? createElement('span', { style: saveNote }, t('editor.saved')) : null,
    createElement('button', {
      type: 'button',
      style: { ...saveBtn, opacity: phase === 'saving' ? 0.5 : 1 },
      disabled: phase === 'saving',
      onClick: save,
    }, phase === 'saving' ? t('editor.saving') : t('editor.save')))
}

/** 用户画像 tab：上限设置 + USER.md 编辑器 */
function UserTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  return createElement('div', null,
    createElement('p', { style: statusText }, t('user.intro')),
    createElement(LimitControl, { value: status?.userLimit ?? 0, field: 'userLimit' }),
    createElement(FileEditor, {
      value: status?.user ?? '',
      path: status?.userPath ?? '',
      endpoint: '/cortex/api/user',
      field: 'user',
      placeholder: t('user.placeholder'),
    }))
}

/** 记忆 tab：上限设置 + MEMORY.md 编辑器 */
function MemoryTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  return createElement('div', null,
    createElement('p', { style: statusText }, t('memory.intro')),
    createElement(LimitControl, { value: status?.memoryLimit ?? 0, field: 'memoryLimit' }),
    createElement(FileEditor, {
      value: status?.memory ?? '',
      path: status?.memoryPath ?? '',
      endpoint: '/cortex/api/memory',
      field: 'memory',
      placeholder: t('memory.placeholder'),
    }))
}

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
        placeholder: t('list.search'),
        'aria-label': t('list.search'),
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
      })),
    createElement('div', { style: catalogHeading },
      createElement('h3', { style: catalogTitle }, heading),
      createElement('span', { style: catalogCount }, String(filtered.length))),
    rows.length === 0
      ? createElement('p', { style: statusText }, t('list.empty'))
      : filtered.length === 0
        ? createElement('p', { style: statusText }, t('list.noMatch'))
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

// ── 待入库（staged）分区：逐项 入库 / 丢弃（v2 人控入库）──
const stagedCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-3)', marginBottom: 8,
}
const stagedName: React.CSSProperties = {
  flexShrink: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)',
}
const stagedDesc: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const stagedBtn: React.CSSProperties = {
  flexShrink: 0, appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8, padding: '3px 10px', fontSize: 12, lineHeight: '18px', font: 'inherit',
  cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
}

function StagedSection({ rows, refresh }: { rows: StagedSkillRow[]; refresh: () => void }): React.ReactElement {
  const [busy, setBusy] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const act = (name: string, kind: 'skill' | 'delete', action: 'promote' | 'discard'): void => {
    if (action === 'discard' && kind === 'skill' && !window.confirm(t('staged.discardConfirm') + name)) return
    if (action === 'promote' && kind === 'delete' && !window.confirm(t('staged.applyDeleteConfirm') + name)) return
    setBusy(name + action)
    setErrMsg('')
    fetch('/cortex/api/staged/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => r.json().then((d: unknown) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          const data = d as { error?: string }
          setErrMsg(data.error ?? String(d))
          return
        }
        refresh()
      })
      .catch((e) => setErrMsg(String(e)))
      .finally(() => setBusy(null))
  }
  return createElement('div', null,
    createElement('div', { style: catalogHeading },
      createElement('h3', { style: catalogTitle }, t('staged.heading')),
      createElement('span', { style: catalogCount }, String(rows.length))),
    rows.length === 0
      ? createElement('p', { style: statusText }, t('staged.empty'))
      : rows.map((row) => createElement('div', { style: stagedCard, key: row.kind + row.name },
        createElement('span', { style: stagedName }, row.name),
        row.kind === 'delete'
          ? createElement('span', { style: { ...badge, flexShrink: 0 } }, t('staged.kindDelete'))
          : createElement('span', { style: stagedDesc }, row.description || t('list.noDescription')),
        createElement('button', {
          type: 'button',
          style: stagedBtn,
          disabled: busy !== null,
          onClick: () => act(row.name, row.kind, 'promote'),
        }, row.kind === 'delete' ? t('staged.applyDelete') : t('staged.promote')),
        createElement('button', {
          type: 'button',
          style: stagedBtn,
          disabled: busy !== null,
          onClick: () => act(row.name, row.kind, 'discard'),
        }, row.kind === 'delete' ? t('staged.cancelDelete') : t('staged.discard')))),
    errMsg !== '' ? createElement('p', { style: { ...statusText, color: 'var(--dsw-alias-state-error-primary)' } }, errMsg) : null,
  )
}

/** 技能 tab：待入库分区 + ctx.skills 快照清单（review 活动记录为调试信息，不展示给用户） */
function SkillTab({ status, refresh }: { status: CortexStatus | null; refresh: () => void }): React.ReactElement {
  const rows = (status?.skills ?? []).map((s) => ({ key: s.name, ...s }))
  return createElement('div', null,
    createElement('p', { style: statusText },
      t('skill.intro')),
    createElement(StagedSection, { rows: status?.staged ?? [], refresh }),
    createElement(SearchableList, {
      heading: t('skill.heading'),
      rows,
      matches: (row, q) => row.name.toLocaleLowerCase().includes(q)
        || row.description.toLocaleLowerCase().includes(q)
        || row.whenToUse.toLocaleLowerCase().includes(q),
      renderTitle: (row) => row.name,
      renderTags: (row) => [
        createElement('span', { key: 'src', style: rowTag(true) }, String(row.source)),
        row.modelInvocable ? createElement('span', { key: 'm', style: rowTag(true) }, t('list.modelCallable')) : null,
        row.userInvocable ? createElement('span', { key: 'u', style: rowTag(true) }, t('list.userCallable')) : null,
      ],
      renderDetails: (row) => createElement('div', null,
        createElement('p', { style: rowDetailText }, row.description || t('list.noDescription')),
        row.whenToUse ? createElement('p', { style: rowDetailText }, row.whenToUse) : null,
        createElement('code', { style: rowDetailCode }, t('list.providerSource') + ' ' + row.provider + ' · source: ' + row.source),
        createElement(SkillLocate, { name: row.name })),
    }))
}

/** MCP tab：loader 装配里的 mcp-client 实例清单 */
function McpTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  const rows = (status?.mcp ?? []).map((m) => ({ key: m.serverName, ...m }))
  return createElement('div', null,
    createElement('p', { style: statusText },
      t('mcp.intro')),
    createElement(SearchableList, {
      heading: t('mcp.heading'),
      rows,
      matches: (row, q) => row.serverName.toLocaleLowerCase().includes(q)
        || row.endpoint.toLocaleLowerCase().includes(q),
      renderTitle: (row) => row.serverName || '（未命名）',
      renderTags: (row) => [
        createElement('span', { key: 't', style: rowTag(true) }, String(row.transport)),
        createElement('span', { key: 'e', style: rowTag(row.enabled) }, row.enabled ? t('list.enabled') : t('list.disabled')),
      ],
      renderDetails: (row) => createElement('div', null,
        createElement('code', { style: rowDetailCode }, row.endpoint || t('list.noEndpoint'))),
    }))
}

/** 占位内容（未接功能的 tab） */
function TabPlaceholder({ tab }: { tab: TabId }): React.ReactElement {
  const meta = TABS.find((t) => t.id === tab)!
  return createElement('div', null,
    createElement('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, t(meta.key)),
    createElement('p', { style: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 13, margin: 0 } },
      t('placeholder.dev') + t(meta.key) + '管理能力。'),
  )
}

// ── 上下文设定 tab：压缩比例预设（deepseek / gpt / 自定义）──
const contextCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)', padding: '14px 16px',
}
const contextRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const contextLabel: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)',
  minWidth: 120,
}
const presetBtn = (active: boolean): React.CSSProperties => ({
  appearance: 'none', border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'),
  borderRadius: 8, padding: '4px 12px', fontSize: 12, lineHeight: '18px', font: 'inherit',
  cursor: 'pointer', background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-layer-1)',
  color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
})

/** 上下文设定：预设（deepseek 0.8 / gpt 0.4）+ 自定义压缩比例（10-95%）→ 保存后重启 web 生效。 */
function ContextTab({ status }: { status: CortexStatus | null }): React.ReactElement {
  const current = status?.context ?? { preset: 'deepseek' as const, thresholdRatio: 0.8 }
  const [preset, setPreset] = useState<'deepseek' | 'gpt' | 'custom'>(current.preset)
  const [ratioDraft, setRatioDraft] = useState(String(Math.round(current.thresholdRatio * 100)))
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    setPreset(current.preset)
    setRatioDraft(String(Math.round(current.thresholdRatio * 100)))
  }, [current.preset, current.thresholdRatio])

  useEffect(() => {
    if (phase !== 'saved') return
    const timer = setTimeout(() => setPhase('idle'), 2000)
    return () => clearTimeout(timer)
  }, [phase])

  const save = (): void => {
    const pct = Number(ratioDraft)
    const ratio = pct / 100
    if (!Number.isInteger(pct) || pct < 10 || pct > 95) {
      setPhase('error')
      setErrMsg(t('context.invalid'))
      return
    }
    setPhase('saving')
    fetch('/cortex/api/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset, thresholdRatio: ratio }),
    }).then((r) => r.json().then((d: unknown) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          const data = d as { error?: string }
          setPhase('error')
          setErrMsg(data.error ?? String(d))
          return
        }
        setPhase('saved')
      })
      .catch((e) => { setPhase('error'); setErrMsg(String(e)) })
  }

  const presetRatio = preset === 'gpt' ? 40 : preset === 'custom' ? Number(ratioDraft) : 80

  return createElement('div', { style: section },
    createElement('h2', { style: title }, t('context.title')),
    createElement('p', { style: intro }, t('context.intro')),
    createElement('div', { style: contextCard },
      createElement('div', { style: contextRow },
        createElement('span', { style: contextLabel }, t('context.preset')),
        createElement('button', { type: 'button', style: presetBtn(preset === 'deepseek'), onClick: () => setPreset('deepseek') }, t('context.presetDeepseek')),
        createElement('button', { type: 'button', style: presetBtn(preset === 'gpt'), onClick: () => setPreset('gpt') }, t('context.presetGpt')),
        createElement('button', { type: 'button', style: presetBtn(preset === 'custom'), onClick: () => setPreset('custom') }, t('context.presetCustom'))),
      createElement('div', { style: contextRow },
        createElement('span', { style: contextLabel }, t('context.ratio')),
        createElement('input', {
          type: 'number',
          style: limitInput,
          value: ratioDraft,
          min: 10,
          max: 95,
          step: 5,
          disabled: preset !== 'custom',
          'aria-label': t('context.ratio'),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setRatioDraft(e.target.value); if (phase !== 'idle') setPhase('idle') },
        }),
        createElement('span', { style: saveNote }, t('context.ratioUnit') + '（' + t('context.ratioPreview') + String(presetRatio) + '%）')),
      createElement('div', { style: contextRow },
        phase === 'error' ? createElement('span', { style: { ...saveNote, color: 'var(--dsw-alias-state-error-primary)' } }, errMsg) : null,
        phase === 'saved' ? createElement('span', { style: saveNote }, t('editor.saved')) : null,
        createElement('button', {
          type: 'button',
          style: { ...saveBtn, opacity: phase === 'saving' ? 0.5 : 1 },
          disabled: phase === 'saving',
          onClick: save,
        }, phase === 'saving' ? t('editor.saving') : t('editor.save'))),
      createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('context.hint'))),
  )
}

/** 全屏 overlay 面板：左侧 tab 导航 + 右侧内容区 */
function CortexPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<TabId>('persona')
  const [closeHover, setCloseHover] = useState(false)
  const { status, error, refresh } = useCortexStatus()
  useLocaleRevision() // locale 切换 → 重渲染 → t() 取新文案

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createElement('div', { style: overlay, onClick: onClose },
    createElement('div', { style: mask }),
    createElement('div', { style: panel, role: 'dialog', 'aria-modal': true, onClick: (e: React.MouseEvent) => e.stopPropagation() },
      createElement('div', { style: nav },
        createElement('div', { style: navTitle }, t('navTitle')),
        ...TABS.map((tabDef) =>
          createElement('button', {
            key: tabDef.id,
            style: navCell(tab === tabDef.id),
            onClick: () => setTab(tabDef.id),
          }, t(tabDef.key))),
      ),
      createElement('div', { style: content },
        createElement('div', { style: header },
          createElement('div', { style: { display: 'flex' } }),
          createElement('button', {
            type: 'button',
            'aria-label': t('close'),
            style: { ...closeBtn, background: closeHover ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent' },
            onMouseEnter: () => setCloseHover(true),
            onMouseLeave: () => setCloseHover(false),
            onClick: onClose,
          }, createElement(IconCloseOutline16, { size: 14 })),
        ),
        createElement('div', { style: options },
          error !== ''
            ? createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, t('channelError') + error)
            : tab === 'persona'
              ? createElement(PersonaTab, { status })
              : tab === 'memory'
                ? createElement(MemoryTab, { status })
                : tab === 'user'
                  ? createElement(UserTab, { status })
                  : tab === 'skill'
                    ? createElement(SkillTab, { status, refresh })
                    : tab === 'mcp'
                      ? createElement(McpTab, { status })
                      : tab === 'context'
                        ? createElement(ContextTab, { status })
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
      wide ? createElement('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap' } }, t('entryLabel')) : null),
    open ? createElement(CortexPanel, { onClose: () => setOpen(false) }) : null,
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('cortex-ui', { zh, en }), 'dsh-cortex-ui: dictionaries')
  currentT = ctx.locale.bind('cortex-ui') as TFunc
  // locale 是 class 实例：直接传 ctx.locale.getSnapshot 会丢失 this
  // （"Cannot read properties of undefined (reading 'snapshot')"）。
  // 用箭头包装，保持 this 指向 locale 服务实例。
  localeFace = {
    subscribe: (fn: () => void) => ctx.locale.subscribe(fn),
    getSnapshot: () => ctx.locale.getSnapshot(),
  }
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'cortex-manager',
      order: 0,
      label: () => t('entryLabel'),
    }, CortexEntry),
  ), 'dsh-cortex-ui: sidebar entry')
}
