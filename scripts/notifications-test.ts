/**
 * NOTIFICATION OUTBOX + EMAIL TRANSPORT (Batch 1 item 9, B1.12) — real lib, test DB.
 *
 *   [1] Transport: log in dev/test; in production NEVER log (even if asked) — always 'none'
 *   [2] Same transaction: a rolled-back write leaves no notification; dedupe makes a retry a no-op
 *   [3] Delivery with a working transport: claimed, sent, SENT; admin rows go to alerts.email
 *   [4] Admin rows with no alerts.email: held (NO_ALERT_EMAIL), not sent, attempts unchanged
 *   [5] Failing transport: retries 1/5/15/60 then FAILED after 5 attempts
 *   [5b] Control: the database-vs-computer clock race (see dueAt), reproduced and removed
 *   [6] No provider ('none'): nothing SENT, nothing logged, rows held NO_EMAIL_PROVIDER
 *   [7] Provider connected later: held admin alerts older than 48h → SKIPPED (kept); applicant
 *       emails of any age are sent
 *   [8] Templates: the agreed wording; the contact line; then the Email Look v1 footer (Nov 25)
 *   [9] Triggers: vendor, organizer and partner sign-ups each write exactly one admin alert
 *   [10] Resend (fetch faked): safety switch holds, 429 waits and stops the run, our-settings
 *        errors (401, 403, 422 invalid_from_address, bad EMAIL_FROM) hold, other 4xx FAIL, 5xx retry
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/notifications-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'ntf-'
const MAIL = '@ntf.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * THE EARLIEST MOMENT THESE ROWS ARE DUE ON BOTH CLOCKS.
 *
 * A new row's nextAttemptAt is set by the DATABASE clock (@default(now())), but
 * deliverDueNotifications compares it with a `now` from THIS computer's clock. Delivering a
 * millisecond after inserting raced the two: with the database clock even slightly ahead, the row
 * was "not due yet" and checks failed at random (2 of 4 runs at 09469ce, Nov 16). Every
 * insert-then-deliver below passes `now: await dueAt(...)`, the later of the computer's clock and
 * the rows' own nextAttemptAt, so the outcome no longer depends on the two clocks agreeing.
 */
async function dueAt(...dedupeKeys: string[]): Promise<Date> {
  const rows = await prisma.notification.findMany({ where: { dedupeKey: { in: dedupeKeys } }, select: { nextAttemptAt: true } })
  if (rows.length !== dedupeKeys.length) throw new Error(`dueAt: expected ${dedupeKeys.length} row(s), found ${rows.length}`)
  return new Date(Math.max(Date.now(), ...rows.map(r => r.nextAttemptAt.getTime())))
}

