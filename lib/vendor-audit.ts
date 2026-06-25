/**
 * Vendor audit log helper.
 *
 * Write-only — logs are immutable. Never updated, only inserted.
 * Failures are swallowed so audit logging never blocks a business action.
 *
 * Action constants follow the pattern NOUN_VERB so they sort cleanly
 * in filters (e.g., ORDER_ACCEPTED, MENU_CHANGE_REQUESTED, SETTINGS_UPDATED).
 */

import type { Prisma } from '@prisma/client'
import { db } from './db'
import { logger } from './logger'

// ── Action constants ──────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Order lifecycle
  ORDER_ACCEPTED:          'ORDER_ACCEPTED',
  ORDER_DECLINED:          'ORDER_DECLINED',
  ORDER_MARKED_PREPARING:  'ORDER_MARKED_PREPARING',
  ORDER_MARKED_READY:      'ORDER_MARKED_READY',
  ORDER_COMPLETED:         'ORDER_COMPLETED',

  // Menu
  MENU_CHANGE_REQUESTED:   'MENU_CHANGE_REQUESTED',   // ADD | EDIT | DELETE submitted
  MENU_CHANGE_REVIEWED:    'MENU_CHANGE_REVIEWED',    // APPROVED or REJECTED by organizer

  // Settings
  SETTINGS_PROFILE_UPDATED: 'SETTINGS_PROFILE_UPDATED',
  SETTINGS_HOURS_UPDATED:   'SETTINGS_HOURS_UPDATED',
  SETTINGS_DOC_UPLOADED:    'SETTINGS_DOC_UPLOADED',

  // Status changes (organizer/admin)
  VENDOR_STATUS_CHANGED:    'VENDOR_STATUS_CHANGED',
} as const

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS]

// ── Log helper ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit log write. Never throws.
 */
export function logVendorAction(
  vendorId: string,
  userId:   string,
  action:   AuditAction,
  metadata?: Record<string, unknown>
): void {
  const metadataValue = metadata as Prisma.InputJsonValue | undefined
  db.vendorAuditLog.create({
    data: { vendorId, userId, action, metadata: metadataValue },
  }).catch(err => {
    logger.warn('[Audit] Failed to write audit log', { vendorId, userId, action, error: String(err) })
  })
}
