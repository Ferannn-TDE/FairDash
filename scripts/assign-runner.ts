import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { guardedPrisma } from '../lib/prod-write-guard'
const db = guardedPrisma()
import { syncUserRoleMetadata } from '../lib/role-sync'

// Assign a user as a Runner for an event. There is no production runner-creation
// endpoint yet (app/api/drivers only acknowledges applications; "Runner records
// are created by admin"). This admin path models the REQUIRED pattern any future
// runner-registration flow must follow: create the Runner row, then sync metadata
// — exactly as the vendor application path does (create VendorMember → sync).
// Idempotent.
//   npx tsx scripts/assign-runner.ts [email] [eventSlug]

const EMAIL = process.argv[2] ?? 'feranmidyro@gmail.com'
const SLUG = process.argv[3] ?? 'springfield-state-fair-2026'

async function main() {
  const user = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true, email: true } })
  if (!user) throw new Error(`No DB user for ${EMAIL}`)
  const event = await db.event.findUnique({ where: { urlSlug: SLUG }, select: { id: true, name: true } })
  if (!event) throw new Error(`No event for slug ${SLUG}`)

  const existing = await db.runner.findUnique({ where: { userId: user.id }, select: { id: true, eventId: true } })
  if (existing) {
    console.log(`Runner row already exists for ${user.email} (eventId=${existing.eventId}) — no insert.`)
  } else {
    await db.runner.create({ data: { userId: user.id, eventId: event.id, status: 'OFFLINE' } })
    console.log(`Created Runner: ${user.email} → ${event.name} (status=OFFLINE).`)
  }

  // The sync that a real registration path MUST also run after creating the row.
  const synced = await syncUserRoleMetadata(user.id)
  console.log(`Synced roles → [${synced?.roles.join(', ') ?? '(no clerk id)'}]`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
