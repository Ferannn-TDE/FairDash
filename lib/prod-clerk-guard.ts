/**
 * LOCAL PROCESSES NEVER TOUCH PRODUCTION CLERK USERS BY DEFAULT.
 *
 * The Clerk twin of lib/prod-db-guard.ts. Until 2026-10-19 localhost and www shared one Clerk
 * instance, so simply opening localhost:3000/onboarding wrote publicMetadata to a real user,
 * and Clerk's user.updated webhook carried it into the production database. Local development
 * gets its own Clerk application; this guard makes reusing the production one a hard error.
 *
 * THE RULE: a process that is NOT a deployed runtime refuses production Clerk keys unless
 * CONFIRM_PROD_CLERK equals the production frontend host. Production is recognised by the
 * frontend host encoded in the publishable key (PRODUCTION_CLERK_HOSTS), or any live key.
 * Deployed runtimes are exempt, with the same wide test as the database guard.
 *
 * PURE decision function + asserting wrapper, so scripts/prod-clerk-guard-test.ts can prove
 * every branch without a network.
 */

import { isDeployedRuntime, type Decision } from './prod-db-guard'

/** Frontend hosts of the Clerk instance www runs on. Update at the pk_live cutover. */
export const PRODUCTION_CLERK_HOSTS = ['noble-tahr-47.clerk.accounts.dev']

export class ProdClerkAccessRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProdClerkAccessRefused'
  }
}

/** The frontend API host a publishable key encodes (pk_<env>_<base64(host$)>), or null. */
export function clerkHostFromPublishableKey(pk: string | undefined): string | null {
  const m = pk?.trim().match(/^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/)
  if (!m) return null
  try {
    const host = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '')
    return /^[a-z0-9.-]+$/i.test(host) ? host.toLowerCase() : null
  } catch {
    return null
  }
}

/** PURE — may this process use the Clerk keys in env? */
export function decideClerkAccess(env: Record<string, string | undefined>): Decision {
  if (isDeployedRuntime(env)) return { allowed: true }
  const pk = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const sk = env.CLERK_SECRET_KEY
  const host = clerkHostFromPublishableKey(pk)
  const live = !!(pk?.startsWith('pk_live_') || sk?.startsWith('sk_live_'))
  const prodHost = host !== null && PRODUCTION_CLERK_HOSTS.includes(host)
  // A secret key whose instance can't be identified (no decodable publishable key beside it)
  // is refused: fail closed, since it may well be production's.
  const unidentified = !!sk && host === null
  if (!live && !prodHost && !unidentified) return { allowed: true }

  const label = host ?? (live ? 'a live Clerk instance' : 'a secret key with no publishable key to identify its instance')
  if (env.CONFIRM_PROD_CLERK && env.CONFIRM_PROD_CLERK === host) return { allowed: true }
  return {
    allowed: false,
    reason:
      `this local process has PRODUCTION Clerk keys (${label}).\n` +
      (env.CONFIRM_PROD_CLERK ? `  CONFIRM_PROD_CLERK is set but does not match.\n` : '') +
      `  Local development uses its own Clerk development application: set\n` +
      `  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.local to that app's keys.\n` +
      `  For a deliberate, reviewed production operation set CONFIRM_PROD_CLERK=<frontend host>.`,
  }
}

/** Throws ProdClerkAccessRefused unless the Clerk keys are allowed for this process. */
export function assertNotProductionClerk(
  label: string,
  env: Record<string, string | undefined> = process.env,
): void {
  const d = decideClerkAccess(env)
  if (!d.allowed) throw new ProdClerkAccessRefused(`🛑 [${label}] REFUSING: ${d.reason}`)
}
