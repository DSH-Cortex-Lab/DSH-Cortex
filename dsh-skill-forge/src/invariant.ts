/**
 * Package-owned durable skill-write invariants.
 *
 * 停用说明（B2 决策 2026-08-20）：审计事件 `skill/write` 已不再写入会话日志——
 * 自定义会话事件会导致 dsh 读侧 SessionFormatUnsupportedError（写侧无 ignorable
 * 声明通道），写入留痕由官方 tool/call + tool/result 事件天然覆盖。本 invariant
 * 保留注册与安装逻辑但校验体为空操作：历史日志中已带 ignorable 标记的旧事件
 * 会被静默放行，新日志不再产生该类事件。
 * @module @dsh-cortex/dsh-skill-forge/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-cortex/dsh-skill-forge'

/** Cordis companion plugin name. */
export const name = 'dsh-skill-forge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** 事件校验（B2 停用）：skill/write 不再产生，历史 ignorable 事件静默放行。 */
function validateEvent(_event: SessionEvent, _fail: InvariantFailure): void {
  /* no-op */
}

/** Install（B2 停用）：保留注册形状，事件校验为空操作。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the skill invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
