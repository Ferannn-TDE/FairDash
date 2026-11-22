/**
 * THE VENDOR-TIMEOUT FAQ (customer FAQ "What happens if the vendor doesn't accept my order?").
 *
 *   [1] the FAQ reads the stage 5 answer, VENDOR_TIMEOUT_ANSWER (lib/refund-copy.ts), word for word; the pre-stage 5
 *       wording ("The service fee isn't refunded") and the old "fully refunded" claim are gone
 *   [2] the minutes in the text equal VENDOR_ACCEPT_TIMEOUT_MS (the timer the accept-timeout job really uses); a
 *       planted mismatch is caught (positive control), so changing either side alone fails
 *
 * Updated with item 10 stage 5 (refunds): a timeout now returns everything, service fee included, so the answer is
 * "…you get everything back" (approved 2026-11-21, kept in lib/refund-copy.ts). Event.orderAcceptanceWindowSec is NOT
 * read by the timer.
 * Run:  npx tsx scripts/faq-timeout-copy-test.ts
 */
import { readFileSync } from 'node:fs'
import { VENDOR_ACCEPT_TIMEOUT_MS } from '../lib/constants'
import { VENDOR_TIMEOUT_ANSWER } from '../lib/refund-copy'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const APPROVED = 'If no vendor accepts within 10 minutes, your order is cancelled automatically and you get everything back.'
const faq = readFileSync('app/_components/faq-content.ts', 'utf8')

console.log('[1] Approved wording')
assert(/\{ q: "What happens if the vendor doesn't accept my order\?", a: VENDOR_TIMEOUT_ANSWER \}/.test(faq), 'the FAQ entry reads VENDOR_TIMEOUT_ANSWER')
assert(VENDOR_TIMEOUT_ANSWER === APPROVED, 'the answer is the approved stage 5 text, word for word')
assert(!/fully refunded/.test(faq) && !/The service fee isn't refunded/.test(faq), 'the old "fully refunded" claim and the pre-stage 5 wording are gone')

console.log('\n[2] The minutes match the timer')
const minutesIn = (text: string) => { const m = /within (\d+) minutes?/.exec(text); return m ? Number(m[1]) : null }
const timerMinutes = VENDOR_ACCEPT_TIMEOUT_MS / 60_000
assert(Number.isInteger(timerMinutes) && timerMinutes > 0, `the timer is a whole number of minutes (${timerMinutes})`)
assert(minutesIn(APPROVED.replace('10 minutes', `${timerMinutes + 5} minutes`)) !== timerMinutes, '[0] control: a planted mismatch would be caught')
assert(minutesIn(VENDOR_TIMEOUT_ANSWER) === timerMinutes, `the FAQ says ${minutesIn(VENDOR_TIMEOUT_ANSWER)} minutes and the timer is ${timerMinutes} minutes`)

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
