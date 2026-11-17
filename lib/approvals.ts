// Sign-up approvals (Batch 1 item 9, B1.12) — ONE decision per application, used by the approvals
// page and the per-fair admin vendor routes alike, so the booth and its owner never split.
//
// Every decision: PENDING only (a second decision gets 409 ALREADY_DECIDED via a status-conditional
// update), one transaction with its ApprovalAction audit row and the applicant's email (outbox).
//
// REVIEWER NAME (Jordan, Nov 16): every decision's ApprovalAction records actorName, the reviewer's
// name as it was when they decided. Who may SEE it is lib/reviewer-label.ts (admins: full name;
// organizers: own org only; vendors and decision emails: never a person's name).
//
// VENDOR rules (agreed 2026-11-05; approval is per booth, the owner row is created PENDING):
//   approve — Stripe payouts asked FRESH (linked + payouts enabled; lib/vendor-payouts-check.ts,
//             Jordan Nov 16), then the go-live checklist (documents, menu, payouts, booth number;
//             lib/vendor-go-live.ts).
//             Owner row PENDING → booth ACTIVE + owner APPROVED.
//             Owner already APPROVED (decided on Booth Operators) → only the booth changes.
//             Owner already REJECTED → refused (never override an explicit earlier rejection).
//   reject  — reason required. Owner row PENDING → booth + owner REJECTED. Owner already APPROVED
//             or REJECTED → only the booth is rejected; the owner row is left untouched.
//   Staff added later are never touched.
//
// WHO DECIDES (Jordan, Nov 16; lib/vendor-approver.ts), on every vendor decision below: the event's
// organizer; FairSynq only when the event has none; a strict admin may override on an organizer's
// event with a required reason (recorded, and the organizer is emailed).
//
// LATER DECISIONS on a booth already decided (Jordan, Nov 16), each one transaction with its
// ApprovalAction and the vendor's email, exactly like the first:
//   reconsiderVendor — a REJECTED booth re-approved: the full approval path (approver rule, Stripe
//                      asked fresh, the checklist). A REJECTED owner row is re-admitted (APPROVED).
//   rejectLiveVendor — an ACTIVE / PAUSED / SUSPENDED booth rejected: reason required; owner untouched.

import { VendorStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-error'
import { REQUIRED_VENDOR_DOCS, VENDOR_DOC_LABELS, type RequiredVendorDoc } from '@/lib/vendor-documents'
import { GO_LIVE_LABELS, GO_LIVE_VENDOR_SELECT, vendorGoLiveRefusal } from '@/lib/vendor-go-live'
import { checkVendorPayouts } from '@/lib/vendor-payouts-check'
import { vendorApproverCheck } from '@/lib/vendor-approver'
import { reviewerLabel, reviewerNameFrom } from '@/lib/reviewer-label'
import { enqueueDecisionEmail, enqueueOverrideNotice, type ApplicationKind } from '@/lib/notifications'
import { SITE_URL } from '@/lib/seo'
import type { SettingsRole } from '@/lib/roles'

/** `name`: the reviewer's sign-in name when the caller has it (routes read it from Clerk). When
 *  absent, the decision falls back to the account's name on file, then the email before the @.
 *  `actorType: 'organizer'` (vendor decisions only) with `organizerId`: an organizer deciding a
 *  booth on their own event. */
export interface Actor { clerkId: string; actorType: SettingsRole | 'organizer'; name?: string | null; organizerId?: string | null }

/** The name recorded on the decision's ApprovalAction (see Actor.name). */
async function recordedActorName(actor: Actor): Promise<string | null> {
  if (actor.name?.trim()) return reviewerNameFrom({ fullName: actor.name })
  const u = await db.user.findUnique({ where: { clerkId: actor.clerkId }, select: { name: true, email: true } })
  return reviewerNameFrom({ dbName: u?.name, email: u?.email })
}
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

/** An optional note (kept when given, trimmed), or null. */
function optionalReason(reason: unknown): string | null {
  const r = typeof reason === 'string' ? reason.trim() : ''
  return r ? r.slice(0, 1000) : null
}

const alreadyDecided = () => new ApiError('Already decided', 409, 'ALREADY_DECIDED')

// ── Vendor ──────────────────────────────────────────────────────────────────────────────────
// Approving puts the booth ACTIVE (live), so it runs the same go-live checklist as every other
// move into ACTIVE (lib/vendor-go-live.ts, audit M1, decided Nov 12): documents, a sellable menu
// item, payouts and a booth number. `opts.boothNumber`, when given, is written in the same
// transaction and counts toward the checklist.
const VENDOR_DECISION_SELECT = {
  status: true, slug: true, contactName: true, contactEmail: true, stripeAccountId: true,
  ...GO_LIVE_VENDOR_SELECT,
  event: { select: { name: true, urlSlug: true, organizerId: true, organizer: { select: { name: true, contactEmail: true } } } },
  vendorMembers: { where: { role: 'owner' }, select: { id: true, approvalStatus: true, user: { select: { email: true } } }, take: 1 },
} satisfies Prisma.VendorSelect
type DecisionVendor = Prisma.VendorGetPayload<{ select: typeof VENDOR_DECISION_SELECT }>

async function loadVendorForDecision(vendorId: string): Promise<DecisionVendor> {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: VENDOR_DECISION_SELECT })
  if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')
  return vendor
}

