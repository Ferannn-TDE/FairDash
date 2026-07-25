import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

/**
 * Supabase pgBouncer (transaction pooler, port 6543) requires connection_limit=1.
 * Without it Prisma holds multiple pooled connections that pgBouncer treats as
 * separate sessions, which breaks tenant routing and causes:
 *   FATAL: Tenant or user not found
 *
 * We inject connection_limit=1 at runtime rather than baking it into .env.local
 * so the fix applies automatically regardless of which env file is used.
 */
/**
 * PURE — the redirect decision, extracted so BOTH directions are provable without a process,
 * a container, or a database.
 *
 * The isolation guard tests the direction you expect (a suite must not reach production). The
 * DANGEROUS direction is the inverse: if this condition ever inverts, or the prod-inert check
 * is dropped, PRODUCTION starts writing into a test database — silently, and with real orders.
 * That failure is worse than the one this whole change was built to prevent, so it gets its own
 * positive control (scripts/test-isolation-guard.ts §[4]) rather than a comment promising it.
 *
 * Returns the TEST url only when BOTH hold: not production, and an explicit opt-in.
 */
export function resolveAppDatabaseUrl(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === 'production') return null   // prod-inert, unconditionally
  if (!env.TEST_DATABASE_URL) return null          // opt-in only
  return env.TEST_DATABASE_URL
}

function buildDatabaseUrl(): string {
  // ── TEST-DATABASE REDIRECT ──────────────────────────────────────────────────
  // Suites do not only write through their own client — they exercise APP CODE
  // (placePaidOrder, reconcileMasterStatus, refundVendorPortion, the reconciler), and all of
  // that imports THIS singleton. Without this branch a suite would seed the test database
  // while the code under test wrote to production: worse than no isolation, because it would
  // look isolated.
  //
  // NARROW BY CONSTRUCTION, in three ways at once:
  //   1. Ignored entirely when NODE_ENV === 'production'. A stray TEST_DATABASE_URL in Vercel
  //      cannot redirect the live app — the branch is not reachable there.
  //   2. Opt-IN: absent TEST_DATABASE_URL, behaviour is exactly as before. Nothing changes for
  //      ordinary `npm run dev`.
  //   3. No fallback in the other direction either — see lib/test-db.ts, which refuses to run
  //      a suite at all when the variable is missing rather than quietly using DATABASE_URL.
  const redirected = resolveAppDatabaseUrl(process.env)
  if (redirected) return redirected

  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      '[FairSynq] DATABASE_URL is not set.\n' +
      'Add it to .env.local — see .env.example for the required format.'
    )
  }

  try {
    const url = new URL(raw)
    // Only patch pgBouncer / transaction-pooler URLs
    if (url.searchParams.get('pgbouncer') === 'true') {
      if (!url.searchParams.has('connection_limit')) {
        url.searchParams.set('connection_limit', '1')
      }
      // POOL TIMEOUT — MUST be finite, and MUST expire before the platform does.
      //
      // This was `0`, which in Prisma DISABLES the timeout: a request contending for the
      // single pooled connection waits FOREVER. It never errors — it hangs until Vercel kills
      // the function, so pool exhaustion surfaces as a 504 with no attribution instead of a
      // fast, named failure. "Prevents connection pool timeout on cold starts" was true in the
      // sense that a hang is not a timeout error; it converted a clean failure into a silent one.
      //
      // WHY 5s: the ordering that matters is pool < platform. `vercel.json` sets no
      // `maxDuration`, so functions run on Vercel's default (10s Hobby / 15s Pro) — 5s expires
      // first on either, leaving headroom to serialise the error response. It is also ~50× the
      // real work: region iad1 sits in the same AWS region as the Supabase project, and the
      // heaviest route (POST /api/orders) issues 6 queries plus a Stripe call. A request waiting
      // 5s for a connection is not slow, it is stuck, and it should say so.
      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '5')
      }
    }
    return url.toString()
  } catch {
    // URL parse failed — return raw value and let Prisma surface the real issue
    return raw
  }
}

function createClient(): PrismaClient {
  const url = buildDatabaseUrl()
  const isDev = process.env.NODE_ENV === 'development'
  const client = new PrismaClient({
    datasources: { db: { url } },
    log: isDev
      ? [
          { emit: 'event',  level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : ['warn', 'error'],
  })

  if (isDev) {
    client.$on('query', (e) => {
      if (e.duration > 100) {
        console.warn('[Slow Query]', { query: e.query, durationMs: e.duration })
      }
    })
  }

  return client
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
