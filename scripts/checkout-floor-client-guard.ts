/**
 * CHECKOUT FLOOR, CLIENT MIRROR — audit H5, Step 2b follow-up.
 *
 * POST /api/orders refuses an order whose food is $0, smaller than the estimated card fee on the
 * full charge, or whose total is under $0.50 (lib/checkout-floor.ts, scripts/checkout-floor-test.ts).
 * The checkout page now runs the SAME function on its own estimate, shows the message, and disables
 * "Continue to Payment", so the customer learns before submitting rather than after.
 *
 * The repo has no React test framework, so this reads the page as source (comments stripped) and
 * proves the wiring. Each check has a control: a planted page without that piece of wiring must
 * fail it, so a check cannot pass by matching nothing.
 *
 *   [1] imports checkoutRefusal from the shared module (no second copy of the rule)
 *   [2] feeds it the page's food subtotal and its five-term total, in cents (since audit H5 2h both
 *       come from checkoutTotals in lib/checkout-total.ts, the calculator the server charges with)
 *   [3] the total has every term the server charges: the page passes the cart lines, the markup,
 *       the money settings' fee terms, the delivery fee and the tip to checkoutTotals, and
 *       checkoutTotals adds food + service fee + delivery fee + tip + sales tax (B1.19) (no event service charge since
 *       item 10 stage 3, C-7; ported into this calculator 2026-11-23)
 *   [4] the button is disabled while there is a refusal, and the handler returns before its fetch
 *   [5] the text shown is the refusal's own message; none of the three messages is copied in
 *   [6] the page's default delivery fee equals the order route's, so the estimate matches the charge
 *
 * Pure — no database, no server. Run: npx tsx scripts/checkout-floor-client-guard.ts
 */

import { readFileSync } from 'node:fs'
import {
  ORDER_BELOW_MINIMUM_MESSAGE, ORDER_BELOW_PROCESSING_FEE_MESSAGE, ORDER_SUBTOTAL_ZERO_MESSAGE,
} from '../lib/checkout-floor'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const PAGE = 'app/fair/[fairSlug]/checkout/page.tsx'
const ROUTE = 'app/api/orders/route.ts'
const CALC = 'lib/checkout-total.ts'

// ── the checks, as functions of the page source, so each can be run on a planted page too ──────
const imports = (s: string) => /import\s*\{[^}]*\bcheckoutRefusal\b[^}]*\}\s*from\s*'@\/lib\/checkout-floor'/.test(s)
const fedFromEstimate = (s: string) =>
  /const floorRefusal = checkoutRefusal\(\{\s*subtotalCents:\s*totals\.onlineSubtotalCents,\s*totalCents:\s*totals\.totalCents,?\s*\}\)/.test(s)
