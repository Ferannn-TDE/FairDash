/**
 * EXECUTABLE INVARIANTS — every documented claim names a live, registered guard, or admits it
 * has none.
 *
 * THE LEAK THIS CLOSES. PROJECT_INVARIANTS.md is prose, and prose has no drift-guard — this
 * codebase's own stated residual leak. It fired this session: the doc claimed "accrual is
 * VOS-independent", the code had stopped honouring it for vendors, and only a manual
 * side-by-side read caught it. A doc that silently stops being true is worse than no doc,
 * because a reviewer repeats it as fact.
 *
 * ⚠️ SCOPE — DELIBERATELY NARROW. This does NOT verify that a guard proves what the prose
 * MEANS. That is not mechanisable, and pretending otherwise would be its own vacuous gate. The
 * claim here is exactly: every documented invariant NAMES a guard that exists and is
 * registered in verify-all, or explicitly declares itself unguarded WITH A REASON.
 * Unguarded-and-declared passes. Unguarded-and-silent fails.
 *
 * KEYED ON STRUCTURE, NOT PHRASING. Claims carry an HTML-comment marker:
 *     <!-- guard: scripts/foo-guard.ts -->
 *     <!-- guard: none — <reason> -->
 * Rewording a claim, reflowing a paragraph or renaming a section changes nothing here.
 * Renaming or unregistering a guard fails it. That distinction is the whole point: this repo
 * has broken guards twice by keying on spelling (a guard keyed on `startDate`/`endDate` missed
 * an aliased copy; a §[3] assertion broke this session when a function was extracted with no
 * behaviour change).
 *
 * Run: npx tsx scripts/invariant-guard-refs.ts
 */

import { readFileSync, existsSync } from 'fs'

const DOC = 'PROJECT_INVARIANTS.md'
const RUNNER = 'scripts/verify-all.ts'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

// ── The sections whose bullets are LOAD-BEARING CLAIMS about code ──────────────
// Excluded by design, and each for a stated reason (reported, never silently skipped):
//   "How we work — disciplines"  → practices for humans, not properties of any file.
//   "The test / guard system"    → describes the runner itself; guarding it with itself is circular.
//   "What FairSynq is"           → prose overview, no claims.
const CLAIM_SECTIONS = new Set([
  'Load-bearing invariants',
  'The money pipeline',
  'The delivery / custody model',
  "Things that look like bugs but aren't",
])

interface Claim { line: number; section: string; title: string; guard: string | null; reason: string | null }

/** Parse claims + their markers. Structure-keyed: bullet start, marker comment, table row. */
export function parseClaims(doc: string): Claim[] {
  const lines = doc.split('\n')
  const claims: Claim[] = []
  let section = ''
  let pending: Claim | null = null

  const flush = () => { if (pending) { claims.push(pending); pending = null } }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const h = /^#{2,3}\s+(.*)/.exec(l)
    if (h) { flush(); section = h[1].trim(); continue }

    const marker = /<!--\s*guard:\s*([\s\S]*?)\s*-->/.exec(l)

    // Through-line table rows carry their guard in the last column.
    if (l.startsWith('|') && !l.startsWith('|---') && !/\| Derivation \|/.test(l)) {
      const cells = l.split('|').map(c => c.trim()).filter(Boolean)
      if (cells.length >= 3) {
        // MARKER WINS. A `guard: none` declaration may legitimately MENTION a script in its
        // reason (the queue-prefix row cites step-b-inspect.ts as an OPERATIONAL check, not a
        // gate suite). Extracting a path out of the reason text and calling it the guard would
        // then demand that operational probe be registered — a false failure, and precisely
        // the read-the-prose-not-the-structure mistake this suite exists to avoid.
        const declaredNone = marker && /^none\b/.test(marker[1])
        const script = declaredNone ? null : /scripts\/([A-Za-z0-9._-]+\.ts)/.exec(l)
        claims.push({
          line: i + 1, section: 'through-line table', title: cells[0],
          guard: script ? `scripts/${script[1]}` : null,
          reason: declaredNone ? marker![1].replace(/^none\s*[—-]\s*/, '') : null,
        })
      }
      continue
    }

    if (CLAIM_SECTIONS.has(section) && /^-\s+\*\*/.test(l)) {
      flush()
      const t = /^-\s+\*\*(.*?)\*\*/.exec(l)
      pending = { line: i + 1, section, title: (t?.[1] ?? l).slice(0, 80), guard: null, reason: null }
      continue
    }

    if (marker && pending) {
      const body = marker[1]
      if (/^none\b/.test(body)) pending.reason = body.replace(/^none\s*[—-]\s*/, '').trim()
      else pending.guard = body.trim()
      flush()
    }
  }
  flush()
  return claims
}

