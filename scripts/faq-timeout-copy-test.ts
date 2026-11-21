/**
 * THE VENDOR-TIMEOUT FAQ (customer FAQ "What happens if the vendor doesn't accept my order?", approved 2026-11-21).
 *
 *   [1] the approved, true-today wording, word for word (the old "fully refunded" claim is gone)
 *   [2] the minutes in the text equal VENDOR_ACCEPT_TIMEOUT_MS (the timer the accept-timeout job really uses); a
 *       planted mismatch is caught (positive control), so changing either side alone fails
 *
 * Today a timeout refunds the food (service fee kept) and owed-back returns any tip and curbside fee. Stage 5 replaces
 * this answer with "…you get everything back" and must keep [2]. Event.orderAcceptanceWindowSec is NOT read by the timer.
 * Run:  npx tsx scripts/faq-timeout-copy-test.ts
 */
import { readFileSync } from 'node:fs'
import { VENDOR_ACCEPT_TIMEOUT_MS } from '../lib/constants'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const APPROVED = "If no vendor accepts your order within 10 minutes, it's cancelled automatically and you get back the food, plus any curbside fee and tip. The service fee isn't refunded."
const faq = readFileSync('app/_components/faq-content.ts', 'utf8')

console.log('[1] Approved wording')
const entry = /\{ q: "What happens if the vendor doesn't accept my order\?", a: "([^"]*)" \}/.exec(faq)
assert(!!entry, 'the FAQ entry exists')
assert(entry?.[1] === APPROVED, 'the answer is the approved text, word for word')
assert(!/fully refunded/.test(faq), 'the old "fully refunded" claim is gone')

console.log('\n[2] The minutes match the timer')
const minutesIn = (text: string) => { const m = /within (\d+) minutes?/.exec(text); return m ? Number(m[1]) : null }
const timerMinutes = VENDOR_ACCEPT_TIMEOUT_MS / 60_000
assert(Number.isInteger(timerMinutes) && timerMinutes > 0, `the timer is a whole number of minutes (${timerMinutes})`)
assert(minutesIn(APPROVED.replace('10 minutes', `${timerMinutes + 5} minutes`)) !== timerMinutes, '[0] control: a planted mismatch would be caught')
assert(minutesIn(entry?.[1] ?? '') === timerMinutes, `the FAQ says ${minutesIn(entry?.[1] ?? '')} minutes and the timer is ${timerMinutes} minutes`)

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
