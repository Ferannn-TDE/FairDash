/**
 * FREE TEXT LIMITS — independent review F16 + F17 (Quick Lows batch 2; Jordan, Nov 17).
 *
 *   [1] F16 reason, pure: parseReviewReason (lib/menu-requests/review-reason.ts). Missing or blank →
 *       no reason; not text → refused; line breaks and control characters → spaces; at most 500
 *       whole characters; Jordan's two sentences exactly.
 *   [2] F16 reason, through the REAL decision routes on the test DB: the organizer route and the
 *       admin route (fair with no organizer) answer 400 VALIDATION_ERROR before anything changes, and
 *       store the cleaned reason when it is accepted.
 *   [3] F17 subject, pure, through the exported renderEmail: names with CR/LF/U+2028 never leave the
 *       subject on two lines; normal names give exactly today's subjects; the body keeps its lines.
 *   [4] F17 emailSubjectLine: 200 kept, 201 cut to 199 + "…", cut by WHOLE characters (an emoji is
 *       never split, no lone surrogate).
 *   [5] source: one exit for subjects, the reason checked before any database read, the page's
 *       input limit, no refusal sentence typed out by hand.
 *
 * Special characters (U+2028, U+2029, emoji) are BUILT at run time with String.fromCharCode /
 * String.fromCodePoint, never typed as escapes in this file.
 *
 * Every new export is checked before it is called, so against the old code the suite reports
 * failures instead of crashing (the bite test).
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/free-text-limits-test.ts
 * Self-cleaning, prefix ftl-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'ftl-'
const MAIL = '@ftl.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Source as text with LF endings and comments removed. */
const src = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function login(clerkId: string, roles?: string[]) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string; publicMetadata?: unknown } }).__MOCK_CLERK =
    { userId: clerkId, ...(roles && { publicMetadata: { roles } }) }
}
function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
async function bodyOf(res: Response): Promise<{ data?: Record<string, unknown>; error?: { code?: string; message?: string } } | null> {
  try { return await res.json() } catch { return null }
}

// Characters built at run time (see the header).
const LS = String.fromCharCode(0x2028)   // line separator
const PS = String.fromCharCode(0x2029)   // paragraph separator
const NEL = String.fromCharCode(0x85)    // C1 "next line"
const EMOJI = String.fromCodePoint(0x1F600) // two UTF-16 units

/** True when every high surrogate is followed by a low one and every low one follows a high one. */
function noLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false
      i++
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      return false
    }
  }
  return true
}
/** No CR, LF, other control character, U+2028 or U+2029 anywhere. */
function oneLine(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || (c >= 0x7F && c <= 0x9F) || c === 0x2028 || c === 0x2029) return false
  }
  return true
}
const chars = (s: string) => Array.from(s).length

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

type ReasonLib = {
  REVIEW_REASON_MAX?: number
  REVIEW_REASON_NOT_TEXT_MESSAGE?: string
  REVIEW_REASON_TOO_LONG_MESSAGE?: string
  parseReviewReason?: (raw: unknown) => { ok: true; reason: string | null } | { ok: false; message: string }
}
type MailLib = {
  renderEmail: (template: string, payload: unknown) => { subject: string; text: string }
  emailSubjectLine?: (s: string) => string
  EMAIL_SUBJECT_MAX?: number
  VENDOR_OVERRIDE_TEMPLATE: string
}

