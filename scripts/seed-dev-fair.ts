// Seed the LOCAL dev database with the Dev Test Fair (see scripts/_dev-fair-seed.ts for what it
// creates and the re-run rule).
//
//   ./scripts/with-dev-db.sh npx tsx scripts/seed-dev-fair.ts
//   ./scripts/with-dev-db.sh npx tsx scripts/seed-dev-fair.ts --vendor-email <email> --organizer-email <email>
//
// SAFETY, before any connection:
//   • assertNotProductionDatabase (lib/prod-db-guard.ts), like every script that builds a client;
//   • and stricter than that guard: DATABASE_URL and DIRECT_URL must both be a local host — this
//     seed is for the Docker dev database only, never any remote one;
//   • TEST_DATABASE_URL must be unset, or lib/db (used by the role sync) would quietly switch to
//     the test database while this client writes to the dev one;
//   • with --vendor-email, assertNotProductionClerk before the role sync calls Clerk.
//
// with-dev-db.sh sets DATABASE_URL and DIRECT_URL to localhost:54329 and clears
// TEST_DATABASE_URL. .env.local is read for CLERK_SECRET_KEY only; dotenv never overrides a
// variable the wrapper already set.

import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { assertNotProductionDatabase, isLocalHost } from '../lib/prod-db-guard'
import { assertNotProductionClerk } from '../lib/prod-clerk-guard'

config({ path: '.env.local' })

const USAGE =
  'usage: ./scripts/with-dev-db.sh npx tsx scripts/seed-dev-fair.ts ' +
  '[--vendor-email <email>] [--organizer-email <email>]'

function parseArgs(argv: string[]): { vendorEmail?: string; organizerEmail?: string } {
  const out: { vendorEmail?: string; organizerEmail?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (flag !== '--vendor-email' && flag !== '--organizer-email') {
      throw new Error(`unknown argument "${flag}"\n${USAGE}`)
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--') || !value.includes('@')) {
      throw new Error(`${flag} needs an email address\n${USAGE}`)
    }
    if (flag === '--vendor-email') out.vendorEmail = value
    else out.organizerEmail = value
    i++
  }
  return out
}

function refuseUnlessLocalDevDatabase(): void {
  assertNotProductionDatabase('seed-dev-fair.ts')
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    if (!isLocalHost(process.env[name])) {
      throw new Error(
        `🛑 REFUSING: ${name} is not a local database. This seed is for the Docker dev database ` +
        `only; run it through ./scripts/with-dev-db.sh.`,
      )
    }
  }
  if (process.env.TEST_DATABASE_URL) {
    throw new Error(
      '🛑 REFUSING: TEST_DATABASE_URL is set, so lib/db would use the test database while this ' +
      'seed writes to the dev one. Run it through ./scripts/with-dev-db.sh, which clears it.',
    )
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  refuseUnlessLocalDevDatabase()
  if (args.vendorEmail) assertNotProductionClerk('seed-dev-fair.ts')

  // Loaded only after the checks and .env.local, because it pulls in lib/db and the role sync.
  const { seedDevFair, DevSeedRefused, DEV_FAIR_SLUG } = await import('./_dev-fair-seed')

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
  try {
    const r = await seedDevFair(prisma, args)
    const day = (d: Date) => d.toISOString().slice(0, 10)
    console.log(`✅ Dev Test Fair (/fair/${DEV_FAIR_SLUG}): ACTIVE, open ${day(r.startDate)} to ${day(r.endDate)}`)
    for (const name of r.createdVendors) console.log(`   + created ${name} (ACTIVE, demo, 3 items)`)
    for (const v of r.keptVendors) console.log(`   = kept ${v.name} as it is (${v.status}, ${v.sellableItems} sellable items)`)
    for (const name of r.demoMarked) console.log(`   ~ marked ${name} as demo (that column only)`)
    if (r.vendorLink) {
      const what = r.vendorLink.outcome === 'created' ? 'now owner of' : 'was already a member of'
      console.log(`   vendor: ${r.vendorLink.email} ${what} ${r.vendorLink.vendorName} (${r.vendorLink.approvalStatus})`)
    }
    if (r.organizerLink) {
      console.log(`   organizer: the fair now belongs to ${r.organizerLink.email}'s organizer account (${r.organizerLink.approvalStatus})`)
      if (r.organizerLink.approvalStatus !== 'APPROVED') {
        console.log('   → approve it as the admin user at http://localhost:3000/admin/approvals')
      }
    }
    console.log('   Restart npm run dev (or wait 5 minutes) if the fair page was already open: fair data is cached.')
    return 0
  } catch (err) {
    if (err instanceof DevSeedRefused) {
      console.error(`🛑 ${err.message}`)
      return 1
    }
    throw err
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('❌ seed-dev-fair failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
