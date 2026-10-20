/**
 * CONNECT CARD TEST (readiness 1.4) — the payout-setup card for vendor, runner and organizer.
 *
 *   [1] STATES — not connected / needs info / verifying / active, from the status read.
 *   [2] WORDING — Stripe requirement descriptions in plain English ("Stripe needs: ID document").
 *   [3] POLL SCHEDULE — 3s for 30s (fresh), 15s to 5 min (fresh), then 60s cached + long-wait copy.
 *   [4] RENDER — each state server-rendered; verifying has no finish button; nothing says
 *       "Payout setup unfinished".
 *   [5] SINGLE OWNER — vendor, runner and organizer settings all render StripeConnectCard; the
 *       vendor page's duplicate is gone; all three status routes and the webhook go through
 *       lib/connect-status.
 *
 * Run:  npx tsx scripts/connect-card-state-test.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deriveConnectCardState, needsLine, plainRequirement, verifyingPoll, VERIFYING_COPY, GENERIC_NEED } from '../lib/connect-card-state'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const due = (description: string, deadline = 'currently_due') => ({ description, deadline })

console.log('[1] states')
assert(deriveConnectCardState({ connected: false, readyToReceivePayments: false }) === 'not_connected', 'no account → not_connected')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: true, dueItems: [due('x')] }) === 'active', 'transfers active → active (even with items listed)')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: false, dueItems: [due('individual.verification.document')] }) === 'needs_info', 'currently_due item → needs_info')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: false, dueItems: [due('x', 'past_due')] }) === 'needs_info', 'past_due item → needs_info')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: false, dueItems: [due('x', 'eventually_due')] }) === 'verifying', 'only eventually_due → verifying (not nagged early)')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: false, dueItems: [], onboardingComplete: true }) === 'verifying', 'onboarding done, transfers not active → verifying (the limbo case)')
assert(deriveConnectCardState({ connected: true, readyToReceivePayments: false, dueItems: [], onboardingComplete: false }) === 'needs_info', 'no entries but summary says due → needs_info')

console.log('[2] wording')
assert(plainRequirement('individual.verification.document') === 'ID document', 'verification.document → ID document')
assert(plainRequirement('individual.id_number') === 'Social Security or tax ID number', 'id_number → Social Security or tax ID number')
assert(plainRequirement('individual.dob.day') === 'date of birth', 'dob → date of birth')
assert(plainRequirement('individual.address.line1') === 'home address', 'address → home address')
assert(plainRequirement('external_account') === 'bank account for payouts', 'external_account → bank account for payouts')
assert(plainRequirement('something.never.seen') === GENERIC_NEED, `unknown → "${GENERIC_NEED}"`)
assert(needsLine([due('individual.verification.document'), due('individual.verification.additional_document'), due('individual.dob.day'), due('x', 'eventually_due')])
  === 'Stripe needs: ID document, date of birth', 'deduped, blocking only: "Stripe needs: ID document, date of birth"')
assert(needsLine([]) === 'Stripe needs: more information', 'nothing itemised → generic line')

console.log('[3] poll schedule')
assert(JSON.stringify(verifyingPoll(0)) === JSON.stringify({ delayMs: 3000, fresh: true, longWait: false }), '0s → 3s, fresh')
assert(verifyingPoll(29_999).delayMs === 3000 && verifyingPoll(30_000).delayMs === 15_000, '30s boundary → 15s')
assert(verifyingPoll(299_999).fresh === true && verifyingPoll(300_000).fresh === false, '5 min boundary → stops fresh reads')
assert(verifyingPoll(300_000).delayMs === 60_000 && verifyingPoll(300_000).longWait, 'after 5 min → 60s cached + long-wait copy')
let fresh = 0
for (let t = 0; t < 300_000; t += verifyingPoll(t).delayMs) fresh++
assert(fresh === 28, `fresh Stripe reads in the first 5 minutes = 28 (got ${fresh})`)

console.log('[4] render')
const { ConnectCardView } = await import('../app/_components/StripeConnectCard')
const html = (props: Partial<React.ComponentProps<typeof ConnectCardView>>) =>
  renderToStaticMarkup(React.createElement(ConnectCardView, { state: 'not_connected', busy: false, onStart: () => {}, description: 'Connect a Stripe account.', ...props }))
const nc = html({ state: 'not_connected' }), ni = html({ state: 'needs_info', needs: 'Stripe needs: ID document' })
const vf = html({ state: 'verifying' }), vl = html({ state: 'verifying', longWait: true }), ac = html({ state: 'active' })
assert(/Set up payouts/.test(nc) && /<button/.test(nc), 'not connected: "Set up payouts" button')
assert(/Stripe needs: ID document/.test(ni) && /Finish payout setup/.test(ni), 'needs info: the plain-English list + finish button')
assert(vf.includes(VERIFYING_COPY.title) && vf.includes(VERIFYING_COPY.body) && !/<button/.test(vf), 'verifying: "Verifying with Stripe", no button')
assert(vl.includes(VERIFYING_COPY.longWait) && !/<button/.test(vl), 'verifying (long): "Still verifying…", no button')
assert(/Payouts active/.test(ac) && !/<button/.test(ac), 'active: "Payouts active", no button')
assert(![nc, ni, vf, vl, ac].some(h => /Payout setup unfinished/.test(h)), 'no state says "Payout setup unfinished"')

console.log('[5] single owner')
const src = (p: string) => readFileSync(p, 'utf8')
for (const p of ['app/vendor/[fairSlug]/settings/page.tsx', 'app/runner/[fairSlug]/settings/page.tsx', 'app/organizer/settings/page.tsx']) {
  assert(/<StripeConnectCard/.test(src(p)), `${p} renders StripeConnectCard`)
}
const vendorSettings = src('app/vendor/[fairSlug]/settings/page.tsx')
assert(!/stripeState|applyStripeStatus|onboarding-link/.test(vendorSettings), 'vendor settings no longer carries its own Stripe state machine')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : /\.tsx?$/.test(n) && out.push(q) }
  return out
}
const stale = [...walk('app'), ...walk('components')].filter(f => /Payout setup unfinished/.test(src(f)))
assert(stale.length === 0, `"Payout setup unfinished" appears nowhere${stale.length ? ` — ${stale.join(', ')}` : ''}`)
for (const p of ['app/api/vendors/[id]/stripe/status/route.ts', 'app/api/runners/me/stripe/status/route.ts', 'app/api/organizer/stripe/status/route.ts']) {
  const s = src(p)
  assert(/payeeStatusResponse\(/.test(s) && !/stripeVerified\s*:|unstable_cache\(|getConnectStatus\(/.test(s), `${p} reads through payeeStatusResponse and writes no flag itself`)
}
const routeHelper = src('lib/connect-status-route.ts')
assert(/readPayeeConnectStatus\(/.test(routeHelper) && /'connectStatusFresh', \{ failClosed: true \}/.test(routeHelper),
  'payeeStatusResponse → readPayeeConnectStatus, fresh reads limited under connectStatusFresh (fail closed)')
const hook = src('app/api/stripe/connect-webhook/route.ts')
assert(/handleConnectWebhook\(/.test(hook) && !/stripeVerified/.test(hook), 'webhook route delegates to handleConnectWebhook and writes no flag itself')
assert(/^\s*connectStatusFresh:/m.test(src('lib/ratelimit.ts')), 'connectStatusFresh is a declared rate-limit policy')
const worker = src('workers/order-worker.ts')
assert(/JOB_PAYEE_NOTICE/.test(worker) && /JOB_CONNECT_RECHECK/.test(worker), 'the worker handles payee-notice and connect-recheck jobs')

console.log(`\n${fail === 0 ? '✅' : '❌'} connect-card: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