const cleanBooth = (b?: string) => (b?.trim() ? b.trim().slice(0, 20) : undefined)

/**
 * Every approval (first, re-approval, override): Stripe first, asked fresh (throws 503 when Stripe
 * can't be asked: nothing changes), then the go-live checklist. Stripe's answer replaces the stored
 * flag for the checklist's "payouts" item, so a vendor Stripe has just enabled is not refused on a
 * stale flag, and one it has just restricted is not approved. Throws the refusal; returns when ready.
 */
async function assertReadyToApprove(vendor: DecisionVendor, boothNumber: string | undefined): Promise<void> {
  const payouts = await checkVendorPayouts(vendor)
  const refusal = await vendorGoLiveRefusal(db, { ...vendor, stripeVerified: payouts.ok, boothNumber: boothNumber ?? vendor.boothNumber }, { approving: true })
  // Name each missing document, as the approvals page always has; the other items by label.
  const labels = (items: (keyof typeof GO_LIVE_LABELS)[]) => items.flatMap(m => m === 'documents'
    ? REQUIRED_VENDOR_DOCS.filter(d => vendor[DOC_PATH[d]] === null).map(d => VENDOR_DOC_LABELS[d])
    : [GO_LIVE_LABELS[m]])
  if (!payouts.ok) {
    const others = labels((refusal?.missing ?? []).filter(m => m !== 'payouts'))
    const message = others.length ? `${payouts.message} Also still needed: ${others.join(', ')}.` : payouts.message
    throw new ApiError(message, 409, payouts.code, { missing: [GO_LIVE_LABELS.payouts, ...others] })
  }
  if (refusal) {
    throw new ApiError(`${vendor.name} can't be approved yet: it isn't ready to go live.`, 409, refusal.code, { missing: labels(refusal.missing) })
  }
}

interface DecisionContext { override: boolean; detail: Record<string, unknown> }

/** The approver rule (lib/vendor-approver.ts) plus what the decision's audit row records about it. */
function decisionContext(vendor: DecisionVendor, actor: Actor, reasonIn: unknown): DecisionContext {
  const { override } = vendorApproverCheck({
    eventOrganizerId: vendor.event.organizerId, actorType: actor.actorType, actorOrganizerId: actor.organizerId, reason: reasonIn,
  })
  const organizerName = vendor.event.organizer?.name ?? null
  return {
    override,
    detail: {
      // Read by lib/reviewer-label.ts: an organizer decision is labelled with its organization.
      ...(actor.actorType === 'organizer' && { organizerId: actor.organizerId, organizerName }),
      ...(override && { override: true, organizerId: vendor.event.organizerId, organizerName }),
    },
  }
}

