/**
 * Proof runner — judges every suite by its EXIT CODE, never by grepping its output.
 *
 * WHY THIS EXISTS. A suite was reported green while 11 of its assertions were failing. The
 * suite itself was honest — it printed "10 passed, 11 failed" and exited 1 — but it was run
 * through a grep for /[0-9]+ passed/, which matched "10 passed" and threw the rest away. A
 * broken SECURITY proof (the runner boundary) sat undetected behind that false green.
 *
 * The lesson is not "grep more carefully". It is that a summariser which can turn a failing
 * run into a passing report is a false-confidence machine, and the fix has to be structural:
 * the ONLY signal here is the process exit code, which a suite cannot fake by phrasing its
 * output differently. Text is for humans; the exit code is the verdict.
 *
 * Same principle as assertPrivateBucket() and the admin grep invariant: make the safe state
 * ENFORCED, not remembered.
 *
 * Usage:
 *   npx tsx scripts/verify-all.ts            # every suite
 *   npx tsx scripts/verify-all.ts money      # only the money group
 */

import { spawnSync } from 'node:child_process'

interface Suite { group: string; name: string; file: string }

const SUITES: Suite[] = [
  // Money — the payout/refund engines and the admin money controls.
  { group: 'money',    name: 'c1-admin-money-control', file: 'scripts/c1-admin-money-control-test.ts' },
  { group: 'correctness', name: 'sweep-coverage',       file: 'scripts/mn-coverage-guard.ts' },
  { group: 'correctness', name: 'status-write-guard',   file: 'scripts/status-write-guard.ts' },
  { group: 'boundary',    name: 'test-isolation',        file: 'scripts/test-isolation-guard.ts' },
  { group: 'boundary',    name: 'protected-membership',  file: 'scripts/protected-events-membership-guard.ts' },
  // Previously UNREGISTERED and silently red — an unregistered script is one nobody runs,
  // which is exactly how both drifted onto ambient production data without anyone noticing.
  { group: 'correctness', name: 'phase6-backstop',       file: 'scripts/test-phase6-backstop.ts' },
  { group: 'boundary',    name: 'runner-onboarding',     file: 'scripts/runner-onboarding-proof.ts' },
  // Proves the soft-delete MONEY FLOOR (money/audit include archived fairs). Cited in
  // PROJECT_INVARIANTS as the proof of that invariant and never registered — the gate has
  // never run it. Surfaced by scripts/invariant-guard-refs.ts.
  { group: 'money',       name: 'archived-money-safety',  file: 'scripts/p1-archived-money-safety-test.ts' },
  { group: 'correctness', name: 'invariant-guard-refs',   file: 'scripts/invariant-guard-refs.ts' },
  { group: 'money',    name: 'b2-runner-payout',       file: 'scripts/b2-runner-payout-test.ts' },
  { group: 'money',    name: 'b3-organizer-batch',     file: 'scripts/b3-organizer-payout-test.ts' },
  { group: 'money',    name: 'b4-tip-refund',          file: 'scripts/b4-tip-refund-test.ts' },
  // refund-engine (test-refunds) is DISABLED: it writes to the REAL Italian Fest event for the
  // connected Stripe test vendors, and prod-write-guard now BLOCKS that. Re-enable once it is
  // repointed at a disposable event with test-mode-connected vendors (open item). Its coverage
  // gap is tracked; running it against prod was the third pollution incident.
  // { group: 'money',    name: 'refund-engine',          file: 'scripts/test-refunds.ts' },
  { group: 'money',    name: 'payout-split',           file: 'scripts/test-payout-split.ts' },

  // Boundaries — who may reach whose data. A false green here is the dangerous kind.
  { group: 'boundary', name: 'p6-admin-chokepoint',    file: 'scripts/p6-admin-fair-chokepoint-proof.ts' },
  { group: 'boundary', name: 'a6-org-killswitch',      file: 'scripts/a6-organizer-killswitch-proof.ts' },
  { group: 'boundary', name: 'organizer-approval-gate', file: 'scripts/organizer-approval-gate-test.ts' },
  { group: 'boundary', name: 'organizer-approval-admin', file: 'scripts/organizer-approval-admin-test.ts' },
  { group: 'boundary', name: 'organizer-admin-panel',  file: 'scripts/organizer-admin-panel-test.ts' },
  { group: 'boundary', name: 'organizer-portal-gate',  file: 'scripts/organizer-portal-gate-test.ts' },
  { group: 'boundary', name: 'runner-boundary',        file: 'scripts/runner-boundary-proof.ts' },

  // Security — the vendor-document exposure and its guards.
  { group: 'security', name: 'vendor-doc-privacy',     file: 'scripts/vendor-doc-privacy-test.ts' },
  { group: 'security', name: 'vendor-public-leak',     file: 'scripts/vendor-public-leak-test.ts' },
  { group: 'security', name: 'vendor-detail-status-gate', file: 'scripts/vendor-detail-status-gate-test.ts' },

  // Correctness — data-shape and UI-wiring invariants.
  { group: 'correctness', name: 'vendor-slug-per-fair',    file: 'scripts/vendor-slug-per-fair-test.ts' },
  { group: 'correctness', name: 'vendor-order-pagination', file: 'scripts/vendor-order-pagination-test.ts' },
  { group: 'correctness', name: 'tab-responsiveness',      file: 'scripts/tab-responsiveness-guard.ts' },
  { group: 'correctness', name: 'live-banner-debounce',    file: 'scripts/live-banner-debounce-test.ts' },
  { group: 'correctness', name: 'vendor-online-gate',      file: 'scripts/vendor-online-gate-test.ts' },
  { group: 'correctness', name: 'vendor-online-persist',   file: 'scripts/vendor-online-persist-guard.ts' },
  { group: 'correctness', name: 'vendor-status-revalidation', file: 'scripts/vendor-status-revalidation-guard.ts' },
  { group: 'correctness', name: 'admin-money-panel',      file: 'scripts/admin-money-panel-guard.ts' },
  { group: 'correctness', name: 'admin-settings',         file: 'scripts/admin-settings-test.ts' },
  { group: 'correctness', name: 'admin-reports',          file: 'scripts/admin-reports-test.ts' },
  { group: 'correctness', name: 'incoming-divergence',    file: 'scripts/incoming-divergence-guard.ts' },
  { group: 'correctness', name: 'migration-safety',       file: 'scripts/migration-safety-guard.ts' },
  { group: 'correctness', name: 'prod-write-guard',       file: 'scripts/prod-write-guard-test.ts' },
  { group: 'correctness', name: 'sweep-summary',         file: 'scripts/sweep-summary-guard.ts' },
  { group: 'correctness', name: 'vendor-vos-advance',     file: 'scripts/vendor-vos-advance-guard.ts' },
  { group: 'correctness', name: 'collect-guard',          file: 'scripts/test-collect-guard.ts' },
  { group: 'correctness', name: 'release-guard',          file: 'scripts/test-release-guard.ts' },
  { group: 'correctness', name: 'return-guard',           file: 'scripts/test-return-guard.ts' },
  { group: 'correctness', name: 'strand-guard',           file: 'scripts/test-strand-guard.ts' },
  { group: 'correctness', name: 'ghost-guard',            file: 'scripts/test-ghost-guard.ts' },
  { group: 'correctness', name: 'resolve-order',         file: 'scripts/resolve-order-guard.ts' },
  { group: 'correctness', name: 'order-log-search',      file: 'scripts/order-log-search-guard.ts' },
  { group: 'correctness', name: 'cancel-label-guard',     file: 'scripts/cancel-label-guard.ts' },
  { group: 'correctness', name: 'active-shape-guard',     file: 'scripts/active-shape-guard.ts' },
  { group: 'correctness', name: 'delivery-progress',      file: 'scripts/delivery-progress-guard.ts' },
  { group: 'correctness', name: 'delivery-address',       file: 'scripts/delivery-address-guard.ts' },
  { group: 'correctness', name: 'ready-lane-eviction',    file: 'scripts/ready-lane-eviction-guard.ts' },
  { group: 'correctness', name: 'delivered-timeline',     file: 'scripts/delivered-timeline-guard.ts' },
  { group: 'correctness', name: 'vehicle-snapshot',       file: 'scripts/vehicle-snapshot-guard.ts' },
  { group: 'correctness', name: 'profile-change',         file: 'scripts/profile-change-guard.ts' },
  { group: 'correctness', name: 'typecheck',              file: 'scripts/typecheck-gate.ts' },
  { group: 'correctness', name: 'health-guard',           file: 'scripts/test-health-guard.ts' },
  { group: 'correctness', name: 'escalation-guard',       file: 'scripts/test-escalation-guard.ts' },
  { group: 'money',       name: 'runner-earnings',        file: 'scripts/runner-earnings-guard.ts' },
  { group: 'money',       name: 'runner-fee-gate',        file: 'scripts/runner-fee-gate-guard.ts' },
  { group: 'money',       name: 'runner-completion',      file: 'scripts/runner-completion-guard.ts' },
  { group: 'correctness', name: 'runner-stats-source',    file: 'scripts/runner-stats-source-guard.ts' },
  { group: 'correctness', name: 'event-date',            file: 'scripts/event-date-guard.ts' },
  { group: 'money',       name: 'organizer-ghost',      file: 'scripts/organizer-ghost-guard.ts' },
  { group: 'money',       name: 'audit-time',            file: 'scripts/audit-time-guard.ts' },
  { group: 'correctness', name: 'live-badge',            file: 'scripts/live-badge-guard.ts' },
  { group: 'boundary',    name: 'preview-bypass',       file: 'scripts/preview-bypass-guard.ts' },
  { group: 'boundary',    name: 'fair-open-gate',      file: 'scripts/fair-open-gate-guard.ts' },
  { group: 'money',       name: 'accrual-exclusion',      file: 'scripts/accrual-exclusion-guard.ts' },
  { group: 'money',       name: 'reverser-pattern-t',     file: 'scripts/reverser-pattern-t-guard.ts' },
  { group: 'money',       name: 'double-pay-guard',       file: 'scripts/test-double-pay-guard.ts' },
  { group: 'money',       name: 'stuck-money-reader',     file: 'scripts/test-stuck-money-guard.ts' },
  { group: 'money',       name: 'x2-referral-ack',        file: 'scripts/x2-referral-ack-guard.ts' },
  { group: 'money',       name: 'payout-failure-gate',    file: 'scripts/payout-failure-gate-guard.ts' },
  { group: 'money',       name: 'money-move-sites',       file: 'scripts/money-move-sites-guard.ts' },
  { group: 'money',       name: 'stripe-error-class',      file: 'scripts/stripe-error-class-guard.ts' },
  { group: 'money',       name: 'payout-fast-fail',       file: 'scripts/payout-fast-fail-guard.ts' },
  { group: 'boundary',    name: 'connect-url',            file: 'scripts/connect-url-guard.ts' },
  { group: 'money',       name: 'transfer-linkage',       file: 'scripts/transfer-linkage-guard.ts' },
  { group: 'money',       name: 'vendor-fee-coupling',    file: 'scripts/vendor-fee-coupling-guard.ts' },
  { group: 'money',       name: 'payout-failure-marker',  file: 'scripts/payout-failure-marker-test.ts' },
  { group: 'correctness', name: 'backstop-warning',       file: 'scripts/backstop-warning-guard.ts' },
  { group: 'money',       name: 'transfer-existence',     file: 'scripts/transfer-existence-guard.ts' },
  { group: 'money',       name: 'pollution-cohort',       file: 'scripts/pollution-cohort-guard.ts' },
  { group: 'correctness', name: 'sweep-run-record',      file: 'scripts/sweep-run-record-test.ts' },
  { group: 'correctness', name: 'flicker-class',          file: 'scripts/flicker-class-guard.ts' },
  { group: 'correctness', name: 'admin-dash-resilience',  file: 'scripts/admin-dashboard-resilience-guard.ts' },
  // The clerkId/email identity collision that 500'd /onboarding in prod (2026-08-01), plus
  // the user.deleted handler that could never succeed against Order_customerId_fkey.
  { group: 'boundary',    name: 'user-identity-upsert',   file: 'scripts/user-identity-upsert-test.ts' },
  // The invariant that makes the roles[] union safe: nothing may delete a membership row, or
  // metadata would keep asserting access the gates no longer grant.
  { group: 'boundary',    name: 'membership-delete',      file: 'scripts/membership-delete-guard.ts' },
]

