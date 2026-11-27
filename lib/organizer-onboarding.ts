// Where a signed-in person goes when they head for the organizer portal (sign-up-fixes commit 4).
// READ-ONLY by construction: it only looks for an organizer membership. Creating an organizer
// happens in exactly one place, POST /api/organizer/apply, when the sign-up form is submitted.
// Used by app/onboarding/page.tsx and app/organizer/layout.tsx; tested in
// scripts/organizer-apply-test.ts ("visiting /organizer with no record creates no record").

import { db } from './db'
import { organizerDraftScope } from './organizer-fair-context'
import { organizerAwaitingLines, organizerDecisionAddress } from './organizer-portal-state'

export const ORGANIZER_APPLY_PATH = '/onboarding/organizer'

/** 'portal' when the user already belongs to an organizer; otherwise 'apply' (the sign-up form). */
export async function organizerOnboardingDestination(userId: string): Promise<'portal' | 'apply'> {
  const member = await db.orgMember.findFirst({ where: { userId }, select: { id: true } })
  return member ? 'portal' : 'apply'
}

/** The "Application under review" lines for this organizer (app/organizer/layout.tsx). READ-ONLY.
 *  The email line uses the decision address (lib/approvals.ts's rule) and never looks at the email
 *  outbox, so it reads the same whether or not the per-address limit held the confirmation back
 *  (confirmation-email-safety, Nov 27). */
export async function organizerAwaitingLinesFor(organizerId: string): Promise<string[]> {
  const [org, draft] = await Promise.all([
    db.fairOrganizer.findUnique({
      where: { id: organizerId },
      select: {
        contactEmail: true,
        members: { where: { role: 'owner' }, orderBy: { createdAt: 'asc' }, take: 1, select: { user: { select: { email: true } } } },
      },
    }),
    db.event.findFirst({ where: organizerDraftScope(organizerId), orderBy: { createdAt: 'asc' }, select: { name: true } }),
  ])
  return organizerAwaitingLines({
    updatesTo: org ? organizerDecisionAddress(org.contactEmail, org.members[0]?.user.email) : null,
    draftEventName: draft?.name ?? null,
  })
}
