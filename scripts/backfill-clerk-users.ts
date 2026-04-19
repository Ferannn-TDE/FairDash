/**
 * One-time script: sync all existing Clerk users into the DB.
 * Run with: npx tsx scripts/backfill-clerk-users.ts
 */
import { clerkClient } from '@clerk/nextjs/server'
import { db } from '../lib/db'

const VALID_ROLES = ['customer', 'vendor', 'organizer', 'runner'] as const
type AppRole = (typeof VALID_ROLES)[number]

async function main() {
  const client = await clerkClient()
  let offset = 0
  const limit = 100
  let totalSynced = 0
  let totalSkipped = 0

  console.log('Starting Clerk → DB backfill...')

  while (true) {
    const { data: users, totalCount } = await client.users.getUserList({ limit, offset })

    if (users.length === 0) break

    for (const clerkUser of users) {
      const primaryEmail = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId
      )?.emailAddress

      if (!primaryEmail) {
        console.warn(`  skip ${clerkUser.id} — no primary email`)
        totalSkipped++
        continue
      }

      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null
      const phone = clerkUser.phoneNumbers?.[0]?.phoneNumber ?? null
      const avatarUrl = clerkUser.imageUrl ?? null
      const isActive = !clerkUser.banned

      const rawRole = clerkUser.publicMetadata?.role as string | undefined
      const role: AppRole = (VALID_ROLES as readonly string[]).includes(rawRole ?? '')
        ? (rawRole as AppRole)
        : 'customer'

      const user = await db.user.upsert({
        where: { clerkId: clerkUser.id },
        create: { clerkId: clerkUser.id, email: primaryEmail, name, phone, avatarUrl, isActive, role },
        update: { email: primaryEmail, name, phone, avatarUrl, isActive, role },
      })

      // Bootstrap organizer org if one doesn't exist yet
      if (role === 'organizer') {
        const existing = await db.orgMember.findFirst({ where: { userId: user.id } })
        if (!existing) {
          const org = await db.fairOrganizer.create({
            data: {
              name: name ?? primaryEmail,
              contactEmail: primaryEmail,
              ...(phone ? { contactPhone: phone } : {}),
            },
          })
          await db.orgMember.create({
            data: { organizerId: org.id, userId: user.id, role: 'owner' },
          })
          console.log(`  created FairOrganizer for ${primaryEmail}`)
        }
      }

      totalSynced++
    }

    console.log(`  synced ${offset + users.length} / ${totalCount}`)
    offset += limit

    if (offset >= totalCount) break
  }

  console.log(`\nDone. Synced: ${totalSynced}, Skipped: ${totalSkipped}`)
}

main().catch(console.error).finally(() => db.$disconnect())
