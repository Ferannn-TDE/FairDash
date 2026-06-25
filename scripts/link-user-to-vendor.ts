/**
 * One-off: link a user (by email) to a vendor via a VendorMember row, so that
 * logging in with that account routes into that vendor's portal.
 *
 * Why this works: the vendor portal resolves the active vendor via
 * /api/vendors/me → vendorMember.findFirst({ where:{userId}, orderBy:{createdAt:'desc'} }).
 * The portal is gated only by sign-in + this membership (no Clerk role / no
 * middleware role-gate), so a DB membership is all that's needed.
 *
 * Idempotent: re-running does NOT create duplicates (unique on vendorId+userId).
 * Does NOT detach the user from any other vendor.
 *
 * Usage:
 *   npx tsx scripts/link-user-to-vendor.ts
 *   npx tsx scripts/link-user-to-vendor.ts <email> <vendorId> [role]
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { syncUserRoleMetadata } from '../lib/role-sync'

const db = new PrismaClient()

// Explicit targets (override via argv). Confirmed values, not guesses:
const EMAIL = process.argv[2] ?? 'feranodedairo@gmail.com'
const VENDOR_ID = process.argv[3] ?? 'cmni6x68q000211znxtpw0076' // ALL PRO TEES
const ROLE = process.argv[4] ?? 'owner' // owner → can run Stripe Connect onboarding

async function main() {
  const user = await db.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, clerkId: true, email: true },
  })
  if (!user) throw new Error(`No User row for ${EMAIL} — sign in once with that Clerk account first.`)

  const vendor = await db.vendor.findUnique({
    where: { id: VENDOR_ID },
    select: { id: true, name: true, event: { select: { urlSlug: true } } },
  })
  if (!vendor) throw new Error(`No Vendor with id ${VENDOR_ID}`)

  // ── BEFORE ────────────────────────────────────────────────────────────────
  const before = await db.vendorMember.findMany({
    where: { userId: user.id },
    select: { vendorId: true, role: true, createdAt: true, vendor: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`\nUser:   ${user.email}  (clerkId=${user.clerkId})`)
  console.log(`Vendor: ${vendor.name}  [${vendor.event?.urlSlug}]  id=${vendor.id}`)
  console.log('\nBEFORE — memberships:')
  if (before.length === 0) console.log('  (none)')
  for (const m of before) console.log(`  - ${m.vendor.name} role=${m.role} created=${m.createdAt.toISOString()}`)

  // ── LINK (idempotent) ───────────────────────────────────────────────────────
  const existing = await db.vendorMember.findFirst({
    where: { userId: user.id, vendorId: vendor.id },
  })
  if (existing) {
    console.log(`\nAlready linked (role=${existing.role}) — no change made.`)
  } else {
    await db.vendorMember.create({
      data: { userId: user.id, vendorId: vendor.id, role: ROLE },
    })
    console.log(`\nLinked: ${user.email} → ${vendor.name} as ${ROLE}.`)
    // New VendorMember row → keep Clerk role metadata in sync with the DB.
    const synced = await syncUserRoleMetadata(user.id)
    console.log(`Synced roles → [${synced?.roles.join(', ') ?? '(no clerk id)'}]`)
  }

  // ── AFTER ─────────────────────────────────────────────────────────────────
  const after = await db.vendorMember.findMany({
    where: { userId: user.id },
    select: { role: true, createdAt: true, vendor: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  console.log('\nAFTER — memberships (newest first = portal lands here):')
  for (const m of after) console.log(`  - ${m.vendor.name} role=${m.role} created=${m.createdAt.toISOString()}`)
  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
