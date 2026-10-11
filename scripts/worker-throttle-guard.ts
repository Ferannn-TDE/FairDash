/**
 * WORKER THROTTLE GUARD — the Upstash-budget knobs (lib/worker-config.ts) and the single
 * sweep runner (lib/sweep-runner.ts). PURE: no Redis, no DB, no real time.
 *
 * What it pins:
 *   [1] every default is the PRE-THROTTLE value (unset env ⇒ nothing changes)
 *   [2] valid overrides are read; invalid ones fall back AND warn (never silent)
 *   [3] the boot config line carries all five knobs (Railway logs confirm the env took)
 *   [4] timer mode: one sweep IMMEDIATELY on start, then on the interval
 *   [5] NO PARALLEL SWEEPS — a tick during a running sweep is skipped + logged, in timer mode,
 *       bullmq mode, AND across both (one shared runner)
 *   [6] shutdown: timer cleared, new sweeps refused, an in-flight sweep FINISHES before stop resolves
 *   [7] a failed sweep releases the slot (one bad sweep can't wedge every later one)
 *   [8] source shape: the worker actually USES the config, keeps bullmq as the rollback path,
 *       stops the sweep before closing, and shuts down idempotently
 *   [9] Pattern X cadence: default every sweep, hourly skips correctly, boot run, bad values
 *       fall back, aborted sweeps don't advance the clock, summary + config line report it
 *
 * Each negative assertion has a positive control on the PROBE first (the fake clock really
 * fires ticks; the runner really runs), so a skip can't pass vacuously.
 *
 * Run:  npx tsx scripts/worker-throttle-guard.ts
 */
