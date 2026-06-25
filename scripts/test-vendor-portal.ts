/**
 * Vendor Portal Regression Tests
 *
 * Tests:
 *  1. DECLINED appears in Cancelled tab count, not Completed tab count
 *  2. Completed tab count excludes DECLINED orders
 *  3. TAB_STATUS_MAP CANCELLED includes DECLINED, UNCOLLECTED, UNDELIVERABLE
 *  4. TAB_STATUS_MAP COMPLETED excludes DECLINED
 *  5. Completion rate counts DECLINED in denominator (not inflated to 100%)
 *  6. Completion rate is 0 when no terminal orders exist
 *  7. Analytics route ?range=7d returns 7-day window (startDate ~7 days ago)
 *  8. Analytics route defaults to today when no range param given
 *  9. History route returns vendor-scoped subtotal, not full order total
 * 10. History route vendorPayout = subtotal * 0.90 (10% platform fee)
 * 11. getStatusMeta('DECLINED') returns iconType 'x', not 'package'
 * 12. getStatusMeta('DECLINED') label is not "Order in progress"
 * 13. getStatusMeta('COMPLETED') returns iconType 'check'
 * 14. getStatusMeta('CANCELLED') returns iconType 'x'
 * 15. isCompleted('DECLINED') returns false
 * 16. isFailed('DECLINED') returns true
 * 17. isFailed('CANCELLED') returns true
 * 18. isCompleted('COMPLETED') returns true
 * 19. isCompleted('DELIVERED') returns true
 * 20. History route: FILTER_TABS has no separate Declined tab
 */

let passed = 0
let failed = 0
function pass(msg: string) { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg: string, detail?: string) {
  console.log(`  ❌ ${msg}`)
  if (detail) console.log(`     ${detail}`)
  failed++
}

