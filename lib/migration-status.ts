// MIGRATION STATUS — does the database have every migration this build was written against?
//
// Migrations are applied by hand (npm run migrate), and Prisma selects every column of a model,
// so code that ships before its migration breaks every read of that table. The build knows which
// migrations it expects: next.config.mjs bakes the prisma/migrations folder names into
// BUILD_MIGRATIONS, because the serverless bundle has no migrations folder to read at runtime.
// The database knows which ones ran: `_prisma_migrations`. Pending = expected but not applied.
//
// A database AHEAD of the build is fine (expand-first: the migration lands before the code), so
// extra applied rows never count. And when either side can't be read the answer is 'unknown',
// never "0 pending": a check that can't look must not report all clear.

export interface MigrationRow {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

export interface MigrationState {
  status: 'ok' | 'pending' | 'unknown'
  pending: string[]
}

/** The folder names baked into this build. Empty ⇒ not baked (unknown, not "nothing expected"). */
export function bakedMigrations(env: Record<string, string | undefined> = process.env): string[] {
  return (env.BUILD_MIGRATIONS ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * PURE. A migration counts as applied when some row for it finished and was not rolled back.
 * (A failed attempt leaves finished_at null; `migrate resolve --rolled-back` then a re-apply
 * leaves two rows, one of each, which is applied.)
 */
export function computeMigrationState(expected: string[], rows: MigrationRow[] | null): MigrationState {
  if (!expected.length || !rows) return { status: 'unknown', pending: [] }
  const applied = new Set(rows.filter(r => r.finished_at && !r.rolled_back_at).map(r => r.migration_name))
  const pending = expected.filter(name => !applied.has(name))
  return { status: pending.length ? 'pending' : 'ok', pending }
}

/** IO. Any client with $queryRawUnsafe (the app db, a test client, a transaction). */
export async function readMigrationState(
  client: { $queryRawUnsafe<T>(sql: string): Promise<T> },
  expected: string[] = bakedMigrations(),
): Promise<MigrationState> {
  const rows = await client
    .$queryRawUnsafe<MigrationRow[]>('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"')
    .catch(() => null)
  return computeMigrationState(expected, rows)
}
