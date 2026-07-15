import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'

/**
 * Seed DEMO organizers in all four gate states — so the #7 work can be eyeballed end to end:
 *   • the ADMIN panel (/admin/organizers) shows pending / approved / rejected / suspended at
 *     once, instead of testing one state and inferring the rest;
 *   • each organizer's OWN gate screen (awaiting / declined-with-reason / suspended) can be
 *     seen by signing in as them (with --with-logins).
 *
 * SAFE BY CONSTRUCTION:
 *   • Idempotent — every run WIPES the demo rows (contactEmail @fairsynq.demo) and recreates
 *     them, so re-running never duplicates and always lands in a known state.
 *   • Clearly labelled — every org name is prefixed "DEMO ·", so it can never be mistaken for
 *     a real organizer in the panel.
 *   • Wipeable — `--wipe` removes everything this script creates and exits.
 *   • --with-logins refuses to run against a LIVE Clerk instance (sk_live_…), same guard as
 *     seed-test-admin — a demo credential must never exist in production.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-organizers.ts                 # DB rows only (admin-panel eyeball)
 *   npx tsx scripts/seed-demo-organizers.ts --with-logins   # + Clerk logins (organizer-side eyeball)
 *   npx tsx scripts/seed-demo-organizers.ts --with-logins --password 'Demo!pass1'
 *   npx tsx scripts/seed-demo-organizers.ts --wipe          # remove all demo organizers
 */

const args = process.argv.slice(2)
const WITH_LOGINS = args.includes('--with-logins')
const WIPE = args.includes('--wipe')
const pwFlag = args.indexOf('--password')
const cliPassword = pwFlag !== -1 ? args[pwFlag + 1] : undefined

const DEMO_MAIL = '@fairsynq.demo' // the marker: every demo row's email ends with this
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const now = new Date()
const ORGS = [
  {
    key: 'pending', name: 'DEMO · Pending Fairs Co',
    data: { approvalStatus: 'PENDING' as const },
  },
  {
    key: 'approved', name: 'DEMO · Approved Events Ltd',
    data: {
      approvalStatus: 'APPROVED' as const, approvedAt: now, approvedBy: 'demo-seed',
      stripeAccountId: 'acct_demo', stripeVerified: true, stripeConnectedAt: now,
    },
    fair: true, // an approved org owns a fair — so the panel renders "their fairs"
  },
  {
    key: 'rejected', name: 'DEMO · Rejected Org',
    data: {
      approvalStatus: 'REJECTED' as const,
      rejectionReason: 'Incomplete tax documentation — resubmit your W-9 and proof of insurance.',
    },
  },
  {
    key: 'suspended', name: 'DEMO · Suspended Org',
    data: {
      approvalStatus: 'APPROVED' as const, approvedAt: now, approvedBy: 'demo-seed',
      suspendedAt: now, suspendedReason: 'Chargeback rate exceeded threshold — access paused pending review.',
    },
  },
]

async function wipe() {
  await prisma.event.deleteMany({ where: { organizer: { contactEmail: { endsWith: DEMO_MAIL } } } })
  await prisma.orgMember.deleteMany({ where: { organizer: { contactEmail: { endsWith: DEMO_MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: DEMO_MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_MAIL } } })
}

async function main() {
  await wipe()
  if (WIPE) {
    console.log('🧹 Wiped all DEMO organizers (rows ending @fairsynq.demo). DB clean.')
    return
  }

  // Optional: Clerk logins so you can sign in AS each demo organizer and see its gate screen.
  let clerk: ReturnType<typeof createClerkClient> | null = null
  let password = ''
  let generated = false
  if (WITH_LOGINS) {
    const secret = process.env.CLERK_SECRET_KEY
    if (!secret) throw new Error('CLERK_SECRET_KEY is not set — cannot create demo logins')
    if (secret.startsWith('sk_live')) {
      throw new Error('REFUSING to create demo logins against a LIVE Clerk instance (sk_live_…). Dev/test only.')
    }
    generated = !cliPassword && !process.env.DEMO_PASSWORD
    password = cliPassword ?? process.env.DEMO_PASSWORD ?? `Demo!${randomBytes(9).toString('base64url')}`
    clerk = createClerkClient({ secretKey: secret })
  }

  const summary: { name: string; state: string; email: string }[] = []

  for (const o of ORGS) {
    const email = `demo-${o.key}${DEMO_MAIL}`

    // Clerk user (only with --with-logins); otherwise a stable synthetic id.
    let clerkId = `demo-clerk-${o.key}`
    if (clerk) {
      let cu = (await clerk.users.getUserList({ emailAddress: [email] })).data[0]
      if (!cu) {
        cu = await clerk.users.createUser({
          emailAddress: [email], password,
          publicMetadata: { roles: ['organizer'] },
          skipPasswordChecks: true,
        })
      } else {
        await clerk.users.updateUserMetadata(cu.id, { publicMetadata: { roles: ['organizer'] } })
      }
      clerkId = cu.id
    }

    const user = await prisma.user.create({
      data: { clerkId, email, name: `${o.name} owner`, role: 'organizer' },
    })
    const org = await prisma.fairOrganizer.create({
      data: { name: o.name, contactEmail: `org-${o.key}${DEMO_MAIL}`, ...o.data },
    })
    await prisma.orgMember.create({ data: { userId: user.id, organizerId: org.id, role: 'owner' } })

    if ((o as any).fair) {
      await prisma.event.create({
        data: {
          name: 'DEMO · Springfield Summer Fair',
          urlSlug: `demo-fair-${randomBytes(3).toString('hex')}`,
          startDate: now, endDate: new Date(now.getTime() + 3 * 864e5),
          organizerId: org.id,
        },
      })
    }

    const state = o.data.suspendedAt ? 'SUSPENDED'
      : o.data.approvalStatus === 'APPROVED' ? 'APPROVED (active)'
      : o.data.approvalStatus
    summary.push({ name: o.name, state, email })
  }

  console.log('\n────────────────────────────────────────────────────────')
  console.log('✅ DEMO ORGANIZERS SEEDED — 4 states')
  for (const s of summary) console.log(`   ${s.state.padEnd(18)} ${s.name}`)
  console.log('\n  Admin-panel eyeball:  /admin/organizers  → all four states in one screen.')
  if (WITH_LOGINS) {
    console.log('\n  Organizer-side eyeball: sign in at /organizer/login as any of —')
    for (const s of summary) console.log(`     ${s.email}`)
    if (generated) console.log(`   password (all): ${password}   ← generated, shown ONCE — save it now`)
    else           console.log('   password (all): (the one you supplied)')
    console.log('   pending → awaiting screen · rejected → declined-with-reason · suspended → suspended notice · approved → the portal')
  } else {
    console.log('\n  (Add --with-logins to create sign-in-able Clerk users for the organizer-side eyeball.)')
  }
  console.log('\n  Clean up when done:  npx tsx scripts/seed-demo-organizers.ts --wipe')
  console.log('⚠️  DEV ONLY — demo data, clearly labelled "DEMO ·". Never seed against production.')
  console.log('────────────────────────────────────────────────────────')
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (e) => { console.error('\n💥', e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1) })
