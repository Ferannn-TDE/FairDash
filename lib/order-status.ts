// Single source of truth for all order status logic.
// Import from here instead of duplicating status arrays or label maps anywhere.

export const COMPLETED_STATUSES = [
  'COMPLETED',
  'DELIVERED',
] as const

export const FAILED_STATUSES = [
  'DECLINED',
  'CANCELLED',
  'UNCOLLECTED',
  'UNDELIVERABLE',
] as const

export const ACTIVE_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'RUNNER_COLLECTED',
] as const

export const TERMINAL_STATUSES = [
  ...COMPLETED_STATUSES,
  ...FAILED_STATUSES,
] as const

export type OrderStatus =
  | typeof COMPLETED_STATUSES[number]
  | typeof FAILED_STATUSES[number]
  | typeof ACTIVE_STATUSES[number]

// ─── Tab groupings ────────────────────────────────────────────────────────────
// DECLINED is grouped under 'CANCELLED' — vendors think of declined and
// cancelled orders together as "orders that didn't complete".

export const TAB_STATUS_MAP: Record<string, string[]> = {
  all:       [...ACTIVE_STATUSES, ...TERMINAL_STATUSES],
  PLACED:    ['PLACED'],
  PREPARING: ['ACCEPTED', 'PREPARING'],
  READY:     ['READY', 'RUNNER_COLLECTED'],
  COMPLETED: [...COMPLETED_STATUSES],
  CANCELLED: [...FAILED_STATUSES],
}

// ─── Display meta ─────────────────────────────────────────────────────────────

export type StatusIconType = 'check' | 'x' | 'package'

export interface StatusMeta {
  label:    string
  iconType: StatusIconType
  color:    string
}

export function getStatusMeta(status: string): StatusMeta {
  switch (status) {
    case 'COMPLETED':
    case 'DELIVERED':
      return { label: 'Order fulfilled successfully', iconType: 'check',   color: 'text-emerald-400' }
    case 'DECLINED':
      return { label: 'Order declined by vendor',     iconType: 'x',       color: 'text-amber-400'  }
    case 'CANCELLED':
    case 'UNCOLLECTED':
    case 'UNDELIVERABLE':
      return { label: 'Order could not be fulfilled', iconType: 'x',       color: 'text-red-400'    }
    default:
      return { label: 'Order in progress',            iconType: 'package', color: 'text-neon-pink'  }
  }
}

// ─── Predicate helpers ────────────────────────────────────────────────────────

export const isCompleted = (status: string): boolean =>
  (COMPLETED_STATUSES as readonly string[]).includes(status)

export const isFailed = (status: string): boolean =>
  (FAILED_STATUSES as readonly string[]).includes(status)

export const isActive = (status: string): boolean =>
  (ACTIVE_STATUSES as readonly string[]).includes(status)

export const isTerminal = (status: string): boolean =>
  (TERMINAL_STATUSES as readonly string[]).includes(status)