/** Inside the decision's transaction, after its ApprovalAction: the vendor's email (who decided, as
 *  the vendor may see it) and, on an override, the organizer's notice. */
async function queueVendorDecisionMail(tx: Prisma.TransactionClient, vendor: DecisionVendor, args: {
  decision: Decision; actor: Actor; actorName: string | null; ctx: DecisionContext; reason: string | null
  actionId: string; laterDecision: boolean
}) {
  const decidedBy = reviewerLabel({ kind: 'vendor' }, { actorType: args.actor.actorType, actorName: args.actorName, detail: args.ctx.detail })
  const owner = vendor.vendorMembers[0] ?? null
  await enqueueDecisionEmail(tx, vendor.id, args.decision === 'approve' ? 'approved' : 'rejected', vendor.contactEmail ?? owner?.user.email ?? null,
    { kind: 'vendor', name: vendor.name, contactName: vendor.contactName, decidedBy, ...(args.decision === 'reject' && args.reason ? { reason: args.reason } : {}) },
    args.laterDecision ? args.actionId : undefined)
  if (args.ctx.override) {
    await enqueueOverrideNotice(tx, vendor.id, args.actionId, vendor.event.organizer?.contactEmail ?? null, {
      vendorName: vendor.name, fairName: vendor.event.name, decision: args.decision === 'approve' ? 'approved' : 'rejected',
      reason: args.reason ?? '', link: `${SITE_URL}/organizer/fairs/${vendor.event.urlSlug}/vendors/${vendor.slug}`,
    })
  }
}

/** VendorMember.approvedBy holds a DB User.id (that table's convention); fall back to the Clerk id
 *  for an approver with no DB row rather than failing the decision. */
async function memberApproverId(actor: Actor): Promise<string> {
  const u = await db.user.findUnique({ where: { clerkId: actor.clerkId }, select: { id: true } })
  return u?.id ?? actor.clerkId
}

/**
 * `opts.readmitOwner` (Booth Operators, sub-step C, Jordan Nov 16): the admin is admitting the
 * OWNER explicitly, so an owner row that was REJECTED is re-admitted with the booth instead of the
 * approval being refused. `opts.via` is recorded on the ApprovalAction (where the decision was made).
 */
