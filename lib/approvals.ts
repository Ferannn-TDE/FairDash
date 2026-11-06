// Sign-up approvals (Batch 1 item 9, B1.12) — ONE decision per application, used by the approvals
// page and the per-fair admin vendor routes alike, so the booth and its owner never split.
//
// Every decision: PENDING only (a second decision gets 409 ALREADY_DECIDED via a status-conditional
// update), one transaction with its ApprovalAction audit row and the applicant's email (outbox).
//
// VENDOR rules (agreed 2026-11-05; approval is per booth, the owner row is created PENDING):
//   approve — documents gate first. Owner row PENDING → booth ACTIVE + owner APPROVED.
//             Owner already APPROVED (decided on Booth Operators) → only the booth changes.
//             Owner already REJECTED → refused (never override an explicit earlier rejection).
//   reject  — reason required. Owner row PENDING → booth + owner REJECTED. Owner already APPROVED
//             or REJECTED → only the booth is rejected; the owner row is left untouched.
//   Staff added later are never touched.

import { VendorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-error'
import { vendorDocsComplete, REQUIRED_VENDOR_DOCS, VENDOR_DOC_LABELS, type RequiredVendorDoc } from '@/lib/vendor-documents'
import { enqueueDecisionEmail, type ApplicationKind } from '@/lib/notifications'
import type { SettingsRole } from '@/lib/roles'

export interface Actor { clerkId: string; actorType: SettingsRole }
export type Decision = 'approve' | 'reject'

const DOC_PATH: Record<RequiredVendorDoc, 'foodHandlerPermitPath' | 'insurancePath' | 'businessLicensePath'> = {
  foodHandler: 'foodHandlerPermitPath', insurance: 'insurancePath', businessLicense: 'businessLicensePath',
}

function requireReason(decision: Decision, reason: unknown): string | null {
  if (decision === 'approve') return null
  const r = typeof reason === 'string' ? reason.trim() : ''
  if (!r) throw new ApiError('A reason is required (it is shown to the applicant)', 400, 'VALIDATION_ERROR')
  return r.slice(0, 1000)
}

const alreadyDecided = () => new ApiError('Already decided', 409, 'ALREADY_DECIDED')

// ── Vendor ──────────────────────────────────────────────────────────────────────────────────
export async function decideVendor(vendorId: string, decision: Decision, reasonIn: unknown, actor: Actor) {
  const reason = requireReason(decision, reasonIn)
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true, name: true, status: true, contactName: true, contactEmail: true,
      foodHandlerPermitPath: true, insurancePath: true, businessLicensePath: true,
      vendorMembers: { where: { role: 'owner' }, select: { id: true, approvalStatus: true, user: { select: { email: true } } }, take: 1 },
    },
  })
  if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')
  if (vendor.status !== VendorStatus.PENDING) throw alreadyDecided()
  const owner = vendor.vendorMembers[0] ?? null

  if (decision === 'approve') {
    if (!vendorDocsComplete(vendor)) {
      const missing = REQUIRED_VENDOR_DOCS.filter(d => vendor[DOC_PATH[d]] === null).map(d => VENDOR_DOC_LABELS[d])
      throw new ApiError(`${vendor.name} can't be approved until all required documents are uploaded.`, 409, 'DOCS_INCOMPLETE', { missing })
    }
    if (owner?.approvalStatus === 'REJECTED') {
      throw new ApiError('The owner was rejected separately; resolve that on Booth Operators first.', 409, 'OWNER_REJECTED')
    }
  }

  // VendorMember.approvedBy holds a DB User.id (that table's convention); fall back to the Clerk id
  // for an approver with no DB row rather than failing the decision.
  const actorUser = await db.user.findUnique({ where: { clerkId: actor.clerkId }, select: { id: true } })
  const memberApprover = actorUser?.id ?? actor.clerkId
  const ownerPending = owner?.approvalStatus === 'PENDING'

  await db.$transaction(async tx => {
    const flip = await tx.vendor.updateMany({
      where: { id: vendorId, status: VendorStatus.PENDING },
      data: { status: decision === 'approve' ? VendorStatus.ACTIVE : VendorStatus.REJECTED },
    })
    if (flip.count === 0) throw alreadyDecided()
    if (owner && ownerPending) {
      await tx.vendorMember.updateMany({
        where: { id: owner.id, approvalStatus: 'PENDING' },
        data: decision === 'approve'
          ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: memberApprover, rejectionReason: null }
          : { approvalStatus: 'REJECTED', rejectionReason: reason },
      })
    }
    await tx.approvalAction.create({
      data: {
        action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'vendor', applicationId: vendorId,
        actorId: actor.clerkId, actorType: actor.actorType, reason,
        detail: { ownerMemberId: owner?.id ?? null, ownerBefore: owner?.approvalStatus ?? null, ownerChanged: !!(owner && ownerPending) },
      },
    })
    await enqueueDecisionEmail(tx, vendorId, decision === 'approve' ? 'approved' : 'rejected', vendor.contactEmail ?? owner?.user.email ?? null,
      { kind: 'vendor', name: vendor.name, contactName: vendor.contactName, ...(reason ? { reason } : {}) })
  })
  return { id: vendorId, status: decision === 'approve' ? VendorStatus.ACTIVE : VendorStatus.REJECTED, ownerChanged: !!(owner && ownerPending) }
}

