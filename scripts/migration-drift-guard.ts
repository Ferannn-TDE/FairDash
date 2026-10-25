/**
 * MIGRATION-DRIFT GUARD — the dev-database drift warning stays wired and can see drift.
 *
 *   [1] pending (lib/migration-status, shared with /api/health): the real migrations folder minus an applied list missing the newest
 *       entry → exactly that entry (positive control), and nothing when all are applied.
 *   [2] wiring: `npm run dev` runs the check first (predev, warn-only, never blocks), and
 *       `npm run db:drift` runs it strictly — both against the dev database wrapper.
 *
 * No database. Run:  npx tsx scripts/migration-drift-guard.ts
 */

import { readFileSync } from 'node:fs'
import { migrationFolders } from './migration-drift'
import { computeMigrationState } from '../lib/migration-status'

/** Folders still pending when exactly `applied` finished. */
const pendingMigrations = (folders: string[], applied: string[]) =>
  computeMigrationState(folders, applied.map(migration_name => ({ migration_name, finished_at: new Date(), rolled_back_at: null }))).pending

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] pending migrations')
const folders = migrationFolders()
assert(folders.length > 50 && folders.includes('20261020120000_add_payee_notice'), `reads the real migrations folder (${folders.length} entries)`)
assert(folders.join() === [...folders].sort().join(), 'folders come back oldest first')
const newest = folders[folders.length - 1]
assert(JSON.stringify(pendingMigrations(folders, folders.slice(0, -1))) === JSON.stringify([newest]), `positive control: a database missing the newest → [${newest}]`)
assert(pendingMigrations(folders, folders).length === 0, 'all applied → nothing pending')
assert(pendingMigrations(folders, ['20261020120000_add_payee_notice']).length === folders.length - 1, 'only one applied → every other folder pending')

console.log('[2] wiring')
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
assert(/with-dev-db\.sh npx tsx scripts\/migration-drift\.ts --warn \|\| true$/.test(scripts.predev ?? ''), 'predev warns about dev-database drift before `npm run dev`, and never blocks it')
assert(/with-dev-db\.sh npx tsx scripts\/migration-drift\.ts$/.test(scripts['db:drift'] ?? ''), '`npm run db:drift` checks the dev database strictly')
assert(/^prisma generate && tsx scripts\/migration-drift\.ts && next build$/.test(scripts.build ?? ''),
  '`npm run build` runs the drift check strictly (no --warn, no || true) before next build')
const src = readFileSync('scripts/migration-drift.ts', 'utf8')
assert(src.includes("process.env.SKIP_MIGRATION_CHECK === '1'") && /SKIP_MIGRATION_CHECK=1 +the documented override/.test(src),
  'the build override is exactly SKIP_MIGRATION_CHECK=1, and documented in the script header')
const plan = readFileSync('docs/PRODUCTION_READINESS.md', 'utf8')
assert(/\*\*A migration is applied to every database in the same session\.\*\*/.test(plan), 'the standing rule names all three databases')

console.log(`\n${fail === 0 ? '✅' : '❌'} migration-drift: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
