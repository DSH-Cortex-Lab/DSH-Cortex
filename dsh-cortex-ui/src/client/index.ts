/**
 * @dsh-cortex/dsh-cortex-ui — 浏览器端：侧栏"设置上方"入口 + 全屏 overlay 管理面板。
 *
 * v0.1：五 tab 页面切换骨架（人格 / 记忆 / 用户画像 / 技能 / MCP），
 * 各 tab 为占位内容，功能逐块补入。
 *
 * 入口：sidebar.footer.action（官方注释：Footer actions stack above Settings）
 * 样式对齐 ui-settings 的 trigger 行：14px、圆角 12、悬停
 * var(--dsw-alias-interactive-bg-hover) 方块；折叠态 36x36 圆形。
 * 面板：全屏 fixed overlay，Esc / 关闭按钮退出。
 * 构建：npm run build:client（tsdown → lib/client.js）。
 */
import { createElement, Fragment, useEffect, useState } from 'react'
import type * as React from 'react'
import { IconCloseOutline16, IconCordisPluginOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

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

// ── 入口行样式（对齐 ui-settings 的 .trigger：14px / 圆角 12 / 悬停方块）──
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

// ── 面板样式（对齐 ui-settings SettingsPanel：800x min(800, 100vh-48)、r24、lv3 阴影）──
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
// 关闭按钮（对齐 ui-settings .close：28x28 圆形、悬停 interactive-bg-hover）
const closeBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, border: 'none', borderRadius: 28,
  background: 'transparent', cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)',
}

/** 占位内容（功能逐块补入） */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createElement('div', { style: overlay, onClick: onClose },
    createElement('div', { style: mask, 'aria-hidden': true }),
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
          createElement(TabPlaceholder, { tab }),
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
      title: '插件管理（人格 / 记忆 / 用户画像 / 技能 / MCP）',
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
