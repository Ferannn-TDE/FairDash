/**
 * MIGRATION HEALTH (readiness 1.8) — code can't deploy ahead of its migration unnoticed.
 *
 * /api/health compares the migrations baked into the build with `_prisma_migrations` and is 503
 * when any are pending; scripts/migration-drift.ts does the same comparison before a push.
 * The test database is built with `prisma db push`, which writes no migration history, so the
 * suite creates `_prisma_migrations` itself with Prisma's own DDL, one finished row per folder
 * (what `migrate deploy` leaves behind), and drops it at the end. Every change after that happens
 * inside a transaction that is rolled back. The same reader is proven against a table Prisma
 * really wrote by running the drift check on the live database (read-only).
 *
 * [0] is the positive control on the probe: the real folder against the fully migrated test
 * database reads ok. Without it, every "pending" below could be a reader that always says pending.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/migration-health-test.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { testPrisma } from '../lib/test-db'
import { bakedMigrations, computeMigrationState, readMigrationState, type MigrationState } from '../lib/migration-status'
import { computeHealth, publicHealthBody } from '../lib/health'
import { migrationFolders } from './migration-drift'

const prisma = testPrisma()

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const ROLLBACK = Symbol('rollback')
/** Run `fn` against a transaction, then roll it back whatever happens. */
async function inRolledBackTx(fn: (tx: typeof prisma) => Promise<void>) {
  await prisma.$transaction(async tx => { await fn(tx as typeof prisma); throw ROLLBACK }).catch(e => { if (e !== ROLLBACK) throw e })
}

const health = (m: MigrationState) => computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: new Date().toISOString(), migrations: m })

// Prisma's DDL for the history table (migration-engine, Postgres).
const HISTORY_DDL = `CREATE TABLE "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`

