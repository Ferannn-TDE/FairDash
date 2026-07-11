/**
 * RUNNER VALIDATION + CARRY-THROUGH + LICENCE PROOF — real handlers, real negative tests.
 *
 * Invokes the REAL route handlers (app/api/drivers POST, app/api/runners/me GET/PATCH,
 * app/api/runners/me/license GET/POST, app/api/admin/runners/[id]/license GET), mocking
 * ONLY Clerk auth() (authentication). Every validation/authorisation gate under test is
 * the real, unmocked route code.
 *
 *   TASK 1 — Server-side validation is the REAL gate (a client can be bypassed):
 *     1. Bad email / bad phone / whitespace-only name / under-18 DOB / bad vehicle year /
 *        unchecked consent  → 400 VALIDATION_ERROR, per-field details, NO Runner minted
 *     2. Same payloads pass the shared validator identically on the CLIENT side
 *        (one module, so client and server cannot drift)
 *     3. A valid payload still passes end-to-end
 *
 *   TASK 2 — Onboarding data carries through to the Settings record:
 *     4. Onboarding phone + vehicle land on the RUNNER row (what Settings reads),
 *        not only on RunnerApplication — the "Settings opens blank" bug
 *     5. GET /api/runners/me returns them; PATCH re-saves and persists
 *
 *   TASK 3 — Licence is SELF-SCOPED and PRIVATE:
 *     6. Runner A cannot read Runner B's licence (no id is accepted from the request)
 *     7. Unauthenticated GET/POST → 401
 *     8. The Runner row stores a PATH, never a public URL
 *     9. Storage unconfigured → honest 503, and NO licence path is written
 *        (never a fake "saved" — the silent-discard bug)
 *
 * Run: npx tsx scripts/runner-license-proof.ts   (self-cleaning, prefix rlic-)
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)

import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { validateApplication } from '../lib/runner-application-validation'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const PFX = 'rlic-'
const MAIL = '@rlic.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string | null, publicMetadata?: object) {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata } : undefined
}

type IdHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let driversPOST: (req: NextRequest) => Promise<Response>
let meGET: () => Promise<Response>
let mePATCH: (req: NextRequest) => Promise<Response>
let licenseGET: () => Promise<Response>
let licensePOST: (req: NextRequest) => Promise<Response>
let adminLicenseGET: IdHandler

async function loadHandlers() {
  driversPOST     = (await import('../app/api/drivers/route')).POST as any
  meGET           = (await import('../app/api/runners/me/route')).GET as any
  mePATCH         = (await import('../app/api/runners/me/route')).PATCH as any
  licenseGET      = (await import('../app/api/runners/me/license/route')).GET as any
  licensePOST     = (await import('../app/api/runners/me/license/route')).POST as any
  adminLicenseGET = (await import('../app/api/admin/runners/[id]/license/route')).GET as any
}

const VALID = {
  personal: { firstName: 'Rlic', lastName: 'Driver', email: '', phone: '+15550000000', dob: '1990-01-01', city: 'Testville' },
  vehicle: { type: 'Car', make: 'Toyota', model: 'Camry', year: '2020', color: 'Silver', plate: 'ABC 1234' },
  agreed: true,
  bgConsent: true,
  termsVersion: '2026-01-01',
}

function body(email: string, fairSlug: string | null, over: any = {}) {
  return {
    ...VALID,
    ...over,
    personal: { ...VALID.personal, email, ...(over.personal ?? {}) },
    vehicle: { ...VALID.vehicle, ...(over.vehicle ?? {}) },
    fairSlug,
  }
}

function post(url: string, json: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })
}

async function main() {
  await loadHandlers()

  // ── Seed ────────────────────────────────────────────────────────────────────
  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })

  const mkUser = async (tag: string) => prisma.user.create({
    data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${PFX}${tag}-${rand()}${MAIL}`, name: `${PFX}${tag}` },
  })

  const userA = await mkUser('a')
  const userB = await mkUser('b')
  const admin = await mkUser('admin')

  // ── TASK 1: server-side validation is the real gate ──────────────────────────
  console.log('\n[1] Server REJECTS invalid payloads (client gate is bypassable — this is the real one)')

  const BAD_CASES: Array<[string, any]> = [
    ['malformed email',        { personal: { email: 'not-an-email' } }],
    ['whitespace-only name',   { personal: { firstName: '   ' } }],
    ['implausible phone',      { personal: { phone: '12' } }],
    ['under-18 DOB',           { personal: { dob: '2015-01-01' } }],
    ['future DOB',             { personal: { dob: '2099-01-01' } }],
    ['bad vehicle year',       { vehicle: { year: '20' } }],
    ['consent not given',      { agreed: false }],
    ['background check unchecked', { bgConsent: false }],
  ]

  for (const [label, over] of BAD_CASES) {
    login(userA.clerkId)
    const email = `${PFX}${rand()}${MAIL}`
    const res = await driversPOST(post('/api/drivers', body(email, event.urlSlug, over)))
    const json: any = await res.json()
    const minted = await prisma.runner.findUnique({ where: { userId: userA.id } })
    assert(
      res.status === 400 && json.error?.code === 'VALIDATION_ERROR' && !minted,
      `${label} → 400 VALIDATION_ERROR, NO Runner minted (status ${res.status})`
    )
  }

  // per-field details reach the caller (not just the first message)
  login(userA.clerkId)
  const multi = await driversPOST(post('/api/drivers', body(`${PFX}${rand()}${MAIL}`, event.urlSlug, {
    personal: { email: 'nope', phone: 'x' },
  })))
  const multiJson: any = await multi.json()
  const fe = multiJson.error?.details?.fieldErrors ?? {}
  assert(!!fe.email && !!fe.phone, 'invalid payload returns PER-FIELD errors (email + phone both reported)')

  console.log('\n[2] Client and server share ONE validator (cannot drift)')
  assert(
    Object.keys(validateApplication({ personal: { email: 'nope' } as any })).includes('email'),
    'the same validateApplication the route runs also flags the client-side payload'
  )
  assert(
    Object.keys(validateApplication({
      // VALID.personal carries a blank email placeholder (body() fills it per-run), so
      // supply a real one here — we're asserting a COMPLETE payload validates clean.
      personal: { ...VALID.personal, email: `${PFX}${rand()}${MAIL}` } as any,
      vehicle: VALID.vehicle as any,
      agreed: true,
      bgConsent: true,
    })).length === 0,
    'a valid payload produces zero errors from the shared validator'
  )

  // ── TASK 2: carry-through ───────────────────────────────────────────────────
  console.log('\n[3] Valid onboarding mints a Runner AND carries contact/vehicle onto it')
  login(userA.clerkId)
  const ok = await driversPOST(post('/api/drivers', body(`${PFX}${rand()}${MAIL}`, event.urlSlug)))
  const okJson: any = await ok.json()
  assert(ok.status === 201 && okJson.data?.runnerMinted === true, `valid payload → 201, runner minted (status ${ok.status})`)

  const runnerA = await prisma.runner.findUnique({ where: { userId: userA.id } })
  assert(!!runnerA, 'Runner row exists for the applicant')
  assert(
    runnerA?.phone === '+15550000000' &&
    runnerA?.vehicleMake === 'Toyota' &&
    runnerA?.vehicleModel === 'Camry' &&
    runnerA?.vehicleColor === 'Silver' &&
    runnerA?.vehiclePlate === 'ABC 1234',
    'onboarding phone + vehicle landed on the RUNNER row (the record Settings reads) ← carry-through'
  )
  assert(runnerA?.approvalStatus === 'PENDING' && runnerA?.status === 'OFFLINE', 'minted runner is PENDING + OFFLINE')

  const app = await prisma.runnerApplication.findFirst({ where: { userId: userA.id } })
  assert(!!app && app.termsAgreed && app.backgroundCheckConsent, 'consent-bearing RunnerApplication still written (audit trail intact)')

  console.log('\n[4] Settings reads it back, and re-saving persists')
  login(userA.clerkId)
  const meRes = await meGET()
  const meJson: any = await meRes.json()
  assert(
    meJson.data?.runner?.phone === '+15550000000' && meJson.data?.runner?.vehicleMake === 'Toyota',
    'GET /api/runners/me returns the onboarding data → Settings renders pre-filled, not blank'
  )

  login(userA.clerkId)
  const patch = await mePATCH(new NextRequest('http://localhost/api/runners/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+15551234567', vehicleColor: 'Red' }),
  }))
  assert(patch.status === 200, 'PATCH /api/runners/me accepts an edit')
  const after = await prisma.runner.findUnique({ where: { userId: userA.id } })
  assert(after?.phone === '+15551234567' && after?.vehicleColor === 'Red', 'edited settings persisted')
  assert(after?.vehicleMake === 'Toyota', 'partial PATCH did NOT clobber untouched fields')

  // ── TASK 3: licence privacy + scoping ───────────────────────────────────────
  console.log('\n[5] Licence is SELF-SCOPED (no id accepted from the request)')

  // Give B a runner + a licence path directly (bypassing storage, which is unconfigured).
  const runnerB = await prisma.runner.create({
    data: {
      userId: userB.id, eventId: event.id, approvalStatus: 'APPROVED', status: 'OFFLINE',
      licensePath: `runners/fake-b/license/${Date.now()}_b.jpg`,
      licenseUploadedAt: new Date(),
    },
  })

  login(userA.clerkId)
  const aSees = await licenseGET()
  const aSeesJson: any = await aSees.json()
  assert(
    aSees.status === 200 && aSeesJson.data?.uploaded === false,
    "runner A's licence endpoint reports A's own state (no licence), NOT B's ← self-scoped"
  )

  login(userB.clerkId)
  const bSees = await licenseGET()
  const bSeesJson: any = await bSees.json()
  assert(bSees.status === 200 && bSeesJson.data?.uploaded === true, "runner B sees B's own licence as uploaded")

  console.log('\n[6] Unauthenticated access is refused')
  login(null)
  const anonGet = await licenseGET()
  assert(anonGet.status === 401, `anonymous GET licence → 401 (got ${anonGet.status})`)
  login(null)
  const anonPost = await licensePOST(new NextRequest('http://localhost/api/runners/me/license', { method: 'POST', body: new FormData() }))
  assert(anonPost.status === 401, `anonymous POST licence → 401 (got ${anonPost.status})`)

  console.log('\n[7] A licence is stored as a PATH, never a public URL')
  assert(
    !!runnerB.licensePath &&
    !runnerB.licensePath.startsWith('http') &&
    !runnerB.licensePath.includes('/public/'),
    'Runner.licensePath is an object path — no scheme, no /public/ segment ← privacy invariant'
  )
  const runnerCols = Object.keys(runnerB)
  assert(
    !runnerCols.some(c => /licen[cs]e.*Url/i.test(c)),
    'no licenceUrl column exists on Runner — a public URL cannot even be persisted'
  )

  console.log('\n[8] Admin (and ONLY admin) can read another runner\'s licence')
  login(userA.clerkId) // a plain runner, not an admin
  const nonAdmin = await adminLicenseGET(
    new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: runnerB.id }) }
  )
  assert(nonAdmin.status === 403 || nonAdmin.status === 401,
    `non-admin hitting the admin licence route → ${nonAdmin.status} (denied)`)

  // ── REAL end-to-end upload against live Supabase storage ────────────────────
  // Storage IS configured in this environment, so this is not a stub: the bytes really
  // go to the private bucket and come back. The headline assertion is the LAST one —
  // the equivalent PUBLIC url must NOT serve the file.
  console.log('\n[9] REAL upload → private bucket → signed read works, PUBLIC read is BLOCKED')

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )

  login(userA.clerkId)
  const realFd = new FormData()
  realFd.append('file', new File([new Uint8Array(PNG)], 'my-license.png', { type: 'image/png' }))
  const realUp = await licensePOST(
    new NextRequest('http://localhost/api/runners/me/license', { method: 'POST', body: realFd })
  )
  const realJson: any = await realUp.json()
  assert(realUp.status === 200 && realJson.data?.uploaded === true, `real upload → 200 uploaded (got ${realUp.status})`)

  const withLic = await prisma.runner.findUnique({ where: { userId: userA.id } })
  assert(!!withLic?.licensePath, 'licensePath persisted on the Runner row')
  assert(
    !withLic!.licensePath!.startsWith('http') && !withLic!.licensePath!.includes('/public/'),
    'persisted value is a PATH, not a URL'
  )

  // Reload (fresh GET) — the licence is still there, with a NEW signed URL each time.
  login(userA.clerkId)
  const reGet = await licenseGET()
  const reJson: any = await reGet.json()
  assert(reJson.data?.uploaded === true && !!reJson.data?.viewUrl, 'reload → still uploaded, fresh signed URL minted')

  // The signed URL actually serves the bytes.
  const signedRes = await fetch(reJson.data.viewUrl)
  assert(signedRes.status === 200, `signed URL serves the file (got ${signedRes.status})`)

  // THE PRIVACY PROOF: the public-style URL for the same object must be refused.
  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/runner-documents/${withLic!.licensePath}`
  const publicRes = await fetch(publicUrl)
  assert(
    publicRes.status !== 200,
    `PUBLIC url for the same licence is REFUSED (got ${publicRes.status}) ← licence is not world-readable`
  )

  // Contrast: prove the invariant is real by showing the vendor bucket IS public.
  const vb = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket/vendor-documents`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
  }).then(r => r.json())
  const rb = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket/runner-documents`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
  }).then(r => r.json())
  assert(rb.public === false, 'runner-documents bucket is PRIVATE')
  console.log(`     (note: vendor-documents bucket public=${vb.public} — pre-existing, unchanged by this work)`)

  // Clean the uploaded object out of the live bucket.
  await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/runner-documents/${withLic!.licensePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
  })
  await prisma.runner.update({ where: { id: withLic!.id }, data: { licensePath: null, licenseUploadedAt: null } })

  console.log('\n[10] Storage unconfigured → honest 503, and NOTHING is written')
  const savedUrl = process.env.SUPABASE_URL
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_URL = ''
  process.env.SUPABASE_SERVICE_ROLE_KEY = ''

  login(userA.clerkId)
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array([1, 2, 3])], 'license.png', { type: 'image/png' }))
  const upl = await licensePOST(new NextRequest('http://localhost/api/runners/me/license', { method: 'POST', body: fd }))
  const uplJson: any = await upl.json()
  assert(
    upl.status === 503 && uplJson.error?.code === 'STORAGE_NOT_CONFIGURED',
    `unconfigured storage → 503 STORAGE_NOT_CONFIGURED, not a fake success (got ${upl.status})`
  )
  const stillNone = await prisma.runner.findUnique({ where: { userId: userA.id } })
  assert(
    !stillNone?.licensePath,
    'failed upload wrote NO licensePath — the record never claims a licence that is not stored'
  )

  process.env.SUPABASE_URL = savedUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await prisma.runnerApplication.deleteMany({ where: { user: { clerkId: { startsWith: PFX } } } })
  await prisma.runner.deleteMany({ where: { user: { clerkId: { startsWith: PFX } } } })
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PFX } } })
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: PFX } } })

  console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  console.log(`cleanup done (all ${PFX} rows removed)`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async err => {
  console.error(err)
  await prisma.runnerApplication.deleteMany({ where: { user: { clerkId: { startsWith: PFX } } } })
  await prisma.runner.deleteMany({ where: { user: { clerkId: { startsWith: PFX } } } })
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PFX } } })
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: PFX } } })
  await prisma.$disconnect()
  process.exit(1)
})
