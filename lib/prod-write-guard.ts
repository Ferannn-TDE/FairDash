import { PrismaClient } from '@prisma/client'

/**
 * PROD-WRITE GUARD — a structural block on the session's recurring failure class: a script or
 * test writing to a REAL event in the production DB (there is no test DB — local IS prod; see
 * the test-prod-isolation note). This is the interim wall until a separate test instance exists.
 *
 * A guarded Prisma client THROWS when a create/upsert/update targets a PROTECTED event id,
 * unless the operator explicitly opts in with ALLOW_PROD_WRITES=true (a deliberate, reviewed
 * prod operation — e.g. a remediation receipt). Test-event writes (any non-protected event) pass
 * freely, so real test suites that create their own throwaway events are unaffected.
 *
 * WHY A FACTORY, NOT the lib/db singleton: scripts construct their OWN `new PrismaClient(...)`,
 * so guarding the app singleton wouldn't reach them. Scripts must call guardedPrisma(); the CI
 * guard (prod-write-guard-test) enforces that every script referencing a protected event does so.
 *
 * LIMITATION (documented, not hidden): the check reads `args.data.eventId` on create/upsert/
 * update. An update/delete BY ID that carries no eventId is not caught here — those are the
 * deliberate-prod-op receipts, which run with ALLOW_PROD_WRITES anyway. The CI grep is the
 * class-level net for anything this runtime check can't see.
 */

// Real, protected events. A write here from a script is the incident class.
export const PROTECTED_EVENT_IDS = new Set<string>([
  'cmni6x63n000011znjwlln5k2', // Italian Fest 2026 — the live event
])

export class ProdWriteBlockedError extends Error {
  constructor(model: string, eventId: string) {
    super(
      `🛑 PROD-WRITE BLOCKED: ${model} write targets PROTECTED event ${eventId}. ` +
      `Local DB is the PRODUCTION Supabase instance — a test/script must not write to a real event. ` +
      `Use a throwaway test event, or (only for a deliberate, reviewed prod operation) set ALLOW_PROD_WRITES=true.`,
    )
    this.name = 'ProdWriteBlockedError'
  }
}

/** The pure check — exported so the guard's positive control can prove it without any real write. */
export function assertWriteAllowed(model: string, data: unknown): void {
  if (process.env.ALLOW_PROD_WRITES === 'true') return
  const rows = Array.isArray(data) ? data : [data]
  for (const d of rows) {
    const eventId = (d as { eventId?: unknown })?.eventId
    if (typeof eventId === 'string' && PROTECTED_EVENT_IDS.has(eventId)) {
      throw new ProdWriteBlockedError(model, eventId)
    }
  }
}

/**
 * A PrismaClient that blocks protected-event writes. Drop-in for scripts:
 *   const prisma = guardedPrisma()
 */
export function guardedPrisma() {
  const base = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  })
  return base.$extends({
    query: {
      $allModels: {
        create({ model, args, query }) { assertWriteAllowed(model, (args as { data?: unknown }).data); return query(args) },
        createMany({ model, args, query }) { assertWriteAllowed(model, (args as { data?: unknown }).data); return query(args) },
        upsert({ model, args, query }) { assertWriteAllowed(model, (args as { create?: unknown }).create); return query(args) },
        update({ model, args, query }) { assertWriteAllowed(model, (args as { data?: unknown }).data); return query(args) },
        updateMany({ model, args, query }) { assertWriteAllowed(model, (args as { data?: unknown }).data); return query(args) },
      },
    },
  })
}
