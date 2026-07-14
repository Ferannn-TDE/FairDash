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
  { group: 'money',    name: 'b2-runner-payout',       file: 'scripts/b2-runner-payout-test.ts' },
  { group: 'money',    name: 'b3-organizer-batch',     file: 'scripts/b3-organizer-payout-test.ts' },
  { group: 'money',    name: 'b4-tip-refund',          file: 'scripts/b4-tip-refund-test.ts' },
  { group: 'money',    name: 'refund-engine',          file: 'scripts/test-refunds.ts' },
  { group: 'money',    name: 'payout-split',           file: 'scripts/test-payout-split.ts' },

  // Boundaries — who may reach whose data. A false green here is the dangerous kind.
  { group: 'boundary', name: 'p6-admin-chokepoint',    file: 'scripts/p6-admin-fair-chokepoint-proof.ts' },
  { group: 'boundary', name: 'a6-org-killswitch',      file: 'scripts/a6-organizer-killswitch-proof.ts' },
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
  { group: 'correctness', name: 'flicker-class',          file: 'scripts/flicker-class-guard.ts' },
  { group: 'correctness', name: 'admin-dash-resilience',  file: 'scripts/admin-dashboard-resilience-guard.ts' },
]

const filter = process.argv[2]
const suites = filter ? SUITES.filter(s => s.group === filter || s.name === filter) : SUITES
if (!suites.length) {
  console.error(`No suite or group matched "${filter}".`)
  process.exit(2)
}

const failed: string[] = []
let lastGroup = ''

for (const s of suites) {
  if (s.group !== lastGroup) {
    console.log(`\n── ${s.group} ${'─'.repeat(Math.max(0, 40 - s.group.length))}`)
    lastGroup = s.group
  }
  process.stdout.write(`  ${s.name.padEnd(26)} `)

  const res = spawnSync('npx', ['tsx', s.file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  // THE VERDICT IS THE EXIT CODE. We do not parse the suite's prose for a pass count —
  // that is exactly the mistake this runner exists to make impossible.
  const ok = res.status === 0
  if (ok) {
    // Show the suite's own tally when it offers one, but it is decoration, not the verdict.
    const tally = (res.stdout ?? '').match(/(\d+) passed, 0 failed|ALL PROOFS PASS|All \d+ assertions passed|ALL PASS/)?.[0] ?? 'ok'
    console.log(`✅ ${tally}`)
  } else {
    failed.push(s.name)
    console.log(`❌ FAILED (exit ${res.status})`)
    const lines = (res.stdout ?? '').split('\n').filter(l => l.includes('❌')).slice(0, 6)
    for (const l of lines) console.log(`       ${l.trim()}`)
    if (res.stderr?.trim()) console.log(`       stderr: ${res.stderr.trim().split('\n')[0].slice(0, 120)}`)
  }
}

console.log(`\n${'═'.repeat(52)}`)
if (failed.length === 0) {
  console.log(`  ✅ ALL ${suites.length} SUITES PASS`)
} else {
  console.log(`  ❌ ${failed.length} of ${suites.length} SUITES FAILED: ${failed.join(', ')}`)
}
console.log(`${'═'.repeat(52)}\n`)

process.exit(failed.length === 0 ? 0 : 1)
