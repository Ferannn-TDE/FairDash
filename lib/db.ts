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
function buildDatabaseUrl(): string {
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
