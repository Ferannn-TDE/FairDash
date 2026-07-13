/**
 * Admin event settings — persistence + the safe-field allowlist.
 *
 * TWO PROOFS, both against real code:
 *   1. ROUND-TRIP: build the update via the REAL allowlist fn (buildSafeSettingsUpdate),
 *      db.event.update, re-read → the change actually persisted. Not optimistic UI.
 *   2. ⛔ ALLOWLIST: a hostile body carrying status / isPaused / archivedAt / organizerId /
 *      urlSlug must write NONE of them — only the presentation/logistics fields. This is the
 *      boundary that keeps a "settings" PATCH from becoming a way to un-pause a fair, seize
 *      ownership, or resurrect an archived one.
 *
 * Plus structural checks: the route rides requireAdminFairContext (non-admin refusal is
 * inherited from the proven chokepoint, p6), and the page no longer fakes a save.
 *
 * Run:  npx tsx scripts/admin-settings-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { buildSafeSettingsUpdate } from '../lib/admin-event-settings'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const PFX = 'settest-'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: PFX } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({
      data: {
        name: 'Before', urlSlug: `${PFX}${rand()}`,
        startDate: new Date('2026-07-01'), endDate: new Date('2026-07-03'),
        status: 'ACTIVE', isPaused: false, serviceChargeEnabled: false,
      },
    })

    // ── [1] ROUND-TRIP: an allowed edit actually persists ──────────────────────
    console.log('\n[1] a settings edit persists to the DB (real round-trip)')
    const data = buildSafeSettingsUpdate(
      { name: 'After Fair', eventLat: '39.78', eventLng: '-89.65', serviceChargeEnabled: true, serviceChargeAmount: '1.50' },
      { startDate: ev.startDate, endDate: ev.endDate },
    )
    await prisma.event.update({ where: { id: ev.id }, data })
    const after = await prisma.event.findUnique({ where: { id: ev.id } })
    assert(after?.name === 'After Fair', 'name persisted')
    assert(after?.eventLat === 39.78 && after?.eventLng === -89.65, 'location persisted (parsed to numbers)')
    assert(after?.serviceChargeEnabled === true && after?.serviceChargeAmount === 1.5, 'service charge persisted')

    // ── [2] ⛔ ALLOWLIST: a hostile body cannot write forbidden fields ─────────
    console.log('\n[2] ⛔ ALLOWLIST: status / isPaused / archivedAt / organizerId / urlSlug are NEVER written')
    const hostile = buildSafeSettingsUpdate(
      {
        name: 'Legit rename',              // allowed
        status: 'INACTIVE',                // forbidden — must be ignored
        isPaused: true,                    // forbidden
        archivedAt: new Date().toISOString(), // forbidden
        organizerId: 'someone-elses-org',  // forbidden (ownership seizure)
        urlSlug: 'hijacked-slug',          // forbidden (identity)
        featuredEnabled: false,            // not in the allowlist either
      },
      { startDate: ev.startDate, endDate: ev.endDate },
    )
    const keys = Object.keys(hostile)
    assert(keys.includes('name'), 'the allowed field (name) IS in the update')
    for (const forbidden of ['status', 'isPaused', 'archivedAt', 'organizerId', 'urlSlug', 'featuredEnabled']) {
      assert(!keys.includes(forbidden), `⛔ "${forbidden}" is NOT in the update — the body could not smuggle it`)
    }
    // And prove it at the DB level: applying the hostile update leaves those columns untouched.
    await prisma.event.update({ where: { id: ev.id }, data: hostile })
    const post = await prisma.event.findUnique({ where: { id: ev.id } })
    assert(post?.status === 'ACTIVE', 'status is STILL ACTIVE (the hostile status was ignored)')
    assert(post?.isPaused === false, 'isPaused is STILL false')
    assert(post?.archivedAt === null, 'archivedAt is STILL null (fair not resurrected/archived)')
    assert(post?.urlSlug === ev.urlSlug, 'urlSlug unchanged (identity intact)')

    // ── [3] validation rejects bad input ──────────────────────────────────────
    console.log('\n[3] validation catches bad input')
    const rejects = (fn: () => unknown, label: string) => {
      try { fn(); assert(false, `${label} — should have thrown`) }
      catch { assert(true, label) }
    }
    rejects(() => buildSafeSettingsUpdate({ name: '   ' }, { startDate: ev.startDate, endDate: ev.endDate }), 'empty name rejected')
    rejects(() => buildSafeSettingsUpdate({ eventLat: '999' }, { startDate: ev.startDate, endDate: ev.endDate }), 'out-of-range latitude rejected')
    rejects(() => buildSafeSettingsUpdate({ startDate: '2026-07-10', endDate: '2026-07-05' }, { startDate: ev.startDate, endDate: ev.endDate }), 'end-before-start rejected')
    rejects(() => buildSafeSettingsUpdate({}, { startDate: ev.startDate, endDate: ev.endDate }), 'empty update rejected (no editable fields)')

    // ── [4] structural: the route is gated, the page is honest ─────────────────
    console.log('\n[4] the route rides the chokepoint; the page no longer fakes a save')
    const route = readFileSync('app/api/admin/events/[id]/settings/route.ts', 'utf8')
    assert(/requireAdminFairContext/.test(route), 'route rides requireAdminFairContext (non-admin → refused, per p6)')
    assert(/buildSafeSettingsUpdate/.test(route) && !/\.\.\.body/.test(route),
      'route uses the allowlist and never spreads the body')
    assert(/revalidateTag\('fair'/.test(route), "route busts the 'fair' discovery cache on change")

    const page = readFileSync('app/admin/[eventSlug]/settings/page.tsx', 'utf8')
    assert(!/mock\/admin|mockAdminEvents/.test(page), 'page no longer imports mock data')
    assert(/setTimeout\(r => setTimeout/.test(page) === false && !/await new Promise\(r => setTimeout\(r, 600\)\)/.test(page),
      'the fake 600ms "save" delay is gone')
    assert(/method: 'PATCH'/.test(page) && /adopt\(json\.data/.test(page),
      "save does a real PATCH and ADOPTS the server's re-read values (no optimistic drift)")
    assert(/\/fair\/\$\{slug\}/.test(page) && !/\/e\/\$\{/.test(page),
      'copy-URL uses the REAL /fair/[slug] route, not the dead /e/[slug]')

    console.log(`\n${'─'.repeat(62)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(62)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
