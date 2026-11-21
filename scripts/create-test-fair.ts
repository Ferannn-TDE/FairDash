/**
 * Create (or archive) the hidden B1.17 test fair. Dry run unless --confirm. Logic + refusals: lib/test-fair.ts.
 *
 *   Create:   ... create-test-fair.ts --organizer-email <email> --start YYYY-MM-DD --end YYYY-MM-DD
 *               [--name "FairSynq Test Fair"] [--slug fairsynq-test-fair] [--curbside] [--confirm]
 *   Archive:  ... create-test-fair.ts --archive --slug <slug> [--confirm]
 *
 *   Local dev:   ./scripts/with-dev-db.sh npx tsx scripts/create-test-fair.ts ...
 *   Production:  ONLY with Feran's go for that run:
 *                CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/create-test-fair.ts ...     (dry run)
 *                ALLOW_PROD_WRITES=true CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/create-test-fair.ts ... --confirm
 *
 * Dates are Central (America/Chicago), whole days, always given (no clock reads). Prints the target database host
 * before doing anything. Against production, --confirm refuses unless ALLOW_PROD_WRITES=true.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '../lib/db'
import {
  TEST_FAIR_DEFAULTS, TestFairRefused, planTestFair, createTestFair, planArchiveTestFair, archiveTestFair,
} from '../lib/test-fair'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const DATE = /^\d{4}-\d{2}-\d{2}$/

async function main() {
  const host = (process.env.DATABASE_URL ?? '').replace(/^[^@]*@/, '').replace(/\/.*$/, '')
  console.log(`Target database: ${host || '(unset)'}`)
  const confirm = flag('confirm')
  if (confirm && process.env.CONFIRM_PROD_DB && process.env.ALLOW_PROD_WRITES !== 'true') {
    throw new Error('Refusing: --confirm against production needs ALLOW_PROD_WRITES=true (and Feran\'s go for this run)')
  }

  if (flag('archive')) {
    const slug = arg('slug')
    if (!slug) throw new Error('Usage: create-test-fair.ts --archive --slug <slug> [--confirm]')
    const plan = await planArchiveTestFair(db, slug)
    console.log(`Archive: "${plan.event.name}" /${slug} (UNLISTED). Kept: ${plan.kept.orders} orders, ${plan.kept.payouts} payouts, ${plan.kept.refunds} refunds`)
    if (!confirm) { console.log('\nDry run: nothing written. Re-run with --confirm to archive it.'); return }
    const done = await archiveTestFair(db, slug)
    console.log(`\nArchived rows: ${done.archived} (expected 1)`)
    if (done.archived !== 1) process.exitCode = 1
    return
  }

  const organizerEmail = arg('organizer-email'), start = arg('start'), end = arg('end')
  if (!organizerEmail || !start || !end || !DATE.test(start) || !DATE.test(end)) {
    throw new Error('Usage: create-test-fair.ts --organizer-email <email> --start YYYY-MM-DD --end YYYY-MM-DD [--name] [--slug] [--curbside] [--confirm]')
  }
  const input = {
    organizerEmail,
    name: arg('name') ?? TEST_FAIR_DEFAULTS.name,
    slug: arg('slug') ?? TEST_FAIR_DEFAULTS.slug,
    startDate: new Date(`${start}T00:00:00-06:00`),
    endDate: new Date(`${end}T23:59:59-06:00`),
    curbside: flag('curbside'),
  }
  const plan = await planTestFair(db, input)
  console.log(`Organizer: ${plan.organizer.name} (${plan.organizer.approvalStatus})`)
  console.log(`Event: "${input.name}" /${input.slug}, ACTIVE, UNLISTED, ${input.startDate.toISOString()} → ${input.endDate.toISOString()}, booth pickup on, curbside ${input.curbside ? 'ON' : 'off'}, delivery off, no venue`)
  if (!confirm) { console.log('\nDry run: nothing written. Re-run with --confirm to create it.'); return }
  const created = await createTestFair(db, input)
  console.log(`\nCreated ${created.urlSlug} (${created.id}) — ${created.status}, ${created.listing}, curbside ${created.fulfillmentConfig?.curbsideEnabled ? 'on' : 'off'}`)
}

main()
  .catch(e => { console.error(e instanceof TestFairRefused ? `Refused (${e.code}): ${e.message}` : e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
