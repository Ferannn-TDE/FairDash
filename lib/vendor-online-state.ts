/**
 * Derives the vendor dashboard's online-badge state — the vendor twin of the runner
 * approval gate. Pure and separately testable so the truth table can be proven rather than
 * eyeballed, because "an unapproved vendor shows Online" is exactly the class of
 * self-contradicting UI this codebase keeps having to kill.
 *
 * THE RULES, in order:
 *   1. readiness not loaded yet  → LOCKED, not online   (don't flash a guess while waiting)
 *   2. application under review  → LOCKED, not online, badge says "awaiting approval"
 *   3. approved, toggled off     → unlocked, offline
 *   4. approved, toggled on      → unlocked, ONLINE
 *
 * `locked` means the toggle is disabled and the vendor CANNOT present as online — the badge
 * can never read Online while locked, regardless of the local `isOnline` choice.
 */

export interface ReadinessStep { key: string; waiting?: boolean }
export interface ReadinessLike { steps: ReadinessStep[] }

export interface OnlineState {
  awaitingApproval: boolean
  locked: boolean
  /** The badge's truth: only ever true for an approved vendor who has toggled on. */
  showOnline: boolean
  label: 'Offline · Awaiting approval' | 'Online' | 'Offline'
}

export function deriveOnlineState(
  readiness: ReadinessLike | null,
  isOnline: boolean,
): OnlineState {
  const awaitingApproval = Boolean(readiness?.steps.find(s => s.key === 'application')?.waiting)
  const locked = readiness === null || awaitingApproval
  const showOnline = !locked && isOnline
  const label = awaitingApproval ? 'Offline · Awaiting approval' : showOnline ? 'Online' : 'Offline'
  return { awaitingApproval, locked, showOnline, label }
}
