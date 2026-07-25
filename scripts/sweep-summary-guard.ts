/**
 * Sweep-summary guard (Q5) — a clean sweep can never again be misread as zero.
 *
 * The incident: the reconciler's summary was logger.info, which is a HARD NO-OP in production
 * (logger.ts: `if (!isDev) return`), so a sweep that changed the ledger logged nothing visible
 * while money moved silently. This guard proves the fix WITHOUT running a sweep or touching the
 * DB: the summary is an unconditional flat line routed through logger.warn (prod-visible), it
 * states repaired=0 explicitly (so silence is a real zero), and the silent accrual path now
 * emits a ledger-delta.
 *
 * Run:  npx tsx scripts/sweep-summary-guard.ts
 */

import { readFileSync } from 'node:fs'
import { formatSweepSummary, type SweepSummary, type LedgerBreakdown } from '../lib/reconciler'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

function mkSum(repaired: Partial<SweepSummary['repaired']>, extra: Partial<SweepSummary> = {}): SweepSummary {
  const zero = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 }
  return {
    startedAt: '', finishedAt: '', durationMs: 42, dryRun: false, patternEEnabled: false, backstopEnabled: false,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { ...zero, ...repaired }, details: {} as SweepSummary['details'],
    alerted: [], ambiguousSkipped: 0, backstopWarnings: [], ...extra,
  }
}

// Build a ledger breakdown from per-event rows; `all` is the roll-up (what the OLD global line showed).
function mkLedger(rows: { name: string; pay: number; paid?: number; canc?: number }[], readable = true): LedgerBreakdown {
  const all = { payableCents: 0, paidCents: 0, cancelledCents: 0 }
  const byEvent = rows.map((e, i) => {
    const t = { payableCents: e.pay, paidCents: e.paid ?? 0, cancelledCents: e.canc ?? 0 }
    all.payableCents += t.payableCents; all.paidCents += t.paidCents; all.cancelledCents += t.cancelledCents
    return { eventId: `ev${i}`, name: e.name, ...t }
  })
  return { all, byEvent, readable }
}

