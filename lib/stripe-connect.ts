/**
 * Stripe Connect — V2 Accounts API (Express, recipient-only).
 *
 * ONBOARDING ONLY. No charges, transfers, or payments here.
 *
 * PAYEE-AGNOSTIC: these helpers take plain strings (displayName, contactEmail,
 * accountId) and know nothing about vendors/runners/organizers. All three payee
 * types onboard through the SAME functions — only the route that calls them and
 * the column the account id is stored on differ. (Originally built for vendors;
 * Part B reuses them verbatim for runner + organizer destinations.)
 *
 * Model: separate charges & transfers (built later). Payees are V2 "recipient"
 * accounts that can receive transfers to their Stripe balance. We use the
 * Express hosted dashboard, which REQUIRES the platform to be the fees and
 * losses collector:
 *
 *   dashboard: 'express'  →  defaults.responsibilities.fees_collector   = 'application'
 *                            defaults.responsibilities.losses_collector = 'application'
 *
 * (Per the V2 create error codes: express dashboards reject 'stripe' for either
 * collector — account_controller_express_dash_without_application_losses_or_fees,
 * and a 'stripe' fees_collector alongside an 'application' losses_collector is
 * also rejected — account_controller_stripe_pricing_platform_liable. Both must
 * be 'application'.)
 *
 * Verified against live docs 2026-06-02:
 *   - create:       https://docs.stripe.com/api/v2/core/accounts/create
 *   - retrieve:     https://docs.stripe.com/api/v2/core/accounts/retrieve
 *   - account link: https://docs.stripe.com/api/v2/core/account-links/create
 *   - thin events:  parseEventNotification (renamed from parseThinEvent in
 *                   stripe-node v19) + stripe.v2.core.events.retrieve
 */

import Stripe from 'stripe'

/**
 * DEDICATED client for Connect V2 calls.
 *
 * Both this client and lib/stripe.ts now pin the same version
 * ('2026-05-27.dahlia', the stripe-node 22.x native version) — historically
 * lib/stripe.ts lagged on acacia (which didn't know the V2 account shape), which
 * is why this separate V2-capable client was introduced. They're aligned now, so
 * this client could be consolidated into lib/stripe.ts in a future cleanup; kept
 * separate for now to avoid coupling the v2.core.* surface to the v1 singleton.
 * Used for ALL v2.core.* calls (account create/retrieve, account links, event
 * parsing/retrieval).
 */
export const stripeConnect = new Stripe(
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder',
  { apiVersion: '2026-05-27.dahlia' as any, typescript: true },
)

/** ISO 3166-1 alpha-2. US-only marketplace for now. */
const ACCOUNT_COUNTRY = 'US'

/**
 * Throws a clear error (not a generic 500) when Stripe is not configured.
 * Stage-1 routes call this up front so a missing key fails loudly.
 */
export function assertStripeConfigured(): void {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || key === 'sk_test_placeholder') {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured — Stripe Connect onboarding is unavailable.',
    )
  }
}

/**
 * Creates a V2 Express recipient connected account.
 * NOTE: V2 has NO top-level `type` parameter.
 */
export async function createConnectedAccount(params: {
  displayName: string
  contactEmail?: string | null
}) {
  assertStripeConfigured()

  return stripeConnect.v2.core.accounts.create({
    display_name: params.displayName,
    ...(params.contactEmail ? { contact_email: params.contactEmail } : {}),
    identity: { country: ACCOUNT_COUNTRY },
    dashboard: 'express',
    defaults: {
      responsibilities: {
        // Required by the express dashboard — see header note. Do not set 'stripe'.
        fees_collector: 'application',
        losses_collector: 'application',
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
  })
}

export interface ConnectStatus {
  readyToReceivePayments: boolean
  onboardingComplete: boolean
  /** Raw requirements summary from Stripe, for surfacing outstanding items in the UI. */
  requirements: unknown
}

/**
 * Reads connected-account status LIVE from Stripe. This is the source of truth —
 * never a DB flag. Uncached; callers add caching where appropriate.
 */
export async function getConnectStatus(accountId: string): Promise<ConnectStatus> {
  assertStripeConfigured()

  const account = await stripeConnect.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.recipient', 'requirements'],
  })

  const transfersStatus =
    account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status
  const readyToReceivePayments = transfersStatus === 'active'

  // requirements.summary.minimum_deadline.status ∈ currently_due | eventually_due | past_due | none
  // "Complete" = nothing immediately or overdue. ('none' is fully clear; we also
  //  treat 'eventually_due' as non-blocking so the vendor isn't nagged early.)
  const reqStatus = account.requirements?.summary?.minimum_deadline?.status
  const onboardingComplete = reqStatus !== 'currently_due' && reqStatus !== 'past_due'

  return {
    readyToReceivePayments,
    onboardingComplete,
    requirements: account.requirements?.summary ?? null,
  }
}

/**
 * Creates a V2 account onboarding link for the recipient configuration.
 * Returns the hosted URL to redirect the vendor to.
 */
export async function createOnboardingLink(params: {
  accountId: string
  refreshUrl: string
  returnUrl: string
}): Promise<string> {
  assertStripeConfigured()

  const link = await stripeConnect.v2.core.accountLinks.create({
    account: params.accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['recipient'],
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
      },
    },
  })

  return link.url
}
