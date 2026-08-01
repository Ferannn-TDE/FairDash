/**
 * MEMBERSHIP-DELETE GUARD — the invariant that makes the roles[] union safe.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * lib/role-sync.ts used to REPLACE publicMetadata.roles[] with the roles derived from a user's
 * membership rows, preserving only admin-family grants. That dropped any role whose row did not
 * (yet) exist — and roles[] was also written optimistically at signup, before any row existed.
 * Acquiring a second role silently revoked the first. Proven live on 2026-08-01:
 * oodedai@siue.edu signed up as a vendor, acquired organizer, and lost 'vendor'.
 *
 * The fix makes sync UNION rather than replace. The cost of a union is that sync can no longer
 * REMOVE a role — so if a VendorMember / OrgMember / Runner row is ever deleted, roles[] would
 * keep asserting access the gates no longer grant. Metadata renders the portal DOORS; the gates
 * read the rows. A stale door is the same divergence class, just pointing the other way.
 *
 * Today that cannot happen, because nothing deletes those rows. But "I grepped and found none"
 * is an observation with a shelf life, and this repo's recurring failure is exactly the
 * observation that quietly stopped being true. This guard converts it into an enforced property.
 *
 * ── WHAT IS AND IS NOT A VIOLATION ───────────────────────────────────────────────────────────
 * FLAGGED: a direct delete of a membership row — `vendorMember.delete(...)`,
 *   `orgMember.deleteMany(...)`, `runner.delete(...)`, or raw SQL `DELETE FROM "VendorMember"`.
 *   These remove access while the User row lives on, which is precisely the state where roles[]
 *   would keep a door open that the gate has closed.
 *
 * NOT FLAGGED: `user.delete(...)`, which cascades to all three via onDelete: Cascade. That is
 *   whole-account deletion — the Clerk account is gone too, so there is no signed-in person left
 *   to hold a stale door. Excluding it is a decision, not an oversight; a cascade that removes
 *   the subject cannot strand the subject.
 *
 * IF THE INVARIANT MUST BE BROKEN: revocation has to become an EXPLICIT call that rewrites
 *   roles[] at the same site — never a silent side effect of a membership write, which is the
 *   shape that caused the original bug.
 *
 * ── SHAPE-KEYED, NOT NAME-KEYED ──────────────────────────────────────────────────────────────
 * It walks the runtime trees (app/, lib/, workers/) and matches on the Prisma delegate shape.
 * It does NOT enumerate filenames, so moving or renaming a file cannot silently exempt it —
 * see `guards-match-shape-not-names-or-locations`. scripts/ is deliberately out of scope: test
 * fixtures clean up after themselves and one-off admin tooling is a reviewed human action, not
 * a runtime path a user can reach.
 *
 * ── COMMENT-STRIPPED, BOTH HALVES ────────────────────────────────────────────────────────────
 * Everything below reads source through scripts/_strip-comments.ts. That matters in both
 * directions: prose describing a delete must not FAIL the guard (which pressures the next person
 * to delete the reasoning to stay green), and — the half that actually bites — a comment must
 * never be able to EXCUSE real code. See `a-comment-cannot-grant-an-exemption`, earned
 * 2026-07-29 when a `// eslint-disable`-shaped line silently exempted a prod-write.
 *
 *   [0]  anti-vacuity — the scan really reads the trees; an empty scan FAILS
 *   [P1] positive control — a PLANTED deleteMany is FOUND, and the finding names its path
 *   [P2] positive control — the same delete inside a COMMENT is NOT found (stripping works)
 *   [P3] positive control — raw SQL DELETE FROM is FOUND (the second detection shape)
 *   [1]  the real trees contain zero membership deletes
 *   [2]  the guard still reports after the planted-defect controls have run
 *
 * Pure file-reader — no database. Run:  npx tsx scripts/membership-delete-guard.ts
 */

import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { stripComments } from './_strip-comments'

const REPO = new URL('..', import.meta.url).pathname
const RUNTIME_ROOTS = ['app', 'lib', 'workers']

/** The three membership models. Deleting any of these removes access while the User survives. */
const MEMBERSHIP_DELEGATES = ['vendorMember', 'orgMember', 'runner'] as const
const MEMBERSHIP_TABLES = ['VendorMember', 'OrgMember', 'Runner'] as const

export interface DeleteFinding {
  file: string
  line: number
  snippet: string
  kind: 'prisma' | 'raw-sql'
}

/** `<anything>.vendorMember.delete(` / `.deleteMany(` — the Prisma delegate shape. */
const PRISMA_DELETE = new RegExp(
  String.raw`\.\s*(${MEMBERSHIP_DELEGATES.join('|')})\s*\.\s*delete(?:Many)?\s*\(`,
)
/** `DELETE FROM "VendorMember"` — the raw-SQL escape hatch ($executeRaw / $queryRaw). */
const RAW_SQL_DELETE = new RegExp(
  String.raw`DELETE\s+FROM\s+"?(${MEMBERSHIP_TABLES.join('|')})"?`,
  'i',
)

function sourceFilesUnder(absRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      let s
      try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
    }
  }
  walk(absRoot)
  return out
}

/**
 * THE SCAN. Takes roots so the positive controls can drive the REAL function over a planted
 * fixture — not a predicate extracted from it. A control that only exercises the regex proves
 * the regex, not the guard; that distinction is why an earlier control in this repo passed
 * vacuously.
 */
