/**
 * SAFE MIGRATE — the blessed path to apply migrations, with a BLOCK (not a reminder) on the
 * mistake that has now bitten twice: applying a RENAME/DROP migration against the shared prod
 * DB AHEAD of shipping the code that speaks the new schema. The moment such a migration lands,
 * deployed code (still selecting/writing the old column name) breaks instantly.
 *
 * THE RULE (from the handoff, now enforced): build + ship the code first, THEN migrate +
 * promote back-to-back. A destructive-to-deployed-code migration must never be applied while
 * the deployed build still speaks the old schema.
 *
 * This wrapper REFUSES to `prisma migrate deploy` when a PENDING migration contains a
 * column/table RENAME or DROP, unless the operator explicitly confirms the ordering is handled:
 *   CONFIRM_DEPLOY_ORDERING=true npm run migrate
 * The confirmation is a conscious act ("the code that reads the new schema is shipped, or this
 * surface has no live traffic and I will deploy immediately") — it turns a silent apply into a
 * decision. Non-destructive migrations (ADD COLUMN, CREATE INDEX, new tables) pass freely.
 *
 * HONEST LIMITATION: a human can still bypass this by running `npx prisma migrate deploy`
 * directly. This wrapper is the blessed path + the CI guard (migration-safety-guard) is the
 * review-time net; neither can physically stop a direct prisma invocation. The real control is
 * process — but "the easy path blocks" beats "a note reminds".
 *
 * Usage:  npm run migrate            (refuses destructive-pending unless confirmed)
 *         CONFIRM_DEPLOY_ORDERING=true npm run migrate
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

// Ops that break deployed code selecting/writing the OLD schema (all-scalar reads/writes 500;
// renamed columns read as undefined). ADD COLUMN / CREATE INDEX / CREATE TABLE are safe.
const DESTRUCTIVE = [
  /ALTER\s+TABLE\s+[^;]*RENAME\s+COLUMN/i,
  /ALTER\s+TABLE\s+[^;]*RENAME\s+TO/i, // table rename
  /ALTER\s+TABLE\s+[^;]*DROP\s+COLUMN/i,
  /DROP\s+TABLE/i,
]

function destructiveOps(sql: string): string[] {
  return DESTRUCTIVE.filter(re => re.test(sql)).map(re => re.source.slice(0, 40))
}

async function appliedMigrationNames(): Promise<Set<string>> {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    )
    return new Set(rows.map(r => r.migration_name))
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  if (!existsSync(MIGRATIONS_DIR)) { console.error('No migrations dir.'); process.exit(1) }
  const applied = await appliedMigrationNames()
  const folders = readdirSync(MIGRATIONS_DIR).filter(f => existsSync(join(MIGRATIONS_DIR, f, 'migration.sql')))
  const pending = folders.filter(f => !applied.has(f)).sort()

  if (pending.length === 0) { console.log('✅ No pending migrations. Nothing to apply.'); process.exit(0) }

  console.log(`Pending migrations (${pending.length}): ${pending.join(', ')}`)
  const dangerous: { name: string; ops: string[] }[] = []
  for (const p of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, p, 'migration.sql'), 'utf8')
    const ops = destructiveOps(sql)
    if (ops.length) dangerous.push({ name: p, ops })
  }

  if (dangerous.length && process.env.CONFIRM_DEPLOY_ORDERING !== 'true') {
    console.error('\n🛑 REFUSING TO MIGRATE — a pending migration renames/drops schema the deployed code may still use:')
    for (const d of dangerous) console.error(`   • ${d.name}  [${d.ops.join(', ')}]`)
    console.error(
      '\nRULE: build + ship the code that speaks the NEW schema FIRST, then migrate + promote back to back.\n' +
      'Applying this now breaks deployed code instantly (renamed column → 500 / undefined).\n\n' +
      'If the code is shipped (or this surface has no live traffic and you will deploy immediately),\n' +
      're-run with:  CONFIRM_DEPLOY_ORDERING=true npm run migrate',
    )
    process.exit(2)
  }

  if (dangerous.length) {
    console.warn(`\n⚠️  Applying ${dangerous.length} destructive migration(s) with CONFIRM_DEPLOY_ORDERING=true — deploy the matching code NOW.`)
  }

  console.log('\n▶ prisma migrate deploy\n')
  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' })
  process.exit(res.status ?? 1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
