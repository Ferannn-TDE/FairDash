import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { readEventTaxRates, updateEventTaxRates, TaxRateRefused } from '@/lib/event-tax-rates'
import { logger } from '@/lib/logger'

// GET   /api/admin/events/[id]/tax — the event's two tax rates + the last 20 changes
// PATCH same — change them: { salesTaxRate?, localTaxRate?, reason } (B1.19)
//
// ADMIN ONLY: rides requireAdminFairContext (strict admin: admin | super_admin), the same chokepoint as the money
// panel. Organizers have no route to these columns. The logic and the reason rule live in lib/event-tax-rates.ts.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)
    return success(await readEventTaxRates(db, event.id))
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    try {
      const out = await updateEventTaxRates(db, { eventId: event.id, body, actorId: adminClerkId, actorRole: 'admin' })
      // The checkout estimate reads the rates from the cached fair; the order route always re-reads them.
      revalidateTag('fair', 'default')
      logger.warn('[AdminTax] tax rates changed', { admin: adminClerkId, eventId: event.id, changed: out.changed })
      return success(out)
    } catch (e) {
      if (e instanceof TaxRateRefused) return apiError(e.message, 400, 'VALIDATION_ERROR', { field: e.field })
      throw e
    }
  } catch (err) {
    return handleApiError(err)
  }
}
