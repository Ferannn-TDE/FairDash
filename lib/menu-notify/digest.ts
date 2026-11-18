// TURN RECORDED MENU CHANGES INTO NOTIFICATIONS (audit H5, step 3).
//
// Run by the worker every minute, before the outbox delivery (workers/order-worker.ts), so a new
// email can go out in the same tick.
//
// GROUPING
//   Deletes: one vendor's unsent deletes wait until the OLDEST is MENU_DELETE_BATCH_WINDOW_MS (10
//     minutes) old; then every unsent delete of that vendor becomes ONE notification. It arrives
//     10–11 minutes after the first delete. A later delete starts a new group.
//   Pending price increases: sent on the next tick. Rows from one vendor submission (same batchId)
//     become one notification; a row with no batchId is on its own. A request that is no longer
//     PENDING by then (decided or replaced) is not announced.
//
// RECIPIENTS (the approver rule, read at send time so membership changes apply)
//   The fair has an organizer: every OrgMember user of that organizer.
//   No organizer: every strict admin (admin | super_admin; never event_operator), from Clerk,
//     mapped to their User row. Admins with no User row are skipped, logged as a count only.
//
// EACH GROUP, IN ONE TRANSACTION
//   1. Claim its rows (digestId set where still null). If any was already claimed, another worker
//      got there first: roll back and leave it to them.
//   2. Read each recipient's saved channel (effectiveChannel: default BOTH).
//   3. Write bell rows (InAppNotification) and queue email rows (Notification, audience 'user'),
//      both with dedupeKey menu:{kind}:{digestId}:{userId}, so a retried tick can't send twice.
//   Recipients are resolved before the transaction, so no Clerk call holds database locks.
//
// No vendor contact details or Stripe ids are ever put in a notification.

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logger } from '../logger'
import { SITE_URL } from '../seo'
import { priceChangeSummary, formatPriceChange } from '../menu/price-gate'
import { listStrictAdminClerkIds } from './admin-recipients'
import { organizerApprovalError } from '../organizer-approval'
import { organizerSuspensionError } from '../organizer-suspension'
import {
  ALERT_TYPE_FOR_KIND,
  CHANGE_KIND,
  MENU_ALERT_TEMPLATE,
  MENU_DELETE_BATCH_WINDOW_MS,
  deliveriesFor,
  effectiveChannel,
  type ChangeKind,
  type MenuAlertType,
  type PricePendingReason,
} from './constants'

export interface DigestDeps {
  now?: Date
  /** Strict admins' Clerk ids; defaults to the Clerk listing. */
  listStrictAdminClerkIds?: () => Promise<string[]>
}

export interface DigestResult {
  /** Groups that produced a notification. */
  notified: number
  inApp: number
  emails: number
  /** Groups claimed but with nothing to deliver: every request already decided, or no recipient wants it. */
  nothingToSend: number
  /** Groups another worker claimed first. */
  claimLost: number
  /** Groups that failed; their rows stay unclaimed and are retried next tick. */
  errors: number
}

/** The payload of a queued menu-alert email (rendered by renderEmail in lib/notifications.ts). */
export interface MenuAlertEmailPayload {
  alertType: MenuAlertType
  fairName: string
  vendorName: string
  lines: string[]
  /** Absolute review link. */
  link: string
}

type Audience = 'organizer' | 'admin'
interface Recipient { userId: string; email: string }
interface Group { kind: ChangeKind; vendorId: string; eventId: string; rowIds: string[] }

class ClaimLost extends Error {}

const money = (d: number) => `$${d.toFixed(2)}`

const REASON_LABEL: Record<PricePendingReason, string> = {
  RESTORE:       'back on the menu at a higher price',
  READD:         'back on the menu at a higher price',
  LIVE_INCREASE: 'price increase',
  NEW_SIZE:      'new size',
}

/** Where the approver reviews it: the organizer's menu requests, or the admin vendors page. */
export function reviewPath(audience: Audience, fairSlug: string): string {
  return audience === 'organizer' ? `/organizer/fairs/${fairSlug}/menu-requests` : `/admin/${fairSlug}/vendors`
}

export function deleteLine(p: { name: string; price: number }): string {
  return `${p.name} (${money(p.price)})`
}

/**
 * "Cannoli (back on the menu at a higher price): $8.00 → $9.50 (+$1.50, +18.8%)". Compared with
 * the item's price as it is NOW, the same rule the review screens use; a new size has no previous
 * price and shows only its own.
 */
export function priceLine(p: { name: string; reason: PricePendingReason; current: number | null; requested: number }): string {
  const label = `${p.name} (${REASON_LABEL[p.reason]})`
  if (p.current === null) return `${label}: ${money(p.requested)}`
  return `${label}: ${formatPriceChange(priceChangeSummary(p.current, p.requested))}`
}