import { readFileSync } from 'node:fs'
import { readWorkerConfig, formatWorkerConfig, WORKER_CONFIG_DEFAULTS } from '../lib/worker-config'
import { createSweepRunner } from '../lib/sweep-runner'
import { createIntervalGate } from '../lib/pattern-x-cadence'
import { formatSweepSummary, type SweepSummary } from '../lib/reconciler'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// ── fake clock: intervals fire only when we say so ─────────────────────────────
function fakeTimers() {
  const intervals = new Map<number, { fn: () => void; ms: number }>()
  let nextId = 1
  return {
    setInterval: (fn: () => void, ms: number) => { const id = nextId++; intervals.set(id, { fn, ms }); return id },
    clearInterval: (h: unknown) => { intervals.delete(h as number) },
    tick() { for (const { fn } of [...intervals.values()]) fn() },
    active: () => intervals.size,
    lastMs: () => [...intervals.values()].at(-1)?.ms,
  }
}
function deferred() {
  let resolve!: () => void, reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise(r => setImmediate(r))

async function main() {
  // ── [1] defaults = today ──────────────────────────────────────────────────────
  console.log('[1] unset env ⇒ the pre-throttle values (nothing changes until env is set)')
  const d = readWorkerConfig({})
  assert(d.warnings.length === 0, 'no warnings for an empty env')
  assert(d.config.scheduler === 'bullmq', 'scheduler defaults to bullmq (today)')
  assert(d.config.sweepIntervalMs === 60_000, 'sweep interval defaults to 60000ms (today)')
  assert(d.config.drainDelaySec === 5, 'drainDelay defaults to 5s (BullMQ default, today)')
  assert(d.config.stalledIntervalMs === 30_000, 'stalledInterval defaults to 30000ms (BullMQ default, today)')
  assert(d.config.lockDurationMs === 30_000, 'lockDuration defaults to 30000ms (BullMQ default, today)')
  assert(JSON.stringify(WORKER_CONFIG_DEFAULTS) === JSON.stringify(d.config), 'exported defaults match what an empty env yields')
  // The BullMQ defaults we claim to preserve really are BullMQ's (installed version).
  const bullWorker = readFileSync('node_modules/bullmq/dist/cjs/classes/worker.js', 'utf8')
  assert(/drainDelay: 5,/.test(bullWorker) && /lockDuration: 30000,/.test(bullWorker) && /stalledInterval: 30000,/.test(bullWorker),
    'installed BullMQ defaults are drainDelay 5 / lockDuration 30000 / stalledInterval 30000 — passing ours explicitly is a no-op')

  // ── [2] overrides + invalid fallbacks ─────────────────────────────────────────
  console.log('\n[2] overrides are read; invalid values fall back to the default AND warn')
  const p = readWorkerConfig({
    WORKER_SWEEP_SCHEDULER: 'timer', WORKER_SWEEP_INTERVAL_MS: '120000', WORKER_DRAIN_DELAY_SEC: '60',
    WORKER_STALLED_INTERVAL_MS: '300000', WORKER_LOCK_DURATION_MS: '30000',
  })
  assert(p.warnings.length === 0, 'the proposed production values parse cleanly')
  assert(p.config.scheduler === 'timer' && p.config.sweepIntervalMs === 120_000 && p.config.drainDelaySec === 60 &&
    p.config.stalledIntervalMs === 300_000 && p.config.lockDurationMs === 30_000, 'all five proposed values are applied')
  assert(readWorkerConfig({ WORKER_SWEEP_SCHEDULER: ' TIMER ' }).config.scheduler === 'timer', 'scheduler is case/space tolerant')
  assert(readWorkerConfig({ WORKER_SWEEP_SCHEDULER: 'bullmq' }).config.scheduler === 'bullmq', 'explicit bullmq (the rollback path) is honoured')
  const bad = readWorkerConfig({
    WORKER_SWEEP_SCHEDULER: 'cron', WORKER_SWEEP_INTERVAL_MS: '120', WORKER_DRAIN_DELAY_SEC: 'sixty',
    WORKER_STALLED_INTERVAL_MS: '-1', WORKER_LOCK_DURATION_MS: '1.5',
  })
  assert(JSON.stringify(bad.config) === JSON.stringify(WORKER_CONFIG_DEFAULTS), 'every invalid value falls back to its default')
  assert(bad.warnings.length === 5, `each invalid value produced a warning (${bad.warnings.length}/5)`)
  assert(bad.warnings.some(w => w.includes('WORKER_SWEEP_INTERVAL_MS="120"')), 'a seconds-typed-as-ms interval (120) is rejected by the floor, not silently used')

  // ── [3] boot config line ──────────────────────────────────────────────────────
  console.log('\n[3] the boot config line names every knob')
  const line = formatWorkerConfig(p.config)
  for (const frag of ['scheduler=timer', 'sweepIntervalMs=120000', 'drainDelaySec=60', 'stalledIntervalMs=300000', 'lockDurationMs=30000']) {
    assert(line.includes(frag), `config line contains ${frag}`)
  }

  // ── [4] boot sweep immediately, then interval ─────────────────────────────────
  console.log('\n[4] timer mode: one sweep immediately on start, then every interval')
  {
    const t = fakeTimers(); let runs = 0
    const r = createSweepRunner({ run: async () => { runs++ }, intervalMs: 120_000, warn: () => {}, error: () => {}, ...t })
    r.start(); await flush()
    assert(runs === 1, 'a sweep ran on start, before any tick')
    assert(t.active() === 1 && t.lastMs() === 120_000, 'one interval armed at the configured 120000ms')
    t.tick(); await flush()
    assert(runs === 2, 'positive control: the fake tick really fires a sweep')
    r.start(); await flush()
    assert(t.active() === 1 && runs === 2, 'start() is idempotent — no second timer, no extra sweep')
    await r.stop()
  }

  // ── [5] no parallel sweeps ────────────────────────────────────────────────────
  console.log('\n[5] NO PARALLEL SWEEPS — skipped + logged, in every mode')
  {
    const t = fakeTimers(); const warns: string[] = []
    let running = 0, maxConcurrent = 0, runs = 0
    let gate = deferred()
    const r = createSweepRunner({
      run: async () => { runs++; running++; maxConcurrent = Math.max(maxConcurrent, running); await gate.promise; running-- },
      intervalMs: 60_000, warn: m => warns.push(m), error: () => {}, ...t,
    })
    r.start(); await flush()
    assert(runs === 1 && r.isRunning(), 'boot sweep is in flight (held open)')
    t.tick(); t.tick(); await flush()
    const bull = await r.runOnce('bullmq')
    assert(runs === 1, 'two timer ticks + a bullmq job during the sweep started NOTHING')
    assert(bull === 'skipped', 'the bullmq-sourced call reports skipped (shared guard covers the mixed case)')
    assert(warns.filter(w => w.includes('sweep skipped: previous still running')).length === 3,
      `each skip logged "sweep skipped: previous still running" (${warns.length} warns)`)
    assert(warns.some(w => w.includes('source=timer')) && warns.some(w => w.includes('source=bullmq')), 'the skip log names its source')
    gate.resolve(); await flush(); await flush()
    assert(!r.isRunning(), 'slot released when the sweep finishes')
    gate = deferred()
    t.tick(); await flush()
    assert(runs === 2, 'the next tick after completion DOES run (the guard is not a latch)')
    // Same-tick race: two calls with no await between them.
    const a = r.runOnce('bullmq'), b = r.runOnce('timer')
    gate.resolve()
    const outcomes = await Promise.all([a, b])
    assert(outcomes.filter(o => o === 'skipped').length === 2, 'both same-tick callers were skipped while tick #2 held the slot')
    assert(maxConcurrent === 1, `max concurrent sweeps ever observed = ${maxConcurrent} (must be 1)`)
    await r.stop()
  }

  // ── [6] shutdown waits for the in-flight sweep ────────────────────────────────
  console.log('\n[6] SIGTERM mid-sweep: timer cleared, sweep FINISHES, then stop resolves; nothing new starts')
  {
    const t = fakeTimers(); const gate = deferred(); let finished = false, runs = 0
    const r = createSweepRunner({ run: async () => { runs++; await gate.promise; finished = true }, intervalMs: 60_000, warn: () => {}, error: () => {}, ...t })
    r.start(); await flush()
    let stopped = false
    const stopP = r.stop().then(() => { stopped = true })
    await flush()
    assert(t.active() === 0, 'timer cleared immediately on stop')
    assert(!stopped, 'stop() has NOT resolved while the sweep is still running')
    t.tick(); await flush()
    assert(runs === 1, 'a tick after stop (cleared timer) starts nothing')
    assert(await r.runOnce('bullmq') === 'stopped', 'a bullmq sweep job arriving during shutdown is refused')
    gate.resolve(); await stopP
    assert(finished && stopped, 'the in-flight sweep finished, THEN stop() resolved')
    r.start(); await flush()
    assert(runs === 1 && t.active() === 0, 'start() after stop is a no-op')
  }

  // ── [7] a failed sweep releases the slot ──────────────────────────────────────
  console.log('\n[7] a thrown sweep is logged and releases the slot')
  {
    const t = fakeTimers(); const errs: string[] = []; let runs = 0
    const r = createSweepRunner({ run: async () => { runs++; if (runs === 1) throw new Error('boom') }, intervalMs: 60_000, warn: () => {}, error: m => errs.push(m), ...t })
    const first = await r.runOnce('timer')
    assert(first === 'failed' && errs.some(e => e.includes('sweep failed')), 'failure reported + logged, not swallowed')
    assert(await r.runOnce('timer') === 'ran', 'the next sweep runs — one bad sweep cannot wedge the rest')
    await r.stop()
  }
  {
    let now = 0; const errs: string[] = []
    const r = createSweepRunner({ run: async () => { now += 61_000 }, intervalMs: 60_000, now: () => now, warn: () => {}, error: m => errs.push(m) })
    await r.runOnce('timer')
    assert(errs.some(e => e.includes('LONGER THAN ITS 60000ms INTERVAL')), 'an over-interval sweep is reported against the CONFIGURED interval')
  }

  // ── [8] source shape ──────────────────────────────────────────────────────────
  console.log('\n[8] the worker really uses the config + keeps the rollback path')
  const w = readFileSync('workers/order-worker.ts', 'utf8')
  const idx = readFileSync('workers/index.ts', 'utf8')
  assert(/readWorkerConfig\(process\.env\)/.test(w), 'worker reads its config from process.env')
  assert(/console\.warn\(formatWorkerConfig\(config\)\)/.test(w), 'config line is logged at WARN (console.log is stripped on Railway)')
  assert(/drainDelay: config\.drainDelaySec/.test(w) && /stalledInterval: config\.stalledIntervalMs/.test(w) && /lockDuration: config\.lockDurationMs/.test(w),
    'drainDelay / stalledInterval / lockDuration are passed from config to the BullMQ Worker')
  assert(/repeat: \{ every: config\.sweepIntervalMs \}/.test(w), 'bullmq mode repeats at the CONFIGURED interval')
  assert(!/every: 60_000/.test(w), 'no hard-coded 60s repeat survives')
  assert(/config\.scheduler === 'bullmq'/.test(w) && /sweepRunner!\.start\(\)/.test(w), 'both modes exist: bullmq repeat (rollback) and timer start')
  assert(/removeRepeatableByKey/.test(w), 'stale reconcile repeats are removed (a mode/interval switch cannot leave an old schedule firing)')
  assert(/runOnce\('bullmq'\)/.test(w) && !/sweepInFlight/.test(w), 'the bullmq handler goes through the SHARED runner (no second, private guard)')
  const close = w.slice(w.indexOf('async close()'))
  assert(close.indexOf('sweepRunner?.stop()') > -1 && close.indexOf('sweepRunner?.stop()') < close.indexOf('worker.close()'),
    'close() stops the sweep BEFORE closing the BullMQ worker')
  assert(/if \(shuttingDown\) return shuttingDown/.test(idx), 'shutdown is idempotent (a second SIGTERM does not race a second close)')

  // ── [9] Pattern X cadence ─────────────────────────────────────────────────────
  console.log('\n[9] Pattern X on its own interval (WORKER_PATTERN_X_INTERVAL_MS)')
  assert(readWorkerConfig({}).config.patternXIntervalMs === 0, 'default is 0 = every sweep (today)')
  assert(readWorkerConfig({ WORKER_PATTERN_X_INTERVAL_MS: '3600000' }).config.patternXIntervalMs === 3_600_000, '3600000 is read')
  assert(readWorkerConfig({ WORKER_PATTERN_X_INTERVAL_MS: '0' }).config.patternXIntervalMs === 0, 'explicit 0 is valid (every sweep)')
  for (const badX of ['-1', 'hourly', '1.5', '3600000ms']) {
    const r = readWorkerConfig({ WORKER_PATTERN_X_INTERVAL_MS: badX })
    assert(r.config.patternXIntervalMs === 0 && r.warnings.some(w => w.includes('WORKER_PATTERN_X_INTERVAL_MS')),
      `bad value "${badX}" → default 0 (every sweep) + a warning`)
  }
  assert(formatWorkerConfig(readWorkerConfig({ WORKER_PATTERN_X_INTERVAL_MS: '3600000' }).config).includes('patternXIntervalMs=3600000'),
    'the [Worker] config line carries patternXIntervalMs')
  assert(formatWorkerConfig(readWorkerConfig({}).config).includes('patternXIntervalMs=0(every sweep)'), 'and says "every sweep" for the default')

  {
    // Default: due on every sweep, including back-to-back ones.
    const g = createIntervalGate(0); let ran = 0
    for (let i = 0; i < 5; i++) { const t = i * 120_000; if (g.due(t)) { ran++; g.markRan(t) } }
    assert(ran === 5, `interval 0: X ran on all 5 sweeps (${ran}/5)`)
  }
  {
    // Hourly, sweeps every 120s for 2h01m: boot + at 60m + at 120m.
    const H = 3_600_000; const g = createIntervalGate(H); const ranAt: number[] = []
    for (let t = 0; t <= 2 * H + 60_000; t += 120_000) { if (g.due(t)) { ranAt.push(t); g.markRan(t) } }
    assert(ranAt[0] === 0, 'X runs on the FIRST sweep after boot')
    assert(ranAt.length === 3 && ranAt[1] === H && ranAt[2] === 2 * H, `3600000: ran at ${ranAt.map(t => t / 60_000 + 'm').join(', ')} (expect 0m, 60m, 120m)`)
    // Positive control on the skip: right before the hour it is NOT due, at the hour it IS.
    const g2 = createIntervalGate(H); g2.markRan(0)
    assert(!g2.due(H - 120_000) && g2.due(H), 'skips at 58m, due again at 60m (the skip is real, not vacuous)')
  }
  {
    // An aborted sweep (X due but not completed) must not advance the clock.
    const g = createIntervalGate(3_600_000)
    assert(g.due(0), 'boot: due'); /* sweep aborts before X completes → no markRan */
    assert(g.due(120_000) && g.lastRanAt() === null, 'after an aborted sweep X is STILL due on the next one (no hour lost)')
  }
  {
    const base = { startedAt: '', finishedAt: '', durationMs: 1, dryRun: false, patternEEnabled: false, backstopEnabled: false,
      scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
      repaired: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 },
      details: {} as SweepSummary['details'], alerted: [], suppressed: [], ambiguousSkipped: 0, backstopWarnings: [] }
    const ledger = { all: { payableCents: 0, paidCents: 0, cancelledCents: 0 }, byEvent: [], readable: true }
    assert(formatSweepSummary({ ...base, patternX: 'skipped' }, ledger).includes('patternX=skipped'), 'sweep summary says patternX=skipped')
    assert(formatSweepSummary({ ...base, patternX: 'ran' }, ledger).includes('patternX=ran'), 'sweep summary says patternX=ran')
  }
  const rec = readFileSync('lib/reconciler.ts', 'utf8')
  assert(/const runPatternX = opts\.runPatternX \?\? true/.test(rec), 'reconciler defaults runPatternX to true (every sweep)')
  assert(/if \(runPatternX\) \{\s*await patternX\(sum[^\n]*\n\s*sum\.patternX = 'ran'/.test(rec), "patternX() is called ONLY when runPatternX, and 'ran' is set only after it completes")
  assert(/patternX: runPatternX \? 'not-reached' : 'skipped'/.test(rec), "a due-but-unfinished X reads 'not-reached', never 'ran'")
  assert(/createIntervalGate\(config\.patternXIntervalMs\)/.test(w), 'worker builds the gate from config')
  assert(/runReconciliationSweep\(\{ runPatternX: patternXGate\.due\(decidedAt\) \}\)/.test(w), 'worker passes the gate decision into the sweep')
  assert(/if \(sum\.patternX === 'ran'\) patternXGate\.markRan\(decidedAt\)/.test(w), "worker advances the clock only when X actually ran")

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} worker-throttle-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
