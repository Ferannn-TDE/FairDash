// NETWORK STUBS for gate suites — so no suite reaches Stripe or Clerk, on a laptop or in CI.
//
// Found 2026-11-26 by running every suite under scripts/ci/network-tripwire.mjs with the real .env.local:
//   • reverser-pattern-t, phase6-backstop → api.stripe.com (the full sweep's Pattern A paymentIntents.list and
//     Pattern F's paymentIntents.retrieve; neither suite asserts on them). Blocked, both suites FAILED.
//   • event-listing, notifications, runner-onboarding, vendor-agreement → api.clerk.com (the best-effort role sync
//     after a membership write, lib/role-sync.ts). Clerk dev answers 404 for test-only clerkIds; the error is caught.
// Without keys (CI) these paths were silently different: Pattern A/F skipped, the role sync threw before connecting.
// The stubs below make BOTH environments take the same path and return what the real services return for test
// data, with no network. Each stub counts its calls so the suite can assert it was really used.
import { stripe } from '../lib/stripe'
import { __setClerkForTest } from '../lib/role-sync'

export const stubCalls = { piList: 0, piRetrieve: 0, clerkGetUser: 0, clerkUpdate: 0 }

/**
 * Stripe reads used by the reconciliation sweep. list → an empty page (no PaymentIntent in the suites' tiny window);
 * retrieve → "No such payment_intent" (the suites' PaymentIntent ids are made up). Sets a placeholder test key when
 * none is set, so the key-gated patterns run the same way everywhere.
 */
export function stubStripeSweepReads() {
  if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = 'sk_test_stub_no_network'
  const pi = stripe.paymentIntents as any // the real client's resource object (lib/stripe's Proxy returns it)
  pi.list = async () => { stubCalls.piList++; return { object: 'list', data: [], has_more: false, url: '/v1/payment_intents' } }
  pi.retrieve = async (id: string) => {
    stubCalls.piRetrieve++
    throw Object.assign(new Error(`No such payment_intent: '${id}'`), { type: 'StripeInvalidRequestError', code: 'resource_missing', statusCode: 404 })
  }
}

/** Clerk users API used by lib/role-sync: getUser → 404 (test-only clerkIds don't exist in Clerk). */
export function stubClerkUsers() {
  __setClerkForTest({
    users: {
      getUser: async (id: string) => {
        stubCalls.clerkGetUser++
        throw Object.assign(new Error(`Not Found: user ${id}`), { status: 404, clerkError: true })
      },
      updateUserMetadata: async () => { stubCalls.clerkUpdate++; throw new Error('stub: updateUserMetadata must not be reached after a 404') },
    } as any,
  })
}
