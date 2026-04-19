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
      // pool_timeout=0 prevents "connection pool timeout" on cold starts
      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '0')
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
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
