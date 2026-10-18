/**
 * LOCAL PROCESSES NEVER TOUCH PRODUCTION BY DEFAULT.
 *
 * Until 2026-10-18 `.env.local` held the production database, queue, storage and Firebase
 * credentials, so `npm run dev`, `prisma db seed`, a local worker or any one-off script hit live
 * data unless someone remembered not to. The test DB (lib/test-db.ts) fixed that for the gate;
 * this is the same rule for everything else that runs on a laptop.
 *
 * THE RULE: a process that is NOT a deployed runtime refuses to connect to a production database
 * (or a remote job queue) unless CONFIRM_PROD_DB equals the production project ref. Typing the
 * ref is the point — it cannot be satisfied by a stale `true` left in a shell.
 *
 * DEPLOYED RUNTIMES ARE EXEMPT, and the exemption is deliberately wide (any ONE signal suffices):
 * a guard that misfires on Vercel or Railway takes payments down, which is worse than anything
 * it prevents. Vercel and Railway both run with NODE_ENV=production; Vercel also sets VERCEL and
 * Railway sets RAILWAY_* variables (the worker already reads RAILWAY_GIT_COMMIT_SHA).
 *
 * PURE decision functions + one asserting wrapper, so scripts/prod-db-guard-test.ts can prove
 * every branch without a database.
 */

/** Hosts that are production. Used to refuse, not to warn. Single source — lib/test-db.ts imports it. */
export const PRODUCTION_HOST_MARKERS = ['supabase.com', 'supabase.co', 'pooler.supabase']

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'fairsynq-test-db', 'fairsynq-dev-db', 'fairsynq-dev-redis'])

export class ProdDbAccessRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProdDbAccessRefused'
  }
}

function parse(url: string): URL | null {
  try { return new URL(url) } catch { return null }
}

export function isProductionDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false
  const u = parse(url)
  // Unparseable: judge the raw text, so a malformed prod URL is still recognised.
  const host = (u?.hostname ?? url).toLowerCase()
  return PRODUCTION_HOST_MARKERS.some(m => host.includes(m))
}

export function isLocalHost(url: string | undefined): boolean {
  if (!url) return false
  const u = parse(url)
  return !!u && LOCAL_HOSTS.has(u.hostname.toLowerCase())
}

/**
 * The Supabase project ref a production URL belongs to, or null. Pooler URLs carry it in the
 * user name (`postgres.<ref>`); direct URLs in the host (`db.<ref>.supabase.co`).
 */
export function supabaseProjectRef(url: string | undefined): string | null {
  const u = url ? parse(url) : null
  if (!u) return null
  const user = decodeURIComponent(u.username)
  if (user.startsWith('postgres.')) return user.slice('postgres.'.length) || null
  const m = u.hostname.match(/^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/)
  return m ? m[1] : null
}

export function isDeployedRuntime(env: Record<string, string | undefined>): boolean {
  return (
    env.NODE_ENV === 'production' ||
    !!env.VERCEL ||
    !!env.RAILWAY_ENVIRONMENT_ID ||
    !!env.RAILWAY_PROJECT_ID ||
    !!env.RAILWAY_GIT_COMMIT_SHA
  )
}

export type Decision = { allowed: true } | { allowed: false; reason: string }

/** PURE — may this process connect to these database URLs? */
export function decideDatabaseAccess(
  env: Record<string, string | undefined>,
  urls: Array<string | undefined>,
): Decision {
  if (isDeployedRuntime(env)) return { allowed: true }
  const prod = urls.filter(isProductionDatabaseUrl)
  if (prod.length === 0) return { allowed: true }

  const refs = [...new Set(prod.map(u => supabaseProjectRef(u) ?? 'unknown-ref'))]
  const confirmed = env.CONFIRM_PROD_DB
  if (confirmed && refs.every(r => r === confirmed)) return { allowed: true }

  return {
    allowed: false,
    reason:
      `this local process resolved a PRODUCTION database (project ${refs.join(', ')}).\n` +
      (confirmed ? `  CONFIRM_PROD_DB is set but does not match.\n` : '') +
      `  Local development uses the Docker dev DB: npm run dev:db:up (see DEPLOYMENT.md, "Local development").\n` +
      `  For a deliberate, reviewed production operation run it through scripts/with-prod-db.sh\n` +
      `  with CONFIRM_PROD_DB=<project ref>.`,
  }
}

/** PURE — may this process use this job-queue Redis? A local process gets a local queue only. */
export function decideQueueAccess(
  env: Record<string, string | undefined>,
  redisUrl: string | undefined,
): Decision {
  if (isDeployedRuntime(env) || !redisUrl || isLocalHost(redisUrl)) return { allowed: true }
  if (env.CONFIRM_PROD_DB) return { allowed: true }
  return {
    allowed: false,
    reason:
      `this local process has a REMOTE job queue (REDIS_URL host ${parse(redisUrl)?.hostname ?? '?'}).\n` +
      `  The production queue is consumed by the Railway worker, so a local enqueue acts on live data.\n` +
      `  Use the Docker dev Redis (npm run dev:db:up), or set CONFIRM_PROD_DB for a deliberate operation.`,
  }
}

/** Throws ProdDbAccessRefused unless the database URLs are allowed for this process. */
export function assertNotProductionDatabase(
  label: string,
  urls: Array<string | undefined> = [process.env.DATABASE_URL, process.env.DIRECT_URL],
  env: Record<string, string | undefined> = process.env,
): void {
  const d = decideDatabaseAccess(env, urls)
  if (!d.allowed) throw new ProdDbAccessRefused(`🛑 [${label}] REFUSING: ${d.reason}`)
}

/** Throws ProdDbAccessRefused unless the queue Redis is allowed for this process. */
export function assertLocalQueue(
  label: string,
  redisUrl: string | undefined = process.env.REDIS_URL,
  env: Record<string, string | undefined> = process.env,
): void {
  const d = decideQueueAccess(env, redisUrl)
  if (!d.allowed) throw new ProdDbAccessRefused(`🛑 [${label}] REFUSING: ${d.reason}`)
}
