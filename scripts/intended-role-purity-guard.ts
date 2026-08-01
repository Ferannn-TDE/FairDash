/**
 * intendedRole PURITY GUARD — a client-writable field must never become an authorization input.
 *
 * ── THE FIELD, AND WHY IT IS DANGEROUS ───────────────────────────────────────────────────────
 * `unsafeMetadata.intendedRole` records what a person clicked at signup ("vendor"). Clerk's
 * unsafeMetadata is CLIENT-WRITABLE — any signed-in user can set it to any value from the
 * browser. It is used in exactly one decision: when the vendor gate has ALREADY denied access,
 * it picks which of two refusals to show (a resume screen, or the unauthorized page). Both are
 * terminal. A forged value buys a stranger a different rejection message and nothing else.
 *
 * It sits one careless edit away from `publicMetadata.roles[]`, which is a different field with
 * a different meaning and a different trust level (server-written, DB-backed since 7e3789c).
 * Someone reading them as synonyms — "they're both the role, right?" — would turn a
 * client-writable string into a grant. The comment at the read site says so; comments in this
 * repo have a documented history of drifting while the code moves. This is the enforcement.
 *
 * ── THE TWO PROPERTIES ───────────────────────────────────────────────────────────────────────
 * [1] ENUMERATION. intendedRole appears in a NAMED SET of sites and nowhere else, so a second
 *     reader cannot appear silently. Each entry carries the reason it is allowed. (Same shape as
 *     money-move-sites-guard's declared set: an enumeration that FAILS on a newcomer, not an
 *     exemption keyed on a path.)
 *
 * [2] ORDERING — the shape half, and the one that actually stops the dangerous edit. Wherever
 *     intendedRole is read in a file that also reads a membership row, EVERY occurrence must
 *     come AFTER the membership read. That is what makes "it can only ever be consulted once
 *     the gate has already said no" a structural fact rather than a promise. Hoisting it above
 *     the gate — the exact move that would turn it into an authorization input — fails here.
 *
 * Neither property alone is enough: [1] would let someone move it above the gate in an
 * already-declared file; [2] would let a brand-new file read it anywhere. Both, or neither.
 *
 * ── COMMENT-STRIPPED, BOTH HALVES ────────────────────────────────────────────────────────────
 * Every scan reads source through scripts/_strip-comments.ts. Prose about intendedRole (there is
 * a lot of it, deliberately) must not fail the guard, and — the half that bites — a comment must
 * never be able to excuse real code. See `a-comment-cannot-grant-an-exemption`.
 *
 *   [0]  anti-vacuity — the scan reads the trees AND finds the field at all
 *   [1]  enumeration — no intendedRole outside the declared set
 *   [2]  ordering — in the vendor gate, every read follows the membership check
 *   [P1] control — intendedRole planted in an undeclared file is CAUGHT and named
 *   [P2] control — intendedRole HOISTED above the membership read is CAUGHT
 *   [P3] control — a comment-only mention is NOT caught (stripping is applied to what we flag)
 *   [3]  the suite still reports after its own planted defects
 *
 * Pure file-reader — no database. Run:  npx tsx scripts/intended-role-purity-guard.ts
 */

import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { stripComments } from './_strip-comments'

const REPO = new URL('..', import.meta.url).pathname
const RUNTIME_ROOTS = ['app', 'lib', 'workers']

/**
 * THE DECLARED SET. Every legitimate site, with the reason. A file appearing in the scan and
 * NOT here fails [1] — that is the point; adding to this list is meant to be a deliberate act
 * that makes someone read the paragraph above.
 */
const DECLARED_SITES: Record<string, string> = {
  'app/_components/RoleAuthCard.tsx':
    'WRITE at signup — sets unsafeMetadata.intendedRole on the Clerk <SignUp>. The origin of the value.',
  'app/onboarding/page.tsx':
    'READ for ROUTING only — decides which application form to redirect to. Grants nothing; ' +
    'roles[] is written at the membership-creation sites (7e3789c).',
  'app/vendor/layout.tsx':
    'READ to choose between TWO REFUSALS — resume screen vs /vendor/unauthorized — strictly ' +
    'after the VendorMember gate has already denied access. Ordering enforced by [2].',
}

/** Files whose ordering must be checked: they read a membership row AND read intendedRole. */
const MEMBERSHIP_READ = /\.\s*(?:vendorMember|orgMember|runner)\s*\.\s*(?:findFirst|findUnique|findMany)\s*\(/

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

export interface PurityReport {
  /** repo-relative paths (stripped source) that mention intendedRole */
  sites: string[]
  /** files where an intendedRole read precedes the membership-row read — the dangerous shape */
  hoisted: string[]
  filesScanned: number
}

/**
 * THE SCAN. Roots are a parameter so the controls drive the REAL function over planted fixtures
 * rather than a re-implemented predicate — a predicate-level control proves the regex, not the
 * guard, which is how an earlier control in this repo passed vacuously.
 */
export function scanIntendedRole(absRoots: string[]): PurityReport {
  const sites: string[] = []
  const hoisted: string[] = []
  let filesScanned = 0

  for (const root of absRoots) {
    for (const file of sourceFilesUnder(root)) {
      filesScanned++
      let raw: string
      try { raw = readFileSync(file, 'utf8') } catch { continue }
      const src = stripComments(raw) // BOTH halves read stripped source
      if (!src.includes('intendedRole')) continue

      const rel = relative(REPO, file)
      sites.push(rel)

      // ORDERING: only meaningful in a file that also reads a membership row.
      const gateIdx = src.search(MEMBERSHIP_READ)
      if (gateIdx === -1) continue
      const firstRead = src.indexOf('intendedRole')
      if (firstRead < gateIdx) hoisted.push(rel)
    }
  }
  return { sites: sites.sort(), hoisted: hoisted.sort(), filesScanned }
}

// ─── harness ──────────────────────────────────────────────────────────────────

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else      { fail++; console.log(`  ❌ ${label}`) }
}