// ── Organizer (platform-wide account) ───────────────────────────────────────────────────────
export async function decideOrganizer(organizerId: string, decision: Decision, reasonIn: unknown, actor: Actor) {
  const reason = requireReason(decision, reasonIn)
  const org = await db.fairOrganizer.findUnique({ where: { id: organizerId }, select: { id: true, name: true, contactEmail: true, approvalStatus: true } })
  if (!org) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')
  if (org.approvalStatus !== 'PENDING') throw alreadyDecided()
  await db.$transaction(async tx => {
    const flip = await tx.fairOrganizer.updateMany({
      where: { id: organizerId, approvalStatus: 'PENDING' },
      // Same field writes as the existing organizer approve/reject routes (approvedBy = Clerk id).
      data: decision === 'approve'
        ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: actor.clerkId, rejectionReason: null }
        : { approvalStatus: 'REJECTED', rejectionReason: reason },
    })
    if (flip.count === 0) throw alreadyDecided()
    await tx.approvalAction.create({ data: { action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'organizer', applicationId: organizerId, actorId: actor.clerkId, actorType: actor.actorType, reason } })
    await enqueueDecisionEmail(tx, organizerId, decision === 'approve' ? 'approved' : 'rejected', org.contactEmail, { kind: 'organizer', name: org.name, contactName: null, ...(reason ? { reason } : {}) })
  })
  return { id: organizerId, status: decision === 'approve' ? 'APPROVED' : 'REJECTED' }
}

// ── Partner organization ────────────────────────────────────────────────────────────────────
export async function decidePartner(partnerId: string, decision: Decision, reasonIn: unknown, actor: Actor) {
  const reason = requireReason(decision, reasonIn)
  const p = await db.partnerOrganization.findUnique({ where: { id: partnerId }, select: { id: true, name: true, contactName: true, contactEmail: true, approvalStatus: true } })
  if (!p) throw new ApiError('Partner organization not found', 404, 'PARTNER_NOT_FOUND')
  if (p.approvalStatus !== 'PENDING') throw alreadyDecided()
  await db.$transaction(async tx => {
    const flip = await tx.partnerOrganization.updateMany({
      where: { id: partnerId, approvalStatus: 'PENDING' },
      data: decision === 'approve'
        ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: actor.clerkId, rejectionReason: null }
        : { approvalStatus: 'REJECTED', rejectionReason: reason },
    })
    if (flip.count === 0) throw alreadyDecided()
    await tx.approvalAction.create({ data: { action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'partner', applicationId: partnerId, actorId: actor.clerkId, actorType: actor.actorType, reason } })
    await enqueueDecisionEmail(tx, partnerId, decision === 'approve' ? 'approved' : 'rejected', p.contactEmail, { kind: 'partner', name: p.name, contactName: p.contactName, ...(reason ? { reason } : {}) })
  })
  return { id: partnerId, status: decision === 'approve' ? 'APPROVED' : 'REJECTED' }
}

