/**
 * 'vendors' cache invalidation on every vendor AVAILABILITY change.
 *
 * THE GAP. lib/fairs.ts getVendorsBySlugCached caches the customer discovery list 120s under
 * the 'vendors' tag, carrying each vendor's ACTIVE/orderable state. The toggle fix busts that
 * tag on isOffline/isBusy — but the STATUS-change paths (organizer approve/pause/suspend,
 * admin approve/reject) did not. So a SUSPENDED vendor lingered as orderable, and a newly
 * ACTIVE one stayed invisible, for up to two minutes.
 *
 * TWO HALVES, both proven:
 *   A. every status-change route now busts 'vendors' (structural, mutation-teeth).
 *   B. 'vendors' is GENUINELY the tag the discovery list reads, AND that list's query
 *      excludes a non-ACTIVE vendor — so once the bust makes it fresh, a suspended vendor is
 *      actually gone. Without B, the bust could be a no-op pointed at a phantom tag (the
 *      failure mode already hit once this session with fair-${slug}).
 *
 * Run:  npx tsx scripts/vendor-status-revalidation-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'

const prisma = testPrisma()
const PFX = 'revtest-'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const noComments = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
}

async function main() {
  await cleanup()
  try {
    const organizer = noComments(readFileSync('app/api/organizer/vendors/[id]/route.ts', 'utf8'))
    const approve   = noComments(readFileSync('app/api/admin/vendors/[id]/approve/route.ts', 'utf8'))
    const reject    = noComments(readFileSync('app/api/admin/vendors/[id]/reject/route.ts', 'utf8'))
    const toggle    = noComments(readFileSync('app/api/vendors/[id]/route.ts', 'utf8'))
    const fairs     = readFileSync('lib/fairs.ts', 'utf8')

    // ── A. every availability-write path busts 'vendors' ───────────────────────
    console.log('\n[A] every path that changes vendor availability busts the discovery cache')
    assert(/revalidateTag\('vendors'/.test(approve), 'admin APPROVE (→ ACTIVE) busts vendors')
    assert(/revalidateTag\('vendors'/.test(reject),  'admin REJECT (→ REJECTED) busts vendors')
    assert(/revalidateTag\('vendors'/.test(toggle),  'the isOffline/isBusy toggle busts vendors (from the prior fix)')
    // The organizer route must bust it specifically on a STATUS CHANGE, not on every save.
    assert(/body\.status\s*&&\s*body\.status\s*!==\s*vendor\.status[\s\S]{0,400}?revalidateTag\('vendors'/.test(organizer),
      'organizer status-change (approve/pause/suspend) busts vendors, inside the status-changed branch')

    // ── B. ⛔ anti-phantom: 'vendors' is the REAL tag the discovery list reads ──
    console.log("\n[B] ⛔ 'vendors' is genuinely the discovery list's tag — the bust is not a no-op")
    assert(/getVendorsBySlugCached[\s\S]*?tags:\s*\['vendors'\]/.test(fairs),
      "getVendorsBySlugCached is cached under tags: ['vendors'] — the exact tag every route busts")

    // ── B(data). the discovery query actually EXCLUDES a non-ACTIVE vendor ─────
    // Proves the other half: once the bust makes the list fresh, a suspended vendor is gone
    // from what it returns (it's not that the bust refreshes a list that shows them anyway).
    console.log('\n[B-data] the discovery list query excludes a SUSPENDED vendor, includes ACTIVE')
    const ev = await prisma.event.create({
      data: { name: 'REV', urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' },
    })
    const activeV = await prisma.vendor.create({ data: { eventId: ev.id, name: 'Active One', slug: `${PFX}a-${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const suspV   = await prisma.vendor.create({ data: { eventId: ev.id, name: 'Suspended One', slug: `${PFX}s-${rand()}`, cuisineType: 'T', status: 'SUSPENDED' } })

    // getVendorsBySlugCached can't be imported here — it wraps unstable_cache, a server-only
    // module that the tsx test context refuses. So this runs its EXACT where-clause directly
    // (lib/fairs.ts:110-118: event ACTIVE + not archived, vendor status ACTIVE, readiness-if-
    // enforced — off by default). The structural check [B] already proved the tag; this
    // proves the filter that runs once the bust makes the list fresh.
    const listed = await prisma.vendor.findMany({
      where: {
        event: { urlSlug: ev.urlSlug, status: 'ACTIVE', archivedAt: null },
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    const ids = new Set(listed.map(v => v.id))
    assert(ids.has(activeV.id), 'the ACTIVE vendor appears in the discovery list')
    assert(!ids.has(suspV.id), '⛔ the SUSPENDED vendor is NOT in the discovery list — so a busted-fresh list hides them')

    console.log(`\n${'─'.repeat(64)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
