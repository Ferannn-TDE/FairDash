// What the approver sees for a request's price: CURRENT → REQUESTED (audit H5, Step 2g).
//
// "Current" is read at review time from the item itself (its live price, or for a removed item its
// last recorded price), never a snapshot from when the request was filed. If the vendor lowered
// the live price while an increase waited, the approver sees the jump they would actually approve.

import { priceChangeSummary, type PriceChangeSummary } from '../menu/price-gate'

interface ReviewRow {
  type: 'ADD' | 'EDIT' | 'DELETE' | 'RESTORE'
  price: number | null
  menuItem: { price: number } | null
}

/** Null when the request carries no price change to show (ADD, DELETE, or no price). */
export function reviewPriceChange(r: ReviewRow): PriceChangeSummary | null {
  if ((r.type !== 'EDIT' && r.type !== 'RESTORE') || r.price === null || !r.menuItem) return null
  return priceChangeSummary(r.menuItem.price, r.price)
}
