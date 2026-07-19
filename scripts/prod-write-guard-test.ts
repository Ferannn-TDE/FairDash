/**
 * PROD-WRITE GUARD — proves the structural block on the session's recurring class (a script
 * writing to a real event in the prod DB). Positive control: a write to Italian Fest's event id
 * MUST fail loudly AND write nothing. Class check: every script referencing a protected event
 * either uses guardedPrisma or is an allowlisted deliberate-prod / read-only op.
 *
 * Uses guardedPrisma itself (so it's a working example). Its own writes go to a throwaway test
 * event (never protected), so it is safe to run against the prod DB.
 *
 * Run:  npx tsx scripts/prod-write-guard-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { guardedPrisma, assertWriteAllowed, ProdWriteBlockedError, PROTECTED_EVENT_IDS, PROTECTED_EVENT_SLUGS } from '../lib/prod-write-guard'

const ITALIAN_FEST = 'cmni6x63n000011znjwlln5k2'
const prisma = guardedPrisma()
const SLUG = 'pwg-', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function main() {
  try {
    // ── [0] the pure check ──────────────────────────────────────────────────────
    console.log('\n[0] assertWriteAllowed — the predicate')
    assert(PROTECTED_EVENT_IDS.has(ITALIAN_FEST), 'Italian Fest is a protected event')
    let threw = false
    try { assertWriteAllowed('Order', { eventId: ITALIAN_FEST }) } catch (e) { threw = e instanceof ProdWriteBlockedError }
    assert(threw, '⛔ a write to a PROTECTED event throws ProdWriteBlockedError')
    let ok = true
    try { assertWriteAllowed('Order', { eventId: 'some-test-event-id' }) } catch { ok = false }
    assert(ok, 'a write to a NON-protected (test) event passes freely')
    // ALLOW_PROD_WRITES escape hatch
    process.env.ALLOW_PROD_WRITES = 'true'
    let bypass = true
    try { assertWriteAllowed('Order', { eventId: ITALIAN_FEST }) } catch { bypass = false }
    assert(bypass, 'ALLOW_PROD_WRITES=true is the deliberate escape hatch')
    delete process.env.ALLOW_PROD_WRITES

    // ── [1] RUNTIME BLOCK — a guarded create to Italian Fest throws + writes nothing ─
    console.log('\n[1] ⛔ the guarded client BLOCKS a create targeting Italian Fest (positive control)')
    const before = await prisma.vendor.count({ where: { eventId: ITALIAN_FEST } })
    let blocked = false
    try {
      await prisma.vendor.create({ data: { eventId: ITALIAN_FEST, name: 'SHOULD NOT EXIST', slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    } catch (e) { blocked = e instanceof ProdWriteBlockedError }
    assert(blocked, 'guardedPrisma().vendor.create → Italian Fest THREW (blocked before the write)')
    const after = await prisma.vendor.count({ where: { eventId: ITALIAN_FEST } })
    assert(before === after, `NO vendor was created in Italian Fest (${before}→${after}) — the block is real, not cosmetic`)

    // ── [1b] the OTHER write ops are blocked too (delete / where-update / raw write) ─
    // Probed with a filter matching 0 rows, so even an un-blocked op would change nothing.
    console.log('\n[1b] delete / where-based update / raw WRITE to Italian Fest are ALSO blocked')
    const blk = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch (e) { return e instanceof ProdWriteBlockedError } }
    assert(await blk(() => prisma.vendor.deleteMany({ where: { eventId: ITALIAN_FEST, name: '__never__' } })), 'deleteMany where.eventId=Italian Fest BLOCKED')
    assert(await blk(() => prisma.vendor.updateMany({ where: { eventId: ITALIAN_FEST, name: '__never__' }, data: { cuisineType: 'x' } })), 'updateMany where.eventId=Italian Fest BLOCKED (where-based)')
    assert(await blk(() => prisma.$executeRawUnsafe(`UPDATE "Vendor" SET "cuisineType"='x' WHERE id='__never__'`)), 'raw WRITE ($executeRawUnsafe) BLOCKED wholesale')
    let rawReadOk = true
    try { await prisma.$queryRawUnsafe(`SELECT 1`) } catch { rawReadOk = false }
    assert(rawReadOk, 'raw READ ($queryRawUnsafe) passes (reads are fine)')

    // ── [2] RUNTIME PASS — writes to a throwaway TEST event are allowed ─────────────
    console.log('\n[2] the guarded client ALLOWS writes to a throwaway test event')
    const ev = await prisma.event.create({ data: { name: `PWG ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const v = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    assert(!!v.id, 'a vendor in a test event was created (test work is unaffected)')
    await prisma.vendor.deleteMany({ where: { eventId: ev.id } })
    await prisma.event.delete({ where: { id: ev.id } })

    // ── [3] CLASS CHECK — every script naming a protected event (by id OR slug) is guarded ─
    // PREDICATE, stated precisely: this greps each script for a protected event id OR urlSlug.
    // It catches literal references and the common slug-lookup dynamic resolution. It does NOT
    // catch a FULLY-dynamic resolver (iterate all events, no literal) — that residual is closed
    // only by the durable fix (a separate test DB). The runtime guard stays sound there.
    console.log('\n[3] structural: every script naming a protected event (id OR slug) is guarded/allowlisted')
    // Deliberate-prod-op receipts + read-only diagnostics + the guard's own test.
    const ALLOWLIST = new Set([
      'reverse-phantom-accruals.ts', // remediation receipt (ALLOW_PROD_WRITES intent)
      'pattern-t-finish.ts',         // remediation receipt
      'pattern-t-dryrun-report.ts',  // read-only dry-run
      'pattern-t-cleanup.ts',        // (if present) receipt
      'prod-write-guard-test.ts',    // this file
    ])
    const dir = join(process.cwd(), 'scripts')
    const offenders: string[] = []
    for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      const referencesProtected =
        [...PROTECTED_EVENT_IDS].some(id => src.includes(id)) ||
        [...PROTECTED_EVENT_SLUGS].some(slug => src.includes(slug))
      if (!referencesProtected) continue
      if (ALLOWLIST.has(f)) continue
      if (src.includes('guardedPrisma')) continue // uses the guard → fine
      offenders.push(f)
    }
    assert(offenders.length === 0, `every script referencing a protected event is guarded or allowlisted (offenders: ${offenders.join(', ') || 'none'})`)

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error('\n💥', e); process.exit(1) })