function main() {
  const real = scanIntendedRole(RUNTIME_ROOTS.map(r => join(REPO, r)))

  // ── [0] anti-vacuity ───────────────────────────────────────────────────────────────────────
  // A scan that reads nothing, or a repo where the field has been renamed, both report "no
  // violations" while proving nothing.
  console.log('\n[0] anti-vacuity — the scan reads the trees and finds the field')
  assert(real.filesScanned > 200, `scanned a real corpus (${real.filesScanned} files, floor 200)`)
  assert(real.sites.length > 0, `intendedRole is actually present (${real.sites.length} sites) — not renamed away`)

  // ── [1] ENUMERATION ────────────────────────────────────────────────────────────────────────
  console.log('\n[1] enumeration — no intendedRole outside the declared set')
  const undeclared = real.sites.filter(s => !(s in DECLARED_SITES))
  for (const u of undeclared) console.log(`     → UNDECLARED: ${u}`)
  assert(undeclared.length === 0, `every site is declared (${undeclared.length} undeclared)`)
  for (const [site, why] of Object.entries(DECLARED_SITES)) {
    assert(real.sites.includes(site), `declared site still exists and still reads it: ${site} — ${why.slice(0, 60)}…`)
  }

  // ── [2] ORDERING ───────────────────────────────────────────────────────────────────────────
  console.log('\n[2] ordering — every read follows the membership gate')
  for (const h of real.hoisted) console.log(`     → HOISTED ABOVE THE GATE: ${h}`)
  assert(real.hoisted.length === 0, `no read precedes a membership check (${real.hoisted.length} hoisted)`)

  const tmp = mkdtempSync(join(tmpdir(), 'intended-role-guard-'))
  try {
    // ── [P1] control — an undeclared reader is caught ─────────────────────────────────────────
    console.log('\n[P1] PROBE CONTROL — intendedRole in an undeclared file is caught')
    const rogue = join(tmp, 'rogue-reader.ts')
    writeFileSync(rogue, [
      `export function isVendor(meta: any) {`,
      `  return meta?.unsafeMetadata?.intendedRole === 'vendor'`,
      `}`,
    ].join('\n'))
    const p1 = scanIntendedRole([tmp])
    assert(p1.sites.length === 1, `planted reader FOUND (${p1.sites.length} site, expected 1)`)
    assert(
      Boolean(p1.sites[0]?.includes('rogue-reader.ts')),
      `the finding NAMES the offending path (got '${p1.sites[0] ?? 'none'}')`,
    )
    assert(!(p1.sites[0]! in DECLARED_SITES), 'and it is correctly NOT in the declared set')

    // ── [P2] control — hoisting above the gate is caught ──────────────────────────────────────
    // The dangerous edit itself: read the client-writable field BEFORE the membership check, so
    // it starts influencing whether access is granted rather than which refusal is shown.
    console.log('\n[P2] PROBE CONTROL — intendedRole hoisted ABOVE the membership read is caught')
    rmSync(rogue)
    const hoistedFile = join(tmp, 'hoisted-gate.ts')
    writeFileSync(hoistedFile, [
      `export async function guard(db: any, userId: string, meta: any) {`,
      `  const intent = meta?.unsafeMetadata?.intendedRole`,
      `  const member = await db.vendorMember.findFirst({ where: { userId } })`,
      `  return Boolean(member) || intent === 'vendor'`,
      `}`,
    ].join('\n'))
    const p2 = scanIntendedRole([tmp])
    assert(p2.hoisted.length === 1, `hoisted read CAUGHT (${p2.hoisted.length}, expected 1)`)
    assert(Boolean(p2.hoisted[0]?.includes('hoisted-gate.ts')), 'and the finding names it')

    // Same file, correct order → NOT flagged. Proves [2] discriminates rather than always firing.
    writeFileSync(hoistedFile, [
      `export async function guard(db: any, userId: string, meta: any) {`,
      `  const member = await db.vendorMember.findFirst({ where: { userId } })`,
      `  if (member) return true`,
      `  const intent = meta?.unsafeMetadata?.intendedRole`,
      `  return intent === 'vendor' ? 'resume' : 'deny'`,
      `}`,
    ].join('\n'))
    const p2b = scanIntendedRole([tmp])
    assert(p2b.hoisted.length === 0, `the SAME file in the correct order is NOT flagged (${p2b.hoisted.length})`)

    // ── [P3] control — a comment-only mention is not a site ───────────────────────────────────
    console.log('\n[P3] PROBE CONTROL — a comment-only mention is NOT flagged')
    rmSync(hoistedFile)
    const commented = join(tmp, 'commented.ts')
    writeFileSync(commented, [
      `// Do not read unsafeMetadata.intendedRole here — it is client-writable.`,
      `/* intendedRole must never gate access. */`,
      `export const NOTHING = 1`,
    ].join('\n'))
    const p3 = scanIntendedRole([tmp])
    assert(p3.sites.length === 0, `comment-only mentions NOT flagged (${p3.sites.length} sites, expected 0)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  // ── [3] the suite survived its own planted defects ─────────────────────────────────────────
  console.log('\n[3] the guard still reports after the planted-defect controls')
  assert(pass + fail >= 13, `all assertions executed and reported (${pass + fail} so far)`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
