/**
 * DATE-FNS CONTAINMENT — react-day-picker's dependencies must not become the app's date layer.
 *
 * Installing react-day-picker@10 pulled in `date-fns` and `@date-fns/tz` transitively. That is
 * fine — the library needs them. What is NOT fine is app code starting to import them directly,
 * because that is how a UI dependency quietly becomes the project's date abstraction: one
 * `import { format } from 'date-fns'` in a component, then another, and now removing or
 * upgrading a calendar widget is a cross-cutting refactor.
 *
 * The codebase already has its date layer, and it encodes rules a generic library does not
 * know: `lib/event-date.ts` (a fair date is a CALENDAR date, read in UTC — written after every
 * surface showed fairs starting a day early), `lib/audit-time.ts` (audit instants), and
 * `lib/calendar-date.ts` (the picker boundary). Those stay the vocabulary.
 *
 *   [0] POSITIVE CONTROL — the scanner must catch a planted import, or a green run means
 *       nothing (it could be scanning nothing at all).
 *   [1] NO DIRECT IMPORT of date-fns / @date-fns/tz anywhere in app code.
 *   [2] THE PICKER IS THE ONLY react-day-picker CONSUMER — one component wraps the library, so
 *       swapping or removing it later is a single-file change, not a search-and-replace.
 *   [3] THE ADAPTER STAYS DEPENDENCY-FREE — lib/calendar-date.ts imports nothing, which is what
 *       lets date-round-trip-guard prove it without mounting a calendar.
 *
 * Run:  npx tsx scripts/date-fns-containment-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const REPO = new URL('..', import.meta.url).pathname
const ROOTS = ['app', 'components', 'lib', 'workers']

/** The ONE file allowed to import react-day-picker. */
const PICKER = 'app/_components/ui/DateRangePicker.tsx'

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const full = join(dir, e)
      let s; try { s = statSync(full) } catch { continue }
      if (s.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e)) out.push(full)
    }
  }
  for (const r of ROOTS) walk(join(REPO, r))
  return out
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DATE_FNS = /from\s+['"](date-fns|@date-fns\/tz)(\/[^'"]*)?['"]/
const DAY_PICKER = /from\s+['"]react-day-picker['"]/

/** Scanner as a function so [0] can run it against planted content. */
function scan(files: { path: string; body: string }[]) {
  const dateFns: string[] = []
  const dayPicker: string[] = []
  for (const { path, body } of files) {
    const code = stripComments(body)
    if (DATE_FNS.test(code)) dateFns.push(path)
    if (DAY_PICKER.test(code)) dayPicker.push(path)
  }
  return { dateFns, dayPicker }
}

console.log('[0] positive control — the scanner can actually fail')
{
  const planted = scan([
    { path: 'planted/a.ts', body: `import { format } from 'date-fns'` },
    { path: 'planted/b.ts', body: `import { TZDate } from '@date-fns/tz'` },
    { path: 'planted/c.ts', body: `import { addDays } from "date-fns/addDays"` },
    { path: 'planted/d.tsx', body: `import { DayPicker } from 'react-day-picker'` },
  ])
  assert(planted.dateFns.length === 3, `catches a planted date-fns import (found ${planted.dateFns.length}/3)`)
  assert(planted.dayPicker.length === 1, 'catches a planted react-day-picker import')
  const clean = scan([{ path: 'clean.ts', body: `import { formatEventDate } from '@/lib/event-date'` }])
  assert(clean.dateFns.length === 0 && clean.dayPicker.length === 0, 'stays quiet on clean code (not matching everything)')
  const commented = scan([{ path: 'c.ts', body: `// we deliberately do not import from 'date-fns' here\nconst x = 1` }])
  assert(commented.dateFns.length === 0, 'ignores COMMENTS (guards scan code, not prose)')
}

const files = sourceFiles().map(path => ({ path: relative(REPO, path), body: readFileSync(path, 'utf8') }))
const { dateFns, dayPicker } = scan(files)

console.log(`\n[1] no direct date-fns import in app code (${files.length} files scanned)`)
assert(files.length > 100, `the scan actually covered the tree (${files.length} files)`)
assert(dateFns.length === 0,
  `zero direct date-fns / @date-fns/tz imports${dateFns.length ? ` — found in ${dateFns.join(', ')}` : ''}`)

console.log('\n[2] react-day-picker has exactly ONE consumer')
assert(dayPicker.length === 1 && dayPicker[0] === PICKER,
  `only ${PICKER} imports react-day-picker${dayPicker.length !== 1 ? ` — found ${dayPicker.length}: ${dayPicker.join(', ')}` : ''}`)

console.log('\n[3] the adapter is dependency-free (so it is provable without a calendar)')
{
  const adapter = readFileSync(join(REPO, 'lib/calendar-date.ts'), 'utf8')
  const imports = stripComments(adapter).match(/^\s*import\s/gm) ?? []
  assert(imports.length === 0, `lib/calendar-date.ts imports nothing (found ${imports.length})`)
  assert(/export function toPickerDate/.test(adapter) && /export function fromPickerDate/.test(adapter),
    'both conversion functions are exported for the round-trip guard')
  // The two one-liners that reintroduce the off-by-one must not appear in the adapter.
  const code = stripComments(adapter)
  assert(!/new Date\(\s*value\s*\)/.test(code), 'adapter never does new Date(value) — that is UTC-parsed (Americas off-by-one)')
  assert(!/toISOString\(\)/.test(code), 'adapter never does toISOString() — that is UTC-read (Asia/AU off-by-one)')
}

console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} date-fns-containment-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
