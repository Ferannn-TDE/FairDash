/**
 * PROFILE-CHANGE GUARD — the runner profile-edit audit logs the right changes, and the retention
 * enforcer is a REAL deleter (not a schema comment promising deletion with nothing behind it).
 *
 *   [1] DIFF (pure) — only PRESENT + CHANGED tracked fields log a row; a no-op re-save and an
 *       absent field write nothing; null↔value both directions log. Positive control: a real
 *       change DOES produce a row (the differ isn't vacuously empty).
 *   [2] RETENTION (real) — purgeExpiredProfileChanges deletes rows whose runner's event ended
 *       past the window, keeps recent ones; dry-run identifies without deleting. Positive
 *       control: the recent row survives the real purge.
 *   [3] SOURCE SHAPE — settings PATCH writes RunnerProfileChange in a transaction; reconciler
 *       runs Pattern W; the retention has a stated home (docs/PII_DECISIONS.md).
 *
 * Seeds a throwaway event and cleans up. Safe against prod: no live event has ended past the
 * 180d window, so a real purge only ever touches this guard's far-past seeded event.
 * Run:  npx tsx scripts/profile-change-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { diffProfileChanges, purgeExpiredProfileChanges, PROFILE_CHANGE_RETENTION_DAYS } from '../lib/runner-profile-log'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'pchg-', MAIL = '@pchg.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    await prisma.runnerProfileChange.deleteMany({ where: { runner: { eventId: { in: ids } } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    // ── [1] DIFF (pure) ──────────────────────────────────────────────────────────
    console.log('[1] diff: only present + changed fields log')
    const changed = diffProfileChanges('r1', { phone: '111', vehicleMake: 'Honda' }, { phone: '222' })
    assert(changed.length === 1 && changed[0].field === 'phone' && changed[0].oldValue === '111' && changed[0].newValue === '222', 'changed phone → one row old→new (vehicleMake absent from patch is NOT logged)')
    assert(diffProfileChanges('r1', { phone: '111' }, { phone: '111' }).length === 0, 'no-op re-save (same value present) → no row')
    assert(diffProfileChanges('r1', { phone: '111' }, { vehicleColor: 'Red' }).length === 1, 'a DIFFERENT field changing → its own row (positive control: differ produces rows)')
    const nulls = diffProfileChanges('r1', { vehiclePlate: null }, { vehiclePlate: 'ABC-1' })
    assert(nulls.length === 1 && nulls[0].oldValue === null && nulls[0].newValue === 'ABC-1', 'null → value logs')
    assert(diffProfileChanges('r1', { phone: 'X' }, { phone: null })[0].newValue === null, 'value → null logs')
    assert(diffProfileChanges('r1', { phone: 'a', vehicleMake: 'b' }, { phone: 'a2', vehicleMake: 'b2' }).length === 2, 'two changed fields → two rows')

    // ── [2] RETENTION (real, DB) ─────────────────────────────────────────────────
    console.log('\n[2] retention: expired rows purged, recent kept, dry-run identifies only')
    const mkEvent = (endDate: Date) => prisma.event.create({ data: { name: `PC ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(endDate.getTime() - 864e5), endDate, status: 'INACTIVE' } })
    const mkUser = async () => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${rand()}${MAIL}`, name: 'r', role: 'customer' } })).id
    const oldEvent = await mkEvent(new Date(Date.now() - 200 * 864e5))    // ended 200d ago → expired
    const recentEvent = await mkEvent(new Date(Date.now() + 864e5))       // ends tomorrow → keep
    const oldRunner = await prisma.runner.create({ data: { eventId: oldEvent.id, userId: await mkUser(), status: 'OFFLINE' } })
    const recentRunner = await prisma.runner.create({ data: { eventId: recentEvent.id, userId: await mkUser(), status: 'OFFLINE' } })
    await prisma.runnerProfileChange.createMany({ data: [
      { runnerId: oldRunner.id, field: 'phone', oldValue: '111', newValue: '222' },
      { runnerId: oldRunner.id, field: 'vehiclePlate', oldValue: 'A', newValue: 'B' },
      { runnerId: recentRunner.id, field: 'phone', oldValue: '333', newValue: '444' },
    ] })

    const dry = await purgeExpiredProfileChanges({ dryRun: true })
    assert(dry.matched >= 2 && dry.purged === 0, `dry-run identifies expired without deleting (matched=${dry.matched}, purged=0)`)

    const real = await purgeExpiredProfileChanges()
    assert(real.purged >= 2, `real purge deleted the expired rows (purged=${real.purged})`)
    assert((await prisma.runnerProfileChange.count({ where: { runnerId: oldRunner.id } })) === 0, 'old-event rows gone')
    assert((await prisma.runnerProfileChange.count({ where: { runnerId: recentRunner.id } })) === 1, 'positive control: recent-event row SURVIVES (retention is age-scoped, not a blanket wipe)')
    assert(PROFILE_CHANGE_RETENTION_DAYS === 180, 'retention window is the stated 180 days')

    // ── [3] SOURCE SHAPE ─────────────────────────────────────────────────────────
    console.log('\n[3] source shape')
    const route = readFileSync(new URL('../app/api/runners/me/route.ts', import.meta.url), 'utf8')
    assert(route.includes('diffProfileChanges') && route.includes('runnerProfileChange.createMany') && route.includes('$transaction'), 'settings PATCH logs changes in a transaction with the update')
    const rec = readFileSync(new URL('../lib/reconciler.ts', import.meta.url), 'utf8')
    assert(/patternW\(sum,/.test(rec) && rec.includes('purgeExpiredProfileChanges'), 'reconciler runs Pattern W (the retention enforcer)')
    let doc = ''
    try { doc = readFileSync(new URL('../docs/PII_DECISIONS.md', import.meta.url), 'utf8') } catch { /* absent */ }
    assert(doc.includes('180 days') && doc.includes('Pattern W'), 'PII decisions doc records the retention policy + its enforcer')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} profile-change-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
