// B1.19 — an event's tax rates: read and change. ADMIN ONLY (the route sits behind requireAdminFairContext, the
// strict admin chokepoint); organizers never see or set them, and the organizer-safe settings allowlist
// (lib/admin-event-settings.ts) never picks them.
//
// A change: exact text parse (lib/fees/tax.ts parseTaxRatePercent: ≤ 3 decimals, 0..15%, '' = not charged), a
// reason is REQUIRED, and the event update plus one EventTaxRateChange row per changed part are written in ONE
// transaction. Unchanged parts write nothing. New orders snapshot the rates; placed orders never move.
import type { PrismaClient } from '@prisma/client'
import { parseTaxRatePercent } from './fees/tax'

export class TaxRateRefused extends Error {
  constructor(public field: 'salesTaxRate' | 'localTaxRate' | 'reason' | 'none', message: string) {
    super(message)
    this.name = 'TaxRateRefused'
  }
}

type Db = Pick<PrismaClient, 'event' | 'eventTaxRateChange' | '$transaction'>

export async function readEventTaxRates(db: Db, eventId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId }, select: { salesTaxRateMilli: true, localTaxRateMilli: true } })
  const changes = await db.eventTaxRateChange.findMany({ where: { eventId }, orderBy: { createdAt: 'desc' }, take: 20 })
  return { salesTaxRateMilli: ev?.salesTaxRateMilli ?? null, localTaxRateMilli: ev?.localTaxRateMilli ?? null, changes }
}

/** body: { salesTaxRate?, localTaxRate?, reason } as typed in the form ("8.35", "", …). Absent = unchanged. */
export async function updateEventTaxRates(
  db: Db,
  input: { eventId: string; body: Record<string, unknown>; actorId: string; actorRole: string },
) {
  const parts = [
    { key: 'salesTaxRate' as const, part: 'sales', column: 'salesTaxRateMilli' as const },
    { key: 'localTaxRate' as const, part: 'local', column: 'localTaxRateMilli' as const },
  ]
  const current = await db.event.findUnique({ where: { id: input.eventId }, select: { salesTaxRateMilli: true, localTaxRateMilli: true } })
  if (!current) throw new TaxRateRefused('none', 'Event not found')

  const changed: { part: string; column: 'salesTaxRateMilli' | 'localTaxRateMilli'; oldValue: number | null; newValue: number | null }[] = []
  for (const p of parts) {
    if (!(p.key in input.body)) continue
    const parsed = parseTaxRatePercent(input.body[p.key])
    if (!parsed.ok) throw new TaxRateRefused(p.key, parsed.error)
    if (parsed.value !== current[p.column]) changed.push({ part: p.part, column: p.column, oldValue: current[p.column], newValue: parsed.value })
  }
  if (changed.length === 0) throw new TaxRateRefused('none', 'Nothing changed')
  const reason = String(input.body.reason ?? '').trim()
  if (!reason) throw new TaxRateRefused('reason', 'A reason is required for every tax rate change')

  await db.$transaction(async (tx) => {
    await tx.event.update({ where: { id: input.eventId }, data: Object.fromEntries(changed.map(c => [c.column, c.newValue])) })
    await tx.eventTaxRateChange.createMany({
      data: changed.map(c => ({ eventId: input.eventId, part: c.part, oldValue: c.oldValue, newValue: c.newValue, actorId: input.actorId, actorRole: input.actorRole, reason })),
    })
  })
  return { changed: changed.map(c => c.part), ...(await readEventTaxRates(db, input.eventId)) }
}