export function alertTitle(type: MenuAlertType, vendorName: string, count: number): string {
  if (type === 'MENU_ITEMS_DELETED') {
    return `${vendorName} removed ${count} menu item${count === 1 ? '' : 's'}`
  }
  return `${vendorName}: ${count} price increase${count === 1 ? '' : 's'} waiting for approval`
}

async function resolveRecipients(
  organizerId: string | null,
  admins: () => Promise<string[]>,
): Promise<{ audience: Audience; recipients: Recipient[] }> {
  if (organizerId) {
    // WHO MAY BE TOLD (review F15; Jordan, Nov 17): only members of an organizer that may operate,
    // decided by the SAME two functions requireOrganizerAuth uses (lib/auth.ts): approved, and not
    // suspended. A blocked organizer's fairs get no menu alerts at all (decision A): the group is
    // taken off the queue with nobody told (counted nothingToSend), as with no members. Its pending
    // requests still wait on the menu-requests page for when it is reinstated.
    const org = await db.fairOrganizer.findUnique({
      where: { id: organizerId },
      select: { approvalStatus: true, rejectionReason: true, suspendedAt: true, suspendedReason: true },
    })
    if (!org || organizerApprovalError(org) || organizerSuspensionError(org)) {
      // warn, not info: info prints only in development (lib/logger.ts), and this must leave a trace in production.
      logger.warn('[menu-alerts] organizer not approved or suspended: no recipients', { organizerId })
      return { audience: 'organizer', recipients: [] }
    }
    const members = await db.orgMember.findMany({
      where: { organizerId },
      select: { user: { select: { id: true, email: true } } },
    })
    return { audience: 'organizer', recipients: members.map(m => ({ userId: m.user.id, email: m.user.email })) }
  }
  const clerkIds = await admins()
  const users = clerkIds.length
    ? await db.user.findMany({ where: { clerkId: { in: clerkIds } }, select: { id: true, email: true } })
    : []
  const missing = clerkIds.length - users.length
  if (missing > 0) logger.warn('[menu-alerts] strict admins with no database row skipped', { count: missing })
  return { audience: 'admin', recipients: users.map(u => ({ userId: u.id, email: u.email })) }
}

async function processGroup(
  group: Group,
  admins: () => Promise<string[]>,
): Promise<{ inApp: number; emails: number } | null> {
  const [event, vendor] = await Promise.all([
    db.event.findUnique({ where: { id: group.eventId }, select: { name: true, urlSlug: true, organizerId: true } }),
    db.vendor.findUnique({ where: { id: group.vendorId }, select: { name: true } }),
  ])
  // Both are foreign keys with cascade: a missing one means it was deleted with its rows mid-run.
  if (!event || !vendor) return null

  const { audience, recipients } = await resolveRecipients(event.organizerId, admins)
  const alertType = ALERT_TYPE_FOR_KIND[group.kind]
  const path = reviewPath(audience, event.urlSlug)
  const digestId = randomUUID()

  return db.$transaction(async tx => {
    const claimed = await tx.menuChangeEvent.updateMany({
      where: { id: { in: group.rowIds }, digestId: null },
      data: { digestId },
    })
    if (claimed.count !== group.rowIds.length) throw new ClaimLost()

    const rows = await tx.menuChangeEvent.findMany({
      where: { digestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    let lines: string[]
    if (group.kind === CHANGE_KIND.DELETE) {
      lines = rows.map(r => deleteLine(r.payload as { name: string; price: number }))
    } else {
      const requestIds = rows.map(r => r.menuRequestId).filter((id): id is string => id !== null)
      const itemIds = rows.map(r => r.menuItemId).filter((id): id is string => id !== null)
      const [requests, items] = await Promise.all([
        tx.menuRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, status: true } }),
        tx.menuItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, price: true } }),
      ])
      const pending = new Set(requests.filter(r => r.status === 'PENDING').map(r => r.id))
      const priceNow = new Map(items.map(i => [i.id, i.price]))
      lines = rows
        .filter(r => r.menuRequestId !== null && pending.has(r.menuRequestId))
        .map(r => {
          const p = r.payload as { name: string; previousPrice: number | null; requestedPrice: number; reason: PricePendingReason }
          const current = p.previousPrice === null ? null : (r.menuItemId !== null ? priceNow.get(r.menuItemId) : undefined) ?? p.previousPrice
          return priceLine({ name: p.name, reason: p.reason, current, requested: p.requestedPrice })
        })
    }
    if (lines.length === 0) return { inApp: 0, emails: 0 }

    const saved = recipients.length
      ? await tx.notificationPreference.findMany({
        where: { userId: { in: recipients.map(r => r.userId) }, eventType: alertType },
        select: { userId: true, channel: true },
      })
      : []
    const savedBy = new Map(saved.map(s => [s.userId, s.channel]))

    const title = alertTitle(alertType, vendor.name, lines.length)
    const body = `${event.name}\n${lines.join('\n')}`
    const emailPayload: MenuAlertEmailPayload = {
      alertType, fairName: event.name, vendorName: vendor.name, lines, link: `${SITE_URL}${path}`,
    }
    const bellPayload = { kind: group.kind, vendorId: group.vendorId, eventId: group.eventId, digestId, count: lines.length }

    const bell: Prisma.InAppNotificationCreateManyInput[] = []
    const mail: Prisma.NotificationCreateManyInput[] = []
    for (const r of recipients) {
      const want = deliveriesFor(effectiveChannel(alertType, savedBy.get(r.userId)), r.email)
      const dedupeKey = `menu:${group.kind}:${digestId}:${r.userId}`
      if (want.inApp) {
        bell.push({ userId: r.userId, type: alertType, title, body, link: path, payload: bellPayload, dedupeKey })
      }
      if (want.email) {
        mail.push({
          audience: 'user', to: r.email, template: MENU_ALERT_TEMPLATE[alertType],
          payload: emailPayload as unknown as Prisma.InputJsonValue, dedupeKey,
        })
      }
    }
    const inApp = bell.length ? (await tx.inAppNotification.createMany({ data: bell, skipDuplicates: true })).count : 0
    const emails = mail.length ? (await tx.notification.createMany({ data: mail, skipDuplicates: true })).count : 0
    return { inApp, emails }
  })
}

