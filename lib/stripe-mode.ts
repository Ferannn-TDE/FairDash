// IS THIS SITE TAKING REAL MONEY? (Jordan, Nov 16; demo flag, sub-step D)
//
// The one answer every demo-vendor rule asks (lib/demo-vendor.ts). FAILS CLOSED: only a Stripe
// TEST key (sk_test_… or a restricted rk_test_…) means test mode. Anything else counts as LIVE —
// an sk_live_ or rk_live_ key, an unknown key shape, and a missing key — so a demo booth can never
// take a real order or show to real customers because the key was unexpected.
//
// Read on every call (not cached at import), so a deploy's environment is what decides.
// Import-free, so pages, routes and tests can all share it.

export function stripeLiveMode(key: string | undefined = process.env.STRIPE_SECRET_KEY): boolean {
  const k = (key ?? '').trim()
  return !(k.startsWith('sk_test_') || k.startsWith('rk_test_'))
}
