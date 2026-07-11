import type { Prisma } from '@prisma/client'
import { db } from './db'

/**
 * Build the WHERE clause that resolves a vendor route param — which may be a cuid
 * `id` OR a per-fair `slug` — to ONE vendor, unambiguously.
 *
 * WHY THIS EXISTS. Vendor.slug is unique PER FAIR, not globally (`@@unique([eventId,
 * slug])`). Before that was enforced, a bare `findFirst({ where: { slug } })`
 * happened to identify one vendor only because the live DB carried a legacy GLOBAL
 * unique index. The moment the constraint is relaxed to per-fair, that same query can
 * match the WRONG fair's vendor — a customer on /fair/A/vendor/randys-bbq could be
 * served Fair B's "randys-bbq". This is the single place that closes that gap:
 *
 *   - `id` branch  — cuid ids are globally unique, so ALWAYS unambiguous; no fair
 *                    needed. (This keeps every id-based caller — vendor lists, the
 *                    dashboard sub-routes — working unchanged.)
 *   - `slug` branch — only unique WITHIN a fair, so it is admitted ONLY when a fair
 *                     is known, scoped to that fair's event.
 *
 * A bare slug with no fair resolves to `{ id: param }` → no match → 404. That is the
 * correct, safe outcome: refuse to serve an arbitrary fair's vendor rather than guess.
 * Callers that pass a slug (the fair/organizer vendor pages) already have the fair in
 * their URL and pass it as `?fair=<fairSlug>`.
 */
export async function resolveVendorWhere(
  param: string,
  fairSlug?: string | null,
): Promise<Prisma.VendorWhereInput> {
  if (!fairSlug) return { id: param }

  const event = await db.event.findFirst({
    where: { urlSlug: fairSlug },
    select: { id: true },
  })
  // Unknown fair → fall back to id-only. Never widen to an unscoped slug match.
  if (!event) return { id: param }

  return { OR: [{ id: param }, { slug: param, eventId: event.id }] }
}
