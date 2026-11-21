// DEV FAIR SEED — the data for clicking through a LOCAL dev server (DEPLOYMENT.md, "Local
// Development"): one live fair, three ACTIVE vendors, nine items priced $1.00–$20.00.
//
// This module never builds a database client; the caller passes one. scripts/seed-dev-fair.ts
// passes the guarded dev-DB client, scripts/seed-dev-fair-test.ts the test-DB client
// (scripts/test-isolation-guard.ts forbids a gate suite from building one from DATABASE_URL).
//
// RE-RUN RULE: a re-run moves the fair's dates so it is open today and creates any of the three
// vendors that is missing (with its items). It never changes an existing vendor or menu item,
// EXCEPT marking the three seed vendors as demo (Vendor.isDemo, that column only; Jordan, Nov 16),
// because those writes have their own rules in the app: a vendor's move into ACTIVE runs the
// go-live check (lib/vendor-go-live.ts) and every price change writes an audit row in the same
// transaction (lib/menu/price-audit.ts). To get back to the seeded state, wipe the dev database
// (npm run dev:db:reset) and seed again.
//
// DEMO VENDORS (Jordan, Nov 16; lib/demo-vendor.ts): every seed vendor is a demo booth, so the
// local site (Stripe TEST keys) shows them and takes test orders, while a live site would hide
// them and refuse them at checkout.
//
// NO STRIPE DATA: checkout does not use a vendor's Stripe account (the charge is on the platform
// account with a transfer_group only), and every Stripe-status check sits behind
// ENFORCE_VENDOR_READINESS, which is off locally. stripeAccountId stays empty and stripeVerified
// false. Checked 2026-11-16.
//
// MEMBERSHIP: the vendor link goes through lib/payee-membership.ts (scripts/role-reconcile-test.ts
// forbids creating VendorMember rows anywhere else), which also adds "vendor" to the person's
// Clerk roles.

import { ApprovalStatus, EventListing, EventStatus, VendorStatus, type PrismaClient } from '@prisma/client'
import { addVendorMember } from '../lib/payee-membership'

export const DEV_FAIR_SLUG = 'dev-test-fair'
export const DEV_FAIR_NAME = 'Dev Test Fair'
/** The vendor that --vendor-email makes the owner of. */
export const DEV_LINKED_VENDOR_SLUG = 'dev-grill'

const DAY_MS = 24 * 60 * 60 * 1000

export interface DevItem { name: string; description: string; price: number; category: string; prepTime: number }
export interface DevVendor { slug: string; name: string; cuisineType: string; description: string; boothNumber: string; items: DevItem[] }

/** In-person prices in dollars; customers see these plus the fair's markup (0% unless changed). */
export const DEV_VENDORS: readonly DevVendor[] = [
  {
    slug: 'dev-grill', name: 'Dev Grill', cuisineType: 'Grill', boothNumber: 'A1',
    description: 'Burgers, fries and cold drinks.',
    items: [
      { name: 'Burger', description: 'Quarter-pound burger with cheese.', price: 9.0, category: 'Mains', prepTime: 10 },
      { name: 'Fries', description: 'A basket of crispy fries.', price: 4.5, category: 'Sides', prepTime: 6 },
      { name: 'Soda', description: 'A canned soft drink.', price: 2.0, category: 'Drinks', prepTime: 1 },
    ],
  },
  {
    slug: 'dev-sweets', name: 'Dev Sweets', cuisineType: 'Desserts', boothNumber: 'A2',
    description: 'Funnel cakes, lemonade and cookies.',
    items: [
      { name: 'Funnel Cake', description: 'With powdered sugar.', price: 7.0, category: 'Desserts', prepTime: 8 },
      { name: 'Lemonade', description: 'Fresh-squeezed lemonade.', price: 3.5, category: 'Drinks', prepTime: 2 },
      { name: 'Cookie', description: 'One chocolate chip cookie.', price: 1.0, category: 'Desserts', prepTime: 1 },
    ],
  },
  {
    slug: 'dev-tacos', name: 'Dev Tacos', cuisineType: 'Mexican', boothNumber: 'A3',
    description: 'Tacos, nachos and a party platter.',
    items: [
      { name: 'Taco Plate', description: 'Three tacos with rice and beans.', price: 12.0, category: 'Mains', prepTime: 12 },
      { name: 'Nachos', description: 'Chips with cheese, salsa and jalapeños.', price: 8.25, category: 'Sides', prepTime: 7 },
      { name: 'Party Platter', description: 'Tacos and nachos for four.', price: 20.0, category: 'Mains', prepTime: 15 },
    ],
  },
]

/** Raised when the seed refuses before writing anything (e.g. an email with no account). */
export class DevSeedRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DevSeedRefused'
  }
}

export interface SeedDevFairOptions {
  /** Make this person the APPROVED owner of Dev Grill. They must have signed in once. */
  vendorEmail?: string
  /** Give the fair to the organizer account this person owns. They must have signed up at /organizer/login. */
  organizerEmail?: string
  /** Clock for the fair's dates; tests pass a fixed one. */
  now?: Date
}

