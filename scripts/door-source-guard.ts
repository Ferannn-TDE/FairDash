/**
 * DOOR-SOURCE GUARD — no portal door may be rendered from Clerk metadata.
 *
 * ── THE BUG THIS FREEZES OUT ─────────────────────────────────────────────────────────────────
 * The navbar and landing quick-nav rendered "Vendor Dashboard" / "Organizer Portal" / "Runner
 * Dashboard" from `publicMetadata.roles[]`, while the GATES that admit anyone read DB membership
 * rows. Two derivations of one question, free to disagree — and they did: measured live on
 * 2026-08-01, an account was shown a Vendor Dashboard link that led straight to a resume screen.
 *
 * Metadata cannot be repaired into a trustworthy door source: lib/role-sync.ts:91 unions
 * `existing` unconditionally, so an ungrounded role, once written, is re-affirmed forever. The
 * fix was to make the doors read the gates' own predicate (lib/portal-state.ts, via
 * /api/auth/access). This guard is what stops the old shape coming back — because it is a small,
 * plausible-looking edit ("just check roles[], it's right there in the session") that reintroduces
 * a whole class.
 *
 * ── WHAT IS AND IS NOT A VIOLATION ───────────────────────────────────────────────────────────
 * FLAGGED: in a DOOR file, testing `roles` membership against a PORTAL role literal —
 *   `roles.includes('vendor')`, `roles.some(r => r === 'organizer')`, `hasRole(meta, 'runner')`,
 *   `roles.indexOf('driver')`. These are the doors deciding portal access from metadata.
 *
 * NOT FLAGGED: the ADMIN family. `admin` | `super_admin` | `event_operator` have NO DB membership
 *   model — they are granted by invite directly in Clerk metadata (lib/role-sync.ts:31-36,
 *   lib/auth.ts:148). For admin, metadata IS the authority, not a shortcut past one, so
 *   `ADMIN_ROLES.includes(r)` in a door file is correct and must stay green. Excluding it is a
 *   decision, not an oversight: a guard that forced admin off metadata would be demanding a row
 *   that does not exist.
 *
 * ── SHAPE-KEYED, NOT FILENAME-KEYED ──────────────────────────────────────────────────────────
 * DOOR_FILES names the surfaces, but the DETECTION is a shape: role-literal membership tests.
 * A new door added elsewhere is caught by [2], which asserts that no OTHER file under app/
 * renders a portal quick-nav link from metadata — so this does not degrade into an allowlist
 * that a renamed file walks straight past.
 *
 * ── COMMENT-STRIPPED, BOTH HALVES ────────────────────────────────────────────────────────────
 * Every scan reads scripts/_strip-comments.ts output. The prose in RoleContext.tsx explains the
 * old `roles.includes('vendor')` shape at length; that must not fail the guard (or the next
 * person deletes the reasoning to go green). And — the half that bites — a comment must never
 * EXCUSE real code: see `a-comment-cannot-grant-an-exemption`.
 *
 *   [0]  anti-vacuity — the door files exist, are read, and are non-trivial
 *   [1]  no door file tests a PORTAL role literal against metadata
 *   [2]  the door files still render the three portal links (they weren't emptied to pass)
 *   [3]  the doors DO consume the shared predicate — a door that reads neither is not "fixed"
 *   [P1] control — a planted `roles.includes('vendor')` in a real door file is CAUGHT, named
 *   [P2] control — the ADMIN-family read is NOT caught (the exemption is real, not luck)
 *   [P3] control — a comment-only mention is NOT caught (stripping applies to what we flag)
 *   [4]  the suite still reports after its planted defects
 *
 * Pure file-reader — no database. Run:  npx tsx scripts/door-source-guard.ts
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripComments } from './_strip-comments'

const REPO = new URL('..', import.meta.url).pathname

/** The door surfaces — every place a portal quick-nav link is rendered. */
const DOOR_FILES = [
  'app/_components/MarketplaceNavbar.tsx',
  'app/MarketplaceLanding.tsx',
  'app/_contexts/RoleContext.tsx',
]

