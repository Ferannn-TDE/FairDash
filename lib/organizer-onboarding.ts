// Where a signed-in person goes when they head for the organizer portal (sign-up-fixes commit 4).
// READ-ONLY by construction: it only looks for an organizer membership. Creating an organizer
// happens in exactly one place, POST /api/organizer/apply, when the sign-up form is submitted.
// Used by app/onboarding/page.tsx and app/organizer/layout.tsx; tested in
// scripts/organizer-apply-test.ts ("visiting /organizer with no record creates no record").

import { db } from './db'

export const ORGANIZER_APPLY_PATH = '/onboarding/organizer'

/** 'portal' when the user already belongs to an organizer; otherwise 'apply' (the sign-up form). */
export async function organizerOnboardingDestination(userId: string): Promise<'portal' | 'apply'> {
  const member = await db.orgMember.findFirst({ where: { userId }, select: { id: true } })
  return member ? 'portal' : 'apply'
}
