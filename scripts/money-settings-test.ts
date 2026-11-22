/**
 * MONEY SETTINGS + ORDER FEE SNAPSHOT (item 10 / B1.13 stage 2, BATCH-1 §19 S2-Q1..Q6) — test DB.
 *
 *   [0] probe controls and the starting state (the production seed)
 *   [1] exact text → integer conversion (no float maths), every accepted case and every refusal
 *   [2] registry: four money keys, no defaults, display, the approved "not in effect" notes,
 *       getSetting() refuses them
 *   [3] save rules: reason required, never cleared, row + log in one transaction, 409 still works
 *   [4] permissions through PATCH /api/admin/settings: platform_manager 403 on every money key and
 *       nothing written; admin / super_admin 200; platform_manager still saves a non-money key
 *   [5] getMoneySettings(): the seed, uncached, all-or-nothing, every missing/invalid key named
 *   [6] the Slack notice: only for a committed money change, registered through after(), a throwing
 *       or never-answering notifier can't fail or delay the save, postToSlack gives up after 5 s
 *   [7] the seed migration: idempotent, one log entry per row actually inserted, a present key kept,
 *       "System (migration)" in the log
 *   [8] the order snapshot columns: enum, nullable, no default, null on every order incl. new ones
 *   [9] (updated for stage 3) new orders are feeModel 2 and differ from the frozen 10% baseline, which
 *       stays as the legacy record; only the order route and fair payload read the settings; the fee
 *       function's golden values, and a scan proving nothing reads the new settings or columns yet
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/money-settings-test.ts
 */
// fee-baseline sets the environment (test Upstash proxy, stubbed Stripe key, .env.local) and
// registers the route loader when imported, before anything below loads a route.
import { runScenarios, compareToBaseline, loadBaseline, SCENARIOS, acceptedScenarios, type Observed } from './fee-baseline'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createServer } from 'node:http'
import { NextRequest } from 'next/server'
import { testPrisma } from '../lib/test-db'

process.env.SLACK_WEBHOOK_URL = '' // no real Slack from this suite; [6] points it at a local server

const prisma = testPrisma()
const PFX = 'mset-'
const MAIL = '@mset.local'
const rand = () => Math.random().toString(36).slice(2, 8)
let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const SEED_SQL = readFileSync('prisma/migrations/20261118120000_add_money_settings/migration.sql', 'utf8')
const SEED: Record<string, unknown> = { 'fees.serviceFee.percentBps': 1500, 'fees.serviceFee.flatCents': 0, 'fees.curbsideRunnerFeeCents': 399, 'fees.cardFeesPaidBy': 'VENDOR' }
const MONEY = Object.keys(SEED)
/** Back to the production seed: drop the fee rows (and their log entries) and run the migration file. */
async function resetToSeed() {
  await prisma.platformSettingChange.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.platformSetting.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.$executeRawUnsafe(SEED_SQL)
}
const versionOf = async (key: string) => (await prisma.platformSetting.findUnique({ where: { key } }))?.updatedAt.toISOString() ?? 'unset'
const logCount = (key: string) => prisma.platformSettingChange.count({ where: { key } })
const login = (clerkId: string, roles: string[]) => { (globalThis as any).__MOCK_CLERK = { userId: clerkId, publicMetadata: { roles } } }
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/admin/settings', {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : /\.(tsx?|mjs|js)$/.test(n) && out.push(q) }
  return out
}