export async function decide(kind: ApplicationKind, id: string, decision: Decision, reason: unknown, actor: Actor) {
  if (kind === 'vendor') return decideVendor(id, decision, reason, actor)
  if (kind === 'organizer') return decideOrganizer(id, decision, reason, actor)
  return decidePartner(id, decision, reason, actor)
}

// ── Pending lists for the page ──────────────────────────────────────────────────────────────
export async function listPendingApplications() {
  const [vendors, organizers, partners] = await Promise.all([
    db.vendor.findMany({
      where: { status: VendorStatus.PENDING, event: { archivedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, cuisineType: true, description: true, contactName: true, contactEmail: true, contactPhone: true, createdAt: true,
        foodHandlerPermitPath: true, insurancePath: true, businessLicensePath: true,
        event: { select: { name: true, urlSlug: true } },
        vendorMembers: { where: { role: 'owner' }, select: { approvalStatus: true }, take: 1 },
      },
    }),
    db.fairOrganizer.findMany({ where: { approvalStatus: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, contactEmail: true, contactPhone: true, createdAt: true } }),
    db.partnerOrganization.findMany({ where: { approvalStatus: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
  ])
  return {
    vendors: vendors.map(v => ({
      id: v.id, name: v.name, cuisineType: v.cuisineType, description: v.description,
      contactName: v.contactName, contactEmail: v.contactEmail, contactPhone: v.contactPhone, createdAt: v.createdAt,
      fair: v.event.name,
      ownerStatus: v.vendorMembers[0]?.approvalStatus ?? null,
      documents: REQUIRED_VENDOR_DOCS.map(d => ({ key: d, label: VENDOR_DOC_LABELS[d], onFile: v[DOC_PATH[d]] !== null })),
    })),
    organizers,
    partners: partners.map(p => ({
      id: p.id, name: p.name, groupType: p.groupType, groupTypeOther: p.groupTypeOther,
      contactName: p.contactName, contactEmail: p.contactEmail, contactPhone: p.contactPhone, city: p.city, state: p.state,
      interests: p.interests, staffHours: p.staffHours, note: p.note, createdAt: p.createdAt,
    })),
  }
}

export async function countPendingApplications(): Promise<number> {
  const [v, o, p] = await Promise.all([
    db.vendor.count({ where: { status: VendorStatus.PENDING, event: { archivedAt: null } } }),
    db.fairOrganizer.count({ where: { approvalStatus: 'PENDING' } }),
    db.partnerOrganization.count({ where: { approvalStatus: 'PENDING' } }),
  ])
  return v + o + p
}

// ── Document viewing (pending vendors only), audited ────────────────────────────────────────
export async function vendorDocumentPathForReview(vendorId: string, doc: string, actor: Actor): Promise<string> {
  if (!(REQUIRED_VENDOR_DOCS as readonly string[]).includes(doc)) throw new ApiError('Unknown document', 400, 'VALIDATION_ERROR')
  const key = doc as RequiredVendorDoc
  const v = await db.vendor.findUnique({ where: { id: vendorId }, select: { status: true, foodHandlerPermitPath: true, insurancePath: true, businessLicensePath: true } })
  if (!v) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')
  // Only applications awaiting a decision: platform_manager gets no standing access to documents.
  if (v.status !== VendorStatus.PENDING) throw new ApiError('Documents are only viewable here while the application is pending', 403, 'NOT_PENDING')
  const path = v[DOC_PATH[key]]
  if (!path) throw new ApiError(`${VENDOR_DOC_LABELS[key]} isn't on file`, 404, 'DOC_MISSING')
  await db.approvalAction.create({ data: { action: 'VIEW_DOCUMENT', applicationType: 'vendor', applicationId: vendorId, actorId: actor.clerkId, actorType: actor.actorType, detail: { document: key } } })
  return path
}
