import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { db } from '../lib/db'

const EMAIL = process.argv[2] ?? 'feranmidyro@gmail.com'

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const list = await clerk.users.getUserList({ emailAddress: [EMAIL] })
  const cu = list.data[0]
  console.log('=== CLERK ===')
  if (!cu) {
    console.log('No Clerk user for', EMAIL)
  } else {
    console.log('clerkId:', cu.id)
    console.log('publicMetadata:', JSON.stringify(cu.publicMetadata))
    console.log('unsafeMetadata:', JSON.stringify(cu.unsafeMetadata))
  }

  console.log('\n=== DB ===')
  const clerkId = cu?.id
  const user = clerkId
    ? await db.user.findUnique({ where: { clerkId }, select: { id: true, email: true } })
    : null
  console.log('db.user:', user)
  if (user) {
    const [runner, orgMembers, vendorMembers] = await Promise.all([
      db.runner.findUnique({ where: { userId: user.id }, select: { id: true, event: { select: { urlSlug: true } } } }),
      db.orgMember.findMany({ where: { userId: user.id }, select: { organizerId: true } }),
      db.vendorMember.findMany({ where: { userId: user.id }, select: { vendorId: true, role: true } }),
    ])
    console.log('Runner row:', runner)
    console.log('OrgMember rows:', orgMembers)
    console.log('VendorMember rows:', vendorMembers)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
