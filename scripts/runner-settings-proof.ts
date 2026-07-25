/**
 * RUNNER SETTINGS PERSISTENCE PROOF — exercises the REAL /api/runners/me GET+PATCH
 * handlers (Clerk auth mocked) against the live DB. Proves edit → save → reload →
 * persists for phone / vehicle / notifications / availability, that the status flip
 * still works, that validation rejects garbage, and that a write is me-scoped.
 *
 * Run: npx tsx scripts/runner-settings-proof.ts   (self-cleaning, prefix rsseed-)
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'rsseed-', MAIL = '@rsseed.local'
const rand = () => Math.random().toString(36).slice(2, 10)
let pass = 0, fail = 0
function assert(c: boolean, l: string) { if (c) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}`) } }
function login(clerkId: string) { (globalThis as any).__MOCK_CLERK = { userId: clerkId } }

let meGET: () => Promise<Response>
let mePATCH: (req: NextRequest) => Promise<Response>

async function patch(clerkId: string, body: object) {
  login(clerkId)
  const res = await mePATCH(new NextRequest('http://t/api/runners/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function get(clerkId: string) { login(clerkId); const res = await meGET(); return { status: res.status, json: await res.json().catch(() => ({})) } }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) { await prisma.runner.deleteMany({ where: { eventId: { in: ids } } }); await prisma.event.deleteMany({ where: { id: { in: ids } } }) }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}
async function mkRunner(eventId: string) {
  const u = await prisma.user.create({ data: { clerkId: `${PFX}clerk-${rand()}`, email: `${PFX}${rand()}${MAIL}`, name: 'RS', role: 'runner' } })
  const r = await prisma.runner.create({ data: { userId: u.id, eventId, status: 'OFFLINE' } })
  return { u, r }
}

async function main() {
  meGET   = (await import('../app/api/runners/me/route')).GET as unknown as () => Promise<Response>
  mePATCH = (await import('../app/api/runners/me/route')).PATCH as unknown as (req: NextRequest) => Promise<Response>
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `RS ${rand()}`, urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
    const A = await mkRunner(ev.id)
    const B = await mkRunner(ev.id)

    // ── defaults ───────────────────────────────────────────────────────────────
    console.log('\n[1] fresh runner → sane defaults')
    const g0 = await get(A.u.clerkId)
    assert(g0.json?.data?.runner?.notifyNewDelivery === true, 'notifyNewDelivery defaults true')
    assert(g0.json?.data?.runner?.notifyEarnings === false, 'notifyEarnings defaults false')
    assert(Array.isArray(g0.json?.data?.runner?.availableDays) && g0.json.data.runner.availableDays.length === 0, 'availableDays defaults []')

    // ── edit → save ────────────────────────────────────────────────────────────
    console.log('\n[2] PATCH settings → 200')
    const p = await patch(A.u.clerkId, {
      phone: '  +1 312-555-0199  ', vehicleMake: 'Honda', vehicleModel: 'Civic', vehicleColor: 'Blue', vehiclePlate: 'LMN 9012',
      notifyNewDelivery: false, notifyEarnings: true, availableDays: ['Sat', 'Fri', 'Sat'], // dupes + unsorted on purpose
    })
    assert(p.status === 200, `save → 200 (got ${p.status})`)

    // ── reload → persists ────────────────────────────────────────────────────────
    console.log('\n[3] reload (fresh GET) → values persisted')
    const g1 = await get(A.u.clerkId)
    const r = g1.json?.data?.runner
    assert(r?.phone === '+1 312-555-0199', `phone persisted + trimmed (got ${JSON.stringify(r?.phone)})`)
    assert(r?.vehicleMake === 'Honda' && r?.vehiclePlate === 'LMN 9012', 'vehicle persisted')
    assert(r?.notifyNewDelivery === false && r?.notifyEarnings === true, 'notification prefs persisted')
    assert(JSON.stringify(r?.availableDays) === JSON.stringify(['Fri', 'Sat']), `availableDays deduped + canonical order (got ${JSON.stringify(r?.availableDays)})`)

    // ── partial PATCH doesn't clobber ────────────────────────────────────────────
    console.log('\n[4] partial PATCH (only phone) leaves other fields intact')
    await patch(A.u.clerkId, { phone: '+1 000' })
    const g2 = (await get(A.u.clerkId)).json?.data?.runner
    assert(g2?.phone === '+1 000' && g2?.vehicleMake === 'Honda' && JSON.stringify(g2?.availableDays) === JSON.stringify(['Fri', 'Sat']), 'only phone changed; vehicle + availability untouched')

    // ── status flip still works ──────────────────────────────────────────────────
    console.log('\n[5] status flip still works via the same endpoint')
    const ps = await patch(A.u.clerkId, { status: 'ACTIVE' })
    assert(ps.status === 200 && (await get(A.u.clerkId)).json?.data?.runner?.status === 'ACTIVE', 'status → ACTIVE persisted')

    // ── validation ───────────────────────────────────────────────────────────────
    console.log('\n[6] validation rejects garbage (no partial write)')
    const v1 = await patch(A.u.clerkId, { availableDays: ['Funday'] })
    assert(v1.status === 400, `invalid day → 400 (got ${v1.status})`)
    const v2 = await patch(A.u.clerkId, { notifyEarnings: 'yes' })
    assert(v2.status === 400, `non-boolean notify → 400 (got ${v2.status})`)
    const v3 = await patch(A.u.clerkId, {})
    assert(v3.status === 400, `empty patch → 400 (got ${v3.status})`)
    // the rejected writes left the good state intact
    const g3 = (await get(A.u.clerkId)).json?.data?.runner
    assert(g3?.notifyEarnings === true && JSON.stringify(g3?.availableDays) === JSON.stringify(['Fri', 'Sat']), 'rejected writes did NOT corrupt persisted state')

    // ── me-scoped: A's writes never touched B ────────────────────────────────────
    console.log('\n[7] write is me-scoped — runner B untouched by A’s saves')
    const gB = (await get(B.u.clerkId)).json?.data?.runner
    assert(gB?.vehicleMake == null && gB?.notifyNewDelivery === true && gB?.availableDays.length === 0, 'runner B still at defaults (A’s writes isolated)')

    console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  } finally {
    await cleanup(); console.log('cleanup done (rsseed- rows removed)')
  }
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('PROOF_ERR', e); cleanup().finally(() => process.exit(1)) })
