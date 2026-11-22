// MENU-REQUEST ITEM VALIDATION — one rule set, applied per item, by BOTH write paths.
//
// A menu request arrives either as a single object (one ADD/EDIT/DELETE) or as a batch of
// items submitted together. Those are two shapes of the same thing, and if each carried its own
// validation they would drift: a price the single path refuses would land through the batch
// path, and nothing would report the disagreement. So the rules live here once and the route
// runs them per item over a list of length 1 or N.
//
// SHAPE OF A FAILURE. Every rule returns a rejection DESCRIPTOR rather than throwing, because a
// batch needs to say WHICH item failed. The route turns it into the response, prefixing the
// item's position when there is more than one. assertSafeImageUrl does throw (it is shared with
// the multipart upload paths, which want that), so it is caught here and converted — its status
// and code are preserved verbatim so a data:/blob: URL still answers exactly as it did before.
//
// NOT client-safe by accident: this imports lib/upload-limits, which is itself import-free for
// that reason. Unlike group-by-batch.ts it carries no isomorphism promise — nothing in the
// browser needs it.

import { UploadRejection, assertSafeImageUrl } from '../upload-limits'
import { parseInPersonPrice, clientPriceKey, CLIENT_PRICE_MESSAGE } from '../menu/price'

export const MENU_REQUEST_TYPES = ['ADD', 'EDIT', 'DELETE', 'RESTORE'] as const
export type MenuRequestTypeInput = (typeof MENU_REQUEST_TYPES)[number]

/**
 * Exhaustiveness check. Call it where every request type must be handled — the compiler
 * narrows the union to `never` only when nothing is left, so a FIFTH type added later fails
 * `tsc` at every such site instead of falling silently through to "do nothing".
 *
 * That silent fall-through is not hypothetical: adding RESTORE left the approval route's
 * ADD/EDIT/DELETE chain unmatched, which would have flipped a request to APPROVED having
 * written nothing — approval theatre, where organizer and vendor both believe the restore
 * happened. Making the missing case a BUILD failure is worth more than any guard that has to
 * remember to look.
 */
export function assertNeverRequestType(value: never): never {
  throw new Error(`Unhandled menu request type: ${String(value)}`)
}

/**
 * The most items one submission may carry.
 *
 * A SAFETY BOUND, NOT A PRODUCT LIMIT. A batch is written in a single transaction, so an
 * unbounded N is a lock-duration and denial-of-service risk — the cap exists to bound how long
 * that transaction holds its connection, and 50 creates in one transaction strains nothing.
 *
 * Sized against reality rather than guessed: the largest menu in the live database is 11 items
 * (SS. PETER & PAUL, 2026-08-28), with the next largest at 5. 50 is roughly four times the
 * biggest menu anyone has actually operated, so no real vendor should meet it — and the
 * over-limit message tells them to split the submission rather than failing opaquely, because
 * the one who does meet it needs a way forward, not a wall.
 */
export const MAX_BATCH_ITEMS = 50

/** One item as it arrives from the client. Deliberately `unknown` — this is untrusted input. */
export interface MenuRequestItemInput {
  type?: unknown
  menuItemId?: unknown
  name?: unknown
  description?: unknown
  price?: unknown
  category?: unknown
  prepTime?: unknown
  imageUrl?: unknown
  /** Sizes (H5 Fix B): rows sharing a variantGroup are one dish; variantLabel names the size. */
  variantGroup?: unknown
  variantLabel?: unknown
  /**
   * Withdrawing a waiting price increase (Step 12 finding 4): the id of the PENDING increase the
   * vendor saw. Checked here and in file-item.ts applyEdit; never stored on the request row.
   */
  withdrawsRequestId?: unknown
}

export const MAX_VARIANT_GROUP = 120
export const MAX_VARIANT_LABEL = 60

export interface ItemRejection {
  message: string
  status: number
  code: string
}

const reject = (message: string, status = 400, code = 'VALIDATION_ERROR'): ItemRejection =>
  ({ message, status, code })

/**
 * Validate ONE proposed menu change. Returns null when the item is acceptable, or the rejection
 * to answer with.
 *
 * These are the rules the single-object route has always applied, moved verbatim so that both
 * paths cannot disagree. Order matters only in that the most specific message wins.
 */