// ─── Tiered gate ──────────────────────────────────────────────────────────────
// The full suite is the BATCH gate (merge boundaries). Between units, run only the touched
// area's suites — a COMMITTED mapping, so "which suites for this change" is a decision in the
// repo, not a per-session judgement call that erodes when someone's in a hurry.
//   no args            → full run (batch gate)
//   --for <area>       → the unit gate for a changed area (below)
//   --group <group>    → one group (money | boundary | security | correctness)
//   <group>|<name>     → that group or single suite (back-compat)
const AREA_SUITES: Record<string, string[]> = {
  // Delivery custody / runner escape path (Commit 2). Touched-area guards + the cross-cutting
  // runner boundary + one reconcile guard (the smoke set that catches breakage they didn't mean).
  delivery: ['collect-guard', 'release-guard', 'return-guard', 'strand-guard', 'ghost-guard', 'escalation-guard', 'runner-boundary', 'reverser-pattern-t'],
  money:    ['c1-admin-money-control', 'b2-runner-payout', 'b3-organizer-batch', 'b4-tip-refund', 'payout-split', 'double-pay-guard', 'stuck-money-reader', 'accrual-exclusion', 'reverser-pattern-t', 'x2-referral-ack', 'payout-failure-gate', 'money-move-sites', 'stripe-error-class', 'payout-fast-fail', 'connect-url', 'transfer-linkage', 'vendor-fee-coupling', 'payout-failure-marker', 'transfer-existence', 'pollution-cohort', 'sweep-run-record'],
  reconcile:['backstop-warning', 'reverser-pattern-t', 'sweep-summary', 'stuck-money-reader', 'health-guard', 'incoming-divergence', 'x2-referral-ack'],
  vendor:   ['vendor-online-gate', 'vendor-online-persist', 'vendor-vos-advance', 'vendor-order-pagination', 'vendor-doc-privacy', 'vendor-public-leak', 'incoming-divergence'],
  // Runner stats surfaces (runner-facing earnings + admin roster): the custody-for-counts /
  // ledger-for-money split, the dead-column scan, the floor, and the flicker + boundary
  // cross-cuts.
  runner:   ['runner-earnings', 'runner-completion', 'runner-stats-source', 'runner-fee-gate', 'runner-boundary', 'flicker-class', 'typecheck'],
}

