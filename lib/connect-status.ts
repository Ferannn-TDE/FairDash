// ─────────────────────────────────────────────────────────────────────────────
// Connect status → payout gate (readiness 1.4). THE ONE WRITER of stripeVerified.
// ─────────────────────────────────────────────────────────────────────────────
//
// stripeVerified is the payout gate: the vendor, runner and organizer executors and reconciler
// Patterns D/P only pay a payee whose flag is true. Two paths learn Stripe's live status — the
// Connect webhook and the three GET …/stripe/status routes — and both used to write the flag
// unconditionally on every read. That made "did it just become ready?" unanswerable, so nothing
// could send a "payout setup complete" notice exactly once, and stripeConnectedAt was rewritten
// on every event.
//
// applyConnectStatus is now the only way either path writes it, and every write is a
// CONDITIONAL updateMany on the current value:
//
//   false → true  (where stripeVerified=false)  count===1 → stripeConnectedAt=now, notice job
//   true  → false (where stripeVerified=true)   count===1 → gate closes NOW, re-check job ~10 min
//   anything else                               count===0 → nothing (replays, races, no-ops)
//
// The database serialises the race: of N concurrent callers seeing the same live status,
// exactly one gets count===1. The gate closes immediately on a restriction (payouts stop at
// once — the safe direction); only the "needs attention" notice waits for the re-check, so a
// restriction that clears itself inside 10 minutes never alarms anyone.
//
// Notices are not sent here: they become PayeeNotice rows via JOB_PAYEE_NOTICE, keyed so a
// replayed job can never add a second. Phase 5 sends them.
//
// scripts/connect-status-test.ts pins all of this against the test database.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './db'
import { logger } from './logger'
import { getOrderQueue, JOB_PAYEE_NOTICE, JOB_CONNECT_RECHECK, type JobData } from './queues'
import { enqueueJobSafely } from './queue-safe'
import type { ConnectDueItem } from './connect-card-state'

export type PayeeKind = 'vendor' | 'runner' | 'organizer'
export type NoticeKind = 'PAYOUT_SETUP_COMPLETE' | 'PAYOUTS_RESTORED' | 'PAYOUT_NEEDS_ATTENTION'

export const RECHECK_DELAY_MS = 10 * 60_000

export interface LiveConnectStatus {
  readyToReceivePayments: boolean
  onboardingComplete: boolean
  dueItems: ConnectDueItem[]
  requirements?: unknown
}

export type Transition =
  | { transition: 'activated'; notice: NoticeKind | null }
  | { transition: 'deactivated' }
  | { transition: 'none' }