/** Groups of rows ready to send at `now`. */
async function readyGroups(now: Date): Promise<Group[]> {
  const groups: Group[] = []

  // Deletes: a vendor's group is ready once its oldest unsent delete is 10 minutes old.
  const cutoff = new Date(now.getTime() - MENU_DELETE_BATCH_WINDOW_MS)
  const oldest = await db.menuChangeEvent.groupBy({
    by: ['vendorId', 'eventId'],
    where: { kind: CHANGE_KIND.DELETE, digestId: null, createdAt: { lte: now } },
    _min: { createdAt: true },
  })
  for (const o of oldest) {
    if (!o._min.createdAt || o._min.createdAt > cutoff) continue
    const rows = await db.menuChangeEvent.findMany({
      where: { kind: CHANGE_KIND.DELETE, digestId: null, vendorId: o.vendorId, createdAt: { lte: now } },
      select: { id: true },
    })
    groups.push({ kind: CHANGE_KIND.DELETE, vendorId: o.vendorId, eventId: o.eventId, rowIds: rows.map(r => r.id) })
  }

  // Pending price increases: ready at once, one group per vendor submission.
  const pending = await db.menuChangeEvent.findMany({
    where: { kind: CHANGE_KIND.PRICE_PENDING, digestId: null, createdAt: { lte: now } },
    select: { id: true, vendorId: true, eventId: true, batchId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const byBatch = new Map<string, Group>()
  for (const r of pending) {
    const batch = r.batchId?.trim()
    const key = `${r.vendorId}|${batch ? batch : `solo:${r.id}`}`
    const g = byBatch.get(key)
    if (g) g.rowIds.push(r.id)
    else byBatch.set(key, { kind: CHANGE_KIND.PRICE_PENDING, vendorId: r.vendorId, eventId: r.eventId, rowIds: [r.id] })
  }
  groups.push(...byBatch.values())
  return groups
}

export async function runMenuNotificationDigests(deps: DigestDeps = {}): Promise<DigestResult> {
  const now = deps.now ?? new Date()
  const listAdmins = deps.listStrictAdminClerkIds ?? listStrictAdminClerkIds
  // One Clerk listing per run, and only if a fair without an organizer needs it.
  let adminIds: Promise<string[]> | null = null
  const admins = () => (adminIds ??= listAdmins())

  const res: DigestResult = { notified: 0, inApp: 0, emails: 0, nothingToSend: 0, claimLost: 0, errors: 0 }
  for (const group of await readyGroups(now)) {
    try {
      const out = await processGroup(group, admins)
      if (out === null) continue
      if (out.inApp === 0 && out.emails === 0) res.nothingToSend++
      else res.notified++
      res.inApp += out.inApp
      res.emails += out.emails
    } catch (err) {
      if (err instanceof ClaimLost) { res.claimLost++; continue }
      res.errors++
      logger.error('[menu-alerts] a group failed; it is retried next run', {
        kind: group.kind, vendorId: group.vendorId, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return res
}
