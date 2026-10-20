/**
 * Sets up the LOCAL dev stack for the readiness-1.4 return-from-Stripe walkthrough: one account
 * that is an organizer, a vendor and a runner, each with NO Stripe account, so every payout card
 * starts at "Set up payouts". Refuses any non-local database and the production Clerk instance.
 *
 *   - User row bound to the given Clerk id via ensureDbUser (re-points an older row by email).
 *   - Organizer: the user's FairOrganizer (bootstrapped if missing), approved, Stripe cleared.
 *   - A local fair "Connect Walkthrough" with a vendor the user owns (approved operator) and a
 *     Runner for the user (approved), both with Stripe cleared.
 *   - roles[] synced from the rows (writes the LOCAL Clerk app only).
 *
 * Run:   npx tsx scripts/seed-connect-walkthrough.ts <email> --clerk-id=user_…
 * Reset: npx tsx scripts/seed-connect-walkthrough.ts <email> --clerk-id=user_… --reset
 *        (clears the three Stripe accounts again so the walkthrough can be re-recorded)
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { isLocalHost, assertNotProductionDatabase } from '../lib/prod-db-guard'
import { assertNotProductionClerk } from '../lib/prod-clerk-guard'

const SLUG = 'connect-walkthrough'
const CLEARED = { stripeAccountId: null, stripeVerified: false, stripeConnectedAt: null }

async function main() {
  if (!isLocalHost(process.env.DATABASE_URL)) throw new Error('refusing: DATABASE_URL is not a local database')
  assertNotProductionDatabase('seed-connect-walkthrough.ts')
  assertNotProductionClerk('seed-connect-walkthrough.ts')
  const email = process.argv[2]
  const clerkId = process.argv.find(a => a.startsWith('--clerk-id='))?.slice('--clerk-id='.length)
  if (!email || !clerkId) throw new Error('usage: seed-connect-walkthrough.ts <email> --clerk-id=user_… [--reset]')

  const { db } = await import('../lib/db')
  const { ensureDbUser } = await import('../lib/ensure-db-user')
  const { ensureOrganizerBootstrap } = await import('../lib/organizer-bootstrap')
  const { syncUserRoleMetadata } = await import('../lib/role-sync')
  const { createVendorWithOwner, createRunnerRecord } = await import('../lib/payee-membership')
  try {
    const { user, outcome } = await ensureDbUser(clerkId, { email })
    console.log(`user ${user.id} (${outcome})`)

    await ensureOrganizerBootstrap(user.id, { name: user.name, email, phone: user.phone })
    const om = await db.orgMember.findFirst({ where: { userId: user.id, role: 'owner' }, select: { organizerId: true } })
    if (!om) throw new Error('organizer bootstrap produced no owner membership')
    await db.fairOrganizer.update({ where: { id: om.organizerId }, data: { ...CLEARED, approvalStatus: 'APPROVED', approvedAt: new Date() } })

    const now = Date.now()
    const event = await db.event.upsert({
      where: { urlSlug: SLUG },
      update: { status: 'ACTIVE', organizerId: om.organizerId },
      create: {
        name: 'Connect Walkthrough', urlSlug: SLUG, status: 'ACTIVE', organizerId: om.organizerId,
        startDate: new Date(now - 86_400_000), endDate: new Date(now + 7 * 86_400_000),
      },
    })

    let vendor = await db.vendor.findFirst({ where: { eventId: event.id, slug: `${SLUG}-booth` } })
    if (!vendor) {
      vendor = await createVendorWithOwner(
        { eventId: event.id, name: 'Walkthrough Booth', slug: `${SLUG}-booth`, cuisineType: 'Demo', status: 'ACTIVE' },
        { userId: user.id, approvalStatus: 'APPROVED', approvedAt: new Date() },
      )
    }
    await db.vendor.update({ where: { id: vendor.id }, data: CLEARED })

    const runner = await db.runner.findUnique({ where: { userId: user.id } })
    if (runner && runner.eventId !== event.id) throw new Error(`user already has a runner on another fair (${runner.eventId}); not moving it`)
    if (!runner) {
      await createRunnerRecord({ userId: user.id, eventId: event.id, approvalStatus: 'APPROVED', approvedAt: new Date(), status: 'OFFLINE' })
    }
    await db.runner.update({ where: { userId: user.id }, data: CLEARED })

    const synced = await syncUserRoleMetadata(user.id)
    console.log(`roles[] = ${JSON.stringify(synced?.roles)}`)
    console.log('\nPayout cards, each at "Set up payouts":')
    console.log(`  organizer  http://localhost:3000/organizer/settings`)
    console.log(`  vendor     http://localhost:3000/vendor/${SLUG}/settings`)
    console.log(`  runner     http://localhost:3000/runner/${SLUG}/settings`)
  } finally {
    await db.$disconnect()
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
