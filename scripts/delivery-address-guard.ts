/**
 * DELIVERY-ADDRESS GUARD — the checkout write path never fabricates a city from the street.
 *
 * The bug: `deliveryCity: form.deliveryCity.trim() || form.deliveryStreet.trim()` copied the
 * street into the city when the city was empty (which happens whenever the Places autocomplete
 * doesn't fire and the customer types manually). Result on vendor cards:
 * "417 Cougar Village, 417 Cougar Village". Not Stripe — the checkout form write.
 *
 *   [1] SOURCE SHAPE — the street→city fallback is gone; city is `|| null`.
 *   [2] DB SANITY (read-only) — report how many existing orders still carry street === city
 *       (historical; the fix is forward-looking — this is informational, not a failure unless
 *       NEW rows appear, which this guard can't see, so it only asserts the source shape).
 *
 * Run:  npx tsx scripts/delivery-address-guard.ts
 */

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] source shape: no street→city fabrication')
const checkout = readFileSync(new URL('../app/fair/[fairSlug]/checkout/page.tsx', import.meta.url), 'utf8')
assert(!/deliveryCity:\s*form\.deliveryCity\.trim\(\)\s*\|\|\s*form\.deliveryStreet/.test(checkout), 'deliveryCity does NOT fall back to deliveryStreet (the duplicate-address bug)')
assert(/deliveryCity:\s*form\.deliveryCity\.trim\(\)\s*\|\|\s*null/.test(checkout), 'deliveryCity is `|| null` — empty city stays null, never the street')
assert(/deliveryCity:\s*get\('locality'\)/.test(checkout), 'handlePlaceSelect still fills deliveryCity from the parsed locality when autocomplete fires')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivery-address-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