// ─── Network tier ─────────────────────────────────────────────────────────────
// Six suites drive real Stripe test-mode calls (~2 min each). A gate that takes 12 minutes of
// network gets run less often, and an UNRUN GATE PROTECTS NOTHING — so `--fast` skips them.
//
// ⚠️ THE BARE COMMAND IS ALWAYS THE FULL GATE. `--fast` is an explicit opt-in and nothing else
// may imply it. The discipline in this repo is "judged by exit code, full batch"; if the bare
// command silently became the fast subset, every habit built around it would become a FALSE
// GREEN BY CONVENIENCE — the same class as the grep-summariser this runner exists to replace.
const NETWORK_SUITES = new Set([
  'c1-admin-money-control', 'b2-runner-payout', 'b3-organizer-batch',
  'b4-tip-refund', 'double-pay-guard', 'refund-engine',
])

const argv = process.argv.slice(2)
const fast = argv.includes('--fast')
let suites = SUITES
if (argv[0] === '--for') {
  const area = argv[1]
  const names = AREA_SUITES[area]
  if (!names) { console.error(`Unknown --for area "${area}". Known: ${Object.keys(AREA_SUITES).join(', ')}`); process.exit(2) }
  const missing = names.filter(n => !SUITES.some(s => s.name === n))
  if (missing.length) { console.error(`--for ${area} references unregistered suites: ${missing.join(', ')}`); process.exit(2) }
  suites = SUITES.filter(s => names.includes(s.name))
} else if (argv[0] === '--group') {
  suites = SUITES.filter(s => s.group === argv[1])
} else if (argv[0] && argv[0] !== '--fast') {
  suites = SUITES.filter(s => s.group === argv[0] || s.name === argv[0])
}
if (fast) {
  const skipped = suites.filter(s => NETWORK_SUITES.has(s.name)).map(s => s.name)
  suites = suites.filter(s => !NETWORK_SUITES.has(s.name))
  console.log(`⚡ --fast: SKIPPING ${skipped.length} network suite(s): ${skipped.join(', ')}`)
  console.log('   This is NOT the batch gate. Run `npx tsx scripts/verify-all.ts` (no args) before committing.')
}
if (!suites.length) {
  console.error(`No suite or group matched "${argv.join(' ')}".`)
  process.exit(2)
}
console.log(argv.length ? `Running ${suites.length} suite(s): ${argv.join(' ')}` : `Running ALL ${suites.length} suites (batch gate)`)