export function validateMenuRequestItem(item: MenuRequestItemInput): ItemRejection | null {
  const { type, menuItemId, name, price, category, imageUrl } = item

  // The online price is worked out by FairSynq from this in-person price and the event's markup
  // (audit H5, 2h). An item carrying onlinePrice / onlineMarkupBps / markup is refused.
  if (clientPriceKey(item)) return reject(CLIENT_PRICE_MESSAGE, 400, 'CLIENT_PRICE_NOT_ACCEPTED')

  // Plain wording: rejections are surfaced straight to the vendor via toast.error(...), and in
  // the batch form they arrive prefixed "Item 4: …". "type" is internal jargon (ADD/EDIT/DELETE)
  // that a vendor has no way to act on.
  if (!type) return reject('Each item needs a change type (add, edit, or remove)')
  if (typeof type !== 'string' || !(MENU_REQUEST_TYPES as readonly string[]).includes(type)) {
    return reject('Invalid type')
  }

  if (type === 'ADD' && (!name || price === undefined || !category)) {
    return reject('name, price, and category are required for ADD')
  }

  // The one price rule every write path shares (lib/menu/price.ts, audit H5): $1.00–$10,000,
  // at most 2 decimals.
  if (price !== undefined) {
    const parsed = parseInPersonPrice(price)
    if (!parsed.ok) return reject(parsed.message)
  }

  // EDIT, DELETE and RESTORE all name an EXISTING item; only ADD invents one.
  if (type !== 'ADD' && !menuItemId) {
    return reject(`menuItemId is required for ${type}`)
  }

  // WITHDRAWING A WAITING INCREASE (Step 12 finding 4, 2026-11-22). Optional. When sent it must name
  // the increase (non-empty text) and ride on an EDIT that carries a price: the withdraw button sends
  // the live price with it. Whether that increase is still the one waiting is checked under the
  // vendor lock in file-item.ts applyEdit (409 INCREASE_NOT_PENDING).
  const { withdrawsRequestId } = item
  if (withdrawsRequestId !== undefined) {
    if (typeof withdrawsRequestId !== 'string' || withdrawsRequestId.trim() === '') {
      return reject('The increase to withdraw is missing — reload the page and try again')
    }
    if (type !== 'EDIT' || price === undefined || price === null) {
      return reject('Only a price edit can withdraw a waiting increase')
    }
  }

  // SIZES (H5 Fix B). An ADD may carry both a group and a size label, or neither. An EDIT may
  // rename a size (variantLabel) but not move it to another dish (variantGroup). DELETE and
  // RESTORE act on an existing row as it is.
  const { variantGroup, variantLabel } = item
  const sizeText = (v: unknown, max: number, what: string): ItemRejection | null => {
    if (v === undefined || v === null) return null
    if (typeof v !== 'string' || v.trim() === '') return reject(`${what} must be text`)
    if (v.trim().length > max) return reject(`${what} must be at most ${max} characters`)
    return null
  }
  const groupBad = sizeText(variantGroup, MAX_VARIANT_GROUP, 'The item a size belongs to')
  if (groupBad) return groupBad
  const labelBad = sizeText(variantLabel, MAX_VARIANT_LABEL, 'The size name')
  if (labelBad) return labelBad
  const hasGroup = variantGroup !== undefined && variantGroup !== null
  const hasLabel = variantLabel !== undefined && variantLabel !== null
  if (type === 'ADD' && hasGroup !== hasLabel) {
    return reject('A size needs both the item it belongs to and its size name')
  }
  if (type === 'EDIT' && hasGroup) return reject('A size cannot be moved to a different item')
  if ((type === 'DELETE' || type === 'RESTORE') && (hasGroup || hasLabel)) {
    return reject(`Size details can't be changed on ${type === 'DELETE' ? 'a removal' : 'a restore'}`)
  }

  // A menu request is copied verbatim onto the MenuItem at approval time, so an unvalidated
  // imageUrl here is the same bypass one approval later. See lib/upload-limits.ts.
  try {
    assertSafeImageUrl(imageUrl)
  } catch (err) {
    if (err instanceof UploadRejection) return reject(err.message, err.statusCode, err.code)
    throw err
  }

  return null
}

export interface MenuRequestRowContext {
  vendorId: string
  requestedBy: string
  /** Null for a standalone request; the shared submission id for every row of a batch. */
  batchId: string | null
}

/**
 * The row a validated item becomes. Shared for the same reason the validation is: the single
 * and batch paths must persist an identical shape, and a field coerced in one place and not the
 * other is a divergence no test would notice.
 *
 * Call only on an item that validateMenuRequestItem() accepted.
 */
export function buildMenuRequestData(item: MenuRequestItemInput, ctx: MenuRequestRowContext) {
  const { type, menuItemId, name, description, price, category, prepTime, imageUrl, variantGroup, variantLabel } = item
  // Store the parsed value ("12.50" → 12.5), not a second Number() of the raw input.
  let storedPrice: number | null = null
  if (price !== undefined) {
    const parsed = parseInPersonPrice(price)
    if (!parsed.ok) throw new Error(`buildMenuRequestData called with an unvalidated price: ${parsed.message}`)
    storedPrice = parsed.value
  }
  return {
    vendorId: ctx.vendorId,
    requestedBy: ctx.requestedBy,
    batchId: ctx.batchId,
    type: type as MenuRequestTypeInput,
    menuItemId: (menuItemId as string | undefined) ?? null,
    name: (name as string | undefined) ?? null,
    description: (description as string | undefined) ?? null,
    price: storedPrice,
    category: (category as string | undefined) ?? null,
    prepTime: prepTime !== undefined ? Number(prepTime) : null,
    imageUrl: (imageUrl as string | undefined) ?? null,
    variantGroup: typeof variantGroup === 'string' ? variantGroup.trim() : null,
    variantLabel: typeof variantLabel === 'string' ? variantLabel.trim() : null,
  }
}
