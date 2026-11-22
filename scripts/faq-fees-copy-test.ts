/**
 * THE FAQ FEES WORDING (block header-signin-v1, 2026-11-24).
 *
 * The FAQ quoted the service fee as "10%". It now names the fee without a figure: the customer sees
 * the amount at checkout before paying. Three answers changed (app/_components/faq-content.ts):
 *   • Customers, "What fees will I pay?": new approved wording.
 *   • Customers, "Can I cancel an order?": "10% " removed, meaning unchanged.
 *   • Vendors, "What does FairSynq take?": "10% " removed, meaning unchanged.
 *
 *   [0] positive controls: the old wording fails [1]–[3]; a planted 10% or 15% is caught; clean text passes
 *   [1] the fees answer is the approved text, word for word
 *   [2] no 10% or 15% anywhere in the customers section
 *   [3] no 10% or 15% anywhere in the vendors section; "What does FairSynq take?" is the approved text
 *   [4] the timeout and cancel answers are pinned word for word. Until item 10 stage 5 (refunds) they said the
 *       service fee is not refunded; stage 5 changed the code and these answers together, on purpose, so they
 *       are now the approved stage 5 answers in lib/refund-copy.ts (also pinned by scripts/refunds-stage5-test.ts).
 *
 * Run:  npx tsx scripts/faq-fees-copy-test.ts
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CANCEL_ANSWER, VENDOR_TIMEOUT_ANSWER } from '../lib/refund-copy'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

type Item = { q: string; a: string }
type Category = { id: string; items: Item[] }

const FEES_Q = 'What fees will I pay?'
const FEES_APPROVED = 'A service fee, shown at checkout before you pay, plus a curbside fee if you choose curbside.'
const TAKE_Q = 'What does FairSynq take?'
const TAKE_APPROVED = "No commission. Our only revenue is the customer's service fee. You do cover your share of Stripe's processing fee, the same as any card payment."
const TIMEOUT_Q = "What happens if the vendor doesn't accept my order?"
const TIMEOUT_PINNED = VENDOR_TIMEOUT_ANSWER // stage 5 (was: "... The service fee isn't refunded.")
const CANCEL_Q = 'Can I cancel an order?'
const CANCEL_PINNED = CANCEL_ANSWER // stage 5 (was: "... the service fee isn't refunded. ...")

/** A percentage figure of 10 or 15, written any common way. */
const PCT = /\b1[05]\s*(%|percent\b)/i
const hasPct = (items: Item[]) => items.some(i => PCT.test(i.q) || PCT.test(i.a))
const answer = (items: Item[], q: string) => items.find(i => i.q === q)?.a

const OLD_FEES = "A 10% service fee on your food subtotal, plus a curbside fee if you choose curbside (the service fee isn't charged on it)."
const OLD_TAKE = "No commission. Our only revenue is the customer's 10% service fee. You do cover your share of Stripe's processing fee, the same as any card payment."

console.log('[0] Positive controls')
assert(answer([{ q: FEES_Q, a: OLD_FEES }], FEES_Q) !== FEES_APPROVED && hasPct([{ q: FEES_Q, a: OLD_FEES }]), '[0] the old fees answer fails [1] and [2]')
assert(answer([{ q: TAKE_Q, a: OLD_TAKE }], TAKE_Q) !== TAKE_APPROVED && hasPct([{ q: TAKE_Q, a: OLD_TAKE }]), '[0] the old "What does FairSynq take?" answer fails [3]')
assert(hasPct([{ q: 'x', a: 'a 15 % fee' }]) && hasPct([{ q: 'x', a: 'ten is 10 percent' }]), '[0] a planted 15 % or 10 percent is caught')
assert(!hasPct([{ q: FEES_Q, a: FEES_APPROVED }, { q: 'x', a: 'within 10 minutes, 100 orders, 2015 season' }]), '[0] clean text passes (10 minutes, 100, 2015 are not percentages)')

const mod = await import(pathToFileURL(resolve('app/_components/faq-content.ts')).href) as { FAQ_CATEGORIES: Category[] }
const section = (id: string) => mod.FAQ_CATEGORIES.find(c => c.id === id)?.items ?? []
const customers = section('customers')
const vendors = section('vendors')
assert(customers.length >= 4 && vendors.length >= 4, `[0] the customers (${customers.length}) and vendors (${vendors.length}) sections were read`)

console.log('\n[1] The fees answer')
assert(answer(customers, FEES_Q) === FEES_APPROVED, `"${FEES_Q}" is the approved text, word for word`)

console.log('\n[2] Customers section')
for (const i of customers) assert(!PCT.test(i.q) && !PCT.test(i.a), `no 10% or 15% in "${i.q}"`)

console.log('\n[3] Vendors section')
for (const i of vendors) assert(!PCT.test(i.q) && !PCT.test(i.a), `no 10% or 15% in "${i.q}"`)
assert(answer(vendors, TAKE_Q) === TAKE_APPROVED, `"${TAKE_Q}" is the approved text, word for word`)

console.log('\n[4] Refund answers pinned (stage 5 approved text, lib/refund-copy.ts)')
assert(answer(customers, TIMEOUT_Q) === TIMEOUT_PINNED, `"${TIMEOUT_Q}" is the stage 5 approved answer, word for word`)
assert(answer(customers, CANCEL_Q) === CANCEL_PINNED, `"${CANCEL_Q}" is the stage 5 approved answer, word for word`)

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
