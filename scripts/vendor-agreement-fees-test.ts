/**
 * THE VENDOR AGREEMENT AGAINST THE FEE SETTINGS (item 10; retargeted 2026-11-23 at the client's Vendor Agreement
 * v2026-11-23, which replaced our planned §2 / §4(c) patch). Pure: no database, no server.
 *
 *   [1] the money settings are seeded 1500 / 0 / 399 / VENDOR (prisma/migrations/20261118120000_add_money_settings)
 *   [2] the agreement is version 2026-11-23
 *   [3] §4 says what the VENDOR setting does: Stripe's card processing on the vendor's own sales comes out of their
 *       payouts; no sign-up fee, platform fee, commission or monthly charge; the customer pays a service fee shown at
 *       checkout. A planted PLATFORM seed is caught (the agreement would then be false)
 *   [4] the agreement names no fee numbers (the client's decision: no fee numbers in legal text). The $100 liability
 *       cap in §13 is the only dollar amount allowed
 *
 * If this fails after a settings or agreement change: the agreement and the fee settings no longer agree. Changing
 * fees.cardFeesPaidBy needs a new agreement version (§4: 30 days' notice), as the settings cards say.
 * Run:  npx tsx scripts/vendor-agreement-fees-test.ts
 */
import { readFileSync } from 'node:fs'
import { VENDOR_AGREEMENT_TEXT, VENDOR_AGREEMENT_VERSION } from '../lib/legal/vendor-agreement'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const SEED_FILE = 'prisma/migrations/20261118120000_add_money_settings/migration.sql'
type Seed = Record<string, unknown>
/** The four seeded values, read from the migration's VALUES list. */
function seedValues(sql: string): Seed {
  const out: Seed = {}
  for (const m of sql.matchAll(/\('(fees\.[\w.]+)',\s*'([^']*)'::jsonb\)/g)) out[m[1]] = JSON.parse(m[2])
  return out
}
const EXPECTED: Seed = {
  'fees.serviceFee.percentBps': 1500, 'fees.serviceFee.flatCents': 0, 'fees.curbsideRunnerFeeCents': 399, 'fees.cardFeesPaidBy': 'VENDOR',
}

/** §4, the fees section, as one paragraph of plain text. */
function feesSection(text: string): string {
  const m = /### 4\. Fees\n([\s\S]*?)\n### 5\./.exec(text)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}
const VENDOR_PAYS = /Stripe's standard card processing on your own sales[^.]*is deducted from your payouts/
const NO_PLATFORM_FEES = /no sign-up fee, platform fee, commission or monthly charge/
const CUSTOMER_FEE = /The customer pays a service fee to FairSynq, which is shown at checkout/
/** What §4 must say for a given card-fee setting. Only VENDOR is written today. */
const agreementMatches = (cardFeesPaidBy: unknown, s4: string) =>
  cardFeesPaidBy === 'VENDOR' && VENDOR_PAYS.test(s4) && NO_PLATFORM_FEES.test(s4) && CUSTOMER_FEE.test(s4)

/** Fee numbers: any percentage, any cents amount, or a dollar amount other than the §13 $100 cap. */
function feeNumbers(text: string): string[] {
  const hits = [...text.matchAll(/\d+(?:\.\d+)?\s?%|\d+\s?¢|\$\d[\d,]*(?:\.\d+)?/g)].map(m => m[0])
  return hits.filter(h => h !== '$100')
}

const sql = readFileSync(SEED_FILE, 'utf8')
const seed = seedValues(sql)
const s4 = feesSection(VENDOR_AGREEMENT_TEXT)

console.log('[0] Controls')
assert(Object.keys(seed).length === 4, `the seed parser finds the four money rows (${Object.keys(seed).length})`)
assert(s4.length > 100 && s4.startsWith('You currently pay FairSynq'), 'the §4 extractor finds the Fees section')
assert(feeNumbers('a 15% fee, 30¢, $3.99 and the $100 cap').join() === '15%,30¢,$3.99', 'the fee-number scan finds 15%, 30¢ and $3.99 and allows only $100')

console.log('\n[1] Seeded money settings')
assert(JSON.stringify(seed) === JSON.stringify(EXPECTED), `seeded 1500 / 0 / 399 / VENDOR (got ${JSON.stringify(seed)})`)

console.log('\n[2] Agreement version')
assert(VENDOR_AGREEMENT_VERSION === '2026-11-23', `the Vendor Agreement is version 2026-11-23 (got ${VENDOR_AGREEMENT_VERSION})`)

console.log('\n[3] §4 matches the card-fee setting')
assert(agreementMatches(seed['fees.cardFeesPaidBy'], s4), '§4: vendors pay Stripe card processing on their own sales out of payouts, pay FairSynq nothing, and the customer pays the service fee')
assert(!agreementMatches('PLATFORM', s4), '[0] control: with card fees set to PLATFORM, §4 would no longer match (caught)')
assert(!agreementMatches('VENDOR', s4.replace('is deducted from your payouts', 'is paid by FairSynq')), '[0] control: a §4 that stops charging vendors is caught')

console.log('\n[4] No fee numbers in the agreement')
const nums = feeNumbers(VENDOR_AGREEMENT_TEXT)
assert(nums.length === 0, `no percentages, cents or dollar amounts besides the $100 liability cap (found: ${nums.join(', ') || 'none'})`)
assert(feeNumbers(VENDOR_AGREEMENT_TEXT.replace('pays a service fee to FairSynq', 'pays a 15% service fee to FairSynq')).length === 1, '[0] control: a planted "15%" in the agreement is caught')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