/** The five inputs the page passes to checkoutTotals: lines, markup, fee terms, delivery fee, tip. */
const fiveTerms = (s: string) => {
  if (!/import\s*\{[^}]*\bcheckoutTotals\b[^}]*\}\s*from\s*'@\/lib\/checkout-total'/.test(s)) return false
  const m = s.match(/const totals = useMemo\(\(\) => checkoutTotals\(\{([\s\S]*?)\}\), \[/)
  if (!m) return false
  const args = m[1].split(',').map(t => t.trim()).filter(Boolean).sort()
  return JSON.stringify(args) === JSON.stringify([
    'deliveryFeeCents: estimatedDeliveryFeeCents', 'feeTerms', 'lines: calculatorLines', 'markupBps',
    'taxRates: fair.taxRates', 'tipCents: toCents(tipAmount)',
  ])
}
/** checkoutTotals itself adds the four terms the server charges. */
const calcAddsFiveTerms = (s: string) => {
  const m = s.match(/const totalCents = ([^\n]+)/)
  if (!m) return false
  const terms = m[1].split('+').map(t => t.trim()).sort()
  return JSON.stringify(terms) === JSON.stringify(
    ['input.deliveryFeeCents', 'input.tipCents', 'onlineSubtotalCents', 'serviceFee', 'taxCents'])
}
const buttonDisabled = (s: string) => /onClick=\{\(\) => handlePlaceOrder\(totals\.totalCents\)\}\s*disabled=\{submitting \|\| !!floorRefusal \|\| orderingPaused\}/.test(s)
/** The PRICE_CHANGED "Confirm" button is held to the same rule (added in audit H5 2h). */
const confirmDisabled = (s: string) => /onClick=\{\(\) => handlePlaceOrder\(activePriceChange\.newTotalCents\)\}\s*disabled=\{submitting \|\| !!floorRefusal \|\| orderingPaused\}/.test(s)
const handlerReturnsFirst = (s: string) => {
  const start = s.indexOf('const handlePlaceOrder = async (expectedTotalCents: number) => {')
  if (start < 0) return false
  const body = s.slice(start)
  const guard = body.indexOf('if (floorRefusal) return')
  const fetchAt = body.indexOf("fetch('/api/orders'")
  return guard > 0 && fetchAt > 0 && guard < fetchAt
}
const showsMessage = (s: string) => /\{floorRefusal && \(\s*<p role="alert"[^>]*>\s*\{floorRefusal\.message\}\s*<\/p>/.test(s)
const copiedMessages = (s: string) =>
  [ORDER_SUBTOTAL_ZERO_MESSAGE, ORDER_BELOW_PROCESSING_FEE_MESSAGE, ORDER_BELOW_MINIMUM_MESSAGE, 'too small to process online', 'at least $0.50']
    .filter(m => s.includes(m))

function main() {
  console.log('\n══ CHECKOUT FLOOR, CLIENT MIRROR (H5, Step 2b) ══')
  const raw = readSource(PAGE)
  const page = strip(raw)
  assert(/Checkout floor \(audit H5/.test(raw) && !/Checkout floor \(audit H5/.test(page), '[0] control: comment stripping works on the page')

  // A planted page: the real one with every piece of the mirror taken out again.
  const planted = page
    .replace(/import \{ checkoutRefusal \} from '@\/lib\/checkout-floor'\n/, '')
    .replace(/const floorRefusal = checkoutRefusal\(\{[\s\S]*?\}\)\n/, '')
    // replaceAll: since audit H5 2h the page has two buttons with this guard ("Continue to Payment"
    // and the PRICE_CHANGED "Confirm"); the planted page must lose it from both.
    .replaceAll(' || !!floorRefusal', '')
    .replace(/\s*if \(floorRefusal\) return/, '')
    .replace(/\{floorRefusal && \([\s\S]*?<\/p>\s*\)\}/, '')

  const checks: Array<[string, (s: string) => boolean]> = [
    ['[1] imports checkoutRefusal from @/lib/checkout-floor', imports],
    ['[2] computes floorRefusal from totals.onlineSubtotalCents and totals.totalCents', fedFromEstimate],
    ['[4] "Continue to Payment" is disabled={submitting || !!floorRefusal || orderingPaused}', buttonDisabled],
    ['[4] the PRICE_CHANGED "Confirm" button is disabled={submitting || !!floorRefusal || orderingPaused} too', confirmDisabled],
    ['[4] handlePlaceOrder returns on a refusal before its fetch to /api/orders', handlerReturnsFirst],
    ['[5] renders {floorRefusal.message} in a role="alert" paragraph', showsMessage],
  ]
  for (const [label, check] of checks) {
    assert(check(page), label)
    assert(!check(planted), `${label.slice(0, 3)} [0] control: the same check FAILS on a page without the mirror`)
  }

  assert(fiveTerms(page), '[3] the page passes exactly the cart lines, markup, fee terms, delivery fee, tip and tax rates to checkoutTotals')
  assert(!fiveTerms(page.replace(/\s*tipCents: toCents\(tipAmount\),/, '')), '[3] [0] control: a total missing the tip fails the check')
  const calc = strip(readSource(CALC))
  assert(calcAddsFiveTerms(calc), '[3] checkoutTotals adds exactly food + service fee + delivery fee + tip + tax')
  assert(!calcAddsFiveTerms(calc.replace(' + input.tipCents', '')), '[3] [0] control: a calculator total missing the tip fails the check')

  const copies = copiedMessages(page)
  assert(copies.length === 0, `[5] none of the three refusal messages is copied into the page (found: [${copies.join(' | ')}])`)
  assert(copiedMessages(`x ${ORDER_BELOW_MINIMUM_MESSAGE} y`).length > 0, '[5] [0] control: the copy scan finds a pasted message')

  // ── [6] default delivery fee parity ───────────────────────────────────────────────────────────
  const pageFee = page.match(/const configDeliveryFee = fc\?\.homeDeliveryFee \?\? ([0-9.]+)/)?.[1]
  const routeFee = strip(readSource(ROUTE)).match(/const DEFAULT_DELIVERY_FEE = ([0-9.]+)/)?.[1]
  assert(!!pageFee && !!routeFee, `[6] [0] control: both default fees were found (page ${pageFee}, route ${routeFee})`)
  assert(!!pageFee && pageFee === routeFee, `[6] the page's default delivery fee equals the route's DEFAULT_DELIVERY_FEE (${pageFee} vs ${routeFee})`)

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