export function scanMembershipDeletes(absRoots: string[]): { findings: DeleteFinding[]; filesScanned: number } {
  const findings: DeleteFinding[] = []
  let filesScanned = 0

  for (const root of absRoots) {
    for (const file of sourceFilesUnder(root)) {
      filesScanned++
      let raw: string
      try { raw = readFileSync(file, 'utf8') } catch { continue }
      // BOTH halves read stripped source — what we flag and what we let past.
      const lines = stripComments(raw).split('\n')
      lines.forEach((line, i) => {
        const kind: DeleteFinding['kind'] | null =
          PRISMA_DELETE.test(line) ? 'prisma' : RAW_SQL_DELETE.test(line) ? 'raw-sql' : null
        if (!kind) return
        findings.push({
          file: relative(REPO, file),
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          kind,
        })
      })
    }
  }
  return { findings, filesScanned }
}

// ─── harness ──────────────────────────────────────────────────────────────────

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else      { fail++; console.log(`  ❌ ${label}`) }
}

function main() {
  // ── [0] anti-vacuity ───────────────────────────────────────────────────────────────────────
  // A scan that reads nothing reports nothing and looks identical to a clean tree. Floor it.
  console.log('\n[0] anti-vacuity — the scan reads the runtime trees')
  const real = scanMembershipDeletes(RUNTIME_ROOTS.map(r => join(REPO, r)))
  assert(real.filesScanned > 200, `scanned a real corpus (${real.filesScanned} files, floor 200)`)

  // Sanity that the corpus contains the models at all — otherwise a rename could make the
  // guard trivially true while it goes on reporting green.
  const mentions = sourceFilesUnder(join(REPO, 'lib'))
    .filter(f => /vendorMember|orgMember|runner\./i.test(stripComments(readFileSync(f, 'utf8'))))
  assert(mentions.length > 0, `the membership models are actually referenced in lib/ (${mentions.length} files)`)

  // ── [P1] POSITIVE CONTROL — a planted delete is FOUND ──────────────────────────────────────
  console.log('\n[P1] PROBE CONTROL — a planted vendorMember.deleteMany is caught')
  const tmp = mkdtempSync(join(tmpdir(), 'membership-guard-'))
  try {
    const planted = join(tmp, 'planted-offender.ts')
    writeFileSync(planted, [
      `import { db } from '@/lib/db'`,
      `export async function revokeVendor(userId: string) {`,
      `  await db.vendorMember.deleteMany({ where: { userId } })`,
      `}`,
    ].join('\n'))

    const p1 = scanMembershipDeletes([tmp])
    assert(p1.findings.length === 1, `planted defect FOUND (${p1.findings.length} finding, expected 1)`)
    assert(p1.findings[0]?.kind === 'prisma', 'classified as a prisma delegate delete')
    assert(
      Boolean(p1.findings[0]?.file?.includes('planted-offender.ts')),
      `the finding NAMES the offending path (got '${p1.findings[0]?.file ?? 'none'}')`,
    )
    assert(p1.findings[0]?.line === 3, `the finding names the offending LINE (got ${p1.findings[0]?.line})`)

    // ── [P2] POSITIVE CONTROL — the same delete, in a comment, is NOT found ──────────────────
    // The half that actually bites: prose must never be able to trip the guard, AND — read the
    // other way — the stripper must be applied to what we flag, not bolted on somewhere else.
    console.log('\n[P2] PROBE CONTROL — the same delete inside a comment is NOT flagged')
    rmSync(planted)
    const commented = join(tmp, 'commented-mention.ts')
    writeFileSync(commented, [
      `// Historically this did: await db.vendorMember.deleteMany({ where: { userId } })`,
      `/* and the block-comment form: db.orgMember.delete({ where: { id } }) */`,
      `export const NOTHING = 1`,
    ].join('\n'))
    const p2 = scanMembershipDeletes([tmp])
    assert(p2.findings.length === 0, `comment-only mentions NOT flagged (${p2.findings.length} findings, expected 0)`)

    // ── [P3] POSITIVE CONTROL — raw SQL is the second detection shape ────────────────────────
    console.log('\n[P3] PROBE CONTROL — raw SQL DELETE FROM is caught')
    rmSync(commented)
    const rawSql = join(tmp, 'raw-offender.ts')
    writeFileSync(rawSql, [
      `import { db } from '@/lib/db'`,
      `export const nuke = () => db.$executeRawUnsafe('DELETE FROM "OrgMember" WHERE "userId" = $1')`,
    ].join('\n'))
    const p3 = scanMembershipDeletes([tmp])
    assert(p3.findings.length === 1, `raw SQL delete FOUND (${p3.findings.length} finding, expected 1)`)
    assert(p3.findings[0]?.kind === 'raw-sql', 'classified as raw-sql')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  // ── [1] THE INVARIANT ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] the runtime trees contain no membership deletes')
  for (const f of real.findings) console.log(`     → ${f.file}:${f.line}  [${f.kind}]  ${f.snippet}`)
  assert(
    real.findings.length === 0,
    `no VendorMember / OrgMember / Runner delete in app|lib|workers (${real.findings.length} found)`,
  )

  // ── [2] the suite survived its own planted defects ─────────────────────────────────────────
  // The controls above deliberately construct failing states. If one of them had thrown instead
  // of asserting, everything after it would silently not run — a suite that stops reporting
  // looks exactly like a suite with nothing to report.
  console.log('\n[2] the guard still reports after the planted-defect controls')
  assert(pass + fail >= 9, `all assertions executed and reported (${pass + fail} so far)`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
