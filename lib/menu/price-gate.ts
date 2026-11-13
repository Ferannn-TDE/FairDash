// MENU PRICE GATE — which price changes need an approver (audit H5, Step 2g).
//
// THE RULE: a price that goes UP needs approval; the same price or a lower one is published by the
// vendor directly. Compared in integer cents so float noise (1.29 vs 1.2900000001) never decides
// whether a request waits for a human.
//
// Import-free on purpose: the vendor menu page and the organizer and admin review screens render
// the same summary the server computes, so this module must load in the browser too.

const toCents = (dollars: number) => Math.round(dollars * 100)

/** True only when `next` is higher than `previous` by at least one cent. */
export function priceNeedsApproval(previous: number, next: number): boolean {
  return toCents(next) > toCents(previous)
}

export interface PriceChangeSummary {
  /** The price live (or stored, for a removed item) right now. */
  current: number
  requested: number
  deltaCents: number
  /** Percent change to one decimal, or null when the current price is $0 (legacy rows). */
  pct: number | null
  direction: 'up' | 'down' | 'same'
}

/**
 * Current → requested, for the people who approve. Always computed against the price as it is
 * NOW, never a snapshot taken when the request was filed: if the vendor dropped the live price
 * while an increase was waiting, the approver sees the real jump they are agreeing to.
 */
export function priceChangeSummary(current: number, requested: number): PriceChangeSummary {
  const currentCents = toCents(current)
  const deltaCents = toCents(requested) - currentCents
  const pct = currentCents === 0 ? null : Math.round((deltaCents / currentCents) * 1000) / 10
  return {
    current,
    requested,
    deltaCents,
    pct,
    direction: deltaCents > 0 ? 'up' : deltaCents < 0 ? 'down' : 'same',
  }
}

/** "$8.00 → $9.50 (+$1.50, +18.8%)". Shared wording for every review surface. */
export function formatPriceChange(s: PriceChangeSummary): string {
  const money = (d: number) => `$${d.toFixed(2)}`
  if (s.direction === 'same') return `${money(s.current)} (no change)`
  const sign = s.deltaCents > 0 ? '+' : '−'
  const delta = `${sign}${money(Math.abs(s.deltaCents) / 100)}`
  const pct = s.pct === null ? '' : `, ${sign}${Math.abs(s.pct).toFixed(1)}%`
  return `${money(s.current)} → ${money(s.requested)} (${delta}${pct})`
}
