// VENDOR APPROVAL NEEDS STRIPE PAYOUTS (Jordan, Nov 16, locked decision 1).
//
// A vendor may be approved only when their Stripe Connect account is linked AND Stripe reports
// payouts enabled. Checked on the server in every approval path (lib/approvals.ts), by asking
// Stripe FRESH at approval time; the stored Vendor.stripeVerified flag is not enough on its own,
// because it means "can receive transfers" (stripe_transfers), not "payouts enabled".
//
//   demo booth (Vendor.isDemo)           → ok, Stripe not asked (lib/demo-vendor.ts)
//   no stripeAccountId                   → refused, VENDOR_STRIPE_NOT_LINKED
//   Stripe can't find that account       → refused, VENDOR_STRIPE_NOT_LINKED
//   transfers or payouts not active      → refused, VENDOR_PAYOUTS_NOT_ENABLED
//   Stripe unreachable / not configured  → 503 STRIPE_CHECK_FAILED, nothing changes (fails closed)
//   both active                          → ok
//
// The fresh result is also handed to applyConnectStatus (the ONE writer of stripeVerified), so
// the stored flag catches up with Stripe as a side effect. That write never blocks the decision.
//
// Runs BEFORE the decision's transaction: a network call never sits inside a database transaction.

import { ApiError } from './api-error'
import { getConnectStatus } from './stripe-connect'
import { applyConnectStatus } from './connect-status'
import { logger } from './logger'

export interface PayoutsStatus { readyToReceivePayments: boolean; payoutsEnabled: boolean }
type GetStatus = (accountId: string) => Promise<PayoutsStatus>

let _testGetStatus: GetStatus | null = null
/** Test seam: route every Stripe status read here (null restores the real Stripe call). */
export function __setStripePayoutsStatusForTest(fake: GetStatus | null) { _testGetStatus = fake }

export interface PayoutsVendor { id: string; name: string; stripeAccountId: string | null; isDemo?: boolean }

export type PayoutsRefusalCode = 'VENDOR_STRIPE_NOT_LINKED' | 'VENDOR_PAYOUTS_NOT_ENABLED'
export type PayoutsCheck = { ok: true } | { ok: false; code: PayoutsRefusalCode; message: string }

export const notLinkedMessage = (name: string) =>
  `${name} can't be approved yet: they haven't linked a Stripe account for payouts. Ask them to finish "Connect payouts" in their vendor settings.`
export const notEnabledMessage = (name: string) =>
  `${name} can't be approved yet: Stripe hasn't enabled payouts on their account. They need to finish Stripe's setup (Connect payouts).`
export const STRIPE_CHECK_FAILED_MESSAGE = "Couldn't check Stripe just now. Nothing was changed; try again."

function isMissingAccount(err: unknown): boolean {
  const e = err as { code?: unknown; statusCode?: unknown } | null
  return e?.code === 'resource_missing' || e?.statusCode === 404
}

/**
 * Is this vendor's Stripe account linked with payouts enabled? Returns a refusal (409 material)
 * or ok; THROWS 503 STRIPE_CHECK_FAILED when Stripe can't be asked.
 */
export async function checkVendorPayouts(vendor: PayoutsVendor): Promise<PayoutsCheck> {
  // A demo booth skips this check (Jordan, Nov 16; lib/demo-vendor.ts): it can never take real
  // money (checkout refuses it with live keys), so there are no payouts to check. Stripe is not asked.
  if (vendor.isDemo) return { ok: true }
  const accountId = vendor.stripeAccountId?.trim()
  if (!accountId) return { ok: false, code: 'VENDOR_STRIPE_NOT_LINKED', message: notLinkedMessage(vendor.name) }

  let status: PayoutsStatus
  try {
    status = _testGetStatus ? await _testGetStatus(accountId) : await getConnectStatus(accountId)
  } catch (err) {
    if (isMissingAccount(err)) {
      logger.warn('[VendorPayoutsCheck] Stripe account on file not found', { vendorId: vendor.id })
      return { ok: false, code: 'VENDOR_STRIPE_NOT_LINKED', message: notLinkedMessage(vendor.name) }
    }
    logger.error('[VendorPayoutsCheck] Stripe status read failed — approval refused', { vendorId: vendor.id, error: String(err) })
    throw new ApiError(STRIPE_CHECK_FAILED_MESSAGE, 503, 'STRIPE_CHECK_FAILED')
  }

  // Keep the stored flag in step with what Stripe just said (the one writer; conditional, idempotent).
  await applyConnectStatus('vendor', vendor.id, status.readyToReceivePayments, { source: 'status' })
    .catch(err => logger.error('[VendorPayoutsCheck] stored-flag update failed', { vendorId: vendor.id, error: String(err) }))

  if (status.readyToReceivePayments && status.payoutsEnabled) return { ok: true }
  return { ok: false, code: 'VENDOR_PAYOUTS_NOT_ENABLED', message: notEnabledMessage(vendor.name) }
}