async function main() {
  const settings = await import('../lib/settings')
  const money = await import('../lib/money-input')
  const route = await import('../app/api/admin/settings/route')
  const { runAfterResponse } = await import('../lib/after-response')
  const notify = await import('../lib/notify')
  const constants = await import('../lib/constants')
  ;(globalThis as any).__AFTER_RESPONSE_FOR_TEST = (t: () => Promise<void>) => { void t() }
  await resetToSeed()

  // ── [0] ───────────────────────────────────────────────────────────────────────────────────
  console.log('[0] probe controls and the starting state')
  login(`${PFX}admin`, ['admin'])
  const ctrl = await route.PATCH(req('PATCH', { key: 'alerts.phone', value: '(618) 555-0100', expectedVersion: await versionOf('alerts.phone') }) as any)
  assert(ctrl.status === 200, '[0] control: the stubbed Clerk admin saves a non-money key (200)')
  await prisma.platformSettingChange.deleteMany({ where: { key: 'alerts.phone' } }); await prisma.platformSetting.deleteMany({ where: { key: 'alerts.phone' } })
  const rows0 = await prisma.platformSetting.findMany({ where: { key: { in: MONEY } } })
  assert(rows0.length === 4 && rows0.every(r => JSON.stringify(r.value) === JSON.stringify(SEED[r.key])), 'starts from the production seed: 1500 / 0 / 399 / VENDOR')

  // ── [1] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] exact text → integer (no float maths)')
  const cents = (s: unknown) => money.dollarsToCents(s, 1_000_000)
  const bps = (s: unknown) => money.percentToBps(s, 1_000_000)
  const okEq = (r: { ok: boolean; value?: number }, v: number) => r.ok && (r as any).value === v
  for (const [t, v] of [['3.99', 399], ['0.29', 29], ['4.35', 435], ['0', 0], ['5', 500], ['5.00', 500], [' 3.99 ', 399], ['0.5', 50]] as const) {
    assert(okEq(cents(t), v), `dollars ${JSON.stringify(t)} → ${v}`)
  }
  for (const [t, v] of [['12.5', 1250], ['15.25', 1525], ['15', 1500], ['30', 3000], ['0', 0]] as const) {
    assert(okEq(bps(t), v), `percent ${JSON.stringify(t)} → ${v}`)
  }
  assert(okEq(cents(4.35), 435) && okEq(cents(0.29), 29) && okEq(bps(15.25), 1525), 'numbers from the API go through the same text rule (4.35 → 435, 0.29 → 29, 15.25 → 1525)')
  assert(Math.round(4.35 * 100) !== 435 || Math.round(0.29 * 100) !== 29 || Math.round(1.005 * 100) !== 101,
    '[0] control: naive Math.round(x × 100) really is wrong for some of these inputs (so the exact rule matters)')
  const refusals: Array<[string, unknown, RegExp]> = [
    ['3 decimals', '3.999', /2 decimal/], ['3 decimals percent', '12.345', /2 decimal/], ['negative', '-1', /negative/],
    ['comma', '1,000', /commas/], ['blank', '', /Enter a value/], ['spaces', '   ', /Enter a value/], ['null', null, /Enter a value/],
    ['letters', 'abc', /Enter a number/], ['two dots', '3.9.9', /Enter a number/], ['exponent', '1e3', /Enter a number/],
    ['dollar sign', '$3.99', /Enter a number/], ['percent sign', '15%', /Enter a number/], ['object', {}, /Enter a number/],
  ]
  for (const [label, raw, re] of refusals) {
    const r = money.parseHundredths(raw, '3.99')
    assert(!r.ok && re.test((r as any).error), `refused, ${label}: ${JSON.stringify(raw)} → "${(r as any).error}"`)
  }
  const pf = (k: string, raw: unknown) => (settings.SETTINGS as any)[k].parse(raw)
  assert(!pf('fees.serviceFee.percentBps', '30.01').ok && pf('fees.serviceFee.percentBps', '30').ok, 'service fee: 30% accepted, 30.01% refused')
  assert(!pf('fees.serviceFee.flatCents', '5.01').ok && pf('fees.serviceFee.flatCents', '5.00').ok, 'flat: $5.00 accepted, $5.01 refused')
  assert(!pf('fees.curbsideRunnerFeeCents', '15.01').ok && pf('fees.curbsideRunnerFeeCents', '15').ok, 'curbside: $15.00 accepted, $15.01 refused')
  assert(pf('fees.cardFeesPaidBy', 'VENDOR').ok && pf('fees.cardFeesPaidBy', 'PLATFORM').ok
    && ['vendor', 'BOTH', '', null, 1].every(v => !pf('fees.cardFeesPaidBy', v).ok), 'card fees: VENDOR / PLATFORM only')

  // ── [2] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] registry')
  const S = settings.SETTINGS as any
  assert(MONEY.every(k => S[k].class === 'money' && S[k].default === null), 'the four fees.* keys are class money with no default')
  assert(settings.formatSettingValue('fees.serviceFee.percentBps', 1500) === '15%' && settings.formatSettingValue('fees.serviceFee.percentBps', 1250) === '12.5%'
    && settings.formatSettingValue('fees.serviceFee.percentBps', 1525) === '15.25%', 'display: 15%, 12.5%, 15.25%')
  assert(settings.formatSettingValue('fees.serviceFee.flatCents', 0) === '$0.00' && settings.formatSettingValue('fees.curbsideRunnerFeeCents', 399) === '$3.99',
    'display: $0.00, $3.99')
  assert(settings.formatSettingValue('fees.cardFeesPaidBy', 'VENDOR') === 'Vendor pays' && settings.formatSettingValue('fees.cardFeesPaidBy', 'PLATFORM') === 'FairSynq pays',
    'display: Vendor pays / FairSynq pays')
  const NOTES: Record<string, string> = {
    'fees.serviceFee.percentBps': 'Not in effect yet. Checkout still charges the old 10% service fee. This value takes effect when the new fees go live.',
    'fees.serviceFee.flatCents': 'Not in effect yet. Checkout adds no flat fee today. This value takes effect when the new fees go live.',
    'fees.curbsideRunnerFeeCents': "Not in effect yet. Checkout still uses each event's own curbside fee. This value takes effect when the new fees go live.",
    'fees.cardFeesPaidBy': 'Not in effect yet. Today vendors pay the full card processing fee on every order. This value takes effect when the new fees go live.',
  }
  // Updated 2026-11-18 (item 10 stage 3): checkout reads the three price keys, so their notes are gone;
  // the card-fee note stays until the stage 4 payout reads it.
  // Updated 2026-11-19 (item 10 stage 4): the payout splits by the card-fee snapshot, so that note is gone too.
  void NOTES
  assert(['fees.serviceFee.percentBps', 'fees.serviceFee.flatCents', 'fees.curbsideRunnerFeeCents', 'fees.cardFeesPaidBy'].every(k => !S[k].notInEffect),
    'no money card has an amber note: the three price cards since stage 3, card fees since stage 4')
  assert(money.centsToText(399) === '3.99' && money.centsToText(0) === '0.00' && money.bpsToText(1250) === '12.5' && money.bpsToText(1500) === '15',
    'the form shows stored values as editable text (399 → 3.99, 1250 → 12.5)')
  let refusedAll = true
  for (const k of MONEY) { try { await settings.getSetting(k as any); refusedAll = false } catch { /* refused */ } }
  let delOk = false
  try { delOk = (await settings.getSetting('delivery.enabled')) !== undefined } catch { delOk = false }
  assert(refusedAll && delOk, 'getSetting() refuses every money key (control: it still reads delivery.enabled)')

  // ── [3] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] save rules')
  const save = (k: string, raw: unknown, extra: Record<string, unknown> = {}) => settings.saveSetting({
    key: k, raw, expectedVersion: extra.expectedVersion, actorId: `${PFX}admin`, actorType: (extra.actorType as any) ?? 'admin',
    reason: extra.reason, hooks: extra.hooks as any, afterResponse: (extra.afterResponse as any) ?? (() => {}), notify: extra.notify as any,
  })
  const kind = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return `${e.kind}:${JSON.stringify(e.details?.fieldErrors ?? {})}` } }
  const K = 'fees.serviceFee.percentBps'
  const v0 = await versionOf(K), l0 = await logCount(K)
  for (const r of [undefined, '', '   ']) {
    assert((await kind(save(K, '12.5', { expectedVersion: v0, reason: r }))).startsWith('invalid:{"reason"'), `no reason (${JSON.stringify(r)}) → refused with a reason field error`)
  }
  assert((await kind(save(K, '', { expectedVersion: v0, reason: 'clear it' }))).startsWith('invalid'), 'clearing (empty value) → refused')
  assert((await kind(save(K, null, { expectedVersion: v0, reason: 'clear it' }))).startsWith('invalid'), 'clearing (null) → refused')
  assert((await versionOf(K)) === v0 && (await logCount(K)) === l0, 'and none of those wrote anything')
  const good = await save(K, '12.5', { expectedVersion: v0, reason: 'test: 12.5%' })
  const row = await prisma.platformSetting.findUnique({ where: { key: K } })
  const last = await prisma.platformSettingChange.findFirst({ where: { key: K }, orderBy: { createdAt: 'desc' } })
  assert(good.outcome === 'saved' && row?.value === 1250 && last?.reason === 'test: 12.5%' && last?.oldValue === 1500 && last?.newValue === 1250
    && last?.actorType === 'admin', 'a valid save writes the row (1250) and one log entry (1500 → 1250, reason, actor)')
  const v1 = await versionOf(K), l1 = await logCount(K)
  const rolled = await kind(save(K, '13', { expectedVersion: v1, reason: 'test rollback', hooks: { afterSettingWrite: () => { throw new Error('boom') } } }))
  assert(rolled === 'undefined:{}' || rolled.includes('boom') || rolled !== 'ok', 'an error inside the transaction fails the save')
  assert((await prisma.platformSetting.findUnique({ where: { key: K } }))?.value === 1250 && (await logCount(K)) === l1, '… and rolls back BOTH the row and the log entry')
  assert((await kind(save(K, '14', { expectedVersion: v0, reason: 'stale' }))).startsWith('conflict'), 'a stale version still gets a conflict (409)')
  await resetToSeed()

  // ── [4] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[4] permissions (PATCH /api/admin/settings)')
  const VALUES: Record<string, [string, string]> = {
    'fees.serviceFee.percentBps': ['12.5', '14'], 'fees.serviceFee.flatCents': ['0.50', '0.25'],
    'fees.curbsideRunnerFeeCents': ['3.49', '2.99'], 'fees.cardFeesPaidBy': ['PLATFORM', 'VENDOR'],
  }
  const patch = async (roles: string[], key: string, value: unknown, reason = 'test') => {
    login(`${PFX}${roles.join('-') || 'none'}`, roles)
    const r = await route.PATCH(req('PATCH', { key, value, expectedVersion: await versionOf(key), reason }) as any)
    return { status: r.status, body: await r.json() as any }
  }
  for (const k of MONEY) {
    const before = await prisma.platformSetting.findUnique({ where: { key: k } }), lc = await logCount(k)
    const r = await patch(['platform_manager'], k, VALUES[k][0])
    const after = await prisma.platformSetting.findUnique({ where: { key: k } })
    assert(r.status === 403 && r.body.error?.code === 'FORBIDDEN' && r.body.error?.message === 'Only an admin can change fees.'
      && JSON.stringify(after?.value) === JSON.stringify(before?.value) && after?.updatedAt.getTime() === before?.updatedAt.getTime() && (await logCount(k)) === lc,
      `platform_manager → 403 on ${k}, nothing written`)
  }
  for (const k of MONEY) {
    const r = await patch(['admin'], k, VALUES[k][0])
    assert(r.status === 200 && r.body.data?.outcome === 'saved', `[0] control: admin → 200 on ${k}`)
    const s = await patch(['super_admin'], k, VALUES[k][1])
    assert(s.status === 200 && s.body.data?.outcome === 'saved', `super_admin → 200 on ${k}`)
  }
  const pmAlerts = await patch(['platform_manager'], 'alerts.email', 'ops@mset.local', '')
  assert(pmAlerts.status === 200, 'platform_manager still saves a non-money key (alerts.email → 200)')
  await prisma.platformSettingChange.deleteMany({ where: { key: 'alerts.email' } }); await prisma.platformSetting.deleteMany({ where: { key: 'alerts.email' } })
  const noReason = await patch(['admin'], 'fees.serviceFee.flatCents', '0.75', '')
  assert(noReason.status === 400 && typeof noReason.body.error?.details?.fieldErrors?.reason === 'string', 'admin without a reason → 400 with a reason field error')
  for (const role of ['admin', 'super_admin', 'platform_manager']) {
    login(`${PFX}${role}`, [role])
    const g = await route.GET(req('GET') as any); const gb = await g.json() as any
    assert(g.status === 200 && gb.data?.viewerRole === role, `GET works for ${role} and says who is viewing (${gb.data?.viewerRole})`)
  }
  await resetToSeed()

  // ── [5] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[5] getMoneySettings()')
  assert(JSON.stringify(await settings.getMoneySettings()) === JSON.stringify({ serviceFeeBps: 1500, serviceFeeFlatCents: 0, curbsideRunnerFeeCents: 399, cardFeesPaidBy: 'VENDOR' }),
    'right after the migration: 1500 / 0 / 399 / VENDOR')
  await prisma.platformSetting.update({ where: { key: 'fees.serviceFee.percentBps' }, data: { value: 1300 } })
  assert((await settings.getMoneySettings()).serviceFeeBps === 1300, 'uncached: a row changed in the database is read on the very next call')
  await resetToSeed()
  const unavailable = async () => { try { await settings.getMoneySettings(); return null } catch (e) { return e as InstanceType<typeof settings.MoneySettingsUnavailable> } }
  for (const k of MONEY) {
    await prisma.platformSetting.delete({ where: { key: k } })
    const e = await unavailable()
    assert(e instanceof settings.MoneySettingsUnavailable && e.missing.join() === k && e.invalid.length === 0, `${k} missing → MoneySettingsUnavailable naming it`)
    await resetToSeed()
  }
  const BAD: Array<[string, unknown]> = [
    ['fees.serviceFee.percentBps', -5], ['fees.serviceFee.percentBps', 'abc'], ['fees.serviceFee.percentBps', 3500], ['fees.serviceFee.percentBps', 1.5],
    ['fees.serviceFee.flatCents', 501], ['fees.curbsideRunnerFeeCents', 1501], ['fees.cardFeesPaidBy', 'BOTH'], ['fees.cardFeesPaidBy', null], ['fees.serviceFee.flatCents', {}],
  ]
  for (const [k, v] of BAD) {
    await prisma.$executeRawUnsafe(`UPDATE "PlatformSetting" SET "value" = $1::jsonb WHERE "key" = $2`, JSON.stringify(v), k)
    const e = await unavailable()
    assert(e instanceof settings.MoneySettingsUnavailable && e.invalid.join() === k, `${k} stored as ${JSON.stringify(v)} → invalid, named`)
    await resetToSeed()
  }
  await prisma.platformSetting.delete({ where: { key: 'fees.serviceFee.flatCents' } })
  await prisma.$executeRawUnsafe(`UPDATE "PlatformSetting" SET "value" = '"BOTH"'::jsonb WHERE "key" = 'fees.cardFeesPaidBy'`)
  const two = await unavailable()
  assert(!!two && two.missing.join() === 'fees.serviceFee.flatCents' && two.invalid.join() === 'fees.cardFeesPaidBy', 'two bad keys at once: both named (one missing, one invalid)')
  await resetToSeed()
  const libSrc = readFileSync('lib/settings.ts', 'utf8')
  const body = libSrc.slice(libSrc.indexOf('export async function getMoneySettings'))
  assert((body.match(/db\.platformSetting\.\w+\(/g) ?? []).length === 1 && !/unstable_cache|cache\(/.test(body) && !/\.default\b/.test(body),
    'one query, no cache, no default anywhere in getMoneySettings()')

  // ── [6] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] the Slack notice')
  const calls: any[] = []
  const scheduled: Array<() => Promise<void>> = []
  const capture = { afterResponse: (t: () => Promise<void>) => { scheduled.push(t) }, notify: async (c: any) => { calls.push(c) } }
  const F = 'fees.curbsideRunnerFeeCents'
  const s1 = await save(F, '3.49', { expectedVersion: await versionOf(F), reason: 'slack test', ...capture })
  assert(s1.outcome === 'saved' && scheduled.length === 1 && calls.length === 0, 'a money save schedules exactly one notice, not yet sent (after the response)')
  await scheduled[0]()
  assert(calls.length === 1 && calls[0].key === F && calls[0].from === '$3.99' && calls[0].to === '$3.49' && calls[0].actorId === `${PFX}admin`
    && calls[0].actorType === 'admin' && calls[0].reason === 'slack test', 'the notice carries key, old value, new value, actor and reason')
  const n0 = scheduled.length
  await save(F, '3.49', { expectedVersion: await versionOf(F), reason: 'same', ...capture })
  await kind(save(F, '99', { expectedVersion: await versionOf(F), reason: 'too big', ...capture }))
  await kind(save(F, '3.29', { expectedVersion: await versionOf(F), reason: 'pm', actorType: 'platform_manager', ...capture }))
  await save('alerts.phone', '(618) 555-0100', { expectedVersion: await versionOf('alerts.phone'), ...capture })
  assert(scheduled.length === n0, 'no notice for an unchanged save, a refused value, a 403 or a non-money save')
  await prisma.platformSettingChange.deleteMany({ where: { key: 'alerts.phone' } }); await prisma.platformSetting.deleteMany({ where: { key: 'alerts.phone' } })
  const throwing = await save(F, '3.19', { expectedVersion: await versionOf(F), reason: 'throwing notifier',
    afterResponse: (t: () => Promise<void>) => { void t().catch(() => {}) }, notify: async () => { throw new Error('slack down') } })
  const lt = await prisma.platformSettingChange.findFirst({ where: { key: F }, orderBy: { createdAt: 'desc' } })
  assert(throwing.outcome === 'saved' && (await prisma.platformSetting.findUnique({ where: { key: F } }))?.value === 319 && lt?.reason === 'throwing notifier',
    'a throwing notifier: the save still returns saved, row and log written')
  const t0 = Date.now()
  const hanging = await save(F, '3.09', { expectedVersion: await versionOf(F), reason: 'hanging notifier',
    afterResponse: (t: () => Promise<void>) => { void t() }, notify: () => new Promise<void>(() => {}) })
  const ms = Date.now() - t0
  assert(hanging.outcome === 'saved' && ms < 1000 && (await prisma.platformSetting.findUnique({ where: { key: F } }))?.value === 309,
    `a notifier that never answers: saved and logged in ${ms} ms (< 1 s)`)
  // Through runAfterResponse with a throwing notifier: its wrapper swallows the error (no unhandled rejection).
  let unhandled = 0; const onUnhandled = () => { unhandled++ }; process.on('unhandledRejection', onUnhandled)
  await save(F, '2.99', { expectedVersion: await versionOf(F), reason: 'wrapped', afterResponse: runAfterResponse, notify: async () => { throw new Error('slack down') } })
  await new Promise(r => setTimeout(r, 50)); process.off('unhandledRejection', onUnhandled)
  assert(unhandled === 0, 'through runAfterResponse a failing notice is swallowed and logged, never an unhandled rejection')
  // Registered through after(): the route hands saveSetting runAfterResponse, which calls Next's after().
  const routeSrc = readFileSync('app/api/admin/settings/route.ts', 'utf8'), arSrc = readFileSync('lib/after-response.ts', 'utf8')
  assert(/afterResponse: runAfterResponse,/.test(routeSrc) && /import \{ after \} from 'next\/server'/.test(arSrc) && /\n  after\(safe\)\n/.test(arSrc),
    'the route registers the notice through runAfterResponse → after()')
  const hook = (globalThis as any).__AFTER_RESPONSE_FOR_TEST; delete (globalThis as any).__AFTER_RESPONSE_FOR_TEST
  let afterErr = ''
  try { runAfterResponse(async () => {}) } catch (e) { afterErr = String((e as Error).message) }
  ;(globalThis as any).__AFTER_RESPONSE_FOR_TEST = hook
  assert(/outside a request scope/.test(afterErr), 'proof it really calls after(): outside a request, Next refuses it ("outside a request scope")')
  await resetToSeed()
  // postToSlack is bounded: a webhook that never answers is abandoned after SLACK_TIMEOUT_MS.
  const received: string[] = []
  const quiet = createServer(() => { /* never answers */ }), answers = createServer((rq, rs) => { let b = ''; rq.on('data', d => b += d); rq.on('end', () => { received.push(b); rs.end('ok') }) })
  await new Promise<void>(r => quiet.listen(0, '127.0.0.1', r)); await new Promise<void>(r => answers.listen(0, '127.0.0.1', r))
  const change = { key: F, label: 'Curbside fee', from: '$3.99', to: '$3.49', actorId: 'x', actorType: 'admin', reason: 'r' }
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(answers.address() as any).port}/hook`
  const a0 = Date.now(); await notify.notifyMoneySettingChanged(change); const aMs = Date.now() - a0
  assert(received.length === 1 && received[0].includes('fees.curbsideRunnerFeeCents') && received[0].includes('$3.49') && aMs < 2000,
    `[0] control: a webhook that answers gets the notice (key and new value in the body) in ${aMs} ms`)
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(quiet.address() as any).port}/hook`
  const q0 = Date.now(); await notify.notifyMoneySettingChanged(change); const qMs = Date.now() - q0
  assert(notify.SLACK_TIMEOUT_MS === 5000 && qMs >= 4500 && qMs < 8000, `a webhook that never answers is abandoned after ~5 s (${qMs} ms), not forever`)
  process.env.SLACK_WEBHOOK_URL = ''
  quiet.closeAllConnections?.(); quiet.close(); answers.close()

  // ── [7] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[7] the seed migration')
  await prisma.platformSettingChange.deleteMany({ where: { key: { in: MONEY } } }); await prisma.platformSetting.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.$executeRawUnsafe(SEED_SQL)
  const rowsA = await prisma.platformSetting.findMany({ where: { key: { in: MONEY } } }), logsA = await prisma.platformSettingChange.findMany({ where: { key: { in: MONEY } } })
  assert(rowsA.length === 4 && logsA.length === 4, 'from empty: 4 rows and 4 log entries')
  assert(rowsA.every(r => r.updatedById === 'migration:20261118120000_add_money_settings' && r.updatedByType === 'system')
    && logsA.every(l => l.actorId === 'migration:20261118120000_add_money_settings' && l.actorType === 'system' && l.reason === 'Starting value (item 10, stage 2)' && l.oldValue === null
      && JSON.stringify(l.newValue) === JSON.stringify(SEED[l.key])), 'actor migration:<name>, type system, the reason, old value empty, new value = the seed')
  await prisma.$executeRawUnsafe(SEED_SQL)
  assert((await prisma.platformSetting.count({ where: { key: { in: MONEY } } })) === 4 && (await prisma.platformSettingChange.count({ where: { key: { in: MONEY } } })) === 4,
    'a second run changes nothing: still 4 rows and 4 log entries')
  await prisma.platformSettingChange.deleteMany({ where: { key: { in: MONEY } } }); await prisma.platformSetting.deleteMany({ where: { key: { in: MONEY } } })
  await prisma.platformSetting.create({ data: { key: 'fees.serviceFee.percentBps', value: 1200, updatedAt: new Date(), updatedById: `${PFX}admin`, updatedByType: 'admin' } })
  await prisma.$executeRawUnsafe(SEED_SQL)
  const kept = await prisma.platformSetting.findUnique({ where: { key: 'fees.serviceFee.percentBps' } })
  const logsB = await prisma.platformSettingChange.findMany({ where: { key: { in: MONEY } } })
  assert(kept?.value === 1200 && kept.updatedByType === 'admin' && logsB.length === 3 && !logsB.some(l => l.key === 'fees.serviceFee.percentBps'),
    'a key already present keeps its value (1200) and gets no log entry; the other 3 are seeded with 3 entries')
  await resetToSeed()
  assert(JSON.stringify(await settings.getMoneySettings()) === JSON.stringify({ serviceFeeBps: 1500, serviceFeeFlatCents: 0, curbsideRunnerFeeCents: 399, cardFeesPaidBy: 'VENDOR' }),
    'after the migration getMoneySettings() returns the seed')
  const view = await settings.listSettings()
  const sys = view.changes.filter(c => MONEY.includes(c.key))
  assert(sys.length === 4 && sys.every(c => c.actor === 'System (migration)' && c.actorType === 'system' && c.from === 'not set'),
    'the /admin/settings log shows the seed as "System (migration)"')

  // ── [8] ───────────────────────────────────────────────────────────────────────────────────
  console.log('\n[8] the order snapshot columns')
  const enumVals = await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT unnest(enum_range(NULL::"CardFeesPaidBy"))::text AS v`)
  assert(enumVals.map(e => e.v).join() === 'VENDOR,PLATFORM', 'enum CardFeesPaidBy is exactly VENDOR, PLATFORM')
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string; udt_name: string }>>(
    `SELECT column_name, is_nullable, column_default, data_type, udt_name FROM information_schema.columns WHERE table_name = 'Order' AND column_name IN ('feeModel','serviceFeeBps','serviceFeeFlatCents','cardFeesPaidBy') ORDER BY column_name`)
  assert(cols.length === 4 && cols.every(c => c.is_nullable === 'YES' && c.column_default === null), 'the four columns exist, nullable, no default')
  assert(cols.find(c => c.column_name === 'cardFeesPaidBy')?.udt_name === 'CardFeesPaidBy' && ['feeModel', 'serviceFeeBps', 'serviceFeeFlatCents'].every(n => cols.find(c => c.column_name === n)?.data_type === 'integer'),
    'three integers and the enum')
  // A legacy-style order created the old way (no snapshot fields), so the count below is never vacuous.
  const ev = await prisma.event.create({ data: { name: `${PFX}ev`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const cu = await prisma.user.create({ data: { clerkId: `${PFX}cu-${rand()}`, email: `cu-${rand()}${MAIL}`, name: 'C' } })
  const vd = await prisma.vendor.create({ data: { eventId: ev.id, name: `${PFX}v`, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
  await prisma.order.create({ data: { eventId: ev.id, customerId: cu.id, vendorId: vd.id, status: 'PENDING_PAYMENT', fulfillmentType: 'BOOTH_PICKUP', subtotal: 10, total: 11, fairSynqFee: 1, vendorPayout: 0, customerName: 'C', customerPhone: '6185550100' } })
  const total = await prisma.order.count()
  const nonNull = await prisma.order.count({ where: { OR: [{ feeModel: { not: null } }, { serviceFeeBps: { not: null } }, { serviceFeeFlatCents: { not: null } }, { cardFeesPaidBy: { not: null } }] } })
  assert(total > 0 && nonNull === 0, `every order in the test database (${total}) is null on all four`)
  await prisma.order.deleteMany({ where: { eventId: ev.id } }); await prisma.vendor.delete({ where: { id: vd.id } })
  await prisma.event.delete({ where: { id: ev.id } }); await prisma.user.delete({ where: { id: cu.id } })

  // ── [9] ───────────────────────────────────────────────────────────────────────────────────
  // Updated 2026-11-18 (item 10 stage 3): the 10% baseline is RETIRED for new orders (they are 15% by
  // design now) and kept as the legacy record. Stage 3's own end-to-end checks: scripts/fees-stage3-test.ts.
  console.log('\n[9] stage 3: new orders are feeModel 2; the 10% baseline is the legacy record')
  const { results, stubCalls } = await runScenarios()
  const accepted = acceptedScenarios()
  const refused = SCENARIOS.filter(s => s.refusedBy)
  assert(refused.length === 1 && refused[0].name === 'booth 0.29' && accepted.length === SCENARIOS.length - 1,
    '[0] fixture: exactly one scenario (booth 0.29) is expected to be refused; the other five are compared')
  assert(stubCalls === accepted.length && accepted.every(s => results[s.name]?.status === 201),
    `[0] control: the Stripe stub was called once per accepted order (${stubCalls}/${accepted.length}) and every one was created (201)`)
  for (const s of refused) {
    const r = results[s.name]
    assert(r?.status === 400 && !!r.floorCode && r.code === r.floorCode && r.stored === null && r.piAmount === null,
      `${s.name}: refused by the checkout floor with its own code, 400 ${r?.floorCode}; no order stored and no payment started (got ${r?.status} ${r?.code})`)
  }
  const baseline = loadBaseline()
  const diffs = compareToBaseline(results, baseline)
  for (const d of diffs) console.log(`     ↳ ${d}`)
  const b50now = results['booth 50.00']
  assert(Object.keys(baseline).length === 6 && diffs.length > 0 && (b50now.stored as any).total === 57.5 && b50now.piAmount === 5750,
    'accepted orders differ from the 10% baseline as intended ($50 booth: $57.50, PaymentIntent 5750); the baseline file stays as the legacy record')
  assert(accepted.every(s => { const r = results[s.name]; return !!r?.snapshot && JSON.stringify(r.snapshot) === JSON.stringify({ feeModel: 2, serviceFeeBps: 1500, serviceFeeFlatCents: 0, cardFeesPaidBy: 'VENDOR' }) }),
    `all ${accepted.length} accepted orders through POST /api/orders store the snapshot feeModel 2 / 1500 / 0 / VENDOR`)
  const at15: Record<string, Observed> = JSON.parse(JSON.stringify(baseline))
  const b50 = at15['booth 50.00']; (b50.stored as any).fairSynqFee = 7.5; (b50.stored as any).total = 57.5; b50.piAmount = 5750
  assert(compareToBaseline(at15, baseline).length >= 3, '[0] control: the comparison catches a 15% order (fee, total and PaymentIntent all flagged)')
  const fee = constants.calculateServiceFee
  assert(fee(0.29) === 0.03 && fee(4.35) === 0.44 && fee(15.25) === 1.53 && fee(50) === 5 && fee(0) === 0 && constants.SERVICE_FEE_RATE === 0.10,
    'calculateServiceFee golden values unchanged (0.29 → 0.03, 4.35 → 0.44, 15.25 → 1.53, 50 → 5.00, 0 → 0) and SERVICE_FEE_RATE is 0.10')
  const READ = /getMoneySettings\(|(?<!fees\.)\b(feeModel|serviceFeeBps|serviceFeeFlatCents|cardFeesPaidBy)\b|lib\/fees\/exhibit-a/
  assert(READ.test('const t = await getMoneySettings()') && READ.test('if (order.feeModel === 2)') && !READ.test("key: 'fees.cardFeesPaidBy'"),
    '[0] control: the scanner finds a planted call and a planted column read, and ignores the settings key name')
  // Stage 3 readers: the order route and the fair payload (via fee-terms); the one calculator (lib/checkout-total.ts) takes the terms as input.
  // Updated 2026-11-19 (item 10 stage 4): the PAYOUT side now reads the order's snapshot columns (fee split,
  // payout, vendor estimate, accrual skip, reconciler). Two rules remain: (a) only the price side reads the LIVE
  // money settings (getMoneySettings), so a payout can never use today's setting for an old order; (b) refunds,
  // chargebacks and the worker entry points read neither (stage 5 isn't built).
  const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const all = ['app', 'lib', 'workers'].flatMap(d => walk(join(process.cwd(), d))).map(f => relative(process.cwd(), f).split(sep).join('/'))
  const LIVE_ALLOWED = new Set(['lib/settings.ts', 'app/api/orders/route.ts', 'lib/fees/fee-terms.ts'])
  const liveReaders = all.filter(f => !LIVE_ALLOWED.has(f) && /getMoneySettings\(/.test(code(f)))
  assert(liveReaders.length === 0, `only the price side reads the live money settings (others found: ${liveReaders.join(', ') || 'none'})`)
  const NOT_YET = all.filter(f => /^workers\//.test(f) || /(refund|chargeback)/i.test(f.split('/').pop()!))
  // Updated 2026-11-22 (item 10 stage 5): owed-back (lib/tip-refund.ts) reads the order's STORED feeModel to apply the
  // stage 5 rules — the snapshot, never the live settings. Only that one column, only in that one file; everything
  // else (getMoneySettings, the other snapshot columns) stays forbidden there too.
  const STAGE5_FORBIDDEN = /getMoneySettings\(|(?<!fees\.)\b(serviceFeeBps|serviceFeeFlatCents|cardFeesPaidBy)\b/
  const refundReaders = NOT_YET.filter(f => (f === 'lib/tip-refund.ts' ? STAGE5_FORBIDDEN : READ).test(code(f)))
  assert(STAGE5_FORBIDDEN.test(code('lib/tip-refund.ts') + '\nconst x = order.cardFeesPaidBy') && !STAGE5_FORBIDDEN.test('if (order.feeModel === FEE_MODEL_EXHIBIT_A) {}'),
    '[0] control: in owed-back a planted cardFeesPaidBy read is caught; the stored feeModel is allowed')
  assert(NOT_YET.length >= 5 && NOT_YET.includes('lib/process-refund.ts') && NOT_YET.includes('lib/tip-refund.ts'), `[0] control: the refund/worker set is found (${NOT_YET.length} files)`)
  assert(refundReaders.length === 0, `refunds, chargebacks and the worker read neither the money settings nor the snapshot columns (found: ${refundReaders.join(', ') || 'none'})`)
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await resetToSeed() } catch (e) { console.error('reset failed', e) }
    delete (globalThis as any).__AFTER_RESPONSE_FOR_TEST
    await prisma.$disconnect()
    console.log(`\n${fail === 0 ? '✅' : '❌'} money settings: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
