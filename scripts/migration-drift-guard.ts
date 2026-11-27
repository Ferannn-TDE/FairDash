/**
 * MIGRATION-DRIFT GUARD — the dev-database drift warning stays wired and can see drift.
 *
 *   [1] pending (lib/migration-status, shared with /api/health): the real migrations folder minus an applied list missing the newest
 *       entry → exactly that entry (positive control), and nothing when all are applied.
 *   [2] wiring: `npm run dev` runs the check first (predev, warn-only, never blocks), and
 *       `npm run db:drift` runs it strictly — both against the dev database wrapper.
 *   [3] Preview without a database: the build check is skipped ONLY when VERCEL_ENV=preview and no database URL is
 *       set (exit 0, "skipped on Preview"); production with no URL still fails; a Preview WITH a URL is still checked.
 *       Proven on the pure rule and on the real script (spawned with a scrubbed environment).
 *
 * No database. Run:  npx tsx scripts/migration-drift-guard.ts
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { migrationFolders, driftSkipReason } from './migration-drift'
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

console.log('\n[3] Preview builds with no database')
const PREVIEW_SKIP = /skipped on Preview/
assert(PREVIEW_SKIP.test(driftSkipReason({ VERCEL_ENV: 'preview' }) ?? ''), 'rule: Preview with no database URL → skipped on Preview')
assert(driftSkipReason({ VERCEL_ENV: 'production' }) === null, '[0] control: production with no database URL is NOT skipped')
assert(driftSkipReason({}) === null, 'a local / unknown build with no database URL is NOT skipped')
assert(driftSkipReason({ VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://x' }) === null && driftSkipReason({ VERCEL_ENV: 'preview', DIRECT_URL: 'postgresql://x' }) === null,
  'a Preview that HAS a database URL (either variable) is still checked')
// The real script, as the build runs it. Scrubbed env: no database variables leak in from the gate's wrapper, and
// "no database" is pinned as EMPTY strings — importing Prisma loads a local .env (the dev database) into any variable
// that is unset, and neither Prisma nor dotenv overrides one that is set. Vercel and CI have no .env file.
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli')
const base: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter(([k, v]) =>
  v !== undefined && !/^(DATABASE_URL|DIRECT_URL|TEST_DATABASE_URL|VERCEL_ENV|SKIP_MIGRATION_CHECK|CONFIRM_PROD_DB)$/.test(k))) as Record<string, string>
const run = (extra: Record<string, string>) => {
  const r = spawnSync(process.execPath, [TSX_CLI, 'scripts/migration-drift.ts'], { env: { ...base, ...extra } as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60_000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const NO_DB = { DATABASE_URL: '', DIRECT_URL: '' }
const pv = run({ VERCEL_ENV: 'preview', ...NO_DB })
assert(pv.code === 0 && PREVIEW_SKIP.test(pv.out), `script: Preview, no database → exit 0 with "skipped on Preview" (exit ${pv.code})`)
const pr = run({ VERCEL_ENV: 'production', ...NO_DB })
assert(pr.code === 1 && /no DATABASE_URL — not checked/.test(pr.out) && !PREVIEW_SKIP.test(pr.out), `[0] control: production, no database → exit 1 (exit ${pr.code})`)
const pvDb = run({ VERCEL_ENV: 'preview', DIRECT_URL: '', DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none' })
assert(pvDb.code === 1 && /could not read _prisma_migrations/.test(pvDb.out) && !PREVIEW_SKIP.test(pvDb.out),
  `script: Preview WITH an (unreachable) database URL is still checked and fails (exit ${pvDb.code})`)

console.log(`\n${fail === 0 ? '✅' : '❌'} migration-drift: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