// Per-kind table access, typed loosely on purpose: the three models carry identical
// stripeAccountId / stripeVerified / stripeConnectedAt columns.
function table(kind: PayeeKind): any {
  return kind === 'vendor' ? db.vendor : kind === 'runner' ? db.runner : db.fairOrganizer
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export interface PayeeJobData extends JobData {
  payeeType: PayeeKind
  payeeId: string
  noticeKind?: NoticeKind
  noticeKey?: string
  deactivatedAt?: string
}

async function enqueueNotice(kind: PayeeKind, id: string, notice: NoticeKind, noticeKey: string): Promise<void> {
  const data: PayeeJobData = { eventId: '__payee__', payeeType: kind, payeeId: id, noticeKind: notice, noticeKey }
  const queue = getOrderQueue()
  if (!queue) {
    // No queue (local / Redis down): the notice is only a DB row, so write it inline.
    await handlePayeeNotice(data)
    return
  }
  await enqueueJobSafely({ queue, name: JOB_PAYEE_NOTICE, data, jobId: `payee-notice-${noticeKey}`, priority: 'low',
    fallback: async () => { await handlePayeeNotice(data) } })
}

async function enqueueRecheck(kind: PayeeKind, id: string, at: Date): Promise<void> {
  const data: PayeeJobData = { eventId: '__payee__', payeeType: kind, payeeId: id, deactivatedAt: at.toISOString() }
  const queue = getOrderQueue()
  if (!queue) {
    logger.warn('[ConnectStatus] no queue — needs-attention re-check not scheduled', { payeeType: kind, payeeId: id })
    return
  }
  await enqueueJobSafely({ queue, name: JOB_CONNECT_RECHECK, data, jobId: `connect-recheck-${kind}-${id}-${at.getTime()}`,
    delay: RECHECK_DELAY_MS, priority: 'low' })
}

// ─── The writer ───────────────────────────────────────────────────────────────

export async function applyConnectStatus(
  kind: PayeeKind,
  id: string,
  ready: boolean,
  opts: { now?: Date; source: 'webhook' | 'status' | 'recheck' | 'dry-run'; dryRun?: boolean },
): Promise<Transition> {
  const now = opts.now ?? new Date()
  const t = table(kind)

  // DRY RUN (the sealed production dry run): the same decision from the current row, with no
  // update and no enqueue. Everything after this block is the live path.
  const before = await t.findUnique({ where: { id }, select: { stripeVerified: true, stripeConnectedAt: true } })
  if (opts.dryRun) {
    if (ready && before && !before.stripeVerified) return { transition: 'activated', notice: await activationNotice(kind, id, before.stripeConnectedAt) }
    if (!ready && before?.stripeVerified) return { transition: 'deactivated' }
    return { transition: 'none' }
  }

  if (ready) {
    // `before` was read BEFORE flipping: its stripeConnectedAt decides which notice is owed.
    const { count } = await t.updateMany({ where: { id, stripeVerified: false }, data: { stripeVerified: true, stripeConnectedAt: now } })
    if (count !== 1) return { transition: 'none' }

    const notice = await activationNotice(kind, id, before?.stripeConnectedAt ?? null)
    if (notice) await enqueueNotice(kind, id, notice, `${notice}:${kind}:${id}:${now.toISOString()}`)
    logger.info('[ConnectStatus] payout gate OPENED', { payeeType: kind, payeeId: id, source: opts.source, notice })
    return { transition: 'activated', notice }
  }

  const { count } = await t.updateMany({ where: { id, stripeVerified: true }, data: { stripeVerified: false } })
  if (count !== 1) return { transition: 'none' }
  await enqueueRecheck(kind, id, now)
  logger.warn('[ConnectStatus] payout gate CLOSED — Stripe restricted transfers', { payeeType: kind, payeeId: id, source: opts.source })
  return { transition: 'deactivated' }
}

/** First activation → setup complete. Re-activation → "restored" only if a needs-attention
 *  notice went out since the last activation; otherwise nobody was told anything was wrong. */
async function activationNotice(kind: PayeeKind, id: string, prevConnectedAt: Date | null): Promise<NoticeKind | null> {
  if (!prevConnectedAt) return 'PAYOUT_SETUP_COMPLETE'
  const warned = await db.payeeNotice.findFirst({
    where: { payeeType: kind, payeeId: id, kind: 'PAYOUT_NEEDS_ATTENTION', createdAt: { gt: prevConnectedAt } },
    select: { id: true },
  })
  return warned ? 'PAYOUTS_RESTORED' : null
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

/** Records the notice. Idempotent on noticeKey: a replayed job is a no-op. */
export async function handlePayeeNotice(data: PayeeJobData, detail?: unknown): Promise<'created' | 'duplicate'> {
  if (!data.noticeKind || !data.noticeKey) throw new Error('payee-notice job without noticeKind/noticeKey')
  const res = await db.payeeNotice.createMany({
    data: [{ noticeKey: data.noticeKey, kind: data.noticeKind, payeeType: data.payeeType, payeeId: data.payeeId,
      ...(detail !== undefined ? { detail: detail as object } : {}) }],
    skipDuplicates: true,
  })
  return res.count === 1 ? 'created' : 'duplicate'
}

/**
 * ~10 min after the gate closed: if the payee is STILL restricted (DB flag still false AND
 * Stripe still says not ready), owe a "needs attention" notice. Recovered → nothing. The
 * notice key is derived from the deactivation instant, so a replayed re-check adds nothing.
 */
export async function handleConnectRecheck(
  data: PayeeJobData,
  deps: { getStatus: (accountId: string) => Promise<LiveConnectStatus> },
): Promise<'notice' | 'recovered' | 'gone'> {
  const row = await table(data.payeeType).findUnique({
    where: { id: data.payeeId }, select: { stripeAccountId: true, stripeVerified: true },
  })
  if (!row?.stripeAccountId) return 'gone'
  if (row.stripeVerified) return 'recovered'
  const live = await deps.getStatus(row.stripeAccountId)
  if (live.readyToReceivePayments) {
    // Stripe recovered but no event has reached us yet: open the gate through the one writer.
    await applyConnectStatus(data.payeeType, data.payeeId, true, { source: 'recheck' })
    return 'recovered'
  }
  const { needsLine } = await import('./connect-card-state')
  const noticeKey = `PAYOUT_NEEDS_ATTENTION:${data.payeeType}:${data.payeeId}:${data.deactivatedAt}`
  await handlePayeeNotice({ ...data, noticeKind: 'PAYOUT_NEEDS_ATTENTION', noticeKey }, { needs: needsLine(live.dueItems) })
  return 'notice'
}

// ─── Status read for the three GET …/stripe/status routes ────────────────────

export interface StatusReadDeps {
  live: (accountId: string) => Promise<LiveConnectStatus>
  cached: (accountId: string) => Promise<LiveConnectStatus>
  rateLimit: (userKey: string) => Promise<boolean>
}

/**
 * ?fresh=1 is honoured only for the payee's OWNER and only within the per-user rate limit;
 * anyone else, or over the limit, gets the ~60s cached read. Either way the result goes
 * through applyConnectStatus, so a status read can open or close the gate exactly like an
 * event would — and never twice.
 */
export async function readPayeeConnectStatus(
  input: { kind: PayeeKind; id: string; accountId: string; wantFresh: boolean; isOwner: boolean; userKey: string },
  deps: StatusReadDeps,
): Promise<LiveConnectStatus & { fresh: boolean }> {
  const fresh = input.wantFresh && input.isOwner && (await deps.rateLimit(input.userKey))
  const status = fresh ? await deps.live(input.accountId) : await deps.cached(input.accountId)
  await applyConnectStatus(input.kind, input.id, status.readyToReceivePayments, { source: 'status' })
    .catch(err => logger.error('[ConnectStatus] status-route apply failed', { payeeType: input.kind, payeeId: input.id, error: String(err) }))
  return { ...status, fresh }
}

// ─── Connect webhook ──────────────────────────────────────────────────────────

export const HANDLED_CONNECT_EVENTS = new Set([
  'v2.core.account[requirements].updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
])

export interface WebhookDeps {
  parse: (rawBody: string, sig: string, secret: string) => { id: string; type: string }
  retrieveAccountId: (eventId: string) => Promise<string | undefined>
  live: (accountId: string) => Promise<LiveConnectStatus>
}

/**
 * Signature failure → 400 (Stripe won't fix it by retrying). Unknown type → 200, no DB touch.
 * Anything that goes wrong after a valid signature → 500, so Stripe RETRIES: the writer is
 * idempotent, so a retry can only finish the job, never double it.
 */
export async function handleConnectWebhook(
  rawBody: string,
  sig: string | null,
  secret: string,
  deps: WebhookDeps,
): Promise<{ status: number; body: unknown }> {
  if (!sig) return { status: 400, body: 'Missing signature' }
  let note: { id: string; type: string }
  try {
    note = deps.parse(rawBody, sig, secret)
  } catch (err) {
    logger.warn('[ConnectWebhook] Signature verification failed', { error: String(err) })
    return { status: 400, body: 'Invalid signature' }
  }
  if (!HANDLED_CONNECT_EVENTS.has(note.type)) return { status: 200, body: { received: true, ignored: note.type } }

  try {
    const accountId = await deps.retrieveAccountId(note.id)
    if (!accountId) return { status: 200, body: { received: true, account: null } }
    const [vendor, runner, organizer] = await Promise.all([
      db.vendor.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
      db.runner.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
      db.fairOrganizer.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }),
    ])
    const match: { kind: PayeeKind; id: string } | null =
      (vendor && { kind: 'vendor', id: vendor.id }) ||
      (runner && { kind: 'runner', id: runner.id }) ||
      (organizer && { kind: 'organizer', id: organizer.id }) || null
    if (!match) {
      logger.warn('[ConnectWebhook] No payee for account', { accountId, type: note.type })
      return { status: 200, body: { received: true, payee: null } }
    }
    const live = await deps.live(accountId)
    const result = await applyConnectStatus(match.kind, match.id, live.readyToReceivePayments, { source: 'webhook' })
    return { status: 200, body: { received: true, ...result } }
  } catch (err) {
    logger.error('[ConnectWebhook] Handler error — returning 500 so Stripe retries', { type: note.type, error: String(err) })
    return { status: 500, body: { received: false } }
  }
}
