/** Package-owned durable memory-write invariants. @module @dsh-cortex/dsh-memory-harness/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-cortex/dsh-memory-harness'
const ACTIONS = new Set(['add', 'replace', 'remove'])
const TARGETS = new Set(['memory', 'user'])

/** Cordis companion plugin name. */
export const name = 'dsh-memory-harness-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one memory/write audit payload before it reaches the durable log.
 *
 * Deliberately silent on usage magnitude: the per-deployment char limit is
 * Config policy (memoryLimit/userLimit), not a durable-shape rule — a log
 * written under a larger limit must still replay after the limit is lowered.
 */
function validateMemoryWrite(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('memory/write payload must be an object')
  const record = value as Record<string, unknown>
  if (typeof record.action !== 'string' || !ACTIONS.has(record.action)) {
    fail(`memory/write carries unknown action ${JSON.stringify(record.action)}`)
  }
  if (typeof record.target !== 'string' || !TARGETS.has(record.target)) {
    fail(`memory/write carries unknown target ${JSON.stringify(record.target)}`)
  }
  if (typeof record.content !== 'string') fail('memory/write content must be a string')
  if (typeof record.usage !== 'number' || !Number.isInteger(record.usage) || record.usage < 0) {
    fail('memory/write usage must be a non-negative integer')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'memory/write') validateMemoryWrite(event.data, fail)
}

/** Install validation for loaded and newly appended memory/write audit payloads. */
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
 * Register the memory invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
