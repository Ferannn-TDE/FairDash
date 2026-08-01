import { db } from './db'
import { organizerPortalState, type OrganizerPortalView } from './organizer-portal-state'

// ─── THE ONE ANSWER TO "MAY THIS PERSON ENTER PORTAL X, AND IN WHAT STATE?" ───────────────────
//
// ── THE CLASS THIS CLOSES ────────────────────────────────────────────────────────────────────
// That question had FOUR independent derivations, and they disagreed:
//   1. publicMetadata.roles[]        — what the navbar/landing DOORS rendered from
//   2. each portal layout's own DB check — the GATE, the only thing that actually admits
//   3. /api/auth/access               — a third answer, used by the login card
//   4. each door's boolean            — isVendor / isOrganizer / isRunner
// A door rendered from (1) linked to a gate enforced by (2), so an account could be shown
// "Vendor Dashboard" and then refused by it — measured live on 2026-08-01. And because
// lib/role-sync.ts unions `existing` unconditionally, an ungrounded role in roles[] is
// re-affirmed forever, so metadata can never be made trustworthy enough to be the door's source.
//
// This module is derivation ZERO: the gates CALL it. A predicate a gate merely agrees with is a
// fifth derivation, which is the bug rather than the fix — so if you add a portal here, wire its
// gate to it in the same change.
//
// ── STATE, NOT A BOOLEAN — and why the boolean could never work ──────────────────────────────
// "Row pending approval" lands an organizer on a GATE SCREEN but a runner on the FULL PORTAL
// (with a banner). One bit cannot express a difference the doors have to act on. Hence:
//
//   none     — no membership row. The gate refuses (resume screen, /become-driver, or denial).
//   pending  — a row exists, but the gate serves a non-portal screen instead of the portal.
//   active   — the gate admits. The portal renders.
//   blocked  — a row exists and the gate refuses for cause (rejected / suspended).
//
// ── EACH PORTAL'S STATE IS ITS GATE'S OWN LOGIC, NOT A TIDIER VERSION OF IT ──────────────────
// The three gates do NOT share a finish line, and flattening them would be a behaviour change
// wearing a refactor's clothes. What each one actually checks today:
//
//   VENDOR    — VendorMember existence, and nothing else. Vendor.status is NOT an input: a
//               PENDING vendor WITH a member row gets the full portal (with an honest banner,
//               app/vendor/[fairSlug]/dashboard/page.tsx). So vendor is never `pending` here —
//               that would misdescribe a vendor who is fully inside the portal.
//   ORGANIZER — OrgMember existence AND organizerPortalState (approval + suspension). This is
//               the only gate that refuses a row-holder, so it is the only source of `blocked`.
//   RUNNER    — Runner row existence, and nothing else. Approval is enforced at the VERBS
//               (app/api/runners/me:63 go-online, app/api/orders/[id]/status:163 claim), NOT at
//               the gate: a PENDING runner gets the full portal with a banner.
//
//               ⚠️ ASYMMETRY, DELIBERATELY LEFT UNRESOLVED: because approval is not a gate
//               input, runner never returns `pending` — a runner awaiting approval is `active`,
//               which is the truth about what the gate does. Moving approval into this function
//               would silently change who reaches the runner portal. That is a separate,
//               deliberate decision; this module reports the gates, it does not reform them.

export type PortalState = 'none' | 'pending' | 'active' | 'blocked'

/** The three doors' answer, in one object. Used by the door surface; see allPortalStates. */
export interface PortalStates {
  vendor: PortalState
  organizer: PortalState
  runner: PortalState
}

export const NO_PORTALS: PortalStates = { vendor: 'none', organizer: 'none', runner: 'none' }

/**
 * VENDOR — VendorMember existence. `active` or `none`, never `pending`/`blocked`.
 * @param userId DB User.id (NOT the Clerk id).
 */
export async function vendorPortalStatus(userId: string): Promise<{ state: PortalState }> {
  const member = await db.vendorMember.findFirst({ where: { userId }, select: { id: true } })
  return { state: member ? 'active' : 'none' }
}

/**
 * ORGANIZER — OrgMember existence plus the approval/suspension verdict. Returns the full
 * OrganizerPortalView too, because the gate renders its message and rejection reason verbatim
 * (that is the whole point of lib/organizer-portal-state.ts — the screen and the 403 cannot
 * drift). `view` is null only when there is no row.
 * @param userId DB User.id (NOT the Clerk id).
 */
export async function organizerPortalStatus(
  userId: string,
): Promise<{ state: PortalState; view: OrganizerPortalView | null }> {
  const orgMember = await db.orgMember.findFirst({
    where: { userId },
    select: {
      id: true,
      organizer: {
        select: {
          approvalStatus: true, rejectionReason: true,
          suspendedAt: true, suspendedReason: true,
        },
      },
    },
  })
  if (!orgMember) return { state: 'none', view: null }

  const view = organizerPortalState(orgMember.organizer)
  const state: PortalState =
    view.state === 'ACTIVE'   ? 'active'
    : view.state === 'AWAITING' ? 'pending'
    : 'blocked' // DECLINED | SUSPENDED — a row exists and the gate refuses it for cause
  return { state, view }
}

/**
 * RUNNER — Runner row existence. `active` or `none`; see the asymmetry note above for why
 * approval does not appear here. `eventSlug` is returned because callers route on it
 * (app/runner/page.tsx) — it is NOT part of the state decision.
 * @param userId DB User.id (NOT the Clerk id).
 */
export async function runnerPortalStatus(
  userId: string,
): Promise<{ state: PortalState; eventSlug: string | null }> {
  const runner = await db.runner.findUnique({
    where: { userId },
    select: { id: true, event: { select: { urlSlug: true } } },
  })
  if (!runner) return { state: 'none', eventSlug: null }
  return { state: 'active', eventSlug: runner.event?.urlSlug ?? null }
}

/**
 * All three, for the DOOR surface (/api/auth/access → RoleContext). Runs the three reads
 * concurrently — the doors need every portal's answer, whereas each gate needs exactly one.
 * @param userId DB User.id (NOT the Clerk id).
 */
export async function allPortalStates(userId: string): Promise<PortalStates> {
  const [vendor, organizer, runner] = await Promise.all([
    vendorPortalStatus(userId),
    organizerPortalStatus(userId),
    runnerPortalStatus(userId),
  ])
  return { vendor: vendor.state, organizer: organizer.state, runner: runner.state }
}

/**
 * DOOR POLICY — does a quick-nav link to this portal get rendered?
 *
 * THE CRITERION: no link to a portal while that account is still being served an onboarding,
 * resume, or gate screen. Once onboarding completes, the link is correct and wanted.
 *
 * `pending` is the only judgement call, and it is per-portal because the DESTINATION differs:
 *   • organizer pending → OrganizerGateScreen, NOT the portal → no link (a link there would be
 *     a promise the destination does not keep).
 *   • runner pending    → the real portal, with a banner → link is correct.
 * Runner cannot currently produce `pending` (see the asymmetry note), so that arm is written
 * for the policy rather than for a reachable state today. Kept explicit so the intent survives
 * if approval ever becomes a runner gate input — and so this policy can be overridden in ONE
 * edit, here, rather than in three call sites.
 */
export function shouldShowPortalDoor(portal: keyof PortalStates, state: PortalState): boolean {
  if (state === 'active') return true
  if (state === 'pending') return portal === 'runner'
  return false // none | blocked
}
