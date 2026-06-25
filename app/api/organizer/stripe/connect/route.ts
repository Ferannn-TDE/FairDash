import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { assertStripeConfigured, createConnectedAccount } from '@/lib/stripe-connect'

// POST /api/organizer/stripe/connect
//
// Creates a V2 Express recipient connected account for the authenticated
// organizer and stores account.id on FairOrganizer.stripeAccountId. Idempotent:
// an existing account is returned as-is — never create duplicates.
//
// The account lives on the ORGANIZER (one account, reused across all their
// fairs), not per-event — so an organizer running multiple fairs onboards once.
//
// DESTINATIONS ONLY (Part B Phase B1): no transfer fires here — organizer
// payouts (per-event batch) are Phase B3.
export async function POST() {
  try {
    assertStripeConfigured()

    const { organizerId } = await requireOrganizerAuth()

    const organizer = await db.fairOrganizer.findUnique({
      where: { id: organizerId },
      select: { id: true, name: true, contactEmail: true, stripeAccountId: true },
    })
    if (!organizer) return apiError('Organizer not found', 404, 'NOT_FOUND')

    // Reuse an existing account — never create duplicates.
    if (organizer.stripeAccountId) {
      return success({ accountId: organizer.stripeAccountId, created: false })
    }

    const account = await createConnectedAccount({
      displayName: organizer.name,
      contactEmail: organizer.contactEmail,
    })

    await db.fairOrganizer.update({
      where: { id: organizer.id },
      data: { stripeAccountId: account.id },
    })

    return success({ accountId: account.id, created: true }, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
