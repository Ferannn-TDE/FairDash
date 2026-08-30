/**
 * SETTINGS HOOKS GUARD — no React hook may sit below a conditional return in the admin
 * settings page.
 *
 * THE BUG THIS LOCKS. app/admin/[eventSlug]/settings/page.tsx called
 *   useMemo(() => editDateBounds(startDate, endDate), …)
 * BELOW `if (loading) return …`. The first render (loading) returned early and never reached
 * it; the second (loaded) did. React counts hooks per render, saw a different number, and threw
 * "Rendered more hooks than during the previous render" — so the page died deterministically
 * for every admin, on every fair, on every visit. Introduced by ae8413a.
 *
 * WHY A GUARD AND NOT JUST THE FIX. Nothing in the toolchain sees this. `tsc` is clean —
 * conditional hooks are type-correct. `next build` compiles it. The rule that catches it,
 * react-hooks/rules-of-hooks, has never run here because the repo has NO ESLint config at all
 * (a separate, larger pass). Until that lands, this file has no automated protection, and the
 * one thing it must never do again is exactly what it did.
 *
 * It asserts the CLASS, not the line: ANY hook below ANY conditional return goes red.
 *
 * ── TWO SCANNER TRAPS, BOTH LEARNED THE HARD WAY ────────────────────────────────────────────
 * 1. FUNCTION BOUNDARIES. The naive version of this scan (line order only) reported 14 hits
 *    across the app and 13 were false: the "early return" belonged to a small child component
 *    defined earlier in the same file, and the hook belonged to the real component below it.
 *    A scanner that cannot see function boundaries reports noise, gets ignored, and protects
 *    nothing. This one anchors to the component's own body.
 * 2. GENERICS. `useState<string | null>(null)` does NOT match /useState\s*\(/ — the diagnosis
 *    scanner silently skipped :46 for exactly that reason. A hook-detector blind to generics
 *    would miss a whole class of hooks, so the pattern allows a type argument.
 *
 * Run: npx tsx scripts/settings-hooks-guard.ts   (pure — no database, no server)
 */

import { readFileSync } from 'node:fs'

const FILE = 'app/admin/[eventSlug]/settings/page.tsx'
/** The component whose body is under test. */
const COMPONENT = 'export default function AdminSettingsPage'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** A hook call — optionally generic-typed, so `useState<T>(…)` is caught as well as `useState(…)`. */
const HOOK = /\b(use[A-Z]\w*|use)\s*(<[^>()]*>)?\s*\(/
/** A conditional early return: `if (x) return …`. */
const COND_RETURN = /^\s{0,6}if\s*\(.*\)\s*return\b/

function stripComments(line: string): string {
  const t = line.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  return line.split('//')[0]
}

/** Lines of the named component's body, as [1-indexed lineNo, text] — stops at the next top-level decl. */
function componentBody(src: string, header: string): [number, string][] {
  const lines = src.split('\n')
  const start = lines.findIndex(l => l.startsWith(header))
  if (start === -1) return []
  const out: [number, string][] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    // A new top-level declaration ends this component's body.
    if (/^(export |function |const \w+ = )/.test(l)) break
    out.push([i + 1, l])
  }
  return out
}

function analyse(src: string) {
  const body = componentBody(src, COMPONENT)
  const hooks: number[] = []
  const returns: number[] = []
  for (const [no, raw] of body) {
    const line = stripComments(raw)
    if (!line.trim()) continue
    if (HOOK.test(line)) hooks.push(no)
    if (COND_RETURN.test(line)) returns.push(no)
  }
  const firstReturn = returns.length ? returns[0] : null
  const below = firstReturn === null ? [] : hooks.filter(h => h > firstReturn)
  return { bodyLines: body.length, hooks, returns, firstReturn, below }
}

function main() {
  const src = readFileSync(FILE, 'utf8')

  // ── [0] THE SCANNER CAN SEE WHAT IT CLAIMS TO SEE ──────────────────────────────────────
  // Every assertion below is NEGATIVE ("no hook sits below a return"), and a negative passes
  // for free when the detector is broken. So the detector is exercised first.
  console.log('\n[0] the detector is not blind')
  assert(HOOK.test('  const [a, setA] = useState(false)'), 'detects a plain useState')
  assert(HOOK.test('  const [a, setA] = useState<string | null>(null)'),
    'detects a GENERIC useState — the form the diagnosis scanner silently skipped')
  assert(HOOK.test('  const x = useMemo(() => 1, [])'), 'detects useMemo')
  assert(HOOK.test('  const p = use(paramsPromise)'), 'detects the bare `use` hook')
  assert(HOOK.test('  const v = useCustomThing()'), 'detects a custom use* hook')
  assert(!HOOK.test('  const user = userLookup(id)'), 'does NOT fire on an ordinary function call')
  assert(COND_RETURN.test('  if (loading) return <div>Loading…</div>'), 'detects a conditional return')
  assert(!COND_RETURN.test('    return { minDate, maxDate }'), 'does NOT fire on a plain return')

  // ── [1] THE FILE IS CLEAN ──────────────────────────────────────────────────────────────
  console.log('\n[1] every hook in AdminSettingsPage sits above the first conditional return')
  const r = analyse(src)
  assert(r.bodyLines > 50, `the component body was actually found (${r.bodyLines} lines) — an empty body would pass vacuously`)
  assert(r.hooks.length >= 12, `it contains the expected hooks (${r.hooks.length} found)`)
  assert(r.firstReturn !== null, `it has conditional returns (first at :${r.firstReturn}) — otherwise this file cannot exhibit the bug and the guard is pointless`)
  assert(r.below.length === 0,
    r.below.length === 0
      ? `NO hook below the first conditional return (:${r.firstReturn})`
      : `hooks below the return at :${r.firstReturn} → ${r.below.map(l => ':' + l).join(', ')}`)

  // ── [2] THE POSITIVE CONTROL — the guard SEES the original bug ──────────────────────────
  // Reconstruct the pre-fix arrangement in memory (move the useMemo below the returns) and
  // require the analysis to flag it. A guard that has never seen its own bug is not a guard.
  console.log('\n[2] positive control: the PRE-FIX arrangement is caught')
  const memoBlock = `  const { minDate, maxDate, defaultMonth } = useMemo(
    () => editDateBounds(startDate, endDate),
    [startDate, endDate],
  )
`
  assert(src.includes(memoBlock), '[0] the real useMemo block was located in the file (so the reconstruction is faithful)')
  const broken = src
    .replace(memoBlock, '')
    .replace(
      "  const saving = saveState === 'saving'",
      memoBlock + "\n  const saving = saveState === 'saving'",
    )
  const rb = analyse(broken)
  assert(rb.below.length > 0,
    `the pre-fix arrangement IS flagged (hook at ${rb.below.map(l => ':' + l).join(', ')} below the return at :${rb.firstReturn})`)
  assert(rb.hooks.length === r.hooks.length,
    'the reconstruction moved the hook rather than adding or losing one — same hook count, different position')

  console.log(`\n${'─'.repeat(72)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(72)}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