function main() {
  // ── [1] the summary is UNCONDITIONAL — a clean sweep says repaired=0 explicitly ──
  console.log('[1] formatSweepSummary — silence is an explicit zero, never absent')
  const clean = formatSweepSummary(mkSum({}), mkLedger([{ name: 'Italian Fest', pay: 34000 }]))
  assert(clean.includes('[Reconciler] SUMMARY'), 'has the greppable [Reconciler] SUMMARY anchor')
  assert(clean.includes('repaired=0'), 'a clean sweep states repaired=0 (unmissable, not silence)')
  assert(clean.includes('payable=$340.00') && clean.includes('[all-events]'), 'carries the rolled-up payable, labeled [all-events]')

  // ── [1b] PER-EVENT — a watch on ONE fair stays correct once a SECOND fair accrues ──
  // This is the whole point: the global figure stops equalling any single panel the moment
  // >1 event has a ledger, so the per-event line must carry each fair's own numbers.
  console.log('\n[1b] per-event: the global figure diverges from any one fair, but the per-fair line stays greppable')
  const twoFairs = formatSweepSummary(mkSum({}), mkLedger([{ name: 'Italian Fest', pay: 34000 }, { name: 'Second Fair', pay: 5000 }]))
  assert(twoFairs.includes('payable=$390.00') && twoFairs.includes('[all-events]'), 'the global roll-up is $390.00 (both fairs) — no longer equal to Italian Fest alone')
  assert(twoFairs.includes('Italian Fest(pay=$340.00'), 'the Italian Fest per-event line still reads $340.00 — the watch survives a second fair')
  assert(twoFairs.includes('Second Fair(pay=$50.00'), 'the second fair is broken out separately, not folded into a global blur')

  // ── [1c] the summary carries the WHOLE ledger — paid and cancelled, not only payable ──
  console.log('\n[1c] payable AND paid AND cancelled — both sides of every move are visible')
  const whole = formatSweepSummary(mkSum({}), mkLedger([{ name: 'F', pay: 10000, paid: 20000, canc: 3000 }]))
  assert(whole.includes('payable=$100.00') && whole.includes('paid=$200.00') && whole.includes('cancelled=$30.00'),
    'the roll-up carries payable/paid/cancelled; a payout draining payable into paid is now visible in one line')

  // ── [2] a repair is loud and per-pattern ───────────────────────────────────────
  console.log('\n[2] a repair shows the total AND the pattern')
  const moved = formatSweepSummary(mkSum({ S: 2 }, { alerted: ['x'] }), mkLedger([{ name: 'F', pay: 42000 }]))
  assert(moved.includes('repaired=2') && moved.includes('[S2]'), `names repaired=2 [S2] (got: ${moved})`)
  assert(moved.includes('alerts=1'), 'carries the alert count')

  // ── [3] an unreadable ledger still emits the line — never swallowed ──────────────
  console.log('\n[3] an unreadable ledger still emits (a read failure never suppresses the line)')
  assert(formatSweepSummary(mkSum({}), mkLedger([], false)).includes('payable=(unreadable)'), 'payable=(unreadable) when the read failed')

  // ── [4] Q5 ROOT + WIRING (static) — the summary is at WARN, not the no-op INFO ──
  console.log('\n[4] static: the summary routes through logger.warn (prod-visible), not the prod-no-op logger.info')
  const loggerSrc = readFileSync('lib/logger.ts', 'utf8')
  assert(/info:[\s\S]*?if \(!isDev\) return/.test(loggerSrc), 'logger.ts CONFIRMS: info is gated `if (!isDev) return` (a prod no-op) — the root of the blindness')
  assert(!/warn:[\s\S]*?if \(!isDev\) return/.test(loggerSrc.slice(loggerSrc.indexOf('warn:'), loggerSrc.indexOf('error:'))), 'logger.warn is NOT dev-gated (reaches prod)')
  const recSrc = readFileSync('lib/reconciler.ts', 'utf8')
  assert(/logger\.warn\(formatSweepSummary\(/.test(recSrc), 'the reconciler emits the summary via logger.warn(formatSweepSummary(...)) every sweep')
  assert(readFileSync('lib/process-payout.ts', 'utf8').includes("logger.warn(\n      `[Ledger] accrued") || /logger\.warn\([\s\S]{0,40}\[Ledger\] accrued/.test(readFileSync('lib/process-payout.ts', 'utf8')),
    'accrueVendorEarnings emits a [Ledger] ledger-delta at warn on a NEW accrual (the silent path is now visible)')

  // ── [5] logger.money REACHES PRODUCTION — the sink, not the callers ─────────────
  // Q5 fixed the reconciler's summary one call site at a time and deliberately left
  // logger.info alone ("the info line is kept for dev detail", f1306be). Seven money-move
  // OUTCOMES stayed on info and were invisible in prod — every payout we did not make was
  // visible, every one we did was not. logger.money is the fix, and its correctness rests
  // entirely on which console method it calls:
  //
  //   console.warn/error → survives BOTH sinks (the !isDev guard AND next.config.mjs's
  //                        removeConsole, which excludes exactly 'error' and 'warn').
  //   console.info/log/debug → DELETED by the Next compiler in the Vercel build. The call
  //                        site is gone; no runtime guard can rescue it.
  //
  // So "money must not sit on console.info" is the whole property, and until now it was
  // protected by a comment — and prose has no drift-guard. Someone normalising the logger
  // flips it to console.info, every money line dies on Vercel again, and it is SILENT:
  // the call sites still read logger.money, so a scanner that checks the CALLERS stays green.
  // This checks the SINK.
  console.log('\n[5] static: logger.money routes through console.warn/error (survives BOTH prod sinks)')
  const loggerCode = stripComments(readFileSync('lib/logger.ts', 'utf8'))
  const moneyBody = loggerCode.match(/money:\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  assert(moneyBody !== '', 'lib/logger.ts exports a `money` member (the money-visible level exists)')
  assert(/console\.(warn|error)\s*\(/.test(moneyBody),
    'logger.money calls console.warn or console.error — reaches prod on Vercel AND the worker')
  assert(!/console\.(info|log|debug)\s*\(/.test(moneyBody),
    '⛔ logger.money does NOT call console.info/log/debug (the Next compiler deletes those — silent death on Vercel)')
  // The second sink, asserted from its own source rather than trusted: removeConsole must keep
  // excluding warn. If someone drops the exclude list, console.warn dies too and logger.money
  // goes with it — a change in next.config.mjs that would otherwise look unrelated to money.
  const nextCfg = stripComments(readFileSync('next.config.mjs', 'utf8'))
  assert(/removeConsole[\s\S]{0,120}exclude:\s*\[[^\]]*'warn'/.test(nextCfg),
    "next.config.mjs removeConsole still excludes 'warn' (the sink logger.money depends on)")
  // Not vacuous: prove the SAME probe rejects the bad shape it is meant to catch.
  const BAD = " console.info('[MONEY]', msg, payload ?? '')\n "
  assert(!/console\.(warn|error)\s*\(/.test(BAD) && /console\.(info|log|debug)\s*\(/.test(BAD),
    'POSITIVE CONTROL on the probe: a console.info money body is rejected by these same tests')

  console.log(`\n${'─'.repeat(52)}`)
  console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
