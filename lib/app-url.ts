/**
 * THE APP'S PUBLIC BASE URL — one derivation, and it refuses to be wrong quietly.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────────────────────
 * Stripe Connect onboarding in PRODUCTION returned the payee to `localhost`. Every onboarding
 * route already threw when `NEXT_PUBLIC_APP_URL` was UNSET — so this was not the classic
 * `process.env.X ?? 'http://localhost:3000'` fallback (that shape does not exist anywhere in
 * this repo; the only `localhost:3000` in app/ or lib/ is a comment in the webhook file).
 *
 * The gap was narrower and easier to miss: the routes validated PRESENCE, never VALUE. A var
 * set to `http://localhost:3000` sails through `if (!appUrl)` and produces a syntactically
 * perfect, completely dead link. The check answered "is it configured?" when the question that
 * mattered was "is it configured CORRECTLY?".
 *
 * That is the same family as the TEST_REDIS_PREFIX bug even though the mechanism differs: a
 * plausible-looking value substituting for a correct one, with no error on either side.
 *
 * ── WHY THIS IS NOT COSMETIC ────────────────────────────────────────────────────────────────
 * This is not one person's test. EVERY vendor, runner and organizer onboarding builds its link
 * here. A payee who completes Stripe's flow and lands on a dead localhost page has no way to
 * know onboarding actually succeeded on Stripe's side — they will reasonably assume it failed,
 * and some will not come back. Stripe onboarding is the longest-lead item before the fair and
 * the one thing that cannot be compressed by working harder, so a config line silently
 * breaking it is expensive out of all proportion to its size.
 *
 * ── WHY IT FAILS LOUDLY ─────────────────────────────────────────────────────────────────────
 * A misconfigured onboarding link should throw at CONSTRUCTION, where the error names the
 * variable and the offending value, rather than sending a payee to a dead page and surfacing
 * as "onboarding is broken" days later with nothing to point at.
 *
 * NOTE ON BUILD-TIME INLINING: `NEXT_PUBLIC_*` variables are inlined by Next at BUILD time.
 * Setting the var correctly in Vercel is therefore not sufficient on its own — the app must be
 * REBUILT for the new value to take effect. A stale build is a real way for this to keep
 * failing after the config looks right.
 */

/** Hosts that can never be reachable by a Stripe-hosted redirect back to a real user. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/**
 * Is this a production runtime? Kept separate from the check itself so the rule is testable
 * without mutating NODE_ENV globally, and so a preview deploy can still use a non-https host.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production'
}

export class AppUrlMisconfigured extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppUrlMisconfigured'
  }
}

/**
 * The app's public origin, validated. THROWS rather than returning something plausible.
 *
 * Returns the origin with any trailing slash removed, so callers can append a path without
 * producing a double slash — one more thing that would otherwise be re-derived per call site.
 */
export function requireAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) {
    throw new AppUrlMisconfigured(
      'NEXT_PUBLIC_APP_URL is not configured — cannot build onboarding return URLs. ' +
      'Set it in the deployment environment AND redeploy (NEXT_PUBLIC_* is inlined at build time).',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new AppUrlMisconfigured(`NEXT_PUBLIC_APP_URL is not a valid URL: ${JSON.stringify(raw)}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppUrlMisconfigured(`NEXT_PUBLIC_APP_URL must be http(s), got ${JSON.stringify(raw)}`)
  }

  // THE CHECK THAT WAS MISSING. Loopback is legitimate in dev and never in production: a
  // Stripe-hosted page redirecting a real payee to localhost lands them on their OWN machine.
  if (isProductionRuntime(env) && LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new AppUrlMisconfigured(
      `NEXT_PUBLIC_APP_URL points at ${parsed.hostname} in PRODUCTION (${JSON.stringify(raw)}). ` +
      'Stripe would return payees to their own machine, which looks to them like onboarding failed. ' +
      'Set the public origin in the deployment environment and REDEPLOY (NEXT_PUBLIC_* is baked at build time).',
    )
  }

  return raw.replace(/\/+$/, '')
}
