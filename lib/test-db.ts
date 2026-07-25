/**
 * THE TEST-DATABASE BOUNDARY.
 *
 * Every suite that writes to a database goes through here. The single most important property
 * in this file is the one that is NOT here:
 *
 *   ⛔ THERE IS NO FALLBACK TO DATABASE_URL OR DIRECT_URL. ⛔
 *
 * A fallback is what silently recreates the problem. `TEST_DATABASE_URL ?? DATABASE_URL` reads
 * as defensive and behaves as catastrophic: the day the variable is missing — a new laptop, a
 * CI job without the secret, a shell that didn't source the env — every suite quietly seeds
 * production instead of failing. Three pollution incidents in this repo came from exactly that
 * shape of "helpful" default. Missing config must be LOUD.
 *
 * So: unset TEST_DATABASE_URL is a hard throw, and pointing it at production is a hard throw.
 */

import { PrismaClient } from '@prisma/client'

/** Hosts that are production. Used to refuse, not to warn. */
const PRODUCTION_HOST_MARKERS = ['supabase.com', 'supabase.co', 'pooler.supabase']

export class TestDatabaseMisconfigured extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestDatabaseMisconfigured'
  }
}

/**
 * PURE — the decision, so a guard can prove the refusals without a database or a container.
 * Returns the URL to use, or throws with the reason.
 */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.TEST_DATABASE_URL
  if (!url) {
    throw new TestDatabaseMisconfigured(
      'TEST_DATABASE_URL is not set.\n' +
      '  Suites never fall back to DATABASE_URL — that fallback is how test runs end up in production.\n' +
      '  Start the local test database and retry:  npm run test:db:up',
    )
  }
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (PRODUCTION_HOST_MARKERS.some(m => host.includes(m))) {
    throw new TestDatabaseMisconfigured(
      `TEST_DATABASE_URL points at what looks like PRODUCTION (${host}).\n` +
      '  Refusing to run: the whole point of this variable is that it is NOT production.',
    )
  }
  // Belt and braces for a production host the marker list above doesn't know about.
  //
  // NARROWED: this used to refuse ANY equality with DATABASE_URL/DIRECT_URL. That was wrong —
  // scripts/with-test-db.sh deliberately sets all three to the SAME value, because Prisma's CLI
  // reads directUrl and a partial environment silently falls through to .env.local. Equality is
  // the CORRECT state under the wrapper; what must never happen is equality with a NON-LOCAL
  // value. So the refusal is conditioned on the host, not on the equality alone.
  const isLocalHost = ['localhost', '127.0.0.1', 'fairsynq-test-db'].includes(host)
  if (!isLocalHost && (url === env.DATABASE_URL || url === env.DIRECT_URL)) {
    throw new TestDatabaseMisconfigured(
      `TEST_DATABASE_URL is identical to DATABASE_URL/DIRECT_URL and the host (${host}) is not local. Refusing to run.`,
    )
  }
  return url
}

/**
 * THE TOOLING RESOLVER — for clients that must reach PRODUCTION when doing prod work, and the
 * TEST database when running under the gate. `guardedPrisma` and the prod-ops scripts use this.
 *
 * WHY IT EXISTS. `DIRECT_URL ?? DATABASE_URL` was copied into ~15 places, and every copy
 * silently resolved to production even when TEST_DATABASE_URL was set — which is how
 * `guardedPrisma` kept reading production throughout the isolated gate. Two copies of one
 * truth, in the tooling layer.
 *
 * ORDER MATTERS: TEST_DATABASE_URL wins when present. That is the opt-in, and it means a gate
 * run cannot reach production through this path however the client was constructed.
 */
export function resolveToolingDatabaseUrl(env: Record<string, string | undefined>): string | undefined {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL
  return env.DIRECT_URL ?? env.DATABASE_URL
}

let cached: PrismaClient | undefined

/**
 * The client every DB-writing suite uses. Throws loudly rather than degrading to production.
 *
 * `opts` exists for the handful of suites that assert on Prisma's own behaviour (e.g. the
 * slow-query event logger). Passing options bypasses the cache — those suites want their own
 * instance, and sharing one would leak listeners between suites.
 */
export function testPrisma<T extends ConstructorParameters<typeof PrismaClient>[0]>(opts?: T): PrismaClient<T extends undefined ? never : T> {
  const url = resolveTestDatabaseUrl(process.env)
  if (opts) return new PrismaClient({ ...opts, datasources: { db: { url } } }) as never
  if (cached) return cached as never
  cached = new PrismaClient({ datasources: { db: { url } }, log: ['warn', 'error'] })
  return cached as never
}
