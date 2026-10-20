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
 *
 * The test database is not checked here: the gate rebuilds it from schema.prisma
 * (`prisma db push`) on every run, so it cannot fall behind.
 */

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

/** Migration folder names, oldest first. */
export function migrationFolders(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, 'migration.sql'))).sort()
}

/** PURE — folders the database has not finished applying, oldest first. */
export function pendingMigrations(folders: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied)
  return folders.filter(f => !done.has(f))
}

async function main() {
  const warnOnly = process.argv.includes('--warn')
  const say = (m: string) => (warnOnly ? console.warn(m) : console.log(m))
  const { assertNotProductionDatabase } = await import('../lib/prod-db-guard')
  assertNotProductionDatabase('migration-drift.ts') // production only with CONFIRM_PROD_DB=<ref>
  const { PrismaClient } = await import('@prisma/client')
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) { say('⚠️  migration drift: no DATABASE_URL — not checked'); process.exit(warnOnly ? 0 : 1) }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  let applied: string[]
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )
    applied = rows.map(r => r.migration_name)
  } catch (err) {
    say(`⚠️  migration drift: could not read _prisma_migrations (${String(err).split('\n')[0].slice(0, 120)}) — not checked`)
    process.exit(warnOnly ? 0 : 1)
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
  const host = (() => { try { return new URL(url).host } catch { return 'unknown host' } })()
  const pending = pendingMigrations(migrationFolders(), applied)
  if (pending.length === 0) {
    if (!warnOnly) console.log(`✅ ${host}: all ${applied.length} migrations applied`)
    process.exit(0)
  }
  say(`⚠️  ${host} is ${pending.length} migration(s) behind prisma/migrations:`)
  for (const p of pending) say(`     - ${p}`)
  say('   Local dev: npm run dev:db:migrate · Production: CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx prisma migrate deploy')
  process.exit(warnOnly ? 0 : 1)
}

if (process.argv[1]?.endsWith('migration-drift.ts')) void main()