const doc = readFileSync(DOC, 'utf8')
const runner = readFileSync(RUNNER, 'utf8')
const registered = new Set([...runner.matchAll(/file: 'scripts\/([^']+\.ts)'/g)].map(m => `scripts/${m[1]}`))

console.log('\n════ EXECUTABLE INVARIANTS ════')

// ── [0] POSITIVE CONTROLS on the parser — it must be able to FAIL ─────────────
console.log('\n[0] POSITIVE CONTROLS: the parser detects each failure mode')
const SAMPLE = `
## Load-bearing invariants

- **A guarded claim.** Body text.
  <!-- guard: scripts/real-guard.ts -->

- **An undeclared claim.** Body text with no marker at all.

- **A declared-unguarded claim.** Body text.
  <!-- guard: none — spans two deployments, no scanner can see it -->
`
const sample = parseClaims(SAMPLE)
assert(sample.length === 3, `parses every claim in a sample doc (found ${sample.length}/3)`)
assert(sample[0].guard === 'scripts/real-guard.ts', 'a guarded claim yields its guard path')
assert(sample[1].guard === null && sample[1].reason === null, 'an UNDECLARED claim yields neither — this is the failure case')
assert(sample[2].guard === null && !!sample[2].reason, 'a declared-unguarded claim yields a REASON')

// Reformat-immunity: rewording prose and reflowing must not change the parse.
const REWORDED = SAMPLE
  .replace('A guarded claim.', 'Completely different wording here.')
  .replace('Body text.', 'Body\n  text reflowed across\n  several lines.')
assert(parseClaims(REWORDED)[0].guard === 'scripts/real-guard.ts',
  'rewording + reflowing a claim does NOT change its guard (structure, not phrasing)')

// ── [1] every claim is guarded-and-registered, or declared-unguarded ──────────
console.log('\n[1] every documented claim names a live registered guard, or declares it has none')
const claims = parseClaims(doc)
assert(claims.length >= 20, `[0] found ${claims.length} claims to check (not vacuous)`)

const undeclared = claims.filter(c => !c.guard && !c.reason)
assert(undeclared.length === 0,
  `no claim is unguarded-and-silent (offenders: ${undeclared.map(c => `${DOC}:${c.line} "${c.title}"`).join(' | ') || 'none'})`)

const missing = claims.filter(c => c.guard && !existsSync(c.guard))
assert(missing.length === 0,
  `every named guard EXISTS (missing: ${missing.map(c => `${c.guard} (${DOC}:${c.line})`).join(', ') || 'none'})`)

const unregistered = claims.filter(c => c.guard && existsSync(c.guard) && !registered.has(c.guard))
assert(unregistered.length === 0,
  `every named guard is REGISTERED in verify-all (unregistered: ${unregistered.map(c => `${c.guard} (${DOC}:${c.line})`).join(', ') || 'none'})`)

const shortReason = claims.filter(c => !c.guard && c.reason && c.reason.length < 30)
assert(shortReason.length === 0,
  `every unguarded declaration carries a real REASON, not a token (too short: ${shortReason.map(c => DOC + ':' + c.line).join(', ') || 'none'})`)

// ── [2] report, so the finding is visible even on a green run ─────────────────
const unguarded = claims.filter(c => !c.guard && c.reason)
console.log(`\n[2] inventory — ${claims.length} claims: ${claims.length - unguarded.length} guarded, ${unguarded.length} declared-unguarded`)
for (const c of unguarded) console.log(`     ⚠️  UNGUARDED  ${DOC}:${c.line}  ${c.title}\n         reason: ${c.reason}`)

console.log('\n────────────────────────────────────')
console.log(failed === 0 ? `  ✅ ${passed} passed, 0 failed` : `  ❌ ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
