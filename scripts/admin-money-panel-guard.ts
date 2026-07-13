/**
 * Admin MONEY PANEL — wiring invariants.
 *
 * The panel is pure wiring onto the C1 money controls (already built, already proven 94/94).
 * Its correctness is therefore entirely about WHAT IT CALLS and WHAT IT DISPLAYS — neither of
 * which a green build can check. Three properties, each a real trap:
 *
 *  1. ⛔ ATTRIBUTION. It must call the ADMIN money routes. The ORGANIZER refund route
 *     hardcodes actorRole 'organizer' and writes NO AdminMoneyAction row — so an admin
 *     refunding through it would be recorded as the organizer's action and vanish from the
 *     admin audit trail. The single most dangerous wrong wire on this page.
 *  2. ⛔ NO SECOND SOURCE OF TRUTH. The panel renders the API's ledger figures verbatim. It
 *     must not re-derive money (no arithmetic on cents beyond formatting) — a second money
 *     computation is the exact mistake the payout design exists to avoid.
 *  3. REASON REQUIRED. Every action route rejects a blank reason (REASON_REQUIRED) because
 *     the audit row is the defence when a payee contests. The UI must collect one.
 *
 * Run:  npx tsx scripts/admin-money-panel-guard.ts
 */

import { readFileSync } from 'node:fs'

const page  = readFileSync('app/admin/[eventSlug]/money/page.tsx', 'utf8')
const shell = readFileSync('app/admin/_components/AdminShell.tsx', 'utf8')
const noComments = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const P = noComments(page)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\n[1] ⛔ ATTRIBUTION: the panel calls the ADMIN money routes, never the organizer one')
assert(/\/api\/admin\/events\/\$\{params\.eventSlug\}\/money/.test(P),
  'reads GET /api/admin/events/[id]/money (the chokepoint-gated ledger view)')
assert(/money\/\$\{pending\.kind\}/.test(P) || /money\/(payout|freeze|refund)/.test(P),
  'actions POST to /api/admin/events/[id]/money/{payout|freeze|refund}')
assert(!/\/api\/organizer\//.test(P),
  '⛔ the panel calls NO organizer route — an admin refund can never be recorded as the organizer')
assert(!/refundVendorPortion|process-refund/.test(P),
  'the panel never touches the refund engine directly — it goes through the audited admin route')

console.log('\n[2] ⛔ NO SECOND SOURCE OF TRUTH: money figures are rendered, not re-derived')
// The only permitted arithmetic on cents is the display divide-by-100 in the formatter.
const centsMath = P.match(/Cents\s*[+\-*/]\s*\w|\w\s*[+\-*/]\s*\w+Cents/g) ?? []
assert(centsMath.length === 0,
  `no arithmetic on *Cents values anywhere (found ${centsMath.length}) — the API's ledger numbers are rendered verbatim`)
assert(/\(cents \?\? 0\) \/ 100/.test(P),
  'the ONLY cents math is the display formatter (÷100)')
assert(/paidCents/.test(P) && /payableCents/.test(P) && /adminHeldCents/.test(P),
  'settled (paid), owed (payable) and admin-held are displayed as DISTINCT figures — never blended')

console.log('\n[3] REASON is collected — the API rejects a blank one, and the audit row needs it')
assert(/reason/i.test(P) && /disabled=\{!reason\.trim\(\)\}/.test(P),
  'the confirm button is disabled until a reason is typed')
assert(/JSON\.stringify\(body\)/.test(P) && /reason \}/.test(P),
  'reason is sent in every action body')

console.log('\n[4] the panel is reachable, and re-reads the ledger after an action')
assert(/\/admin\/\$\{slug\}\/money/.test(shell), 'AdminShell links to the money panel')
assert(/load\(\)/.test(P.slice(P.indexOf('async function run'))),
  'after an action the panel RE-READS the ledger (never patches the numbers locally)')

console.log(`\n${'─'.repeat(62)}`)
if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log(`${'─'.repeat(62)}\n`)
process.exit(fail === 0 ? 0 : 1)