export async function decideVendor(vendorId: string, decision: Decision, reasonIn: unknown, actor: Actor,
  opts: { boothNumber?: string; readmitOwner?: boolean; via?: 'booth-operators' } = {}) {
  const vendor = await loadVendorForDecision(vendorId)
  const ctx = decisionContext(vendor, actor, reasonIn)
  // An override always carries its reason (required above); otherwise only a reject needs one.
  const reason = ctx.override ? optionalReason(reasonIn) : requireReason(decision, reasonIn)
  if (vendor.status !== VendorStatus.PENDING) throw alreadyDecided()
  const owner = vendor.vendorMembers[0] ?? null
  const boothNumber = cleanBooth(opts.boothNumber)
  const readmit = decision === 'approve' && !!opts.readmitOwner && owner?.approvalStatus === 'REJECTED'

  if (decision === 'approve') {
    await assertReadyToApprove(vendor, boothNumber)
    if (owner?.approvalStatus === 'REJECTED' && !readmit) {
      throw new ApiError('The owner was rejected separately; resolve that on Booth Operators first.', 409, 'OWNER_REJECTED')
    }
  }

  const memberApprover = await memberApproverId(actor)
  const ownerPending = owner?.approvalStatus === 'PENDING'
  const ownerChanges = !!owner && (ownerPending || readmit)
  const actorName = await recordedActorName(actor)

  await db.$transaction(async tx => {
    const flip = await tx.vendor.updateMany({
      where: { id: vendorId, status: VendorStatus.PENDING },
      data: {
        status: decision === 'approve' ? VendorStatus.ACTIVE : VendorStatus.REJECTED,
        ...(decision === 'approve' && boothNumber !== undefined && { boothNumber }),
      },
    })
    if (flip.count === 0) throw alreadyDecided()
    if (owner && ownerChanges) {
      await tx.vendorMember.updateMany({
        where: { id: owner.id, approvalStatus: owner.approvalStatus },
        data: decision === 'approve'
          ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: memberApprover, rejectionReason: null }
          : { approvalStatus: 'REJECTED', rejectionReason: reason },
      })
    }
    const action = await tx.approvalAction.create({
      data: {
        action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'vendor', applicationId: vendorId,
        actorId: actor.clerkId, actorType: actor.actorType, actorName, reason,
        detail: {
          ownerMemberId: owner?.id ?? null, ownerBefore: owner?.approvalStatus ?? null, ownerChanged: ownerChanges,
          ...(opts.via && { via: opts.via }), ...ctx.detail,
        },
      },
      select: { id: true },
    })
    await queueVendorDecisionMail(tx, vendor, { decision, actor, actorName, ctx, reason, actionId: action.id, laterDecision: false })
  })
  return { id: vendorId, status: decision === 'approve' ? VendorStatus.ACTIVE : VendorStatus.REJECTED, ownerChanged: ownerChanges }
}

/**
 * A REJECTED booth approved after all (Jordan, Nov 16: "Re-approve" / "Reconsider"). The full
 * approval path: approver rule, Stripe asked fresh, the checklist ("approved for event" is not
 * asked: this IS the approval). Owner row PENDING or REJECTED → APPROVED (re-admitted); APPROVED →
 * untouched. ApprovalAction APPROVE (detail.reconsidered) and the vendor's approved email.
 */
export async function reconsiderVendor(vendorId: string, reasonIn: unknown, actor: Actor, opts: { boothNumber?: string } = {}) {
  const vendor = await loadVendorForDecision(vendorId)
  const ctx = decisionContext(vendor, actor, reasonIn)
  const reason = optionalReason(reasonIn)
  if (vendor.status !== VendorStatus.REJECTED) throw alreadyDecided()
  const owner = vendor.vendorMembers[0] ?? null
  const boothNumber = cleanBooth(opts.boothNumber)
  await assertReadyToApprove(vendor, boothNumber)

  const memberApprover = await memberApproverId(actor)
  const ownerChanges = !!owner && owner.approvalStatus !== 'APPROVED'
  const actorName = await recordedActorName(actor)

  await db.$transaction(async tx => {
    const flip = await tx.vendor.updateMany({
      where: { id: vendorId, status: VendorStatus.REJECTED },
      data: { status: VendorStatus.ACTIVE, ...(boothNumber !== undefined && { boothNumber }) },
    })
    if (flip.count === 0) throw alreadyDecided()
    if (owner && ownerChanges) {
      await tx.vendorMember.updateMany({
        where: { id: owner.id, approvalStatus: owner.approvalStatus },
        data: { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: memberApprover, rejectionReason: null },
      })
    }
    const action = await tx.approvalAction.create({
      data: {
        action: 'APPROVE', applicationType: 'vendor', applicationId: vendorId,
        actorId: actor.clerkId, actorType: actor.actorType, actorName, reason,
        detail: { reconsidered: true, fromStatus: 'REJECTED', ownerMemberId: owner?.id ?? null, ownerBefore: owner?.approvalStatus ?? null, ownerChanged: ownerChanges, ...ctx.detail },
      },
      select: { id: true },
    })
    await queueVendorDecisionMail(tx, vendor, { decision: 'approve', actor, actorName, ctx, reason, actionId: action.id, laterDecision: true })
  })
  return { id: vendorId, status: VendorStatus.ACTIVE, ownerChanged: ownerChanges }
}

