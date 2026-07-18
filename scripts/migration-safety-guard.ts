/**
 * Migration safety guard — a destructive-to-deployed-code migration MUST carry a
 * deploy-coordination note in its SQL, so the "build first, then migrate + promote" rule is
 * visible at review time and can't be applied silently.
 *
 * WHY (bitten twice): a RENAME/DROP migration applied against the shared prod DB ahead of the
 * matching deploy breaks deployed code instantly. `safe-migrate.ts` blocks the apply in the
 * blessed path; this guard is the REVIEW-TIME net — a destructive migration lacking a
 * DEPLOY NOTE / BACK-TO-BACK acknowledgment turns verify-all red before it merges.
 *
 * Static (no DB). Positive control: a fabricated destructive SQL WITHOUT a note is caught by
 * the same detector — so a green result is non-vacuous.
 *
 * Run:  npx tsx scripts/migration-safety-guard.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')
// The rule became active with the first shared-prod-DB rename (deliveryProofPath). Migrations
// before this predate the rule and are not retro-flagged; everything from here is enforced.
const RULE_ACTIVE_FROM = '20260717000000'

const DESTRUCTIVE = [
  /ALTER\s+TABLE\s+[^;]*RENAME\s+COLUMN/i,
  /ALTER\s+TABLE\s+[^;]*RENAME\s+TO/i,
  /ALTER\s+TABLE\s+[^;]*DROP\s+COLUMN/i,
  /DROP\s+TABLE/i,
]
// Any of these phrases counts as the deploy-coordination acknowledgment.
const NOTE = /DEPLOY NOTE|BACK[ -]TO[ -]BACK|deploy.*back to back|CONFIRM_DEPLOY_ORDERING/i

const isDestructive = (sql: string) => DESTRUCTIVE.some(re => re.test(sql))

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

function main() {
  console.log('[0] positive control — the detector actually fires on a destructive statement')
  const fakeBad = `ALTER TABLE "Order" RENAME COLUMN "a" TO "b";`
  assert(isDestructive(fakeBad), 'detector flags a RENAME COLUMN (probe works)')
  assert(!NOTE.test(fakeBad), 'a bare destructive statement has NO deploy note (so the note check is meaningful)')
  assert(!isDestructive(`ALTER TABLE "Order" ADD COLUMN "c" TEXT;`), 'ADD COLUMN is NOT flagged (safe migrations pass freely)')

  console.log('\n[1] every destructive migration since the rule became active carries a deploy note')
  const folders = readdirSync(MIGRATIONS_DIR)
    .filter(f => existsSync(join(MIGRATIONS_DIR, f, 'migration.sql')) && f >= RULE_ACTIVE_FROM)
    .sort()
  let destructiveCount = 0
  for (const f of folders) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f, 'migration.sql'), 'utf8')
    if (!isDestructive(sql)) continue
    destructiveCount++
    assert(NOTE.test(sql), `${f}: destructive migration carries a DEPLOY NOTE / back-to-back note`)
  }
  console.log(`  (destructive migrations checked: ${destructiveCount})`)

  console.log('\n[2] the blessed migrate path is wired to safe-migrate (not raw prisma)')
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  assert(/safe-migrate/.test(pkg.scripts?.migrate ?? ''), 'package.json "migrate" → scripts/safe-migrate.ts')

  console.log(`\n${'─'.repeat(52)}`)
  console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