async function main() {
  const folder = migrationFolders()
  const latest = folder[folder.length - 1]

  const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS exists`)
  if (exists) throw new Error('_prisma_migrations already exists on the test database; this suite owns that table')
  await prisma.$executeRawUnsafe(HISTORY_DDL)
  try { await run(folder, latest) } finally { await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "_prisma_migrations"') }

  await prisma.$disconnect()
  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} migration-health: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

async function run(folder: string[], latest: string) {
  console.log('[0] precondition — read before the history is written, then the real folder fully applied')
  assert((await readMigrationState(prisma, folder)).pending.length === folder.length, 'empty history → every folder pending (the reader sees rows)')
  for (const name of folder) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'test', $1, now(), now(), 1)`, name)
  }

  const base = await readMigrationState(prisma, folder)
  assert(folder.length > 50, `the folder lists the migrations (${folder.length})`)
  assert(base.status === 'ok' && base.pending.length === 0, `0 pending, status ok (got ${base.status}, ${base.pending.length})`)
  assert(publicHealthBody(health(base), 'x').status === 'ok', 'health is ok, so the route answers 200')

  console.log('\n[1] one applied row missing → that migration is pending → 503')
  await inRolledBackTx(async tx => {
    await tx.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name = $1', latest)
    const s = await readMigrationState(tx, folder)
    assert(s.status === 'pending' && s.pending.length === 1 && s.pending[0] === latest, `pending = [${latest}] (got ${JSON.stringify(s.pending)})`)
    const pub = publicHealthBody(health(s), 'x')
    assert(pub.status === 'degraded' && pub.checks.migrations === 'fail', 'health degraded (503), public migrations = fail')
    const body = JSON.stringify(pub)
    assert(!body.includes(latest) && !/\d+ pending|"pending"|count/i.test(body), 'public body carries no names and no count')
  })

  console.log('\n[2] a failed attempt or a rolled-back row is pending; rolled back then re-applied is applied')
  await inRolledBackTx(async tx => {
    await tx.$executeRawUnsafe('UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1', latest)
    assert((await readMigrationState(tx, folder)).pending.includes(latest), 'unfinished (failed) row → pending')
  })
  await inRolledBackTx(async tx => {
    await tx.$executeRawUnsafe('UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = $1', latest)
    assert((await readMigrationState(tx, folder)).pending.includes(latest), 'rolled-back row → pending')
    await tx.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'test', $1, now(), now(), 1)`, latest)
    assert((await readMigrationState(tx, folder)).status === 'ok', 'rolled back + re-applied (two rows) → applied, ok')
  })

  console.log('\n[3] the database AHEAD of the build is not pending')
  await inRolledBackTx(async tx => {
    await tx.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'test', '29991231000000_from_a_newer_build', now(), now(), 1)`)
    const s = await readMigrationState(tx, folder)
    assert(s.status === 'ok' && s.pending.length === 0, 'an extra applied migration leaves status ok')
  })

  console.log("\n[4] can't look → unknown and non-200, never \"0 pending\"")
  await inRolledBackTx(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE "_prisma_migrations" RENAME TO "_prisma_migrations_hidden"')
    const s = await readMigrationState(tx, folder)
    assert(s.status === 'unknown', `migration table unreadable → unknown (got ${s.status})`)
    assert(publicHealthBody(health(s), 'x').status === 'degraded', 'unknown → health degraded (503)')
  }).catch(() => assert(false, 'unreadable table test ran'))
  const unbaked = await readMigrationState(prisma, bakedMigrations({}))
  assert(unbaked.status === 'unknown', 'no baked list (BUILD_MIGRATIONS unset) → unknown, not ok')
  assert(computeMigrationState(folder, null).status === 'unknown', 'rows unreadable → unknown')
  assert(computeHealth({ database: 'ok', redis: 'ok', lastSweepAt: new Date().toISOString() }).status === 'degraded',
    'health with no migration result at all → degraded, never ok by omission')

  console.log('\n[5] the list baked into the build is the folder')
  const cfg = (await import('../next.config.mjs')).default as { env: Record<string, string> }
  const baked = bakedMigrations(cfg.env)
  assert(baked.join() === folder.join(), `next.config.mjs bakes exactly the folder (${baked.length} vs ${folder.length})`)
  // Next replaces only the literal expression; any other read finds nothing in the deployed
  // bundle (health went 503 'unknown' on www the first time). Comments stripped so prose can't satisfy it.
  const src = readFileSync('lib/migration-status.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert(/=\s*\{\s*BUILD_MIGRATIONS:\s*process\.env\.BUILD_MIGRATIONS\s*\}/.test(src),
    'the runtime read is the literal process.env.BUILD_MIGRATIONS (the only form Next inlines)')

  console.log('\n[6] the drift check — exit code from the comparison')
  // Inherits the environment: with-test-db.sh points every database variable at the test DB.
  const run = (...args: string[]) => spawnSync('npx', ['tsx', 'scripts/migration-drift.ts', ...args], { encoding: 'utf8' })
  const real = run()
  assert(real.status === 0, `real folder vs test database → exit 0 (got ${real.status}: ${real.stdout.trim().split('\n').pop()})`)
  const planted = mkdtempSync(join(tmpdir(), 'migr-'))
  try {
    for (const name of [...folder, '29991231000000_not_applied_yet']) {
      mkdirSync(join(planted, name)); writeFileSync(join(planted, name, 'migration.sql'), '-- fixture')
    }
    mkdirSync(join(planted, 'not_a_migration')) // no migration.sql: ignored, as prisma ignores it
    const drift = run('--migrations-dir', planted)
    assert(drift.status === 1 && drift.stdout.includes('29991231000000_not_applied_yet') && !drift.stdout.includes('not_a_migration'),
      `planted unapplied folder → exit 1 naming it (got ${drift.status})`)
    assert(run('--warn', '--migrations-dir', planted).status === 0, '--warn (predev) reports drift but never blocks')
  } finally { rmSync(planted, { recursive: true, force: true }) }
}

main().catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1) })