async function cleanup() {
  await prisma.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: PFX } }, { to: { endsWith: MAIL } }, { dedupeKey: { contains: PFX } }] } })
  // Rows from the trigger section carry the application id in the key; remove by payload marker.
  const rows = await prisma.notification.findMany({ select: { id: true, payload: true } })
  const mine = rows.filter(r => JSON.stringify(r.payload).includes(PFX)).map(r => r.id)
  if (mine.length) await prisma.notification.deleteMany({ where: { id: { in: mine } } })
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.partnerOrganization.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  // Isolate from any other suite's rows: this suite only reasons about rows it created.
  await prisma.notification.deleteMany({})
  const T = await import('../lib/email/transport')
  const N = await import('../lib/notifications')

  // ── [1] transport ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] Which transport runs where')
  assert(T.resolveEmailTransport({ NODE_ENV: 'development' }) === 'log' && T.resolveEmailTransport({ NODE_ENV: 'test', EMAIL_TRANSPORT: 'log' }) === 'log',
    '[0] control: dev and test get the log transport')
  assert(T.resolveEmailTransport({ NODE_ENV: 'production' }) === 'none', 'production with no provider → none')
  assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' }) === 'none', 'production asking for log → still none (log can never be selected in production)')
  assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'LOG ' }) === 'none', 'case/space tricks don\'t help (LOG ) → none')
  const prodT = T.getEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' })
  assert(prodT.kind === 'none' && prodT.canSend === false, 'the production transport object cannot send')
  const logLines: string[] = []
  const logT = T.getEmailTransport({ NODE_ENV: 'development' }, l => logLines.push(l))
  await logT.send({ to: ['a@x.test'], subject: 'S', text: 'B' })
  assert(logLines.length === 1 && logLines[0].startsWith('[email:log] to=a@x.test'), '[0] control: the dev log transport writes one [email:log] line')

  // ── [2] same transaction + dedupe ──────────────────────────────────────────────────────
  console.log('\n[2] Written with the application, once')
  const alert = (id: string) => ({ kind: 'partner' as const, name: `${PFX}Group ${id}`, contactName: 'C', email: `c${MAIL}`, phone: '6185550100' })
  try {
    await prisma.$transaction(async tx => {
      await N.enqueueSignupAlert(tx, `${PFX}rolled`, alert('rolled'))
      throw new Error('forced rollback')
    })
  } catch { /* expected */ }
  assert((await prisma.notification.count({ where: { dedupeKey: `signup:partner:${PFX}rolled` } })) === 0, 'a rolled-back transaction leaves no notification')
  await prisma.$transaction(async tx => { await N.enqueueSignupAlert(tx, `${PFX}ok`, alert('ok')) })
  assert((await prisma.notification.count({ where: { dedupeKey: `signup:partner:${PFX}ok` } })) === 1, '[0] control: a committed one is there')
  await prisma.$transaction(async tx => { await N.enqueueSignupAlert(tx, `${PFX}ok`, alert('ok')) })
  assert((await prisma.notification.count({ where: { dedupeKey: `signup:partner:${PFX}ok` } })) === 1, 'the same event enqueued again → still one row (dedupe)')

  // ── [3] delivery, working transport ────────────────────────────────────────────────────
  console.log('\n[3] Delivery with a working transport')
  const sent: { to: string[]; subject: string; text: string }[] = []
  const okT = { kind: 'log' as const, canSend: true, send: async (e: any) => { sent.push(e) } }
  await prisma.$transaction(async tx => { await N.enqueueDecisionEmail(tx, `${PFX}app1`, 'approved', `applicant${MAIL}`, { kind: 'partner', name: `${PFX}Scouts`, contactName: 'Pat' }) })
  const r1 = await N.deliverDueNotifications({
    transport: okT, alertEmails: async () => ['ops@client.test', 'two@client.test'],
    now: await dueAt(`signup:partner:${PFX}ok`, `decision:partner:${PFX}app1:approved`),
  })
  const adminRow = await prisma.notification.findUnique({ where: { dedupeKey: `signup:partner:${PFX}ok` } })
  const appRow = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app1:approved` } })
  assert(r1.sent === 2 && adminRow?.status === 'SENT' && appRow?.status === 'SENT' && !!adminRow.sentAt, '[0] positive control: the probe sees SENT rows after a delivery run')
  assert(sent.some(e => e.to.join(',') === 'ops@client.test,two@client.test' && e.subject.startsWith('New partner organization application')), 'the admin alert went to every alerts.email address')
  assert(sent.some(e => e.to.join(',') === `applicant${MAIL}` && e.subject === `${PFX}Scouts is approved on FairSynq`), 'the applicant email went to the applicant')
  assert(sent.length === 2 && sent.every((e: any) => typeof e.html === 'string' && e.html.includes('fairsynq-email-look-v1') && e.text.length > 0), 'every delivered email carries text AND the FairSynq html (multipart)')
  const r1b = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'] })
  assert(r1b.sent === 0 && sent.length === 2, 'a second run sends nothing again')

  // ── [4] no alerts.email ────────────────────────────────────────────────────────────────
  console.log('\n[4] Admin alerts with no alert email set')
  await prisma.$transaction(async tx => { await N.enqueueSignupAlert(tx, `${PFX}noaddr`, alert('noaddr')) })
  const t4 = await dueAt(`signup:partner:${PFX}noaddr`)
  const r2 = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => [], now: t4 })
  const held = await prisma.notification.findUnique({ where: { dedupeKey: `signup:partner:${PFX}noaddr` } })
  assert(r2.held === 1 && held?.status === 'PENDING' && held.heldReason === 'NO_ALERT_EMAIL' && held.attempts === 0, 'held with NO_ALERT_EMAIL, attempts unchanged, nothing sent')
  const later = new Date(t4.getTime() + N.NO_ALERT_EMAIL_RECHECK_MS + 1000)
  const r2b = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'], now: later })
  assert(r2b.sent === 1 && (await prisma.notification.findUnique({ where: { id: held!.id } }))?.status === 'SENT', '[0] control: once an address is set, the held alert goes out')

  // ── [5] failing transport → retries → FAILED ───────────────────────────────────────────
  console.log('\n[5] Retries, then FAILED')
  const badT = { kind: 'log' as const, canSend: true, send: async () => { throw new Error('provider 500') } }
  await prisma.$transaction(async tx => { await N.enqueueDecisionEmail(tx, `${PFX}app2`, 'rejected', `fail${MAIL}`, { kind: 'partner', name: `${PFX}X`, contactName: null, reason: 'Not this season' }) })
  let t = (await dueAt(`decision:partner:${PFX}app2:rejected`)).getTime()
  const gaps: number[] = []
  for (let i = 0; i < 5; i++) {
    await N.deliverDueNotifications({ transport: badT, now: new Date(t) })
    const row = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app2:rejected` } })
    if (row!.status === 'PENDING') { gaps.push(Math.round((row!.nextAttemptAt.getTime() - t) / 60e3)); t = row!.nextAttemptAt.getTime() + 1000 }
  }
  const failed = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app2:rejected` } })
  assert(JSON.stringify(gaps) === JSON.stringify([1, 5, 15, 60]), `retry gaps are 1, 5, 15, 60 minutes (got ${gaps.join(',')})`)
  assert(failed?.status === 'FAILED' && failed.attempts === 5 && failed.lastError === 'provider 500', 'after 5 attempts → FAILED, with the last error kept')

  // ── [5b] the clock race, reproduced on purpose ─────────────────────────────────────────
  // A row due 5 s in the future stands in for "the database clock is ahead". Delivering at the
  // computer's clock (the old timing) does not see it; delivering at dueAt() does. (5 s, not a few
  // ms, so this control cannot itself race; nothing waits, the time is passed in.)
  console.log('\n[5b] Control: the database-vs-computer clock race')
  const raceKey = `${PFX}race`
  await prisma.notification.create({ data: {
    audience: 'applicant', to: `race${MAIL}`, template: 'decision_approved',
    payload: { kind: 'partner', name: `${PFX}Race`, contactName: null }, dedupeKey: raceKey,
    nextAttemptAt: new Date(Date.now() + 5000),
  } })
  const sentBeforeRace = sent.length
  const rOld = await N.deliverDueNotifications({ transport: okT, now: new Date() })
  const raceRow = await prisma.notification.findUnique({ where: { dedupeKey: raceKey } })
  assert(rOld.sent === 0 && raceRow?.status === 'PENDING', '[0] control: at the computer\'s clock, a row due a moment later is NOT delivered (the old race)')
  const raceDue = await dueAt(raceKey)
  assert(raceDue.getTime() >= raceRow!.nextAttemptAt.getTime(), '[0] control: dueAt() is never earlier than the row\'s own nextAttemptAt')
  const rNew = await N.deliverDueNotifications({ transport: okT, now: raceDue })
  assert(rNew.sent === 1 && (await prisma.notification.findUnique({ where: { dedupeKey: raceKey } }))?.status === 'SENT' && sent.length === sentBeforeRace + 1,
    '[0] control: at dueAt(), the same row IS delivered')

  // ── [6] no provider ────────────────────────────────────────────────────────────────────
  console.log('\n[6] No email provider (production today)')
  await prisma.$transaction(async tx => {
    await N.enqueueSignupAlert(tx, `${PFX}prod1`, alert('prod1'))
    await N.enqueueDecisionEmail(tx, `${PFX}prod2`, 'approved', `prod${MAIL}`, { kind: 'partner', name: `${PFX}Y`, contactName: null })
  })
  const prodLog: string[] = []
  const noneT = T.getEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' }, l => prodLog.push(l))
  const origLog = console.log; const origWarn = console.warn; const captured: string[] = []
  console.log = (...a: unknown[]) => { captured.push(a.join(' ')) }; console.warn = (...a: unknown[]) => { captured.push(a.join(' ')) }
  let r3: Awaited<ReturnType<typeof N.deliverDueNotifications>>
  const t6 = await dueAt(`signup:partner:${PFX}prod1`, `decision:partner:${PFX}prod2:approved`)
  try { r3 = await N.deliverDueNotifications({ transport: noneT, alertEmails: async () => ['ops@client.test'], now: t6 }) } finally { console.log = origLog; console.warn = origWarn }
  const p1 = await prisma.notification.findUnique({ where: { dedupeKey: `signup:partner:${PFX}prod1` } })
  const p2 = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}prod2:approved` } })
  assert(r3!.sent === 0 && p1?.status === 'PENDING' && p2?.status === 'PENDING', 'nothing is marked SENT')
  assert(p1?.heldReason === 'NO_EMAIL_PROVIDER' && p2?.heldReason === 'NO_EMAIL_PROVIDER', 'both rows are held with reason NO_EMAIL_PROVIDER')
  assert(prodLog.length === 0 && captured.length === 0, 'nothing is written to the logs')
  const status = await N.outboxStatus(noneT)
  assert(status.connected === false && status.waitingAdmin >= 1 && status.waitingApplicant >= 1, 'the approvals page status says not connected, with both waiting counts')

  // ── [7] provider connected later ───────────────────────────────────────────────────────
  console.log('\n[7] Connecting a provider later')
  const old = new Date(Date.now() - N.STALE_ADMIN_ALERT_MS - 3600e3)
  await prisma.notification.update({ where: { id: p1!.id }, data: { createdAt: old } })
  await prisma.notification.update({ where: { id: p2!.id }, data: { createdAt: old } })
  const sentBefore = sent.length
  const r4 = await N.deliverDueNotifications({
    transport: okT, alertEmails: async () => ['ops@client.test'],
    now: await dueAt(`signup:partner:${PFX}prod1`, `decision:partner:${PFX}prod2:approved`),
  })
  const p1b = await prisma.notification.findUnique({ where: { id: p1!.id } }), p2b = await prisma.notification.findUnique({ where: { id: p2!.id } })
  assert(p1b?.status === 'SKIPPED' && p1b.lastError === 'Older than 48 hours when email was connected', 'a held admin alert older than 48h → SKIPPED, with the reason')
  assert(!!p1b, 'and it is kept, not deleted')
  assert(p2b?.status === 'SENT' && sent.slice(sentBefore).some(e => e.to[0] === `prod${MAIL}`), 'the equally old applicant email is sent')
  assert(r4.skipped === 1, '[0] control: exactly one row was skipped')

  // ── [8] templates ──────────────────────────────────────────────────────────────────────
  console.log('\n[8] Wording')
  const rej = N.renderEmail('decision_rejected', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: 'Missing insurance' })
  // email-look-v1: the plain text ends with the approved footer (Jordan, Nov 25, "FairSynq Email Look v1").
  const FOOTER = '\n\nQuestions? Just reply to this email, or write to support@fairsynq.com.\nFairSynq · Order ahead and skip the line at fairs and festivals.'
  assert(rej.subject === 'Your FairSynq application' && rej.text === `Hi Ana, we're not able to approve Taco Stand right now. Reason: Missing insurance. If you have questions, contact support@fairsynq.com.${FOOTER}`,
    'not-approved email: agreed wording and contact line, then the approved Email Look v1 footer')
  const apv = N.renderEmail('decision_approved', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana' })
  assert(apv.text === `Hi Ana, Taco Stand is approved. Sign in to finish your setup (payouts and menu): https://www.fairsynq.com/sign-in/vendor${FOOTER}`, 'vendor approved email: agreed wording')
  const adm = N.renderEmail('signup_admin_alert', { kind: 'organizer', name: 'County Fair Board', contactName: 'Lee', email: 'lee@x.test', phone: null })
  assert(adm.subject === 'New organizer application: County Fair Board'
      && adm.text.endsWith('Review it at https://www.fairsynq.com/admin/approvals\n\nFairSynq admin alert · sent to the alerts address in Platform settings.'),
    'admin alert: agreed subject and link, then the admin footer')

  // ── [9] triggers ───────────────────────────────────────────────────────────────────────
  console.log('\n[9] Each sign-up writes one admin alert')
  const login = (id: string) => { (globalThis as any).__MOCK_CLERK = { userId: id, publicMetadata: { roles: [] } } }
  const ev = await prisma.event.create({ data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const vu = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'V' } })
  login(vu.clerkId)
  const vendorsPOST = (await import('../app/api/vendors/route')).POST
  const vr = await vendorsPOST(new NextRequest('http://localhost/api/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventSlug: ev.urlSlug, name: `${PFX}Booth`, cuisineType: 'Tacos', legalName: 'V V', agreedToVendorAgreement: true }) }) as any)
  const vj: any = await vr.json()
  assert(vr.status === 201 && (await prisma.notification.count({ where: { dedupeKey: `signup:vendor:${vj.data.id}` } })) === 1, 'vendor sign-up → one admin alert')
  const { ensureOrganizerBootstrap } = await import('../lib/organizer-bootstrap')
  const ou = await prisma.user.create({ data: { clerkId: `${PFX}ou-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'O' } })
  const ob = await ensureOrganizerBootstrap(ou.id, { name: `${PFX}Org`, email: ou.email, phone: null })
  await ensureOrganizerBootstrap(ou.id, { name: `${PFX}Org`, email: ou.email, phone: null })
  assert((await prisma.notification.count({ where: { dedupeKey: `signup:organizer:${ob.organizerId}` } })) === 1, 'organizer bootstrap → one admin alert, even when run twice')
  const partnerPOST = (await import('../app/api/partners/apply/route')).POST
  const pr = await partnerPOST(new NextRequest('http://localhost/api/partners/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ name: `${PFX}PTA`, groupType: 'school', contactName: 'P', email: `p-${rand()}${MAIL}`, phone: '6185550100', city: 'Alton', state: 'IL' }) }) as any)
  const prow = await prisma.partnerOrganization.findFirst({ where: { name: `${PFX}PTA` } })
  assert(pr.status === 201 && !!prow && (await prisma.notification.count({ where: { dedupeKey: `signup:partner:${prow.id}` } })) === 1, 'partner application → one admin alert')

  // ── [10] Resend through the outbox (resend-email-v1) ───────────────────────────────────
  // The real Resend transport with fetch faked (no network), on the real outbox and test DB.
  console.log('\n[10] Resend through the outbox (fetch faked)')
  // Only this section's rows may be due: earlier sections' leftovers (e.g. [9]'s alerts) are parked.
  await prisma.notification.updateMany({ where: { status: { in: ['PENDING', 'SENDING'] } }, data: { status: 'SKIPPED' } })
  const KEY = 'rk-test-not-a-real-key-7Q2'
  const RS_ENV = { NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: KEY, EMAIL_FROM: 'FairSynq <support@fairsynq.com>', EMAIL_REPLY_TO: 'support@fairsynq.com' }
  const answerJson = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  let answer: () => Response = () => answerJson(200, { id: 're-test-1' })
  const calls: { body: any; headers: Record<string, string> }[] = []
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')), headers: (init?.headers ?? {}) as Record<string, string> })
    return answer()
  }) as typeof fetch
  const tLines: string[] = []
  const rs = T.getEmailTransport(RS_ENV, l => tLines.push(l), { fetchImpl: fakeFetch, errorLog: l => tLines.push(l) })
  const dLines: string[] = []
  const dlog = (_level: 'warn' | 'error', line: string) => { dLines.push(line) }
  const RS = `${PFX}rs-`
  const mk = (key: string, to: string) => prisma.notification.create({ data: {
    audience: 'applicant', to, template: 'decision_approved', payload: { kind: 'partner', name: `${PFX}Resend`, contactName: null }, dedupeKey: `${RS}${key}`,
  } })
  const row = (id: string) => prisma.notification.findUnique({ where: { id } })
  const clearRs = () => prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: RS } } })
  assert(rs.kind === 'resend' && rs.canSend, '[0] control: a resend transport that can send')

  // Safety switch
  const outside = await mk('outside', `vendor-${rand()}@gmail.test`)
  const inside = await mk('inside', 'jordan@fairsynq.com')
  const tSafe = await dueAt(`${RS}outside`, `${RS}inside`)
  const rSafe = await N.deliverDueNotifications({ transport: rs, now: tSafe, safeDomain: 'fairsynq.com', log: dlog })
  const outRow = await row(outside.id), inRow = await row(inside.id)
  assert(outRow?.status === 'PENDING' && outRow.heldReason === 'SAFE_RECIPIENT_DOMAIN' && outRow.attempts === 0 && outRow.sentAt === null,
    'safe domain set: the outside email waits (SAFE_RECIPIENT_DOMAIN), not SENT, attempts unchanged')
  assert(!!outRow, 'and it is kept, not deleted')
  assert(inRow?.status === 'SENT' && rSafe.sent === 1 && calls.length === 1 && calls[0].body.to[0] === 'jordan@fairsynq.com',
    '[0] control: the email inside the domain is sent (one request)')
  assert(calls[0].headers['Idempotency-Key'] === `notification-${inside.id}`, 'the request carries the row\'s idempotency key')
  assert(calls[0].body.from === RS_ENV.EMAIL_FROM && calls[0].body.reply_to === RS_ENV.EMAIL_REPLY_TO, 'from and reply_to come from the settings')
  assert(dLines.includes('[email] held: outside safe domain template=decision_approved') && dLines.every(l => !l.includes('gmail.test')),
    'the held line names the email type only, no address')
  assert((await N.outboxStatus(rs)).heldSafeDomain === 1, 'the approvals page counts it as held: outside the test domain')
  const rRelease = await N.deliverDueNotifications({ transport: rs, now: new Date(tSafe.getTime() + N.SAFE_DOMAIN_RECHECK_MS + 1000), safeDomain: null, log: dlog })
  assert(rRelease.sent === 1 && (await row(outside.id))?.status === 'SENT', '[0] control: with the switch removed, it goes out')
  await clearRs()

  // 429: waits, no attempt counted, the run stops
  answer = () => answerJson(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '120' })
  const rl1 = await mk('rl1', 'a@fairsynq.com')
  const rl2 = await mk('rl2', 'b@fairsynq.com')
  await prisma.notification.update({ where: { id: rl2.id }, data: { createdAt: new Date(rl1.createdAt.getTime() + 1000) } }) // rl1 is tried first
  const callsBefore429 = calls.length
  const t429 = await dueAt(`${RS}rl1`, `${RS}rl2`)
  const r429 = await N.deliverDueNotifications({ transport: rs, now: t429, safeDomain: null, log: dlog })
  const rl1Row = await row(rl1.id), rl2Row = await row(rl2.id)
  assert(rl1Row?.status === 'PENDING' && rl1Row.attempts === 0 && rl1Row.lastError === 'Resend 429 rate_limit_exceeded' && r429.rateLimited === 1,
    '429 → still waiting, attempts unchanged, reason kept')
  assert(rl1Row?.nextAttemptAt.getTime() === t429.getTime() + 120_000, 'it waits the 120 s Resend asked for')
  assert(calls.length === callsBefore429 + 1 && rl2Row?.status === 'PENDING' && rl2Row.lastError === null, 'the run stopped: the next email was not tried')
  await clearRs()

  // Our settings wrong: held, never FAILED
  for (const [status, name] of [[401, 'missing_api_key'], [403, 'validation_error'], [422, 'invalid_from_address']] as const) {
    answer = () => answerJson(status, { name })
    const h = await mk(`cfg-${status}`, 'c@fairsynq.com')
    const tc = await dueAt(`${RS}cfg-${status}`)
    const linesBefore = dLines.length
    await N.deliverDueNotifications({ transport: rs, now: tc, safeDomain: null, log: dlog })
    const hr = await row(h.id)
    assert(hr?.status === 'PENDING' && hr.attempts === 0 && hr.lastError === `Resend ${status} ${name}` && hr.nextAttemptAt.getTime() === tc.getTime() + N.SETTINGS_HOLD_MS,
      `${status} ${name} → held 15 min, attempts unchanged, not FAILED`)
    assert(dLines.slice(linesBefore).some(l => l.startsWith(`[email] Resend ${status} ${name}`)), `${status}: one error line naming the status and error only`)
    await clearRs()
  }

  // A malformed EMAIL_FROM: the transport cannot send, rows wait
  const badFromT = T.getEmailTransport({ ...RS_ENV, EMAIL_FROM: 'FairSynq support' }, l => tLines.push(l), { fetchImpl: fakeFetch, errorLog: l => tLines.push(l) })
  const bf = await mk('badfrom', 'd@fairsynq.com')
  const callsBeforeBadFrom = calls.length
  await N.deliverDueNotifications({ transport: badFromT, now: await dueAt(`${RS}badfrom`), safeDomain: null, log: dlog })
  const bfRow = await row(bf.id)
  assert(badFromT.canSend === false && bfRow?.status === 'PENDING' && bfRow.heldReason === 'NO_EMAIL_PROVIDER' && bfRow.attempts === 0 && calls.length === callsBeforeBadFrom,
    'malformed EMAIL_FROM → nothing requested, the email waits, attempts unchanged')
  assert(tLines.some(l => l.includes('malformed EMAIL_FROM')), 'one error line names EMAIL_FROM')
  await clearRs()

  // Any other 4xx: FAILED in one run
  answer = () => answerJson(422, { name: 'validation_error', message: 'Invalid `to` field' })
  const pf = await mk('perm', 'e@fairsynq.com')
  const rPerm = await N.deliverDueNotifications({ transport: rs, now: await dueAt(`${RS}perm`), safeDomain: null, log: dlog })
  const pfRow = await row(pf.id)
  assert(pfRow?.status === 'FAILED' && pfRow.attempts === 1 && pfRow.lastError === 'Resend 422 validation_error' && rPerm.failed === 1, '422 validation_error → FAILED at once, with the reason')

  // 5xx: the usual retry ladder
  answer = () => answerJson(500, { name: 'application_error' })
  const sx = await mk('5xx', 'f@fairsynq.com')
  const t5 = await dueAt(`${RS}5xx`)
  await N.deliverDueNotifications({ transport: rs, now: t5, safeDomain: null, log: dlog })
  const sxRow = await row(sx.id)
  assert(sxRow?.status === 'PENDING' && sxRow.attempts === 1 && sxRow.nextAttemptAt.getTime() === t5.getTime() + 60e3, '500 → retried in 1 minute (attempt counted)')

  // Nothing secret anywhere
  const rsRows = await prisma.notification.findMany({ where: { dedupeKey: { startsWith: RS } }, select: { lastError: true } })
  assert([...dLines, ...tLines, ...rsRows.map(r => r.lastError ?? '')].every(s => !s.includes(KEY)), 'the API key is in no log line and no stored reason')
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