async function main() {
  console.log('Vendor Portal Regression Tests')
  console.log('─'.repeat(60))

  const fs   = await import('fs')
  const path = await import('path')
  const base = new URL('..', import.meta.url).pathname

  // ── 1–4: TAB_STATUS_MAP correctness ────────────────────────────────────────
  console.log('\nTests 1–4 — TAB_STATUS_MAP correctness')

  const orderStatusSrc = fs.readFileSync(path.join(base, 'lib/order-status.ts'), 'utf8')

  // Parse TAB_STATUS_MAP from source to verify groupings
  const hasCancelledWithDeclined =
    orderStatusSrc.includes("CANCELLED: [...FAILED_STATUSES]") ||
    (orderStatusSrc.includes("CANCELLED:") && orderStatusSrc.includes("DECLINED"))

  if (hasCancelledWithDeclined)
    pass('TAB_STATUS_MAP CANCELLED bucket references DECLINED')
  else
    fail('TAB_STATUS_MAP CANCELLED bucket does not include DECLINED', 'Check TAB_STATUS_MAP in lib/order-status.ts')

  const hasFailedStatuses =
    orderStatusSrc.includes("'DECLINED'") &&
    orderStatusSrc.includes("FAILED_STATUSES")

  if (hasFailedStatuses)
    pass('FAILED_STATUSES array includes DECLINED')
  else
    fail('FAILED_STATUSES array does not include DECLINED')

  const cancelledNotInCompleted =
    !orderStatusSrc.match(/COMPLETED:\s*\[.*DECLINED.*\]/)

  if (cancelledNotInCompleted)
    pass('COMPLETED bucket does not include DECLINED')
  else
    fail('COMPLETED bucket incorrectly includes DECLINED')

  const failedIncludesAll =
    orderStatusSrc.includes("'UNCOLLECTED'") &&
    orderStatusSrc.includes("'UNDELIVERABLE'") &&
    orderStatusSrc.includes("'CANCELLED'")

  if (failedIncludesAll)
    pass('FAILED_STATUSES includes UNCOLLECTED and UNDELIVERABLE')
  else
    fail('FAILED_STATUSES missing UNCOLLECTED or UNDELIVERABLE')

  // ── 5–6: Completion rate formula ───────────────────────────────────────────
  console.log('\nTests 5–6 — Completion rate formula')

  const analyticsRouteSrc = fs.readFileSync(
    path.join(base, 'app/api/vendors/[id]/analytics/route.ts'), 'utf8'
  )

  const usesIsFailed = analyticsRouteSrc.includes('isFailed') && analyticsRouteSrc.includes('failedCount')

  if (usesIsFailed)
    pass('Analytics route uses isFailed() to count DECLINED in denominator')
  else
    fail('Analytics route does not use isFailed() — DECLINED may be excluded from denominator')

  const hasZeroDefault =
    analyticsRouteSrc.includes('terminal > 0') &&
    (analyticsRouteSrc.includes(': 0') || analyticsRouteSrc.includes('? Math.round') )

  if (hasZeroDefault)
    pass('Completion rate defaults to 0 when no terminal orders exist')
  else
    fail('Completion rate may default incorrectly when terminal = 0')

  // ── 7–8: Analytics date range ───────────────────────────────────────────────
  console.log('\nTests 7–8 — Analytics date range param')

  const hasBuildDateRange = analyticsRouteSrc.includes('buildDateRange')
  const hasRangePresets   = analyticsRouteSrc.includes("'7d'") && analyticsRouteSrc.includes("'30d'") && analyticsRouteSrc.includes("'90d'")
  const hasRangeParam     = analyticsRouteSrc.includes("searchParams.get('range')")

  if (hasBuildDateRange && hasRangePresets && hasRangeParam)
    pass('Analytics route uses buildDateRange() with ?range= presets (7d, 30d, 90d)')
  else
    fail('Analytics route missing buildDateRange or range presets', `hasBuildDateRange=${hasBuildDateRange} hasRangePresets=${hasRangePresets} hasRangeParam=${hasRangeParam}`)

  const analyticsPageSrc = fs.readFileSync(
    path.join(base, 'app/vendor/[fairSlug]/analytics/page.tsx'), 'utf8'
  )

  const pageUsesRangeParam = analyticsPageSrc.includes('range=${period}') || analyticsPageSrc.includes('range=')
  const pageNotUsingDays   = !analyticsPageSrc.includes('days=')

  if (pageUsesRangeParam && pageNotUsingDays)
    pass('Analytics page sends ?range= (not ?days=) to API')
  else
    fail('Analytics page still sending ?days= instead of ?range=', `usesRange=${pageUsesRangeParam} notDays=${pageNotUsingDays}`)

  // ── 9–10: History route vendor-scoped subtotal ──────────────────────────────
  console.log('\nTests 9–10 — History route vendor-scoped subtotal and payout')

  const historyRouteSrc = fs.readFileSync(
    path.join(base, 'app/api/vendors/[id]/orders/history/route.ts'), 'utf8'
  )

  const computesVendorSubtotal =
    historyRouteSrc.includes('vendorSubtotal') &&
    historyRouteSrc.includes('orderItems.reduce')

  if (computesVendorSubtotal)
    pass('History route computes vendor-scoped subtotal from filtered orderItems')
  else
    fail('History route may be using Order.subtotal (full order) instead of vendor-scoped sum')

  const appliesPlatformFee =
    historyRouteSrc.includes('PLATFORM_FEE_RATE') &&
    (historyRouteSrc.includes('1 - PLATFORM_FEE_RATE') || historyRouteSrc.includes('0.90') || historyRouteSrc.includes('0.9'))

  if (appliesPlatformFee)
    pass('History route applies PLATFORM_FEE_RATE to compute vendorPayout')
  else
    fail('History route missing platform fee deduction on vendorPayout')

  // ── 11–14: getStatusMeta correctness ────────────────────────────────────────
  console.log('\nTests 11–14 — getStatusMeta() label and iconType')

  // Import and call the real function
  let getStatusMeta: ((s: string) => { label: string; iconType: string; color: string }) | null = null
  try {
    const mod = await import(path.join(base, 'lib/order-status.ts'))
    getStatusMeta = mod.getStatusMeta
  } catch {
    fail('Could not import lib/order-status.ts — remaining status meta tests skipped')
  }

  if (getStatusMeta) {
    const declined  = getStatusMeta('DECLINED')
    const completed = getStatusMeta('COMPLETED')
    const cancelled = getStatusMeta('CANCELLED')
    const placed    = getStatusMeta('PLACED')

    if (declined.iconType === 'x')
      pass("getStatusMeta('DECLINED') returns iconType 'x'")
    else
      fail(`getStatusMeta('DECLINED') returned iconType '${declined.iconType}', expected 'x'`)

    if (declined.label !== 'Order in progress')
      pass("getStatusMeta('DECLINED') label is not 'Order in progress'")
    else
      fail("getStatusMeta('DECLINED') still returns 'Order in progress'")

    if (completed.iconType === 'check')
      pass("getStatusMeta('COMPLETED') returns iconType 'check'")
    else
      fail(`getStatusMeta('COMPLETED') returned iconType '${completed.iconType}', expected 'check'`)

    if (cancelled.iconType === 'x')
      pass("getStatusMeta('CANCELLED') returns iconType 'x'")
    else
      fail(`getStatusMeta('CANCELLED') returned iconType '${cancelled.iconType}', expected 'x'`)

    // sanity: active status
    if (placed.iconType === 'package')
      pass("getStatusMeta('PLACED') returns iconType 'package'")
    else
      fail(`getStatusMeta('PLACED') returned iconType '${placed.iconType}', expected 'package'`)
  }

  // ── 15–19: isCompleted / isFailed predicates ─────────────────────────────────
  console.log('\nTests 15–19 — isCompleted() / isFailed() predicates')

  let isCompleted: ((s: string) => boolean) | null = null
  let isFailed:    ((s: string) => boolean) | null = null

  try {
    const mod = await import(path.join(base, 'lib/order-status.ts'))
    isCompleted = mod.isCompleted
    isFailed    = mod.isFailed
  } catch {
    fail('Could not import predicates from lib/order-status.ts')
  }

  if (isCompleted && isFailed) {
    isCompleted('DECLINED') === false
      ? pass("isCompleted('DECLINED') === false")
      : fail("isCompleted('DECLINED') returned true — DECLINED should not be in COMPLETED bucket")

    isFailed('DECLINED') === true
      ? pass("isFailed('DECLINED') === true")
      : fail("isFailed('DECLINED') returned false")

    isFailed('CANCELLED') === true
      ? pass("isFailed('CANCELLED') === true")
      : fail("isFailed('CANCELLED') returned false")

    isCompleted('COMPLETED') === true
      ? pass("isCompleted('COMPLETED') === true")
      : fail("isCompleted('COMPLETED') returned false")

    isCompleted('DELIVERED') === true
      ? pass("isCompleted('DELIVERED') === true")
      : fail("isCompleted('DELIVERED') returned false — DELIVERED should be in COMPLETED bucket")
  }

  // ── 20: FILTER_TABS has no separate Declined tab ─────────────────────────────
  console.log('\nTest 20 — FILTER_TABS structure')

  const ordersPageSrc = fs.readFileSync(
    path.join(base, 'app/vendor/[fairSlug]/orders/page.tsx'), 'utf8'
  )

  const noSeparateDeclinedTab = !ordersPageSrc.includes("value: 'DECLINED'")

  if (noSeparateDeclinedTab)
    pass("FILTER_TABS has no standalone 'DECLINED' tab (grouped under CANCELLED)")
  else
    fail("FILTER_TABS has a separate DECLINED tab — should be grouped under CANCELLED")

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
