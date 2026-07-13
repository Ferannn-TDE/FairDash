/**
 * Derives the vendor dashboard's online-badge state — the vendor twin of the runner
 * approval gate, plus the organizer "sticky offline" lock. Pure and separately testable so
 * the truth table can be proven rather than eyeballed, because "an unapproved vendor shows
 * Online" (and now "a paused vendor can flip themselves back Online") is exactly the class
 * of self-contradicting UI this codebase keeps having to kill.
 *
 * THE ONLINE TOGGLE IS USABLE ONLY WHEN status === ACTIVE (and readiness has loaded). Every
 * other state locks it, with a reason that says WHY:
 *
 *   readiness not loaded yet     → LOCKED (don't flash a guess while waiting)
 *   status PENDING / under review → LOCKED — "awaiting approval"
 *   status PAUSED                 → LOCKED — organizer took them offline. STICKY BY
 *                                   CONSTRUCTION: a vendor cannot change their own status
 *                                   (the vendor PATCH excludes it), so only the organizer
 *                                   can bring them back. No offlineSetBy field needed — the
 *                                   status axis already carries "who set it".
 *   status SUSPENDED / REJECTED   → LOCKED — organizer action; same reasoning.
 *   status ACTIVE, approved       → the vendor's own toggle (isOnline) drives it.
 *
 * `locked` means the toggle is disabled and the vendor CANNOT present as online, regardless
 * of the local `isOnline` choice.
 */

export interface ReadinessStep { key: string; waiting?: boolean }
export interface ReadinessLike { steps: ReadinessStep[] }

export type OnlineLockReason = 'loading' | 'awaiting_approval' | 'paused' | 'suspended' | null

export interface OnlineState {
  awaitingApproval: boolean
  /** Organizer took this vendor offline (PAUSED/SUSPENDED) — vendor can't self-release. */
  organizerLocked: boolean
  locked: boolean
  lockReason: OnlineLockReason
  /** The badge's truth: only ever true for an ACTIVE vendor who has toggled on. */
  showOnline: boolean
  label: string
}

export function deriveOnlineState(
  readiness: ReadinessLike | null,
  isOnline: boolean,
  vendorStatus?: string,
): OnlineState {
  const awaitingApproval = Boolean(readiness?.steps.find(s => s.key === 'application')?.waiting)
  const paused = vendorStatus === 'PAUSED'
  const suspended = vendorStatus === 'SUSPENDED' || vendorStatus === 'REJECTED'
  const organizerLocked = paused || suspended

  const locked = readiness === null || awaitingApproval || organizerLocked
  const showOnline = !locked && isOnline

  // Reason precedence: an explicit organizer action outranks the approval/loading states,
  // because it is the more specific, more actionable thing to tell the vendor.
  const lockReason: OnlineLockReason =
    paused ? 'paused'
    : suspended ? 'suspended'
    : awaitingApproval ? 'awaiting_approval'
    : readiness === null ? 'loading'
    : null

  const label =
    lockReason === 'paused' ? 'Taken offline by organizer'
    : lockReason === 'suspended' ? 'Suspended by organizer'
    : lockReason === 'awaiting_approval' ? 'Offline · Awaiting approval'
    : showOnline ? 'Online'
    : 'Offline'

  return { awaitingApproval, organizerLocked, locked, lockReason, showOnline, label }
}
