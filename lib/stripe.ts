import Stripe from 'stripe'

/**
 * Lazy Stripe singleton.
 *
 * The client is instantiated on FIRST USE, not at import time. This is critical
 * for the worker process: lib/stripe is pulled in during static-import
 * resolution of the worker's module graph, which runs BEFORE the worker's
 * dotenv.config(). Reading STRIPE_SECRET_KEY at import time there yields the
 * placeholder key, silently breaking every Stripe call (e.g. queue payouts via
 * processOrderPayout). Deferring instantiation until the first property access
 * means the key is read after env is loaded, in every process.
 */
let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.warn('[Stripe] STRIPE_SECRET_KEY not set — Stripe features disabled')
  }
  _stripe = new Stripe(key ?? 'sk_test_placeholder', {
    // Pinned to the SDK's native version (stripe-node 22.x → 2026-05-27.dahlia),
    // matching lib/stripe-connect.ts. Was 2024-12-18.acacia, which warned on every
    // call (pin below the SDK's native version). The Acacia→Basil→Clover→Dahlia
    // breaking changes are all in Billing/Invoicing/Subscriptions/Issuing/Tax —
    // none touch our v1 surface (PaymentIntents auto-capture, charges, transfers
    // with source_transaction + idempotency, refunds.create).
    apiVersion: '2026-05-27.dahlia' as any,
    typescript: true,
  })
  return _stripe
}

// Proxy defers `new Stripe()` to the first property access (stripe.charges, …).
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe()
    const value = Reflect.get(client as object, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
