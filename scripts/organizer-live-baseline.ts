import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '../lib/db'

// READ-ONLY baseline snapshot for the organizer live-signup test. Run BEFORE the
// manual signup to capture the current state, then again AFTER to confirm exactly
// one new FairOrganizer + owner OrgMember appeared at the org_<userId> anchor.
async function main() {
  const [organizers, orgMembers, orgUsers] = await Promise.all([
    db.fairOrganizer.findMany({ select: { id: true, name: true, contactEmail: true, createdAt: true } }),
    db.orgMember.findMany({ select: { id: true, organizerId: true, userId: true, role: true } }),
    db.user.findMany({ where: { role: 'organizer' }, select: { id: true, email: true, clerkId: true } }),
  ])

  console.log('=== ORGANIZER LIVE-TEST BASELINE @', new Date().toISOString(), '===')
  console.log(`FairOrganizer rows: ${organizers.length}`)
  for (const o of organizers) {
    const anchored = o.id.startsWith('org_user_') || o.id.startsWith('org_')
    console.log(`  ${o.id}  "${o.name}"  ${o.contactEmail}  ${o.createdAt.toISOString()}  ${anchored ? '(deterministic-anchor)' : '(cuid/legacy)'}`)
  }
  console.log(`OrgMember rows: ${orgMembers.length}`)
  for (const m of orgMembers) {
    console.log(`  member=${m.id}  org=${m.organizerId}  user=${m.userId}  role=${m.role}`)
  }
  console.log(`User.role='organizer' rows: ${orgUsers.length}`)
  for (const u of orgUsers) console.log(`  user=${u.id}  ${u.email}  clerk=${u.clerkId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
