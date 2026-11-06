/**
 * NOTIFICATION OUTBOX + EMAIL TRANSPORT (Batch 1 item 9, B1.12) — real lib, test DB.
 *
 *   [1] Transport: log in dev/test; in production NEVER log (even if asked) — always 'none'
 *   [2] Same transaction: a rolled-back write leaves no notification; dedupe makes a retry a no-op
 *   [3] Delivery with a working transport: claimed, sent, SENT; admin rows go to alerts.email
 *   [4] Admin rows with no alerts.email: held (NO_ALERT_EMAIL), not sent, attempts unchanged
 *   [5] Failing transport: retries 1/5/15/60 then FAILED after 5 attempts
 *   [6] No provider ('none'): nothing SENT, nothing logged, rows held NO_EMAIL_PROVIDER
 *   [7] Provider connected later: held admin alerts older than 48h → SKIPPED (kept); applicant
 *       emails of any age are sent
 *   [8] Templates: the agreed wording; the contact line (no "reply to this email")
 *   [9] Triggers: vendor, organizer and partner sign-ups each write exactly one admin alert
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
  const r1 = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test', 'two@client.test'] })
  const adminRow = await prisma.notification.findUnique({ where: { dedupeKey: `signup:partner:${PFX}ok` } })
  const appRow = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app1:approved` } })
  assert(r1.sent === 2 && adminRow?.status === 'SENT' && appRow?.status === 'SENT' && !!adminRow.sentAt, '[0] positive control: the probe sees SENT rows after a delivery run')
  assert(sent.some(e => e.to.join(',') === 'ops@client.test,two@client.test' && e.subject.startsWith('New partner organization application')), 'the admin alert went to every alerts.email address')
  assert(sent.some(e => e.to.join(',') === `applicant${MAIL}` && e.subject === "You're approved on FairSynq"), 'the applicant email went to the applicant')
  const r1b = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'] })
  assert(r1b.sent === 0 && sent.length === 2, 'a second run sends nothing again')

  // ── [4] no alerts.email ────────────────────────────────────────────────────────────────
  console.log('\n[4] Admin alerts with no alert email set')
  await prisma.$transaction(async tx => { await N.enqueueSignupAlert(tx, `${PFX}noaddr`, alert('noaddr')) })
  const r2 = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => [] })
  const held = await prisma.notification.findUnique({ where: { dedupeKey: `signup:partner:${PFX}noaddr` } })
  assert(r2.held === 1 && held?.status === 'PENDING' && held.heldReason === 'NO_ALERT_EMAIL' && held.attempts === 0, 'held with NO_ALERT_EMAIL, attempts unchanged, nothing sent')
  const later = new Date(Date.now() + N.NO_ALERT_EMAIL_RECHECK_MS + 1000)
  const r2b = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'], now: later })
  assert(r2b.sent === 1 && (await prisma.notification.findUnique({ where: { id: held!.id } }))?.status === 'SENT', '[0] control: once an address is set, the held alert goes out')

  // ── [5] failing transport → retries → FAILED ───────────────────────────────────────────
  console.log('\n[5] Retries, then FAILED')
  const badT = { kind: 'log' as const, canSend: true, send: async () => { throw new Error('provider 500') } }
  await prisma.$transaction(async tx => { await N.enqueueDecisionEmail(tx, `${PFX}app2`, 'rejected', `fail${MAIL}`, { kind: 'partner', name: `${PFX}X`, contactName: null, reason: 'Not this season' }) })
  let t = Date.now()
  const gaps: number[] = []
  for (let i = 0; i < 5; i++) {
    await N.deliverDueNotifications({ transport: badT, now: new Date(t) })
    const row = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app2:rejected` } })
    if (row!.status === 'PENDING') { gaps.push(Math.round((row!.nextAttemptAt.getTime() - t) / 60e3)); t = row!.nextAttemptAt.getTime() + 1000 }
  }
  const failed = await prisma.notification.findUnique({ where: { dedupeKey: `decision:partner:${PFX}app2:rejected` } })
  assert(JSON.stringify(gaps) === JSON.stringify([1, 5, 15, 60]), `retry gaps are 1, 5, 15, 60 minutes (got ${gaps.join(',')})`)
  assert(failed?.status === 'FAILED' && failed.attempts === 5 && failed.lastError === 'provider 500', 'after 5 attempts → FAILED, with the last error kept')

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
  try { r3 = await N.deliverDueNotifications({ transport: noneT, alertEmails: async () => ['ops@client.test'] }) } finally { console.log = origLog; console.warn = origWarn }
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
  const r4 = await N.deliverDueNotifications({ transport: okT, alertEmails: async () => ['ops@client.test'] })
  const p1b = await prisma.notification.findUnique({ where: { id: p1!.id } }), p2b = await prisma.notification.findUnique({ where: { id: p2!.id } })
  assert(p1b?.status === 'SKIPPED' && p1b.lastError === 'Older than 48 hours when email was connected', 'a held admin alert older than 48h → SKIPPED, with the reason')
  assert(!!p1b, 'and it is kept, not deleted')
  assert(p2b?.status === 'SENT' && sent.slice(sentBefore).some(e => e.to[0] === `prod${MAIL}`), 'the equally old applicant email is sent')
  assert(r4.skipped === 1, '[0] control: exactly one row was skipped')

  // ── [8] templates ──────────────────────────────────────────────────────────────────────
  console.log('\n[8] Wording')
  const rej = N.renderEmail('decision_rejected', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: 'Missing insurance' })
  assert(rej.subject === 'Your FairSynq application' && rej.text === "Hi Ana, we're not able to approve Taco Stand right now. Reason: Missing insurance. If you have questions, contact contact@fairsynq.com.",
    'not-approved email: agreed wording, contact line, no "reply to this email"')
  const apv = N.renderEmail('decision_approved', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana' })
  assert(apv.text === 'Hi Ana, Taco Stand is approved. Sign in to finish your setup (payouts and menu): https://www.fairsynq.com/sign-in/vendor', 'vendor approved email: agreed wording')
  const adm = N.renderEmail('signup_admin_alert', { kind: 'organizer', name: 'County Fair Board', contactName: 'Lee', email: 'lee@x.test', phone: null })
  assert(adm.subject === 'New organizer application: County Fair Board' && adm.text.endsWith('Review it at https://www.fairsynq.com/admin/approvals'), 'admin alert: agreed subject and link')

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
