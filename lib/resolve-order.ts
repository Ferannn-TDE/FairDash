import { Prisma } from '@prisma/client'
import { db } from './db'
import { ApiError } from './api-error'

/**
 * Resolve a user-supplied order identifier — full cuid OR the 8-char SHORT CODE a customer reads
 * off their screen ("26685PS7") — to a real order. The ONE place a raw order param is turned into
 * a lookup, so tolerance and disambiguation live in a single spot instead of being re-hand-rolled
 * (correctly at GET /orders/[id], incorrectly-absent at cancel/status/custody, which is what 404'd
 * a cancel: the page loads via the tolerant GET, then PATCHes the short code to a route that did
 * findUnique by primary key → no match → 404).
 *
 * The short code is `Order.id.slice(-8)`. cuid tails are effectively unique (measured: 377 orders,
 * 377 distinct tails, zero collisions), but "effectively" is not "provably", so a collision is
 * handled by FAILING LOUDLY — never by silently picking one order, which on a cancel/refund path
 * would act on the wrong customer's money. The ambiguity check is a `take: 2`: one match resolves,
 * two throws AmbiguousOrderCodeError (409), zero is a clean not-found.
 *
 * RESOLUTION ONLY. This function does not authorize, and it changes no refusal: callers keep their
 * own ownership checks and their own named 409s (the voided-order refusal, ORDER_VOIDED, etc.) on
 * the resolved row exactly as before. It also does not touch RE-READS keyed on an already-resolved
 * `order.id` — those hold a trusted canonical id and are correct as bare findUniques.
 */

const SHORT_CODE_MAX = 8

export class AmbiguousOrderCodeError extends ApiError {
  constructor(public shortCode: string) {
    // 409: the request is well-formed but cannot be resolved to a single order. Named so a
    // caller (and a log) can tell this apart from an ordinary not-found.
    super(`Order code "${shortCode}" matches more than one order — use the full order link`, 409, 'AMBIGUOUS_ORDER_CODE')
    this.name = 'AmbiguousOrderCodeError'
  }
}

/** True when `raw` is a short code (≤8 chars) rather than a full cuid. */
export function isOrderShortCode(raw: string): boolean {
  return raw.trim().length <= SHORT_CODE_MAX
}

/**
 * The disambiguation decision, pure and DB-free so it can be tested without seeding orders that
 * share a cuid tail (which random cuids won't let you force). `take: 2` from the caller means:
 * 0 rows → not found, 1 → resolved, ≥2 → ambiguous, THROW. Never returns one of several.
 */
export function disambiguate(matches: { id: string }[], shortCode: string): string | null {
  if (matches.length === 0) return null
  if (matches.length > 1) throw new AmbiguousOrderCodeError(shortCode)
  return matches[0].id
}

/**
 * Raw identifier → canonical cuid. `null` when nothing matches; throws AmbiguousOrderCodeError if a
 * short code matches more than one order. A full cuid is returned as-is (existence is confirmed by
 * the downstream fetch), so this stays a single cheap query on the short-code path and zero on the
 * full-id path.
 */
export async function resolveOrderId(raw: string): Promise<string | null> {
  const id = raw.trim()
  if (id.length > SHORT_CODE_MAX) return id
  const matches = await db.order.findMany({
    where: { id: { endsWith: id.toLowerCase() } },
    select: { id: true },
    take: 2,
  })
  return disambiguate(matches, id)
}

/**
 * Raw identifier → the order, fetched with the caller's own `select`/`include`. The primary
 * order-lookup for every route and lib that receives a raw order param. Returns `null` for
 * not-found so callers keep returning their existing 404; throws on an ambiguous short code.
 */
export async function resolveOrder<T extends Prisma.OrderDefaultArgs>(
  raw: string,
  args?: Prisma.Subset<T, Prisma.OrderDefaultArgs>,
): Promise<Prisma.OrderGetPayload<T> | null> {
  const canonical = await resolveOrderId(raw)
  if (canonical === null) return null
  return db.order.findUnique({ ...args, where: { id: canonical } }) as Promise<Prisma.OrderGetPayload<T> | null>
}
