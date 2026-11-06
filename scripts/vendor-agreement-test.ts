/**
 * VENDOR AGREEMENT CHECKBOX + VENDOR PITCH (Batch 1 item 8: B1.10 + B1.9) — real route, test DB.
 *
 *   [1] The agreement module never holds placeholder terms, and its version matches its own
 *       "Last Updated" line (each check positive-controlled)
 *   [2] One source: the wizard, /vendor-agreement and the server all read lib/legal/vendor-agreement.ts
 *   [3] POST /api/vendors: no agreement flag → 400 CONSENT_REQUIRED and no vendor; with it → 201;
 *       a forged termsVersion is ignored (the server's version is stored); the typed name stays required
 *   [4] The wizard can't submit step 4 without the box AND the name; the link opens /vendor-agreement
 *   [5] The pitch: approved copy verbatim; no payout-timing wording (scanner positive-controlled)
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/vendor-agreement-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'vagr-'
const MAIL = '@vagr.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles: [] } } : undefined }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const PLACEHOLDER = /\bTODO\b|\bTBD\b|PLACEHOLDER|lorem ipsum|\[[^\]\n]{0,40}\]|\bXX+\b/i
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function versionMatchesLastUpdated(version: string, text: string): boolean {
  const m = text.match(/Last Updated: ([A-Z][a-z]+) (\d{1,2}), (\d{4})/)
  if (!m) return false
  const iso = `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return iso === version
}

async function main() {
  await cleanup()
  const agreement = await import('../lib/legal/vendor-agreement')

  // ── [1] no placeholder terms, version honest ───────────────────────────────────────────
  console.log('\n[1] The agreement module')
  assert(PLACEHOLDER.test('4. FEES\nTBD by the client') && PLACEHOLDER.test('[Company address]') && PLACEHOLDER.test('Lorem ipsum dolor'),
    '[0] positive control: the scanner flags TBD, [bracketed blanks] and lorem ipsum')
  assert(!PLACEHOLDER.test('Disputes shall be resolved by binding arbitration.'), '[0] baseline: real terms are not flagged')
  assert(!PLACEHOLDER.test(agreement.VENDOR_AGREEMENT_TEXT), 'the agreement text holds no placeholder markers')
  assert(!versionMatchesLastUpdated('2026-02-01', agreement.VENDOR_AGREEMENT_TEXT), '[0] positive control: a version that disagrees with "Last Updated" is caught')
  assert(versionMatchesLastUpdated(agreement.VENDOR_AGREEMENT_VERSION, agreement.VENDOR_AGREEMENT_TEXT),
    `the version (${agreement.VENDOR_AGREEMENT_VERSION}) matches the text's "Last Updated" line`)
  assert(agreement.VENDOR_AGREEMENT_TEXT.startsWith('FAIRSYNQ VENDOR AGREEMENT') && agreement.VENDOR_AGREEMENT_TEXT.length > 2000,
    'it is the full agreement, not a stub')

  // ── [2] one source ────────────────────────────────────────────────────────────────────
  console.log('\n[2] Wizard, page and server read the same module')
  const wizard = readFileSync('app/become-vendor/VendorOnboarding.tsx', 'utf8')
  const page = readFileSync('app/vendor-agreement/page.tsx', 'utf8')
  const route = readFileSync('app/api/vendors/route.ts', 'utf8')
  assert(/from '@\/lib\/legal\/vendor-agreement'/.test(wizard) && /\{VENDOR_AGREEMENT_TEXT\}/.test(wizard), 'the wizard shows VENDOR_AGREEMENT_TEXT')
  assert(!/FAIRSYNQ VENDOR AGREEMENT|VENDOR_TERMS\b|termsVersion/.test(wizard), 'the wizard has no inline agreement and sends no version')
  assert(/VENDOR_AGREEMENT_TEXT/.test(page) && /VENDOR_AGREEMENT_VERSION/.test(page), '/vendor-agreement publishes the same text and version')
  assert(/termsVersion:\s+VENDOR_AGREEMENT_VERSION/.test(route) && !/termsVersion \?\?/.test(route) && !/const \{[^}]*termsVersion[^}]*\} = body/.test(route),
    'the server stores VENDOR_AGREEMENT_VERSION and never reads a version from the body')

  // ── [3] the route ─────────────────────────────────────────────────────────────────────
  console.log('\n[3] POST /api/vendors')
  const { POST } = await import('../app/api/vendors/route')
  const event = await prisma.event.create({
    data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) },
  })
  const apply = async (extra: object) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}u-${rand()}`, email: `u-${rand()}${MAIL}`, name: 'V' } })
    login(u.clerkId)
    const r = await POST(new NextRequest('http://localhost/api/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventSlug: event.urlSlug, name: `${PFX}Booth ${rand()}`, cuisineType: 'Tacos', legalName: 'Jane Smith', ...extra }),
    }) as any)
    const j: any = await r.json()
    return { status: r.status, code: j?.error?.code as string | undefined }
  }
  const countVendors = () => prisma.vendor.count({ where: { eventId: event.id } })
  const n0 = await countVendors()
  const noFlag = await apply({})
  assert(noFlag.status === 400 && noFlag.code === 'CONSENT_REQUIRED', `no agreement flag → 400 CONSENT_REQUIRED (got ${noFlag.status} ${noFlag.code})`)
  const falseFlag = await apply({ agreedToVendorAgreement: 'true' })
  assert(falseFlag.status === 400 && falseFlag.code === 'CONSENT_REQUIRED', 'the string "true" is not agreement (must be boolean true)')
  const noName = await apply({ agreedToVendorAgreement: true, legalName: '  ' })
  assert(noName.status === 400 && noName.code === 'CONSENT_REQUIRED', 'the typed legal name is still required (C-19)')
  assert((await countVendors()) === n0, 'none of the refusals created a vendor')
  const ok = await apply({ agreedToVendorAgreement: true, termsVersion: 'forged-9999' })
  assert(ok.status === 201, `[0] control: with the box ticked and a name → 201 (got ${ok.status} ${ok.code})`)
  const stored = await prisma.vendor.findFirst({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' }, select: { termsVersion: true, termsAcceptedName: true, termsAcceptedAt: true } })
  assert(stored?.termsVersion === agreement.VENDOR_AGREEMENT_VERSION, `a forged termsVersion is ignored: stored ${stored?.termsVersion}`)
  assert(stored?.termsAcceptedName === 'Jane Smith' && !!stored?.termsAcceptedAt, 'the typed name and acceptance time are recorded')

  // ── [4] wizard gate ───────────────────────────────────────────────────────────────────
  console.log('\n[4] The wizard step 4 gate')
  assert(/case 4: return data\.legalName\.trim\(\)\.length >= 3 && data\.agreedToVendorAgreement/.test(wizard), 'Submit needs the name AND the ticked box')
  assert(/agreedToVendorAgreement: data\.agreedToVendorAgreement,/.test(wizard), 'the wizard sends the box to the server')
  assert(/href=\{VENDOR_AGREEMENT_PATH\} target="_blank"[\s\S]{0,200}FairSynq Vendor Agreement/.test(wizard) && agreement.VENDOR_AGREEMENT_PATH === '/vendor-agreement',
    '"I agree to the FairSynq Vendor Agreement" links to /vendor-agreement in a new tab')

  // ── [5] the pitch ─────────────────────────────────────────────────────────────────────
  console.log('\n[5] The vendor pitch')
  const { VENDOR_PITCH } = await import('../lib/vendor-pitch')
  const flat = VENDOR_PITCH.heading + ' ' + VENDOR_PITCH.points.map(p => `${p.lead} ${p.text}`).join(' ')
  const APPROVED = [
    'Sell more at every event. Free.',
    'Free to use. No sign-up cost, no monthly fee, no commission on your sales. Standard card processing comes out of each payout.',
    'More sales. Fairgoers order from their phones instead of walking away from your line.',
    'One menu for every event, coming in December. Build your menu once and use it at every fair you work.',
    'Fast payouts. Customers pay by card before you start cooking, and your earnings go straight to your bank through Stripe.',
  ]
  for (const line of APPROVED) assert(flat.includes(line), `approved copy verbatim: ${line.slice(0, 55)}…`)
  const TIMING = /\b\d+\s*(business\s+|working\s+)?(hours?|hrs?|days?|minutes?|mins?|weeks?)\b|\bsame[- ]day\b|\bnext[- ]day\b|\bwithin\b|\bsoon after\b|\binstant/i
  assert(TIMING.test('payouts 4 hours after each order') && TIMING.test('paid soon after each order') && TIMING.test('2 business days'),
    '[0] positive control: the timing scanner flags "4 hours", "soon after" and "2 business days"')
  assert(!TIMING.test(flat), 'the pitch makes no payout-timing claim')
  // The agreement must be readable before sign-up: the proxy's vendor gate must not cover it.
  const proxy = readFileSync('proxy.ts', 'utf8')
  const protectedBlock = proxy.slice(proxy.indexOf('isProtectedRoute = createRouteMatcher(['), proxy.indexOf('])', proxy.indexOf('isProtectedRoute = createRouteMatcher([')))
  const patterns = [...protectedBlock.matchAll(/^\s*'([^']+)',/gm)].map(m => m[1])
  const toRe = (p: string) => new RegExp('^' + p.replace(/\(\.\*\)/g, '.*') + '$')
  const isProtected = (path: string) => patterns.some(p => toRe(p).test(path))
  assert(isProtected('/vendor/springfield/dashboard') && isProtected('/vendor'), '[0] control: the vendor portal (/vendor, /vendor/…) is still protected')
  assert(!isProtected('/vendor-agreement'), '/vendor-agreement is public (not caught by the vendor portal gate)')
  assert(toRe('/vendor(.*)').test('/vendor-agreement'), '[0] positive control: the old pattern /vendor(.*) WOULD have caught it')
  const signIn = readFileSync('app/sign-in/vendor/page.tsx', 'utf8')
  assert(/pitch=\{<VendorPitch \/>\}/.test(signIn) && /VENDOR_PITCH/.test(signIn), 'the pitch is rendered on vendor sign-in')
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