export interface SeedDevFairResult {
  eventId: string
  startDate: Date
  endDate: Date
  createdVendors: string[]
  keptVendors: { name: string; status: VendorStatus; sellableItems: number }[]
  /** Kept vendors this run marked as demo (they were not yet). Created vendors are demo from the start. */
  demoMarked: string[]
  vendorLink: { email: string; vendorName: string; outcome: 'created' | 'already-member'; approvalStatus: ApprovalStatus } | null
  organizerLink: { email: string; organizerId: string; approvalStatus: ApprovalStatus } | null
}

/**
 * The fair's window: yesterday to 30 days from today, as UTC-midnight calendar dates, which is
 * how the app stores fair dates (lib/event-date.ts, EVENT_DATE_ZONE = 'UTC').
 */
export function devFairWindow(now: Date): { startDate: Date; endDate: Date } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { startDate: new Date(today - DAY_MS), endDate: new Date(today + 30 * DAY_MS) }
}

async function findSignedInUser(client: PrismaClient, email: string, flag: string) {
  const user = await client.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } })
  if (!user) {
    throw new DevSeedRefused(
      `${flag}: no FairSynq account for ${email}. Sign in once on the local site ` +
      `(http://localhost:3000) so the app creates the account, then run the seed again.`,
    )
  }
  return user
}

async function findOrganizerOf(client: PrismaClient, email: string) {
  const user = await findSignedInUser(client, email, '--organizer-email')
  const membership = await client.orgMember.findFirst({
    where: { userId: user.id, role: 'owner' },
    select: { organizer: { select: { id: true, approvalStatus: true } } },
  })
  if (!membership) {
    throw new DevSeedRefused(
      `--organizer-email: ${email} has no organizer account. Sign up at ` +
      `http://localhost:3000/organizer/login first, then run the seed again.`,
    )
  }
  return membership.organizer
}

export async function seedDevFair(client: PrismaClient, opts: SeedDevFairOptions = {}): Promise<SeedDevFairResult> {
  const { startDate, endDate } = devFairWindow(opts.now ?? new Date())

  // Look up the people first, so a wrong email refuses before anything is written.
  const vendorUser = opts.vendorEmail ? await findSignedInUser(client, opts.vendorEmail, '--vendor-email') : null
  const organizer = opts.organizerEmail ? await findOrganizerOf(client, opts.organizerEmail) : null

  const fairFields = {
    status: EventStatus.ACTIVE,
    listing: EventListing.PUBLIC,
    startDate,
    endDate,
    ...(organizer ? { organizerId: organizer.id } : {}),
  }
  const event = await client.event.upsert({
    where: { urlSlug: DEV_FAIR_SLUG },
    create: { name: DEV_FAIR_NAME, urlSlug: DEV_FAIR_SLUG, ...fairFields },
    update: fairFields,
    select: { id: true },
  })

  const createdVendors: string[] = []
  const keptVendors: SeedDevFairResult['keptVendors'] = []
  const demoMarked: string[] = []
  for (const v of DEV_VENDORS) {
    const existing = await client.vendor.findFirst({
      where: { eventId: event.id, slug: v.slug },
      select: { id: true, name: true, status: true, isDemo: true, _count: { select: { menuItems: { where: { isAvailable: true, removedAt: null } } } } },
    })
    if (existing) {
      keptVendors.push({ name: existing.name, status: existing.status, sellableItems: existing._count.menuItems })
      // The one change a re-run makes to an existing vendor: the demo mark, that column only.
      if (!existing.isDemo) {
        await client.vendor.update({ where: { id: existing.id }, data: { isDemo: true } })
        demoMarked.push(existing.name)
      }
      continue
    }
    await client.vendor.create({
      data: {
        eventId: event.id,
        name: v.name,
        slug: v.slug,
        cuisineType: v.cuisineType,
        description: v.description,
        boothNumber: v.boothNumber,
        status: VendorStatus.ACTIVE,
        isDemo: true,
        menuItems: {
          create: v.items.map(i => ({
            name: i.name, description: i.description, price: i.price,
            category: i.category, prepTime: i.prepTime, isAvailable: true,
          })),
        },
      },
    })
    createdVendors.push(v.name)
  }

  let vendorLink: SeedDevFairResult['vendorLink'] = null
  if (vendorUser) {
    const grill = await client.vendor.findFirstOrThrow({
      where: { eventId: event.id, slug: DEV_LINKED_VENDOR_SLUG },
      select: { id: true, name: true },
    })
    const member = await client.vendorMember.findUnique({
      where: { vendorId_userId: { vendorId: grill.id, userId: vendorUser.id } },
      select: { approvalStatus: true },
    })
    if (member) {
      vendorLink = { email: vendorUser.email, vendorName: grill.name, outcome: 'already-member', approvalStatus: member.approvalStatus }
    } else {
      const created = await addVendorMember(
        { vendorId: grill.id, userId: vendorUser.id, role: 'owner', approvalStatus: ApprovalStatus.APPROVED },
        { db: client },
      )
      vendorLink = { email: vendorUser.email, vendorName: grill.name, outcome: 'created', approvalStatus: created.approvalStatus }
    }
  }

  const organizerLink = organizer && opts.organizerEmail
    ? { email: opts.organizerEmail, organizerId: organizer.id, approvalStatus: organizer.approvalStatus }
    : null

  return { eventId: event.id, startDate, endDate, createdVendors, keptVendors, demoMarked, vendorLink, organizerLink }
}
