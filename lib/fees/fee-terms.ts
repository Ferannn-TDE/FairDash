// The customer-visible fee terms for the fair payload (item 10 / B1.13 stage 3, S3-Q4).
//
// Read with their OWN uncached query (getMoneySettings) and merged into the cached fair payload,
// so only the fee terms bypass the cache. null = the money settings can't be read: the checkout
// shows "Ordering is paused, please try again shortly" (POST /api/orders refuses with 503 anyway).
// The card-fee setting is deliberately not included: the customer never sees it.
import { getMoneySettings, MoneySettingsUnavailable } from '@/lib/settings'
import type { CustomerFeeTerms } from '@/lib/checkout-total'

export async function getCustomerFeeTerms(): Promise<CustomerFeeTerms | null> {
  try {
    const m = await getMoneySettings()
    return { serviceFeeBps: m.serviceFeeBps, serviceFeeFlatCents: m.serviceFeeFlatCents, curbsideRunnerFeeCents: m.curbsideRunnerFeeCents }
  } catch (err) {
    if (err instanceof MoneySettingsUnavailable) return null
    throw err
  }
}