/** The three portals. `driver` is the legacy alias for runner and is included deliberately. */
const PORTAL_ROLES = ['vendor', 'organizer', 'runner', 'driver'] as const

/**
 * A metadata membership test against a PORTAL role literal, in any of the shapes this codebase
 * actually uses. Admin literals are absent by construction — see the header.
 */
function portalRoleTests(src: string): Array<{ line: number; snippet: string }> {
  const hits: Array<{ line: number; snippet: string }> = []
  const alt = PORTAL_ROLES.join('|')
  const patterns = [
    new RegExp(String.raw`\.(?:includes|indexOf)\s*\(\s*['"\`](${alt})['"\`]`),   // roles.includes('vendor')
    new RegExp(String.raw`===\s*['"\`](${alt})['"\`]`),                            // r === 'organizer'
    new RegExp(String.raw`hasRole\s*\([^)]*['"\`](${alt})['"\`]`),                 // hasRole(meta,'runner')
  ]
  src.split('\n').forEach((line, i) => {
    if (patterns.some(p => p.test(line))) hits.push({ line: i + 1, snippet: line.trim().slice(0, 110) })
  })
  return hits
}

function readStripped(rel: string): string {
  return stripComments(readFileSync(join(REPO, rel), 'utf8'))
}

function tsxFilesUnder(absRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const full = join(dir, e)
      let s
      try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) walk(full)
      else if (/\.tsx$/.test(e)) out.push(full)
    }
  }
  walk(absRoot)
  return out
}

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else      { fail++; console.log(`  ❌ ${label}`) }
}