async function main() {
  console.log('\n══ FREE TEXT LIMITS (review F16 + F17) ══')
  await cleanup()

  let reasonLib: ReasonLib = {}
  try { reasonLib = await import('../lib/menu-requests/review-reason') as ReasonLib } catch { /* old code: no such file */ }
  const mail = await import('../lib/notifications') as unknown as MailLib
  const TOO_LONG = 'The reason can be at most 500 characters.'
  const NOT_TEXT = 'The reason must be text.'

  // ── [1] F16 reason, pure ────────────────────────────────────────────────────────────────────
  console.log('\n[1] the review reason, pure (parseReviewReason)')
  const parse = reasonLib.parseReviewReason
  const P = (raw: unknown) => (parse ? parse(raw) : { ok: false as const, message: 'parseReviewReason is missing' })
  const isNone = (raw: unknown) => { const r = P(raw); return r.ok && r.reason === null }
  const cleanedTo = (raw: unknown, want: string) => { const r = P(raw); return r.ok && r.reason === want }
  const refusedWith = (raw: unknown, msg: string) => { const r = P(raw); return !r.ok && r.message === msg }
  assert(typeof parse === 'function' && reasonLib.REVIEW_REASON_MAX === 500, 'parseReviewReason exists; REVIEW_REASON_MAX is 500')
  assert(reasonLib.REVIEW_REASON_NOT_TEXT_MESSAGE === NOT_TEXT && reasonLib.REVIEW_REASON_TOO_LONG_MESSAGE === TOO_LONG,
    'both sentences read exactly as Jordan approved')
  assert([undefined, null, '', '   '].every(isNone), 'undefined, null, empty and blank → no reason')
  assert(cleanedTo('  Image required  ', 'Image required'), "'  Image required  ' → 'Image required' (trimmed)")
  assert(cleanedTo('a\nb', 'a b') && cleanedTo('a\r\nb', 'a b') && cleanedTo('a\tb', 'a b') && cleanedTo(`a${LS}b`, 'a b')
      && cleanedTo(`a${PS}b`, 'a b') && cleanedTo(`a${NEL}b`, 'a b'),
    'LF, CRLF, tab, U+2028, U+2029 and C1 NEL each become one space')
  assert(cleanedTo('a  \n\n  b', 'a b'), 'repeated spaces left by the cleaning squeeze to one')
  assert(cleanedTo('x'.repeat(500), 'x'.repeat(500)), '500 characters → accepted')
  assert(refusedWith('x'.repeat(501), TOO_LONG), '501 characters → refused with the too-long sentence')
  assert(cleanedTo(`${' '.repeat(50)}${'x'.repeat(500)}${' '.repeat(50)}`, 'x'.repeat(500)), '600 characters that are 500 after trimming → accepted')
  assert(cleanedTo(EMOJI.repeat(500), EMOJI.repeat(500)) && refusedWith(EMOJI.repeat(501), TOO_LONG),
    '500 emoji (1000 UTF-16 units) → accepted; 501 → refused: whole characters are counted')
  assert([5, true, {}, []].every(v => refusedWith(v, NOT_TEXT)), 'a number, true, an object or an array → refused with the not-text sentence')

  // ── [2] F16 reason, through the real routes ─────────────────────────────────────────────────
  console.log('\n[2] the review reason through the real decision routes')
  const org = await prisma.fairOrganizer.create({
    data: { name: `${PFX}org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
  })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'Organizer' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const mkFair = (organizerId: string | null, tag: string) => prisma.event.create({
    data: {
      name: `${PFX}${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status: 'ACTIVE', organizerId,
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })
  const orgFair = await mkFair(org.id, 'org-fair')
  const noOrgFair = await mkFair(null, 'no-org-fair')
  const vUser = await prisma.user.create({ data: { clerkId: `${PFX}v-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Operator', role: 'vendor' } })
  const mkVendor = async (eventId: string, tag: string) => {
    const v = await prisma.vendor.create({ data: { eventId, name: `${PFX}${tag}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
    await prisma.vendorMember.create({ data: { vendorId: v.id, userId: vUser.id, role: 'owner', approvalStatus: 'APPROVED' } })
    return v
  }
  const orgVendor = await mkVendor(orgFair.id, 'booth-a')
  const noOrgVendor = await mkVendor(noOrgFair.id, 'booth-b')
  const admin = await prisma.user.create({ data: { clerkId: `${PFX}admin-${rand()}`, email: `adm-${rand()}${MAIL}`, name: 'Admin' } })

  const mkRequest = (vendorId: string) => prisma.menuRequest.create({
    data: { vendorId, requestedBy: vUser.id, status: 'PENDING', type: 'ADD', name: `${PFX}item-${rand()}`, price: 5, category: 'Mains' } as never,
  })
  const rowOf = async (id: string) => prisma.menuRequest.findUniqueOrThrow({ where: { id }, select: { status: true, reviewNote: true } })

  const orgPATCH = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string; id: string }> }) => Promise<Response>
  const adminPATCH = (await import('../app/api/admin/events/[id]/menu-requests/[requestId]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ id: string; requestId: string }> }) => Promise<Response>
  const orgReject = async (reason: unknown) => {
    const req = await mkRequest(orgVendor.id)
    login(orgUser.clerkId)
    const res = await orgPATCH(jsonReq(`/api/organizer/fairs/${orgFair.urlSlug}/menu-requests/${req.id}`, { action: 'REJECT', reason }),
      { params: Promise.resolve({ fairSlug: orgFair.urlSlug, id: req.id }) })
    return { status: res.status, body: await bodyOf(res), row: await rowOf(req.id) }
  }
  const adminReject = async (reason: unknown) => {
    const req = await mkRequest(noOrgVendor.id)
    login(admin.clerkId, ['admin'])
    const res = await adminPATCH(jsonReq(`/api/admin/events/${noOrgFair.id}/menu-requests/${req.id}`, { action: 'REJECT', reason }),
      { params: Promise.resolve({ id: noOrgFair.id, requestId: req.id }) })
    return { status: res.status, body: await bodyOf(res), row: await rowOf(req.id) }
  }

  {
    const long = await orgReject('x'.repeat(501))
    assert(long.status === 400 && long.body?.error?.code === 'VALIDATION_ERROR' && long.body?.error?.message === TOO_LONG && long.row.status === 'PENDING',
      `organizer: 501 characters → 400 VALIDATION_ERROR "${TOO_LONG}", request still PENDING (got ${long.status} ${long.body?.error?.code ?? ''}, ${long.row.status})`)
    const obj = await orgReject({ a: 1 })
    assert(obj.status === 400 && obj.body?.error?.code === 'VALIDATION_ERROR' && obj.body?.error?.message === NOT_TEXT && obj.row.status === 'PENDING',
      `organizer: an object as the reason → 400 "${NOT_TEXT}" (it used to be a 500), still PENDING (got ${obj.status}, ${obj.row.status})`)
    const max = await orgReject('y'.repeat(500))
    assert(max.status === 200 && max.row.status === 'REJECTED' && max.row.reviewNote === 'y'.repeat(500),
      `organizer: 500 characters → 200, REJECTED, stored as sent (got ${max.status}, ${max.row.status}, ${max.row.reviewNote?.length ?? 'null'} chars)`)
    const lines = await orgReject('  bad\nphoto  ')
    assert(lines.status === 200 && lines.row.reviewNote === 'bad photo',
      `organizer: '  bad\\nphoto  ' → stored as 'bad photo' (got ${lines.status}, ${JSON.stringify(lines.row.reviewNote)})`)
    const blank = await orgReject('   ')
    assert(blank.status === 200 && blank.row.status === 'REJECTED' && blank.row.reviewNote === null,
      `organizer: a blank reason → 200, stored as no reason (got ${blank.status}, ${JSON.stringify(blank.row.reviewNote)})`)

    const aLong = await adminReject('z'.repeat(501))
    assert(aLong.status === 400 && aLong.body?.error?.message === TOO_LONG && aLong.row.status === 'PENDING',
      `admin (fair with no organizer): 501 characters → 400, still PENDING (got ${aLong.status}, ${aLong.row.status})`)
    const aOk = await adminReject('Needs a photo')
    assert(aOk.status === 200 && aOk.row.status === 'REJECTED' && aOk.row.reviewNote === 'Needs a photo',
      `[0] control: the same admin route with a normal reason → 200, REJECTED, stored (got ${aOk.status}, ${aOk.row.status})`)
  }

  // ── [3] F17 subjects through renderEmail ────────────────────────────────────────────────────
  console.log('\n[3] email subjects through renderEmail: always one line')
  const subjectOf = (template: string, payload: unknown) => mail.renderEmail(template, payload).subject
  const SIGNUP = (name: string) => ['signup_admin_alert', { kind: 'organizer', name, contactName: 'Lee', email: 'lee@x.test', phone: null }] as const
  const OVERRIDE = (vendorName: string, fairName: string) => [mail.VENDOR_OVERRIDE_TEMPLATE, { vendorName, fairName, decision: 'approved', reason: 'r', link: 'L' }] as const
  const DELETED = (vendorName: string, fairName: string) => ['menu_items_deleted', { alertType: 'MENU_ITEMS_DELETED', fairName, vendorName, lines: ['a', 'b'], link: 'L' }] as const
  const PRICE = (vendorName: string) => ['menu_price_change_pending', { alertType: 'MENU_PRICE_CHANGE_PENDING', fairName: 'F', vendorName, lines: ['a', 'b'], link: 'L' }] as const

  assert(subjectOf(...SIGNUP('County Fair Board')) === 'New organizer application: County Fair Board'
      && subjectOf(...OVERRIDE('Taco Stand', 'Dev Fair')) === 'FairSynq approved Taco Stand at Dev Fair'
      && subjectOf(...DELETED('Taco Stand', 'Dev Fair')) === 'Taco Stand removed 2 menu items at Dev Fair'
      && subjectOf(...PRICE('Taco Stand')) === '2 price increases are waiting for your approval: Taco Stand'
      && subjectOf('decision_approved', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana' }) === "You're approved on FairSynq"
      && subjectOf('decision_rejected', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: 'x' }) === 'Your FairSynq application',
    'normal names → exactly today\'s subjects, every template')

  const INJECT = 'X\r\nBcc: evil@example.com'
  const nasty = [`Taco\r\nStand`, `Taco\nStand`, `Taco${LS}Stand`, `Taco${PS}Stand`, INJECT]
  for (const name of nasty) {
    const subjects = [
      subjectOf(...SIGNUP(name)), subjectOf(...OVERRIDE(name, name)), subjectOf(...DELETED(name, name)), subjectOf(...PRICE(name)),
    ]
    const label = JSON.stringify(name).replace(/[^\x20-\x7E]/g, c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    assert(subjects.every(oneLine), `name ${label}: all 4 subjects are one line (no CR, LF, control, U+2028/2029)`)
    if (name === INJECT) {
      assert(subjects.every(s => s.includes('X Bcc: evil@example.com') && !/(^|\n)Bcc:/.test(s)),
        'the injected words are still there, flattened onto one line; "Bcc:" never starts a line')
    }
  }
  const body = mail.renderEmail(...DELETED('Taco\nStand', 'Dev Fair')).text
  assert(body.includes('\n- a\n- b\n') && body.includes('\n\nSee the vendor'), 'the email BODY still keeps its line breaks (only subjects are flattened)')

  // ── [4] F17 emailSubjectLine ────────────────────────────────────────────────────────────────
  console.log('\n[4] emailSubjectLine: 200 characters, cut by whole characters')
  const line = mail.emailSubjectLine
  const L = (s: string) => (line ? line(s) : s)
  assert(typeof line === 'function' && mail.EMAIL_SUBJECT_MAX === 200, 'emailSubjectLine exists; EMAIL_SUBJECT_MAX is 200')
  const s200 = 'a'.repeat(200), s201 = 'a'.repeat(201)
  assert(L(s200) === s200, '200 characters → unchanged')
  assert(chars(L(s201)) === 200 && L(s201) === `${'a'.repeat(199)}…`, '201 characters → 199 + "…" (200 in all)')
  assert(L('a\r\n\r\nb') === 'a b', '"a\\r\\n\\r\\nb" → "a b"')
  const longButShort = `${'b'.repeat(190)}\r\n\r\n\r\n${'c'.repeat(8)}`
  assert(L(longButShort) === `${'b'.repeat(190)} ${'c'.repeat(8)}`, 'a name that is 199 characters after flattening is not cut')
  const at199 = `${'d'.repeat(199)}${EMOJI}${'e'.repeat(10)}`
  const cut199 = L(at199)
  assert(chars(cut199) === 200 && cut199.endsWith('…') && noLoneSurrogate(cut199),
    '199 letters + an emoji + more → 200 characters, ends with "…", no lone surrogate (Jordan\'s row)')
  const at198 = `${'d'.repeat(198)}${EMOJI}${'e'.repeat(10)}`
  const cut198 = L(at198)
  assert(chars(cut198) === 200 && cut198 === `${'d'.repeat(198)}${EMOJI}…` && noLoneSurrogate(cut198),
    '198 letters + an emoji + more → the emoji is kept whole as character 199, then "…" (a plain .slice would split it)')
  assert(L(EMOJI.repeat(200)) === EMOJI.repeat(200) && L(EMOJI.repeat(201)) === `${EMOJI.repeat(199)}…` && noLoneSurrogate(L(EMOJI.repeat(201))),
    '200 emoji → unchanged; 201 emoji → 199 emoji + "…", no lone surrogate')
  assert(!noLoneSurrogate(at198.slice(0, 199)), '[0] control: the old way (.slice(0, 199)) DOES leave a lone surrogate on that subject')

  // ── [5] source ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[5] source: one exit for subjects; the reason checked first; the page limit; no typed sentences')
  const orgRoute = src('app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts')
  const adminRoute = src('app/api/admin/events/[id]/menu-requests/[requestId]/route.ts')
  assert([orgRoute, adminRoute].every(r => /applyMenuRequestDecision\(\{[\s\S]*?\n\s*reason,\n[\s\S]*?\}\)/.test(r)),
    'both decision routes pass reason to applyMenuRequestDecision (the one place it is checked)')
  const decide = src('lib/menu-requests/apply-decision.ts')
  const fnAt = decide.indexOf('export async function applyMenuRequestDecision(')
  const parseAt = decide.indexOf('parseReviewReason(input.reason)', fnAt)
  const firstDb = decide.indexOf('db.', fnAt)
  assert(fnAt > 0 && parseAt > fnAt && parseAt < firstDb
      && /if \(!parsedReason\.ok\) throw new ApiError\(parsedReason\.message, 400, 'VALIDATION_ERROR'\)/.test(decide)
      && !/input\.reason \?\? null/.test(decide),
    'applyMenuRequestDecision checks the reason first, before any database read, and throws 400 VALIDATION_ERROR')
  const notif = src('lib/notifications.ts')
  assert(/export function renderEmail\([^)]*\)[^\n]*\{\n\s*const \{ subject, text \} = renderEmailParts\(template, payload\)\s*return \{ subject: emailSubjectLine\(subject\), text \}\s*\}/.test(notif)
      && !/export function renderEmailParts/.test(notif) && (notif.match(/renderEmailParts\(/g) ?? []).length === 2,
    'renderEmail is the one exit: renderEmailParts (private) → emailSubjectLine(subject)')
  assert(/renderEmail\(n\.template, n\.payload\)/.test(notif), 'deliverDueNotifications renders through renderEmail')
  assert(/const \w+ = \/\[\\p\{Cc\}\\p\{Zl\}\\p\{Zp\}\]\/gu/.test(notif)
      && /const \w+ = \/\[\\p\{Cc\}\\p\{Zl\}\\p\{Zp\}\]\/gu/.test(src('lib/menu-requests/review-reason.ts')),
    'both control-character patterns are /[\\p{Cc}\\p{Zl}\\p{Zp}]/gu (plain ASCII source)')
  const page = src('app/organizer/fairs/[fairSlug]/menu-requests/page.tsx')
  assert(page.includes('maxLength={REVIEW_REASON_MAX}') && page.includes("from '@/lib/menu-requests/review-reason'"),
    'the organizer page caps the Reject input at REVIEW_REASON_MAX')
  const typed = ['app/organizer/fairs/[fairSlug]/menu-requests/page.tsx', 'lib/menu-requests/apply-decision.ts',
    'app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts', 'app/api/admin/events/[id]/menu-requests/[requestId]/route.ts']
    .filter(f => /The reason must be text|The reason can be at most/.test(src(f)))
  assert(typed.length === 0, `no refusal sentence typed out by hand outside review-reason.ts (${typed.join(', ') || 'none'})`)
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
