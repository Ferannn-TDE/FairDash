// MENU ALERTS — the one list of alert types, channels and timings (audit H5, step 3).
//
// Organizers (or strict admins, for a fair with no organizer) are told when a vendor deletes menu
// items and when a price increase waits for their approval. Every value here is stored as plain
// text in the database (NotificationPreference.eventType/channel, InAppNotification.type,
// MenuChangeEvent.kind, Notification.template), so adding a type is a change here, not a
// migration.
//
// Import-free on purpose: the settings screen reads ALLOWED_CHANNELS in the browser, and the API,
// the worker and the screen must all agree on one list.

export const MENU_ALERT_TYPES = ['MENU_ITEMS_DELETED', 'MENU_PRICE_CHANGE_PENDING'] as const
export type MenuAlertType = (typeof MENU_ALERT_TYPES)[number]

export const ALERT_CHANNELS = ['EMAIL', 'IN_APP', 'BOTH', 'NONE'] as const
export type AlertChannel = (typeof ALERT_CHANNELS)[number]

/**
 * What each person may choose, per alert type (Jordan, Nov 15). Deletes may be switched off;
 * price increases waiting for approval may not, because nobody else will approve them.
 */
export const ALLOWED_CHANNELS: Record<MenuAlertType, readonly AlertChannel[]> = {
  MENU_ITEMS_DELETED:        ['EMAIL', 'IN_APP', 'BOTH', 'NONE'],
  MENU_PRICE_CHANGE_PENDING: ['EMAIL', 'IN_APP', 'BOTH'],
}

/** With no saved choice, a person gets both the bell and the email. */
export const DEFAULT_CHANNEL: AlertChannel = 'BOTH'

export function isMenuAlertType(value: unknown): value is MenuAlertType {
  return typeof value === 'string' && (MENU_ALERT_TYPES as readonly string[]).includes(value)
}

export function isAllowedChannel(type: MenuAlertType, value: unknown): value is AlertChannel {
  return typeof value === 'string' && (ALLOWED_CHANNELS[type] as readonly string[]).includes(value)
}

/**
 * The channel that applies to one person: their saved choice when it is allowed for this type,
 * otherwise the default. A stored value that is no longer allowed (say NONE on price increases)
 * never silences an alert.
 */
export function effectiveChannel(type: MenuAlertType, saved: string | null | undefined): AlertChannel {
  return isAllowedChannel(type, saved) ? saved : DEFAULT_CHANNEL
}

/** Which deliveries a channel means for one person. No usable email address → bell only. */
export function deliveriesFor(channel: AlertChannel, email: string | null | undefined): { inApp: boolean; email: boolean } {
  const hasEmail = typeof email === 'string' && email.trim().length > 0
  return {
    inApp: channel === 'IN_APP' || channel === 'BOTH',
    email: hasEmail && (channel === 'EMAIL' || channel === 'BOTH'),
  }
}

// ── The grouping queue (MenuChangeEvent.kind) ───────────────────────────────────────────────
export const CHANGE_KIND = { DELETE: 'DELETE', PRICE_PENDING: 'PRICE_PENDING' } as const
export type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND]

export const ALERT_TYPE_FOR_KIND: Record<ChangeKind, MenuAlertType> = {
  DELETE:        'MENU_ITEMS_DELETED',
  PRICE_PENDING: 'MENU_PRICE_CHANGE_PENDING',
}

/**
 * Why a price waits for approval: a higher-priced RESTORE or READD (step 3), a live item's price
 * going up (LIVE_INCREASE, F2) and a new size of a live item (NEW_SIZE, F4), all filed through the
 * same recorder by lib/menu-requests/file-item.ts.
 */
export const PRICE_PENDING_REASONS = ['RESTORE', 'READD', 'LIVE_INCREASE', 'NEW_SIZE'] as const
export type PricePendingReason = (typeof PRICE_PENDING_REASONS)[number]

// ── Timing ──────────────────────────────────────────────────────────────────────────────────
/** One vendor's deletes are grouped until the oldest is this old, then sent as one notification. */
export const MENU_DELETE_BATCH_WINDOW_MS = 10 * 60e3

/**
 * A menu-alert email held for no provider is useless once it is this old: when a provider is
 * connected, older ones are marked EXPIRED instead of sent (lib/notifications.ts).
 */
export const MENU_ALERT_EMAIL_EXPIRY_MS = 48 * 3600e3

// ── Email templates (Notification.template) ─────────────────────────────────────────────────
export const MENU_ALERT_TEMPLATE: Record<MenuAlertType, string> = {
  MENU_ITEMS_DELETED:        'menu_items_deleted',
  MENU_PRICE_CHANGE_PENDING: 'menu_price_change_pending',
}
export const MENU_ALERT_TEMPLATES: readonly string[] = Object.values(MENU_ALERT_TEMPLATE)
