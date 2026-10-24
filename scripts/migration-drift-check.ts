/**
 * MIGRATION DRIFT CHECK (readiness 1.8) — does the target database have every migration in the
 * repo's prisma/migrations folder? Exit 0 when it does, 1 when any are pending or the database's
 * migration table can't be read. Read-only: one SELECT on _prisma_migrations.
 *
 * Run it against the database a push is about to deploy onto, before the push:
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/migration-drift-check.ts
 * In the gate it runs against the test database (proving the check itself works).
 *
 *   --migrations-dir <dir>   compare against another folder (used by the test's planted fixture)
 */

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../lib/db'
import { readMigrationState } from '../lib/migration-status'

/** Folders with a migration.sql, sorted — the same set next.config.mjs bakes into the build. */
export function listMigrationFolders(dir = 'prisma/migrations'): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
    .map(d => d.name)
    .sort()
}

async function main() {
  const i = process.argv.indexOf('--migrations-dir')
  const dir = i > 0 ? process.argv[i + 1] : 'prisma/migrations'
  const expected = listMigrationFolders(dir)
  const state = await readMigrationState(db, expected)
  await db.$disconnect()

  console.log(`${expected.length} migrations in ${dir}`)
  if (state.status === 'ok') { console.log('✅ database has all of them'); return }
  if (state.status === 'unknown') console.log("❌ can't read _prisma_migrations on the target database")
  else console.log(`❌ ${state.pending.length} pending on the target database:\n${state.pending.map(n => `   ${n}`).join('\n')}`)
  process.exit(1)
}

if (process.argv[1]?.endsWith('migration-drift-check.ts')) main().catch(err => { console.error(err); process.exit(1) })
