/**
 * MIGRATION DRIFT — is this database behind prisma/migrations?
 *
 * 2026-10-20: 20261020120000_add_payee_notice was applied to production and the test database
 * but never to the local dev database, and the walkthrough hit "table PayeeNotice does not
 * exist". Migrations are applied by hand, one database at a time, so one gets missed.
 *
 * Reads `_prisma_migrations` on the database the environment points at (run it through
 * scripts/with-dev-db.sh or scripts/with-prod-db.sh) and lists every migration folder it hasn't
 * finished. Read-only.
 *
 *   npm run db:drift                   dev database; exit 1 when behind
 *   (predev)  … migration-drift.ts --warn   before `npm run dev`; prints a warning, never blocks
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/migration-drift.ts
 *   --migrations-dir <dir>             compare another folder (the test's planted fixture)
 *
 * "Applied" means the same thing here as in /api/health: both go through
 * lib/migration-status.ts (finished and not rolled back; a database ahead of the folder is fine).
 *
 * The test database is not checked here: the gate rebuilds it from schema.prisma
 * (`prisma db push`) on every run, so it cannot fall behind.
 */

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readMigrationState } from '../lib/migration-status'

export const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

/** Migration folder names, oldest first. */
export function migrationFolders(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, 'migration.sql'))).sort()
}

async function main() {
  const warnOnly = process.argv.includes('--warn')
  const say = (m: string) => (warnOnly ? console.warn(m) : console.log(m))
  const { assertNotProductionDatabase } = await import('../lib/prod-db-guard')
  assertNotProductionDatabase('migration-drift.ts') // production only with CONFIRM_PROD_DB=<ref>
  const { PrismaClient } = await import('@prisma/client')
  // DATABASE_URL first: it is the database this app (or this deploy) actually serves, and the one
  // /api/health reads. On Vercel, DIRECT_URL is set but not a valid URL (found 2026-10-25), and
  // nothing at runtime uses it.
  const urlVar = process.env.DATABASE_URL ? 'DATABASE_URL' : 'DIRECT_URL'
  const url = process.env[urlVar]
  if (!url) { say('⚠️  migration drift: no DATABASE_URL — not checked'); process.exit(warnOnly ? 0 : 1) }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const i = process.argv.indexOf('--migrations-dir')
  const folders = migrationFolders(i > 0 ? process.argv[i + 1] : MIGRATIONS_DIR)
  const host = (() => { try { return new URL(url).host } catch { return 'unknown host' } })()
  let state
  try { state = await readMigrationState(prisma, folders) } finally { await prisma.$disconnect().catch(() => {}) }
  if (state.status === 'unknown') {
    // Which variable, whether it even parses, and the database's own reason: at build time on
    // Vercel this line is the only diagnosis there is. Never the URL itself (it holds the password).
    say(`⚠️  migration drift: could not read _prisma_migrations on ${host} — not checked`)
    say(`   using ${urlVar} (parses as a URL: ${host !== 'unknown host' ? 'yes' : 'no'})${state.readError ? `: ${state.readError}` : ''}`)
    process.exit(warnOnly ? 0 : 1)
  }
  const { pending } = state
  if (pending.length === 0) {
    if (!warnOnly) console.log(`✅ ${host}: all ${folders.length} migrations applied`)
    process.exit(0)
  }
  say(`⚠️  ${host} is ${pending.length} migration(s) behind prisma/migrations:`)
  for (const p of pending) say(`     - ${p}`)
  say('   Local dev: npm run dev:db:migrate · Production: CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx prisma migrate deploy')
  process.exit(warnOnly ? 0 : 1)
}

if (process.argv[1]?.endsWith('migration-drift.ts')) void main()
