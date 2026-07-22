import { db } from './db'

/**
 * Runner profile-change audit — the diff computation + the retention enforcer.
 *
 * Append-only log of edits to a runner's mutable profile identity (phone + vehicle), old → new.
 * It complements the per-order vehicle SNAPSHOT (Order.runnerVehicle*, the direct "what car took
 * THIS order"): the log answers "what did their profile say at time T" for incident/dispute
 * review without replaying anything.
 *
 * PII-bearing (phone numbers, old values), so retention is ENFORCED, not promised: rows are
 * purged 180 days after the runner's event ends, by reconciler Pattern W calling
 * purgeExpiredProfileChanges below. A schema comment promising deletion with no deleter is the
 * flag-with-no-reader class this project spent a week closing — so the deleter ships with the
 * label. Retention/exposure decisions are recorded in docs/PII_DECISIONS.md.
 */

export const TRACKED_PROFILE_FIELDS = ['phone', 'vehicleMake', 'vehicleModel', 'vehicleColor', 'vehiclePlate'] as const
export type TrackedProfileField = typeof TRACKED_PROFILE_FIELDS[number]

export const PROFILE_CHANGE_RETENTION_DAYS = 180

export interface ProfileChangeRow {
  runnerId: string
  field: string
  oldValue: string | null
  newValue: string | null
}

/**
 * PURE — the changes a settings PATCH would record. Only fields actually PRESENT in the incoming
 * patch and whose value differs from the current one produce a row (a no-op re-save writes
 * nothing; an unrelated field left out of the patch is never logged).
 */
export function diffProfileChanges(
  runnerId: string,
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): ProfileChangeRow[] {
  const rows: ProfileChangeRow[] = []
  for (const field of TRACKED_PROFILE_FIELDS) {
    if (!(field in incoming)) continue
    const oldValue = (current[field] ?? null) as string | null
    const newValue = (incoming[field] ?? null) as string | null
    if (oldValue !== newValue) rows.push({ runnerId, field, oldValue, newValue })
  }
  return rows
}

export interface PurgeResult { matched: number; purged: number; dryRun: boolean }

/**
 * Retention enforcer (reconciler Pattern W). Deletes profile-change rows whose runner's event
 * ended more than `retentionDays` ago. Idempotent, bounded by maxPerPattern, dry-run aware.
 * A clean sweep (nothing expired) returns matched=0 and is silent.
 */
export async function purgeExpiredProfileChanges(opts?: {
  retentionDays?: number
  dryRun?: boolean
  maxPerPattern?: number
  nowMs?: number
}): Promise<PurgeResult> {
  const days = opts?.retentionDays ?? PROFILE_CHANGE_RETENTION_DAYS
  const dryRun = opts?.dryRun ?? false
  const take = opts?.maxPerPattern ?? 1000
  const cutoff = new Date((opts?.nowMs ?? Date.now()) - days * 86_400_000)

  const expired = await db.runnerProfileChange.findMany({
    where: { runner: { event: { endDate: { lt: cutoff } } } },
    select: { id: true },
    take,
  })
  if (expired.length === 0 || dryRun) return { matched: expired.length, purged: 0, dryRun }

  const res = await db.runnerProfileChange.deleteMany({ where: { id: { in: expired.map(e => e.id) } } })
  return { matched: expired.length, purged: res.count, dryRun }
}
