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
import {
  guardedPrisma, assertWriteAllowed, ProdWriteBlockedError, PROTECTED_EVENT_IDS, PROTECTED_EVENT_SLUGS,
  referencesProtectedEvent, usesGuardedClient,
} from '../lib/prod-write-guard'
import { stripComments } from './_strip-comments'

/**
 * THE SCAN, as a pure function over (name, RAW source) pairs.
 *
 * Extracted so the comment-strip is COVERED. Asserting on referencesProtectedEvent /
 * usesGuardedClient alone proves the predicates and says nothing about whether the loop feeds
 * them stripped source — and on the real tree that gap is unobservable, because the one script
 * with prose mentioning guardedPrisma is allowlisted and short-circuits before the check. A
 * control on the loop must therefore run against SYNTHETIC files. Takes raw source and strips
 * internally, so "did the caller remember to strip?" is not a question this can get wrong.
 */
export function scanScriptsForProtectedRefs(
  files: readonly { name: string; source: string }[],
  allowlist: ReadonlySet<string>,
): string[] {
  const offenders: string[] = []
  for (const { name, source } of files) {
    const code = stripComments(source) // CODE, not prose — in BOTH directions
    if (!referencesProtectedEvent(code)) continue
    if (allowlist.has(name)) continue
    if (usesGuardedClient(code)) continue // constructs the guarded client → fine
    offenders.push(name)
  }
  return offenders
}

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

    // ── [1b] the OTHER write ops are blocked too (delete / where-update / raw) ───────
    // EACH assertion is on the THROW (blk returns true ONLY for a ProdWriteBlockedError) —
    // NOT on a row count. The 0-row filters are a safety belt (a leak couldn't damage), not
    // the proof: "0 rows changed" is satisfied by both a working guard and a no-match leak,
    // so the throw is what distinguishes them.
    console.log('\n[1b] delete / where-based update / raw (incl. RETURNING) are blocked — asserting the THROW')
    const blk = async (fn: () => Promise<unknown>) => { try { await fn(); return false } catch (e) { return e instanceof ProdWriteBlockedError } }
    assert(await blk(() => prisma.vendor.deleteMany({ where: { eventId: ITALIAN_FEST, name: '__never__' } })), 'deleteMany where.eventId=Italian Fest THREW')
    assert(await blk(() => prisma.vendor.updateMany({ where: { eventId: ITALIAN_FEST, name: '__never__' }, data: { cuisineType: 'x' } })), 'updateMany where.eventId=Italian Fest THREW (where-based)')
    assert(await blk(() => prisma.$executeRawUnsafe(`UPDATE "Vendor" SET "cuisineType"='x' WHERE id='__never__'`)), 'raw $executeRawUnsafe THREW (write)')
    // query≠read: a DELETE/UPDATE via $queryRaw mutates. Must THROW.
    assert(await blk(() => prisma.$queryRawUnsafe(`DELETE FROM "Vendor" WHERE id='__never__' RETURNING id`)), '⛔ $queryRawUnsafe(DELETE … RETURNING) THREW (query is NOT read-only)')
    // a genuine SELECT read still passes
    let rawReadOk = true
    try { await prisma.$queryRawUnsafe(`SELECT 1`) } catch { rawReadOk = false }
    assert(rawReadOk, 'a leading-SELECT raw read passes (reads are fine)')

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
    console.log('\n[3] structural: every script naming a protected event (id, slug OR SYMBOL) is guarded/allowlisted')
    // Deliberate-prod-op receipts + read-only diagnostics + the guard's own test.
    const ALLOWLIST = new Set([
      'reverse-phantom-accruals.ts', // remediation receipt (ALLOW_PROD_WRITES intent)
      'pattern-t-finish.ts',         // remediation receipt
      'pattern-t-dryrun-report.ts',  // read-only dry-run
      'pattern-t-cleanup.ts',        // (if present) receipt
      'prod-write-guard-test.ts',    // this file
      'protected-events-membership-guard.ts', // constant-only membership assertion — no DB client at all
      // Deliberate, reviewed prod remediation — the 2026-07-16/17 pollution cohort. Same category
      // as reverse-phantom-accruals / pattern-t-finish: dry-run by default, refuses --apply
      // without ALLOW_PROD_WRITES, and its receipt is derived from what the writes RETURNED plus
      // a final-state re-read. It uses the lib/db singleton ON PURPOSE (it must route through the
      // real app-side money-audit writer) — which is exactly why the old literal-only grep could
      // not see it. Allowlisted EXPLICITLY, with a reason, rather than passing by accident.
      'retire-pollution-cohort.ts',
    ])
    const dir = join(process.cwd(), 'scripts')
    const realFiles = readdirSync(dir).filter(f => f.endsWith('.ts'))
      .map(f => ({ name: f, source: readFileSync(join(dir, f), 'utf8') }))
    const offenders = scanScriptsForProtectedRefs(realFiles, ALLOWLIST)
    assert(offenders.length === 0, `every script referencing a protected event is guarded or allowlisted (offenders: ${offenders.join(', ') || 'none'})`)

    // ── [3b] THE PREDICATE — controls that FAIL, not crash ──────────────────────────────
    // [3] alone is satisfied by a detector that detects NOTHING: zero offenders either way.
    // These pin both directions on synthetic sources, so the widening is proven rather than
    // assumed, and a future narrowing fails here BY NAME instead of going quiet.
    console.log('\n[3b] ⛔ the detector matches the IMPORTED SYMBOL, and prose grants nothing')
    const S = (s: string) => stripComments(s)

    // The exact shape that walked through the old net: imports the symbol, no literal anywhere.
    const bySymbol = S(`import { LIVE_PROTECTED_EVENT_ID } from '../lib/prod-write-guard'\nconst x = LIVE_PROTECTED_EVENT_ID\n`)
    assert(referencesProtectedEvent(bySymbol),
      '⛔ a script IMPORTING LIVE_PROTECTED_EVENT_ID is detected (the hole retire-pollution-cohort walked through)')
    assert(!bySymbol.includes(ITALIAN_FEST),
      '  …detected WITHOUT containing the literal cuid — so this is the SYMBOL path, not the old one')
    assert(referencesProtectedEvent(S(`const s = LIVE_PROTECTED_EVENT_SLUG\n`)), 'the SLUG symbol is detected too')
    // BASELINE: the literal paths still work — the widening ADDED, it did not replace.
    assert(referencesProtectedEvent(S(`const id = '${ITALIAN_FEST}'\n`)), 'BASELINE: the literal cuid is still detected')
    assert(referencesProtectedEvent(S(`const s = '${[...PROTECTED_EVENT_SLUGS][0]}'\n`)), 'BASELINE: the literal slug is still detected')

    // NEGATIVE — prose must not trip it, or the pressure is to delete the reasoning to stay green.
    assert(!referencesProtectedEvent(S(`// never touches LIVE_PROTECTED_EVENT_ID\nconst a = 1\n`)),
      '⛔ a LINE COMMENT naming the constant is NOT a reference (guards scan code, not prose)')
    assert(!referencesProtectedEvent(S(`/**\n * about LIVE_PROTECTED_EVENT_ID and ${ITALIAN_FEST}\n */\nconst a = 1\n`)),
      '⛔ nor a BLOCK comment naming the constant AND the literal')
    assert(!referencesProtectedEvent(S(`const MY_LIVE_PROTECTED_EVENT_IDX = 1\n`)),
      'and a longer identifier merely containing the name is not a false positive (word-bounded)')
    assert(!referencesProtectedEvent(S(`const a = 1\n`)), 'an unrelated script is not flagged')

    // ── [3c] THE EXEMPTION — a comment cannot excuse a script ───────────────────────────
    // The more dangerous direction, and the one the real tree CANNOT exercise: the only script
    // whose prose mentions guardedPrisma is allowlisted, so it short-circuits before the check.
    // Run the real scan against SYNTHETIC files so the strip inside it is genuinely covered.
    console.log('\n[3c] ⛔ the scan strips comments before granting the guardedPrisma exemption')
    const NONE: ReadonlySet<string> = new Set<string>()
    const proseExcuse = {
      name: 'fake-prose-excuse.ts',
      source: `// NOTE: this does NOT use guardedPrisma — it uses the lib/db singleton.\nimport { LIVE_PROTECTED_EVENT_ID } from '../lib/prod-write-guard'\nawait db.order.updateMany({ where: { eventId: LIVE_PROTECTED_EVENT_ID }, data: {} })\n`,
    }
    assert(scanScriptsForProtectedRefs([proseExcuse], NONE).includes('fake-prose-excuse.ts'),
      '⛔ a script referencing the constant in CODE while mentioning guardedPrisma only in a COMMENT is an OFFENDER')
    const realExempt = {
      name: 'fake-guarded.ts',
      source: `import { guardedPrisma, LIVE_PROTECTED_EVENT_ID } from '../lib/prod-write-guard'\nconst p = guardedPrisma()\nawait p.order.findMany({ where: { eventId: LIVE_PROTECTED_EVENT_ID } })\n`,
    }
    assert(scanScriptsForProtectedRefs([realExempt], NONE).length === 0,
      'BASELINE: …while one that genuinely CONSTRUCTS guardedPrisma is exempt (the exemption still works)')
    assert(scanScriptsForProtectedRefs([proseExcuse], new Set(['fake-prose-excuse.ts'])).length === 0,
      'and the allowlist still carries a named, reviewed exception')

    // The composition, on the REAL file: caught by the predicate, not exempt, carried by name.
    const retireSrc = stripComments(readFileSync(join(dir, 'retire-pollution-cohort.ts'), 'utf8'))
    assert(referencesProtectedEvent(retireSrc), 'the real remediation script IS now detected…')
    assert(!usesGuardedClient(retireSrc), '…is NOT exempt (it genuinely constructs no guarded client)…')
    assert(ALLOWLIST.has('retire-pollution-cohort.ts'), '…so it is carried EXPLICITLY by the allowlist, with a written reason')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error('\n💥', e); process.exit(1) })