/**
 * An ACTIVE, PAUSED or SUSPENDED booth rejected (Jordan, Nov 16). Reason required (it is emailed to
 * the vendor). The owner row is untouched. ApprovalAction REJECT (detail.fromStatus) and the email.
 * A PENDING booth is decided by decideVendor; a REJECTED one is already rejected.
 */
export async function rejectLiveVendor(vendorId: string, reasonIn: unknown, actor: Actor) {
  const vendor = await loadVendorForDecision(vendorId)
  const ctx = decisionContext(vendor, actor, reasonIn)
  const reason = requireReason('reject', reasonIn)
  const from = vendor.status
  if (from === VendorStatus.PENDING || from === VendorStatus.REJECTED) throw alreadyDecided()
  const actorName = await recordedActorName(actor)

  await db.$transaction(async tx => {
    const flip = await tx.vendor.updateMany({ where: { id: vendorId, status: from }, data: { status: VendorStatus.REJECTED } })
    if (flip.count === 0) throw alreadyDecided()
    const action = await tx.approvalAction.create({
      data: {
        action: 'REJECT', applicationType: 'vendor', applicationId: vendorId,
        actorId: actor.clerkId, actorType: actor.actorType, actorName, reason,
        detail: { fromStatus: from, ownerChanged: false, ...ctx.detail },
      },
      select: { id: true },
    })
    await queueVendorDecisionMail(tx, vendor, { decision: 'reject', actor, actorName, ctx, reason, actionId: action.id, laterDecision: true })
  })
  return { id: vendorId, status: VendorStatus.REJECTED, ownerChanged: false }
}

// ── Organizer (platform-wide account) ───────────────────────────────────────────────────────
export async function decideOrganizer(organizerId: string, decision: Decision, reasonIn: unknown, actor: Actor) {
  const reason = requireReason(decision, reasonIn)
  const org = await db.fairOrganizer.findUnique({ where: { id: organizerId }, select: { id: true, name: true, contactEmail: true, approvalStatus: true } })
  if (!org) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')
  if (org.approvalStatus !== 'PENDING') throw alreadyDecided()
  const actorName = await recordedActorName(actor)
  await db.$transaction(async tx => {
    const flip = await tx.fairOrganizer.updateMany({
      where: { id: organizerId, approvalStatus: 'PENDING' },
      // Same field writes as the existing organizer approve/reject routes (approvedBy = Clerk id).
      data: decision === 'approve'
        ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: actor.clerkId, rejectionReason: null }
        : { approvalStatus: 'REJECTED', rejectionReason: reason },
    })
    if (flip.count === 0) throw alreadyDecided()
    await tx.approvalAction.create({ data: { action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'organizer', applicationId: organizerId, actorId: actor.clerkId, actorType: actor.actorType, actorName, reason } })
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
  const actorName = await recordedActorName(actor)
  await db.$transaction(async tx => {
    const flip = await tx.partnerOrganization.updateMany({
      where: { id: partnerId, approvalStatus: 'PENDING' },
      data: decision === 'approve'
        ? { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: actor.clerkId, rejectionReason: null }
        : { approvalStatus: 'REJECTED', rejectionReason: reason },
    })
    if (flip.count === 0) throw alreadyDecided()
    await tx.approvalAction.create({ data: { action: decision === 'approve' ? 'APPROVE' : 'REJECT', applicationType: 'partner', applicationId: partnerId, actorId: actor.clerkId, actorType: actor.actorType, actorName, reason } })
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
        event: { select: { name: true, urlSlug: true, organizer: { select: { name: true } } } },
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
      // Set when the fair has an organizer: they decide (lib/vendor-approver.ts); FairSynq only by
      // a strict-admin override with a reason.
      organizerName: v.event.organizer?.name ?? null,
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
