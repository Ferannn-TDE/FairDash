/**
 * READINESS PROGRESS — keeps the Done column in docs/PRODUCTION_READINESS.md honest.
 *
 * A hand-updated summary drifts within days. The table is therefore GENERATED: each
 * `## Phase X:` / `## Track X:` section's `- [x]` and `- [ ]` lines are counted, and the row
 * whose first cell starts with `X.` gets `done/total`.
 *
 *   npx tsx scripts/readiness-progress.ts --write   rewrite the table in place
 *   npx tsx scripts/readiness-progress.ts           check only (the verify-all suite): exit 1 if stale
 *
 * The check runs a positive control first (a fixture with a checked box and a stale row must be
 * reported stale, and a phase with no table row must be an error), so a parser that silently
 * matches nothing can't pass.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DOC = join(process.cwd(), 'docs', 'PRODUCTION_READINESS.md')

const SECTION = /^## (?:Phase|Track) (\w+):/
const ROW = /^\| (\w+)\. ([^|]*)\| ([^|]*)\| ([^|]*)\|$/

export function countByPhase(doc: string): Map<string, { done: number; total: number }> {
  const counts = new Map<string, { done: number; total: number }>()
  let current: string | null = null
  for (const line of doc.split('\n')) {
    const s = line.match(SECTION)
    if (s) { current = s[1]; counts.set(current, { done: 0, total: 0 }); continue }
    if (line.startsWith('## ')) { current = null; continue }
    if (!current) continue
    const c = counts.get(current)!
    if (/^\s*- \[x\]/i.test(line)) { c.done++; c.total++ }
    else if (/^\s*- \[ \]/.test(line)) { c.total++ }
  }
  return counts
}

/** Returns the doc with the table rewritten. Throws if a phase and the table disagree on keys. */
export function render(doc: string): string {
  const counts = countByPhase(doc)
  const seen = new Set<string>()
  const out = doc.split('\n').map(line => {
    const r = line.match(ROW)
    if (!r) return line
    const [, key, name, window] = r
    const c = counts.get(key)
    if (!c) throw new Error(`table row "${key}." has no "## Phase ${key}:" or "## Track ${key}:" section`)
    seen.add(key)
    return `| ${key}. ${name}| ${window}| ${c.done}/${c.total} |`
  })
  const missing = [...counts.keys()].filter(k => !seen.has(k))
  if (missing.length) throw new Error(`sections with no table row: ${missing.join(', ')}`)
  if (seen.size === 0) throw new Error('no table rows matched — parser is broken')
  return out.join('\n')
}

function positiveControl(): string | null {
  const fixture = [
    '| 1. One | Jan 1 | 0/2 |',
    '## Phase 1: One',
    '- [x] a',
    '- [ ] b',
  ].join('\n')
  if (render(fixture) === fixture) return 'stale fixture was NOT detected'
  if (!render(fixture).includes('| 1/2 |')) return 'fixture counted wrong'
  try { render(fixture + '\n## Phase 2: Two\n- [ ] c'); return 'missing row was NOT an error' } catch { /* expected */ }
  return null
}

const doc = readFileSync(DOC, 'utf8')

if (!process.argv.includes('--write')) {
  const pc = positiveControl()
  if (pc) { console.log(`  ❌ readiness-progress: positive control failed: ${pc}`); process.exit(1) }
  let next: string
  try { next = render(doc) } catch (e) { console.log(`  ❌ readiness-progress: ${(e as Error).message}`); process.exit(1) }
  if (next !== doc) {
    console.log('  ❌ readiness-progress: summary table is stale. Run: npx tsx scripts/readiness-progress.ts --write')
    process.exit(1)
  }
  console.log('  ✅ readiness-progress: summary table matches the checkboxes — ALL PASS')
  process.exit(0)
}

const next = render(doc)
if (next === doc) console.log('readiness-progress: table already up to date')
else { writeFileSync(DOC, next); console.log('readiness-progress: table rewritten') }
for (const [k, c] of countByPhase(next)) console.log(`  ${k}: ${c.done}/${c.total}`)