function main() {
  // ── [0] anti-vacuity ───────────────────────────────────────────────────────────────────────
  console.log('\n[0] anti-vacuity — the door files exist and are non-trivial')
  for (const f of DOOR_FILES) {
    let src = ''
    try { src = readStripped(f) } catch { /* missing */ }
    assert(src.length > 400, `${f} read and non-trivial (${src.length} chars)`)
  }

  // ── [1] THE INVARIANT ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] no door renders a portal from a metadata role test')
  for (const f of DOOR_FILES) {
    const hits = portalRoleTests(readStripped(f))
    for (const h of hits) console.log(`     → ${f}:${h.line}  ${h.snippet}`)
    assert(hits.length === 0, `${f} has no portal-role metadata test (${hits.length} found)`)
  }

  // ── [2] the doors were not simply emptied to pass ──────────────────────────────────────────
  // A guard that goes green because the links were deleted has proved nothing.
  console.log('\n[2] the doors still render the three portal links')
  const navbar = readStripped('app/_components/MarketplaceNavbar.tsx')
  const landing = readStripped('app/MarketplaceLanding.tsx')
  for (const [label, src] of [['navbar', navbar], ['landing', landing]] as const) {
    assert(/isVendor/.test(src),    `${label} still renders the vendor door`)
    assert(/isOrganizer/.test(src), `${label} still renders the organizer door`)
    assert(/isRunner/.test(src),    `${label} still renders the runner door`)
  }

  // ── [3] the doors consume the SHARED predicate ─────────────────────────────────────────────
  // Not reading roles[] is necessary but not sufficient — a door reading nothing at all would
  // also pass [1]. This pins where the answer comes from.
  console.log('\n[3] the door source reads the shared portal-state predicate')
  const ctx = readStripped('app/_contexts/RoleContext.tsx')
  assert(/shouldShowPortalDoor/.test(ctx), 'RoleContext applies shouldShowPortalDoor (the one policy)')
  assert(/\/api\/auth\/access/.test(ctx), 'RoleContext sources state from /api/auth/access (the gates\' predicate)')
  assert(/portals\s*!==\s*null|known/.test(ctx), 'RoleContext distinguishes UNKNOWN from false (the flicker rule)')

  // ── [P1] CONTROL — a planted violation in a REAL door file is caught ───────────────────────
  // Planted in the actual file, not a temp dir: that is the path the guard must protect, and a
  // control that only proves the regex works on a synthetic string proves the regex, not the guard.
  console.log('\n[P1] PROBE CONTROL — a planted roles.includes(\'vendor\') in a real door is caught')
  const target = 'app/_components/MarketplaceNavbar.tsx'
  const original = readFileSync(join(REPO, target), 'utf8')
  try {
    writeFileSync(
      join(REPO, target),
      original.replace(
        'const { isVendor, isOrganizer, isRunner } = useRole()',
        "const { isVendor, isOrganizer, isRunner } = useRole()\n  const planted = (user?.publicMetadata?.roles as string[] ?? []).includes('vendor')\n  void planted",
      ),
    )
    const planted = portalRoleTests(readStripped(target))
    assert(planted.length === 1, `planted violation FOUND (${planted.length}, expected 1)`)
    assert(
      Boolean(planted[0] && planted[0].line > 0 && /includes\('vendor'\)/.test(planted[0].snippet)),
      `the finding names the LINE and the offending code (line ${planted[0]?.line}: ${planted[0]?.snippet?.slice(0, 60)})`,
    )
  } finally {
    writeFileSync(join(REPO, target), original) // always restore, even if an assertion threw
  }
  assert(
    portalRoleTests(readStripped(target)).length === 0,
    'the real file was restored cleanly after the planted defect',
  )

  // ── [P2] CONTROL — the admin exemption is real, not luck ───────────────────────────────────
  console.log('\n[P2] PROBE CONTROL — an ADMIN-family metadata read is NOT flagged')
  const adminShape = `const isAdmin = roles.some(r => ADMIN_ROLES.includes(r))\nconst x = roles.includes('admin')\nconst y = roles.includes('super_admin')`
  assert(portalRoleTests(adminShape).length === 0, 'admin/super_admin membership tests pass (metadata IS the authority there)')
  // …and the same shape with a PORTAL literal is caught, so [P2] is not passing because the
  // detector is simply blind.
  assert(portalRoleTests(`const z = roles.includes('vendor')`).length === 1, 'the SAME shape with a portal literal IS caught (it discriminates)')

  // ── [P3] CONTROL — comment-only mentions are not violations ────────────────────────────────
  console.log('\n[P3] PROBE CONTROL — a comment-only mention is NOT flagged')
  const commented = stripComments(`// this used to be roles.includes('vendor')\n/* and roles.includes('organizer') */\nexport const A = 1`)
  assert(portalRoleTests(commented).length === 0, 'commented-out portal tests do not fail the guard')

  // ── [2b] SHAPE NET — no OTHER file under app/ renders a portal door from metadata ──────────
  // Stops DOOR_FILES degrading into an allowlist a new or renamed door walks past.
  console.log('\n[2b] no undeclared door elsewhere under app/ reads metadata for a portal link')
  const declared = new Set(DOOR_FILES)
  const strays: string[] = []
  for (const abs of tsxFilesUnder(join(REPO, 'app'))) {
    const rel = relative(REPO, abs)
    if (declared.has(rel)) continue
    const src = stripComments(readFileSync(abs, 'utf8'))
    // A door is a portal LINK plus a metadata role test in the same file.
    const rendersPortalLink = /href=["'`]\/(vendor|organizer|runner)\b/.test(src)
    if (rendersPortalLink && portalRoleTests(src).length > 0) strays.push(rel)
  }
  for (const s of strays) console.log(`     → UNDECLARED DOOR: ${s}`)
  assert(strays.length === 0, `no undeclared metadata-sourced door under app/ (${strays.length} found)`)

  // ── [4] the suite survived its own planted defects ─────────────────────────────────────────
  console.log('\n[4] the guard still reports after the planted-defect controls')
  assert(pass + fail >= 18, `all assertions executed and reported (${pass + fail} so far)`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
