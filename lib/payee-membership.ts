import type { Prisma, Runner, Vendor, VendorMember } from '@prisma/client'
import { db } from './db'
import { logger } from './logger'
import { syncUserRoleMetadata } from './role-sync'

// ─── Payee membership rows — the ONE place they are created (readiness 1.9) ───────────
//
// A Runner, VendorMember or OrgMember row is what opens a portal's gate; Clerk roles[] is
// what shows the portal's door. Every create here adds the role straight after the row, so
// the door appears iff the gate would open.
//
// Production had a runner row inserted outside the app (no RunnerApplication, before any
// committed code could create one) and its role was never added — any script, seed or SQL
// insert skips the sync. The cutover seed (PRODUCTION_READINESS 9.3) is exactly such a
// script. So: nothing outside this file creates these rows (scripts/role-reconcile-test.ts
// scans app/, lib/, workers/ and every non-test script), and the worker's role reconcile
// (lib/role-sync reconcileAllRoles) heals anything that slips through anyway.
//
// The role sync is best-effort: the row is the authority, so a Clerk failure is logged and
// left for the reconcile — it never fails the create.

// Any client exposing these four models: the app's db, a script's own PrismaClient, or the
// guarded/extended client from lib/prod-write-guard.
type Db = {
  runner: { create(args: { data: Prisma.RunnerUncheckedCreateInput }): Promise<Runner> }
  vendor: { create(args: { data: Prisma.VendorUncheckedCreateInput }): Promise<Vendor> }
  vendorMember: { create(args: { data: Prisma.VendorMemberUncheckedCreateInput }): Promise<VendorMember> }
  orgMember: { createMany(args: { data: Prisma.OrgMemberCreateManyInput[]; skipDuplicates: boolean }): Promise<{ count: number }> }
}
interface Opts { db?: Db }

async function syncRoles(userId: string, site: string): Promise<void> {
  try {
    await syncUserRoleMetadata(userId)
  } catch (err) {
    logger.error(`[${site}] roles[] sync failed (row is the authority; the role reconcile will add it)`, {
      userId, err: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Create a Runner row, then add the runner role. Throws what Prisma throws (e.g. P2002 on userId). */
export async function createRunnerRecord(data: Prisma.RunnerUncheckedCreateInput, opts: Opts = {}) {
  const runner = await (opts.db ?? db).runner.create({ data })
  await syncRoles(data.userId, 'payee-membership:runner')
  return runner
}

/** Create a Vendor with its owner VendorMember in one write, then add the vendor role. */
export async function createVendorWithOwner(
  vendor: Omit<Prisma.VendorUncheckedCreateInput, 'vendorMembers'>,
  owner: { userId: string } & Omit<Prisma.VendorMemberUncheckedCreateWithoutVendorInput, 'userId' | 'role'>,
  opts: Opts = {},
) {
  const created = await (opts.db ?? db).vendor.create({
    data: { ...vendor, vendorMembers: { create: { ...owner, role: 'owner' } } },
  })
  await syncRoles(owner.userId, 'payee-membership:vendor')
  return created
}

/** Add a person to an existing vendor, then add the vendor role. */
export async function addVendorMember(data: Prisma.VendorMemberUncheckedCreateInput, opts: Opts = {}) {
  const member = await (opts.db ?? db).vendorMember.create({ data })
  await syncRoles(data.userId, 'payee-membership:vendor-member')
  return member
}

/**
 * Make a user an owner of an organizer account, then add the organizer role. Idempotent:
 * ON CONFLICT (organizerId, userId) DO NOTHING, so a retry or a concurrent bootstrap adds nothing.
 */
export async function addOrgOwner(organizerId: string, userId: string, opts: Opts = {}) {
  await (opts.db ?? db).orgMember.createMany({
    data: [{ organizerId, userId, role: 'owner' }],
    skipDuplicates: true,
  })
  await syncRoles(userId, 'payee-membership:organizer')
}