// stderr lines that are known-benign NOISE, not a failure cause — filtered from the failure
// display so they can't masquerade as the reason (the "[BullMQ] REDIS_URL not set" warn is a
// graceful-degradation log that fires in PASSING runs; it cost a real diagnosis detour once).
const BENIGN_STDERR = [/REDIS_URL not set/, /delayed jobs disabled/, /Failed to parse REDIS_URL/]

const failed: string[] = []
const flaky: string[] = []
let lastGroup = ''

const runSuite = (file: string) => spawnSync('npx', ['tsx', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// The failure evidence display: the suite's own ❌ lines + the actionable stderr TAIL with
// benign noise removed — never the FIRST line, which is often a graceful-degradation warn.
function printEvidence(res: ReturnType<typeof runSuite>) {
  const lines = (res.stdout ?? '').split('\n').filter(l => l.includes('❌')).slice(0, 6)
  for (const l of lines) console.log(`       ${l.trim()}`)
  const errLines = (res.stderr ?? '').split('\n').map(l => l.trim())
    .filter(l => l && !BENIGN_STDERR.some(re => re.test(l)))
  if (errLines.length) {
    for (const l of errLines.slice(-3)) console.log(`       stderr: ${l.slice(0, 160)}`)
  } else if (res.stderr?.trim()) {
    // Only benign warns in stderr → this is NOT infra; look to the assertions above, or it's a
    // flake. Say so, so a benign warn never reads as the failure reason.
    console.log(`       stderr: (only benign warnings; not the cause — check the assertions above or re-run in isolation)`)
  }
}

for (const s of suites) {
  if (s.group !== lastGroup) {
    console.log(`\n── ${s.group} ${'─'.repeat(Math.max(0, 40 - s.group.length))}`)
    lastGroup = s.group
  }
  process.stdout.write(`  ${s.name.padEnd(26)} `)

  let res = runSuite(s.file)

  // INFRA-FLAKE RETRY. The full-run flake (documented-likely: pooler saturation under 40+
  // back-to-back suites) fails a suite that passes in isolation. One retry after a short pause
  // separates that from a real failure — but HONESTLY: a pass-on-retry is reported loudly with
  // the first run's evidence (so the flake's true cause accumulates proof instead of vanishing),
  // never silently greened. A retry that hides the first failure would be the same
  // false-confidence machine this runner exists to kill.
  let firstFail: ReturnType<typeof runSuite> | null = null
  if (res.status !== 0) {
    firstFail = res
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000) // let the pool drain
    res = runSuite(s.file)
  }

  // THE VERDICT IS THE EXIT CODE. We do not parse the suite's prose for a pass count —
  // that is exactly the mistake this runner exists to make impossible.
  const ok = res.status === 0
  if (ok && firstFail) {
    flaky.push(s.name)
    console.log(`⚠️  passed on RETRY — first run failed (exit ${firstFail.status}); its evidence:`)
    printEvidence(firstFail)
  } else if (ok) {
    // Show the suite's own tally when it offers one, but it is decoration, not the verdict.
    const tally = (res.stdout ?? '').match(/(\d+) passed, 0 failed|ALL PROOFS PASS|All \d+ assertions passed|ALL PASS/)?.[0] ?? 'ok'
    console.log(`✅ ${tally}`)
  } else {
    failed.push(s.name)
    console.log(`❌ FAILED twice (exit ${res.status}) — not a flake`)
    printEvidence(res)
  }
}

console.log(`\n${'═'.repeat(52)}`)
if (failed.length === 0) {
  console.log(`  ✅ ALL ${suites.length} SUITES PASS${fast ? ' (⚡ FAST TIER — network suites NOT run)' : ''}`)
} else {
  console.log(`  ❌ ${failed.length} of ${suites.length} SUITES FAILED: ${failed.join(', ')}`)
}
if (flaky.length) {
  // Flaky ≠ green-and-forgotten: it stays on the summary line every run until someone chases it.
  console.log(`  ⚠️  ${flaky.length} FLAKY (passed only on retry): ${flaky.join(', ')}`)
}
console.log(`${'═'.repeat(52)}\n`)

process.exit(failed.length === 0 ? 0 : 1)
