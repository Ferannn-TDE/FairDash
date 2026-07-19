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

// The same events by slug — a script that resolves the event dynamically often does so by
// urlSlug (event.findFirst({ where: { urlSlug } })) and never mentions the id, so the CI
// detector greps BOTH. (A fully-dynamic resolver — iterate all events, no literal at all —
// still evades a static grep; that residual is closed only by the durable fix, a separate
// test DB. The RUNTIME guard remains sound there: it value-checks the resolved eventId at
// write time, so any guarded script is caught however it obtained the id.)
export const PROTECTED_EVENT_SLUGS = new Set<string>([
  'springfield-state-fair-2026', // Italian Fest 2026's urlSlug
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

/** Best-effort SQL text from a raw call's args: string form (`$queryRawUnsafe`) or a
 *  tagged-template Sql object (`$queryRaw`). Returns null when it can't be read (→ block). */
export function extractRawSql(args: unknown): string | null {
  if (typeof args === 'string') return args
  if (Array.isArray(args) && typeof args[0] === 'string') return args[0]            // $queryRawUnsafe(sql, ...params)
  const sqlObj = (Array.isArray(args) ? args[0] : args) as { strings?: unknown; sql?: unknown } | undefined
  if (sqlObj && Array.isArray(sqlObj.strings)) return sqlObj.strings.join(' ')       // Prisma.Sql tagged template
  if (sqlObj && typeof sqlObj.sql === 'string') return sqlObj.sql
  return null
}

/** True only if the statement leads with SELECT or WITH (a read) after stripping leading
 *  whitespace and comments. A DELETE/UPDATE/INSERT (incl. `… RETURNING *`) is NOT a read. */
export function leadsWithRead(sql: string): boolean {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // block comments
    .replace(/--[^\n]*/g, ' ')          // line comments
    .replace(/^\s+/, '')
  const first = cleaned.slice(0, 6).toUpperCase()
  return first.startsWith('SELECT') || first.startsWith('WITH')
}

/** Check one data/where/create object (or array) for a protected eventId. */
export function assertWriteAllowed(model: string, obj: unknown): void {
  if (process.env.ALLOW_PROD_WRITES === 'true') return
  const rows = Array.isArray(obj) ? obj : [obj]
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
 *
 * COVERED (write ops, checking BOTH data and where for a protected eventId):
 *   create · createMany · upsert · update · updateMany · delete · deleteMany
 * Raw WRITES ($executeRaw / $executeRawUnsafe) are BLOCKED WHOLESALE — the SQL is opaque, so
 * the guard refuses rather than parse it (use guardedPrisma's typed ops, or ALLOW_PROD_WRITES).
 * Raw READS ($queryRaw*) pass.
 *
 * NOT COVERED (documented, not hidden): a write whose eventId is neither in `data` nor `where`
 * (e.g. update/delete BY ID where the id was resolved from a protected event elsewhere). The
 * PROTECTED_EVENT_IDS value-check is SEMANTIC (it inspects the actual eventId at call time, so a
 * dynamically-resolved event IS caught when it appears in data/where) — but an id-only operation
 * carries no eventId to inspect. Those are the deliberate-prod receipts (ALLOW_PROD_WRITES). The
 * CI guard (prod-write-guard-test) is the class net: it forbids ANY script from using an
 * unguarded client, so a dynamic-resolution script can't sidestep this by not mentioning the id.
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
        upsert({ model, args, query }) {
          assertWriteAllowed(model, (args as { create?: unknown }).create)
          assertWriteAllowed(model, (args as { update?: unknown }).update)
          assertWriteAllowed(model, (args as { where?: unknown }).where)
          return query(args)
        },
        update({ model, args, query }) {
          assertWriteAllowed(model, (args as { data?: unknown }).data)
          assertWriteAllowed(model, (args as { where?: unknown }).where)
          return query(args)
        },
        updateMany({ model, args, query }) {
          assertWriteAllowed(model, (args as { data?: unknown }).data)
          assertWriteAllowed(model, (args as { where?: unknown }).where)
          return query(args)
        },
        delete({ model, args, query }) { assertWriteAllowed(model, (args as { where?: unknown }).where); return query(args) },
        deleteMany({ model, args, query }) { assertWriteAllowed(model, (args as { where?: unknown }).where); return query(args) },
      },
      // RAW is opaque, and query≠read: `DELETE … RETURNING *` / `UPDATE … RETURNING *` mutate
      // yet run through $queryRaw. So $executeRaw* is blocked wholesale, and $queryRaw* is
      // allowed ONLY when the statement leads with SELECT/WITH (a read). Anything else — a
      // mutation, or SQL we can't parse — is blocked. Imperfect (leading-keyword only), but not
      // an open door. ALLOW_PROD_WRITES bypasses for deliberate ops.
      async $allOperations({ operation, args, query }) {
        if (process.env.ALLOW_PROD_WRITES === 'true') return query(args)
        if (operation === '$executeRaw' || operation === '$executeRawUnsafe') {
          throw new ProdWriteBlockedError(`rawWrite(${operation})`, '(raw execute — always a write)')
        }
        if (operation === '$queryRaw' || operation === '$queryRawUnsafe') {
          const sql = extractRawSql(args)
          if (sql === null || !leadsWithRead(sql)) {
            throw new ProdWriteBlockedError(`rawQuery(${operation})`, '(non-SELECT raw query may mutate — RETURNING)')
          }
        }
        return query(args)
      },
    },
  })
}
