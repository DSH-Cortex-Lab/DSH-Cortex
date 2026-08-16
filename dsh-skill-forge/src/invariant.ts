/** Package-owned durable skill-write invariants. @module @dsh-cortex/dsh-skill-forge/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-cortex/dsh-skill-forge'
const ACTIONS = new Set(['create', 'patch', 'edit', 'delete'])

/** Cordis companion plugin name. */
export const name = 'dsh-skill-forge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one skill/write audit payload before it reaches the durable log.
 * Only durable-shape rules: name is a non-empty string; path, when present, is a string.
 */
function validateSkillWrite(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('skill/write payload must be an object')
  const record = value as Record<string, unknown>
  if (typeof record.action !== 'string' || !ACTIONS.has(record.action)) {
    fail(`skill/write carries unknown action ${JSON.stringify(record.action)}`)
  }
  if (typeof record.name !== 'string' || record.name.length === 0) fail('skill/write name must be a non-empty string')
  if (record.path !== undefined && typeof record.path !== 'string') fail('skill/write path must be a string when present')
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'skill/write') validateSkillWrite(event.data, fail)
}

/** Install validation for loaded and newly appended skill/write audit payloads. */
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
