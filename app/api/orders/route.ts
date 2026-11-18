import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { currentUser } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { FulfillmentType, EventStatus, EventListing, VendorStatus, OrderStatus } from '@prisma/client'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'
import { demoVendorHidden, demoRefusalMessage, VENDOR_DEMO_CODE } from '@/lib/demo-vendor'
import { db } from '@/lib/db'
import { SELLABLE } from '@/lib/menu/on-menu'
import { stripe } from '@/lib/stripe'
import { validateDeliveryAddress } from '@/lib/delivery-address'
import { decideDeliveryRadius, googleGeocoder } from '@/lib/delivery-radius'
import { statementSuffix } from '@/lib/statement-descriptor'
import { deriveEventLiveState, formatEventDateRange } from '@/lib/event-date'
import { hasPreviewAccess } from '@/lib/preview-access'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { ensureDbUser } from '@/lib/ensure-db-user'
import { enforceRateLimit } from '@/lib/ratelimit'
import { checkoutRefusal } from '@/lib/checkout-floor'
import { checkoutTotals, fromCents, toCents } from '@/lib/checkout-total'
import { CLIENT_LINE_PRICE_KEYS, CLIENT_ORDER_TOTAL_KEYS, CLIENT_PRICE_MESSAGE, clientPriceKey } from '@/lib/menu/price'
import { MAX_QTY_PER_ITEM, MAX_ITEMS_PER_ORDER, QUANTITY_LIMIT_MESSAGE, ORDER_ITEM_LIMIT_MESSAGE } from '@/lib/order-limits'
import { logger } from '@/lib/logger'
import { effectiveFulfillment, isDeliveryEnabled } from '@/lib/delivery'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DELIVERY_FEE = 2.99

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  menuItemId: string
  vendorId: string
  quantity: number
  specialInstructions?: string
}

interface CreateOrderBody {
  eventId: string
  fulfillmentType: FulfillmentType
  items: CartItem[]
  customerName: string
  customerPhone: string
  tip?: number // dollars; runner-fulfilled orders only; 100% the runner's
  // The total the checkout page showed, in cents (audit H5, 2h). Required. If the server's total
  // differs, nothing is charged: 409 PRICE_CHANGED with the new total, for the customer to confirm.
  expectedTotalCents?: number
  // Curbside
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  // Home delivery — shape mirrors lib/delivery-address (DeliveryAddressInput)
  deliveryStreet?: string
  deliveryUnit?: string
  deliveryCity?: string
  deliveryState?: string
  deliveryZip?: string
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
//
// One cart → one PaymentIntent → one Order.
// Items from multiple vendors are accepted; each OrderItem carries its vendorId.
// Order.vendorId is set to the primary vendor (first item's vendor) for
// Firebase RTDB routing and vendor dashboard fallback queries.
//
// Flow:
//   1. Auth + body validation
//   2. DB validation — event active, all vendors online, items available
//   3. Re-price from DB (never trust frontend prices)
//   4. Resolve user record (upsert stub if Clerk webhook hasn't fired yet)
//   5. Create single Stripe PaymentIntent for combined total
//   6. Write Order + OrderItems atomically
//   7. Patch PI metadata with orderId (best-effort)
//   8. Firebase RTDB push to each vendor's path (best-effort)
//   9. Schedule accept-timeout job for primary vendor
//  10. Return { orderId, clientSecret, summary }

export async function POST(req: NextRequest) {
  try {
    // Per USER, not per IP (readiness 1.7): at a fair, a crowd on venue Wi-Fi or one carrier IP
    // shared a single 10/min bucket. Auth first so the key is the person.
    const clerkId = await requireAuth()
    const { allowed, headers: rlHeaders } = await enforceRateLimit(`order:${clerkId}`, 'orderCreate', { failClosed: true })
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
        { status: 429, headers: rlHeaders }
      )
    }

    // ── 1. Parse + validate body ───────────────────────────────────────────
    const body: CreateOrderBody = await req.json()
    const {
      eventId,
      fulfillmentType,
      items,
      customerName,
      customerPhone,
      vehicleMake,
      vehicleColor,
      vehiclePlate,
      deliveryStreet,
      deliveryUnit,
      deliveryCity,
      deliveryState,
      deliveryZip,
      tip: tipInput,
      expectedTotalCents,
    } = body

    if (!eventId || !fulfillmentType || !customerName || !customerPhone) {
      throw new ApiError(
        'eventId, fulfillmentType, customerName, and customerPhone are required',
        400,
        'VALIDATION_ERROR'
      )
    }

    if (!Array.isArray(items) || items.length === 0) {
      return apiError('Cart is empty', 400, 'VALIDATION_ERROR')
    }
    if (items.length > 20) {
      return apiError('Cart cannot exceed 20 items', 400, 'VALIDATION_ERROR')
    }
    // Prices are worked out here from the database (audit H5, 2h). A body or cart line that
    // carries a price, a total or a markup is refused, not silently ignored (review F8).
    if (clientPriceKey(body, CLIENT_ORDER_TOTAL_KEYS)) {
      return apiError(CLIENT_PRICE_MESSAGE, 400, 'CLIENT_PRICE_NOT_ACCEPTED')
    }
    for (const item of items as unknown[]) {
      // Each cart line must be a plain object: null, a string, a number or an array used to reach
      // item.menuItemId below and crash with a 500.
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        return apiError('Invalid item in cart', 400, 'VALIDATION_ERROR')
      }
      if (clientPriceKey(item, CLIENT_LINE_PRICE_KEYS)) {
        return apiError(CLIENT_PRICE_MESSAGE, 400, 'CLIENT_PRICE_NOT_ACCEPTED')
      }
    }
    // QUANTITY (Jordan, Nov 17; lib/order-limits.ts): each line a whole number of at least 1 (review
    // F9: 1.5 or "2" used to reach the calculator and give a 500), and at most MAX_ITEMS_PER_ORDER
    // in all. The per-item limit counts every size of a dish together, so it needs each line's
    // variantGroup: it is checked right after the menu items are read (step 2 below), still before
    // anything is written or sent to Stripe.
    let totalQty = 0
    for (const item of items) {
      if (!item.menuItemId || typeof item.menuItemId !== 'string') {
        return apiError('Invalid item in cart', 400, 'VALIDATION_ERROR')
      }
      const quantity: unknown = item.quantity
      if (!(typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1)) {
        return apiError('Invalid quantity', 400, 'VALIDATION_ERROR')
      }
      if (!item.vendorId || typeof item.vendorId !== 'string') {
        return apiError('Invalid vendorId in cart item', 400, 'VALIDATION_ERROR')
      }
      totalQty += quantity
    }
    if (totalQty > MAX_ITEMS_PER_ORDER) {
      return apiError(ORDER_ITEM_LIMIT_MESSAGE, 400, 'ORDER_ITEM_LIMIT')
    }

    if (!Object.values(FulfillmentType).includes(fulfillmentType)) {
      throw new ApiError(`Invalid fulfillmentType: ${fulfillmentType}`, 400, 'VALIDATION_ERROR')
    }

    if (fulfillmentType === FulfillmentType.CURBSIDE && (!vehicleMake || !vehicleColor)) {
      throw new ApiError(
        'vehicleMake and vehicleColor are required for CURBSIDE orders',
        400,
        'VALIDATION_ERROR'
      )
    }

    if (fulfillmentType === FulfillmentType.HOME_DELIVERY) {
      // ONE rule, shared with the checkout form (lib/delivery-address) — the form validates
      // through the same function, so it cannot build a payload this route rejects. That
      // dead-end is exactly what shipped when the form stopped fabricating a city: the route
      // required one, the form had no city input, and the customer got an unclearable 400.
      const addressErrors = validateDeliveryAddress({
        street: deliveryStreet, unit: deliveryUnit, city: deliveryCity, state: deliveryState, zip: deliveryZip,
      })
      if (addressErrors.length > 0) {
        // Field-named, so a client can attach each message to its own input instead of
        // showing one opaque "failed to create order".
        throw new ApiError(
          addressErrors.map(e => e.message).join('; '),
          400,
          'VALIDATION_ERROR',
          { fields: addressErrors },
        )
      }
    }

    // ── 2. DB validation ───────────────────────────────────────────────────

    const event = await db.event.findFirst({
      // No new orders (money-in) into a soft-deleted fair. Existing orders still
      // settle via the INCLUDE-archived payout/reconciler paths.
      where: { id: eventId, archivedAt: null },
      include: { fulfillmentConfig: true },
    })

    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    // A sign-up-only event never takes an order, at any status. In addition to the status
    // check below, never instead of it (lib/event-listing.ts).
    if (event.listing === EventListing.SIGNUP_ONLY) {
      throw new ApiError('This event does not take orders', 409, 'EVENT_SIGNUP_ONLY')
    }

    if (event.status !== EventStatus.ACTIVE) {
      throw new ApiError('This event is not currently active', 409, 'EVENT_INACTIVE')
    }

    // ── The fair must be OPEN, not merely ENABLED ────────────────────────────────
    // Event.status is the organizer's enablement flag; it says nothing about whether the fair
    // is happening today. Until now this route accepted an order for an ACTIVE fair starting
    // in twelve days — while the storefront said "Upcoming". Two answers to "is the fair
    // open", and the API's answer was the one that took money.
    //
    // Both must hold: enabled (above) AND inside the run (here), from the SAME
    // deriveEventLiveState the badges and the storefront gate use — one derivation, not a
    // second date comparison that can drift from it.
    const liveState = deriveEventLiveState(event.startDate, event.endDate)
    if (liveState !== 'live') {
      // The preview bypass, honoured SERVER-SIDE through the same two-condition decision as the
      // storefront (env flag + strict-admin session) — so testing still works before Aug 5 and
      // nothing else gets through. Checked only when the fair is closed, so the ordinary
      // customer path costs no auth lookup.
      const previewing = await hasPreviewAccess()
      if (!previewing) {
        const runs = formatEventDateRange(event.startDate, event.endDate)
        throw new ApiError(
          liveState === 'upcoming'
            ? `${event.name} isn't open for orders yet — it runs ${runs}.`
            : `${event.name} has ended — it ran ${runs}.`,
          409,
          'FAIR_NOT_OPEN',
        )
      }
    }

    if (event.isPaused) {
      throw new ApiError(
        'Ordering is temporarily paused — please try again shortly',
        503,
        'PLATFORM_PAUSED'
      )
    }

    // What a customer can actually choose (lib/delivery.ts): home delivery needs the platform
    // switch AND the event's flag; a fair with NO config offers booth pickup only. This used to be
    // `if (config) { … }`, so a config-less fair accepted every mode, delivery included.
    const config = event.fulfillmentConfig
    const offered = effectiveFulfillment(await isDeliveryEnabled(), config)
    const enabledMap: Record<FulfillmentType, boolean> = {
      BOOTH_PICKUP: offered.boothPickupEnabled,
      CURBSIDE: offered.curbsideEnabled,
      HOME_DELIVERY: offered.homeDeliveryEnabled,
    }
    if (!enabledMap[fulfillmentType]) {
      throw new ApiError(
        `${fulfillmentType} is not enabled for this event`,
        409,
        'FULFILLMENT_DISABLED'
      )
    }

    // Validate all unique vendors are active and belong to this event
    const uniqueVendorIds = [...new Set(items.map(i => i.vendorId))]
    const vendors = await db.vendor.findMany({
      where: { id: { in: uniqueVendorIds } },
      // READINESS COUNTS ITEMS THAT ARE ACTUALLY ON THE MENU. `...ON_MENU` excludes removed
      // items, which has a real consequence worth stating: a vendor who removes their LAST
      // available item drops below the readiness bar and goes offline to customers. That is
      // correct — a booth with nothing live should not be orderable — but it is a state change
      // that happens as a SIDE EFFECT of a removal, so it is asserted by the removal guard
      // rather than left to surface as "why did I vanish mid-fair?".
      include: { _count: { select: { menuItems: { where: SELLABLE } } } },
    })

    if (vendors.length !== uniqueVendorIds.length) {
      const found = new Set(vendors.map(v => v.id))
      const missing = uniqueVendorIds.filter(id => !found.has(id))
      throw new ApiError(`Vendor(s) not found: ${missing.join(', ')}`, 404, 'VENDOR_NOT_FOUND')
    }

    for (const vendor of vendors) {
      if (vendor.eventId !== eventId) {
        throw new ApiError(
          `Vendor ${vendor.id} does not belong to this event`,
          400,
          'VENDOR_EVENT_MISMATCH'
        )
      }
      if (vendor.status !== VendorStatus.ACTIVE) {
        throw new ApiError(
          `${vendor.name} is not currently accepting orders`,
          409,
          'VENDOR_INACTIVE'
        )
      }
      // DEMO BOOTH (Jordan, Nov 16; lib/demo-vendor.ts): never a real order. With live Stripe keys
      // (anything not sk_test_/rk_test_, lib/stripe-mode.ts) it is refused here — before the price
      // check, any write and any Stripe call. In test mode it takes test orders normally.
      if (demoVendorHidden(vendor)) {
        throw new ApiError(demoRefusalMessage(vendor.name), 409, VENDOR_DEMO_CODE)
      }
      if (vendor.isOffline) {
        throw new ApiError(`${vendor.name} is currently offline`, 409, 'VENDOR_OFFLINE')
      }
      // Phase 5 order backstop: when enforcement is on, reject an unready vendor
      // (no Stripe / no available menu) — BEFORE any PaymentIntent is created
      // below, so there's no charge and no half-order. Belt to the visibility
      // gates' suspenders. OFF by default → unchanged. Shared predicate.
      if (isVendorReadinessEnforced() &&
          !vendorReady({ status: vendor.status, stripeVerified: vendor.stripeVerified, availableMenuCount: vendor._count.menuItems })) {
        throw new ApiError(`${vendor.name} is not currently accepting orders`, 409, 'VENDOR_NOT_READY')
      }
      if (vendor.isBusy && vendor.busyUntil && vendor.busyUntil > new Date()) {
        throw new ApiError(
          `${vendor.name} is currently busy — please try again in a few minutes`,
          409,
          'VENDOR_BUSY'
        )
      }
    }

    // Validate all menu items exist and belong to their stated vendor
    const menuItemIds = items.map(i => i.menuItemId)
    const dbMenuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    })

    const menuItemMap = new Map(dbMenuItems.map(m => [m.id, m]))
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)
      if (!mi) {
        throw new ApiError(
          `Menu item not found: ${item.menuItemId}`,
          404,
          'MENU_ITEM_NOT_FOUND'
        )
      }
      if (mi.vendorId !== item.vendorId) {
        throw new ApiError(
          `Menu item ${mi.name} does not belong to the specified vendor`,
          400,
          'MENU_ITEM_VENDOR_MISMATCH'
        )
      }
      // REMOVED IS CHECKED BEFORE SOLD-OUT, and answers differently. A cart lives in the
      // customer's localStorage and can name an item taken off the menu days ago; telling them
      // it is "currently unavailable" would promise it comes back. The lookup above is
      // deliberately NOT filtered on removedAt — resolving the row is what lets us say which
      // item is gone by name instead of returning an opaque MENU_ITEM_NOT_FOUND.
      if (mi.removedAt !== null) {
        throw new ApiError(
          `${mi.name} is no longer on the menu`,
          409,
          'ITEM_REMOVED'
        )
      }
      if (!mi.isAvailable) {
        throw new ApiError(
          `${mi.name} is currently unavailable`,
          409,
          'ITEM_UNAVAILABLE'
        )
      }
    }

    // ONE DISH, ALL ITS SIZES (Jordan, Nov 17): sizes are separate menu items that share a
    // variantGroup within a vendor (prisma/schema.prisma, MenuItem.variantGroup), so the
    // MAX_QTY_PER_ITEM limit is counted per vendor + variantGroup; a standalone item counts alone,
    // and the same item on two lines adds up. 3 Small + 2 Large = 5, allowed; 3 Small + 3 Large = 6,
    // refused. Uses the rows read above: no extra query, and still before any write or Stripe call.
    const qtyPerDish = new Map<string, number>()
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)
      if (!mi) continue // unreachable: the loop above refused a missing item
      const dish = mi.variantGroup ? `group|${mi.vendorId}|${mi.variantGroup}` : `item|${mi.id}`
      const forDish = (qtyPerDish.get(dish) ?? 0) + item.quantity
      if (forDish > MAX_QTY_PER_ITEM) {
        throw new ApiError(QUANTITY_LIMIT_MESSAGE, 400, 'QUANTITY_LIMIT')
      }
      qtyPerDish.set(dish, forDish)
    }

    // ── 3. Re-price from DB ────────────────────────────────────────────────
    const vendorMap = new Map(vendors.map(v => [v.id, v]))

    // ONLINE PRICE (audit H5, 2h): each unit is charged the event's online price, worked out here
    // from the in-person MenuItem.price and Event.onlineMarkupBps. Never from the client.
    const markupBps = event.onlineMarkupBps
    const pricedLines = items.map(cartItem => {
      const mi = menuItemMap.get(cartItem.menuItemId)
      const vendor = vendorMap.get(cartItem.vendorId)
      if (!mi || !vendor) {
        // Should be unreachable — validation above guarantees both exist
        throw new ApiError(
          `Internal pricing error for item ${cartItem.menuItemId}`,
          500,
          'PRICING_ERROR'
        )
      }
      return { cartItem, mi }
    })

    // The applicable runner-fulfilled fee (delivery OR curbside), server-derived
    // from config — never client-supplied. Stored in Order.deliveryFee (the fee
    // line the reconciler already understands). Null for booth pickup.
    const deliveryFeeCents: number | null =
      fulfillmentType === FulfillmentType.HOME_DELIVERY
        ? toCents(config?.homeDeliveryFee ?? DEFAULT_DELIVERY_FEE)
        : fulfillmentType === FulfillmentType.CURBSIDE
          ? toCents(config?.curbsideFee ?? 0)
          : null
    const deliveryFee: number | null = deliveryFeeCents === null ? null : fromCents(deliveryFeeCents)

    // Tip: runner-fulfilled orders only (delivery + curbside). 100% the runner's;
    // no service fee, no split. Forced to 0 for booth pickup (ignore client input).
    const isRunnerFulfilled =
      fulfillmentType === FulfillmentType.HOME_DELIVERY ||
      fulfillmentType === FulfillmentType.CURBSIDE
    if (tipInput != null && (!Number.isFinite(tipInput) || tipInput < 0)) {
      throw new ApiError('Invalid tip amount', 400, 'VALIDATION_ERROR')
    }
    // Cents through the same toCents() the checkout page uses (lib/checkout-total.ts), so a custom
    // tip like 3.335 is the same amount on both sides.
    const tipCents = isRunnerFulfilled && tipInput && tipInput > 0 ? toCents(tipInput) : 0
    const tip = fromCents(tipCents)

    const serviceChargeCents =
      event.serviceChargeEnabled && event.serviceChargeAmount
        ? toCents(event.serviceChargeAmount)
        : 0
    const serviceCharge = fromCents(serviceChargeCents)

    // ── Fee model ──────────────────────────────────────────────────────────
    // FairSynq's sole revenue is the 10% service fee charged to the CUSTOMER on
    // top of the food, computed on the IN-PERSON subtotal (serviceFeeBase), NOT on
    // the online subtotal: the online markup is vendor revenue and carries no fee
    // (audit H5, 2h). The fee is kept CLEAN (Stripe fees do NOT come out of it).
    // Vendors absorb the Stripe processing fee: each vendor receives their
    // subtotal slice minus their proportional share of the real settled fee.
    // That per-vendor math runs in the PAYOUT WORKER at fulfillment, when the
    // balance transaction has settled — NOT here and NOT at placement.
    //
    // `fairSynqFee` records FairSynq's revenue (= the service fee) for dashboards.
    // `vendorPayout` is NOT meaningful per-order under multi-vendor; the real
    // per-vendor payout amounts are recorded as Payout rows by the worker. We
    // store 0 on the draft (column is non-null) — do not read it for payouts.
    //
    // THE ONE CALCULATION (lib/checkout-total.ts), shared with the checkout page:
    //   subtotal       = Σ online unit × qty  (what the customer pays for food; vendors are paid on it,
    //                    so the markup is vendor revenue)
    //   serviceFeeBase = Σ in-person unit × qty; serviceFee = 10% of serviceFeeBase (audit H5, 2h),
    //                    never 10% of the online subtotal
    //   total          = subtotal + serviceFee + deliveryFee + serviceCharge + tip (5-term money
    //                    identity; the fee is never on the markup, delivery fee, service charge or tip)
    const totals = checkoutTotals({
      lines: pricedLines.map(({ cartItem, mi }) => ({ inPersonCents: toCents(mi.price), quantity: cartItem.quantity })),
      markupBps,
      deliveryFeeCents: deliveryFeeCents ?? 0,
      serviceChargeCents,
      tipCents,
    })

    const lineItems = pricedLines.map(({ cartItem, mi }, i) => {
      const unitPrice = fromCents(totals.unitCents[i])
      const lineSubtotal = fromCents(totals.lineCents[i])
      return {
        menuItemId: cartItem.menuItemId,
        itemName: mi.name,
        vendorId: cartItem.vendorId,
        quantity: cartItem.quantity,
        specialInstructions: cartItem.specialInstructions ?? null,
        unitPrice, // the ONLINE unit price the customer pays
        inPersonUnitPrice: mi.price, // snapshot: the booth price at checkout
        totalPrice: lineSubtotal,
        subtotal: lineSubtotal,
      }
    })

    const subtotal = fromCents(totals.onlineSubtotalCents)
    const serviceFeeBase = fromCents(totals.feeBaseCents)
    const serviceFee = fromCents(totals.serviceFeeCents)
    const fairSynqFee = serviceFee
    const vendorPayout = 0
    const total = fromCents(totals.totalCents)
    const itemCount = lineItems.reduce((sum, i) => sum + i.quantity, 0)

    // ── Checkout floor (audit H5, Step 2b) ─────────────────────────────────────
    // No food, food smaller than the estimated card fee on the full charge, or a charge under
    // Stripe's $0.50 minimum. Refused HERE, before the user upsert, the Stripe call and the order
    // transaction below, so a refused order writes nothing and charges nothing. See
    // lib/checkout-floor.ts. totalCents is computed exactly as the PaymentIntent amount is.
    // Uses the ONLINE food subtotal (what the customer pays and the vendors are paid on).
    const floorRefusal = checkoutRefusal({ subtotalCents: totals.onlineSubtotalCents, totalCents: totals.totalCents })
    if (floorRefusal) throw new ApiError(floorRefusal.message, 400, floorRefusal.code)

    // ── Never charge more than the customer saw (audit H5, 2h) ─────────────────────
    // The checkout page sends the total it showed, computed with the same checkoutTotals(). Any
    // difference (an organizer or admin changed the markup, a vendor changed a price, a fee changed)
    // is refused HERE — after the floor, before the user upsert, the Stripe call and the order
    // transaction — so nothing is written and nothing is charged. The page shows the new total and
    // the customer confirms before paying. Missing → 400 (Batch 1 merge checklist).
    if (typeof expectedTotalCents !== 'number' || !Number.isInteger(expectedTotalCents) || expectedTotalCents < 0) {
      throw new ApiError('expectedTotalCents (the total shown to the customer, in cents) is required', 400, 'VALIDATION_ERROR')
    }
    if (expectedTotalCents !== totals.totalCents) {
      throw new ApiError(
        `Prices updated — new total $${total.toFixed(2)}`,
        409,
        'PRICE_CHANGED',
        {
          newTotal: total,
          newTotalCents: totals.totalCents,
          expectedTotalCents,
          breakdown: {
            subtotal,
            serviceFee,
            deliveryFee,
            serviceCharge: serviceCharge > 0 ? serviceCharge : null,
            tip: tip > 0 ? tip : null,
            total,
            onlineMarkupBps: markupBps,
            lines: lineItems.map(l => ({ menuItemId: l.menuItemId, vendorId: l.vendorId, quantity: l.quantity, unitPrice: l.unitPrice })),
          },
        },
      )
    }

    // Primary vendor — first item's vendor (used for Order.vendorId and RTDB routing)
    const primaryVendorId = items[0].vendorId

    // ── 4. Resolve user in DB ──────────────────────────────────────────────
    let dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) {
      const clerkUser = await currentUser()
      // ensureDbUser, NOT a bare upsert — see lib/ensure-db-user.ts. `email` is @unique, so
      // the old create-on-miss died with P2002 whenever another row already owned the
      // address. syncProfile:false preserves this site's original `update: {}` semantics:
      // an existing row's profile is never overwritten from a checkout.
      const ensured = await ensureDbUser(
        clerkId,
        {
          email:
            clerkUser?.emailAddresses?.[0]?.emailAddress ??
            `${clerkId}@pending.invalid`,
          name: clerkUser?.firstName
            ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`.trim()
            : undefined,
          phone: clerkUser?.phoneNumbers?.[0]?.phoneNumber ?? undefined,
        },
        { syncProfile: false },
      )
      dbUser = ensured.user
    }

    // ── 5. Create single Stripe PaymentIntent ──────────────────────────────
    if (
      !process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY === 'sk_test_placeholder'
    ) {
      throw new ApiError(
        'Payment processing is not configured — contact support',
        503,
        'STRIPE_NOT_CONFIGURED'
      )
    }

    // Per-vendor subtotal breakdown (cents) — lets the payout worker / Stripe
    // dashboard see the split source without trusting the client. The worker is
    // authoritative from the DB; this is belt-and-suspenders.
    //
    // ⚠️ N IS BOUNDED BY MAX_ITEMS_PER_ORDER (lib/order-limits.ts: 15 items, so at most 15 vendors) and the 20-line cap above, NOT by a vendor cap.
    // This comment used to claim "Max 5 vendors/order keeps this well under Stripe's 500-char
    // metadata value limit" — but MAX_VENDORS_PER_ORDER is DEAD (lib/constants.ts:157; its only
    // appearance in the repo is its own definition), so nothing enforces 5. Since each vendor
    // needs at least one item, the real bound is N ≤ 20.
    //
    // BOTH N-scaling metadata values overflow before that bound: with 25-char cuids,
    // `vendorSubtotalCents` passes 500 chars at N=15 and `vendorIds` at N=20. Stripe then
    // rejects the PaymentIntent. That FAILS CLOSED — paymentIntents.create (:465) throws before
    // any Order row or money exists, so it is a broken checkout, never a money bug. Measured
    // 2026-08-11; the largest multi-vendor order ever placed is N=4 (and N=2 for every in-model
    // one), so the reachable N=15..20 band has never been approached.
    //
    // IF N EVER MATTERS, the fix is to DROP vendorSubtotalCents from PI metadata — not to add a
    // cap. The worker is authoritative from the DB (above), so this value is belt-and-suspenders;
    // removing it deletes the only failure mode that scales with N, and is strictly simpler than
    // enforcing a limit. See CURRENT_STATE §7.
    const vendorSubtotalCents: Record<string, number> = {}
    for (const l of lineItems) {
      vendorSubtotalCents[l.vendorId] = (vendorSubtotalCents[l.vendorId] ?? 0) + Math.round(l.subtotal * 100)
    }

    // Separate charges & transfers: charge the FULL amount to the platform and
    // tag it with a transfer_group. The charge inherits this group, so the
    // worker reads charge.transfer_group and stamps it on each per-vendor
    // transfer (binding is via source_transaction = the charge id).
    const transferGroup = `order_grp_${globalThis.crypto.randomUUID()}`

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      transfer_group: transferGroup,
      // NOTE: deliberately NO transfer_data.destination / application_fee_amount —
      // those are for DESTINATION charges. We use separate charges & transfers.
      metadata: {
        primaryVendorId,
        eventId,
        customerId: dbUser.id,
        fulfillmentType,
        fairSynqFee: fairSynqFee.toFixed(2),
        serviceFee: serviceFee.toFixed(2),
        serviceFeeBase: serviceFeeBase.toFixed(2),
        onlineMarkupBps: String(markupBps),
        deliveryFee: (deliveryFee ?? 0).toFixed(2),
        serviceCharge: serviceCharge.toFixed(2),
        tip: tip.toFixed(2),
        vendorIds: uniqueVendorIds.join(','),
        vendorSubtotalCents: JSON.stringify(vendorSubtotalCents),
      },
    }

    // Card statement: "FAIRSYNQ* ITALIAN FEST" (readiness 1.6). Already cleaned to Stripe's rules;
    // when nothing usable is left the field is omitted and the prefix stands alone, because a
    // suffix Stripe rejects would fail this create, and with it the checkout.
    const statementDescriptorSuffix = statementSuffix(event)
    if (statementDescriptorSuffix) piParams.statement_descriptor_suffix = statementDescriptorSuffix

    // ── Delivery radius — the LAST check before money exists ─────────────────────
    // Server geocode of the stored address, straight-line distance from the fair, fail closed on
    // missing config or an unreachable geocoder (lib/delivery-radius). Placed after every other
    // validation so a geocode is only spent on an otherwise-valid order, and before
    // paymentIntents.create so an out-of-range order never charges anyone. The stored
    // coordinates come from THIS decision, never from the request body.
    let deliveryGeo: { lat: number; lng: number; precision: string } | null = null
    if (fulfillmentType === FulfillmentType.HOME_DELIVERY) {
      const radius = await decideDeliveryRadius(
        { eventLat: event.eventLat, eventLng: event.eventLng, homeDeliveryRadiusKm: config?.homeDeliveryRadiusKm ?? null },
        { street: deliveryStreet!.trim(), city: deliveryCity!.trim(), state: deliveryState?.trim() || null, zip: deliveryZip!.trim() },
        googleGeocoder,
      )
      if (!radius.ok) {
        if (radius.code === 'GEOCODER_UNAVAILABLE' || radius.code === 'DELIVERY_NOT_CONFIGURED') {
          logger.error('[orders] home delivery refused', { eventId, code: radius.code, reason: radius.reason })
        }
        throw new ApiError(radius.message, radius.status, radius.code)
      }
      deliveryGeo = { lat: radius.point.lat, lng: radius.point.lng, precision: radius.point.precision }
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams)

    // ── 6. Write Order + OrderItems + VendorOrderStatuses atomically ──────────
    const order = await db.$transaction(async tx => {
      const created = await tx.order.create({
        data: {
          eventId,
          customerId: dbUser!.id,
          vendorId: primaryVendorId,
          status: OrderStatus.PENDING_PAYMENT,
          fulfillmentType,
          subtotal,
          deliveryFee,
          tip: tip > 0 ? tip : null,
          serviceCharge: serviceCharge > 0 ? serviceCharge : null,
          total,
          fairSynqFee,
          vendorPayout,
          // Snapshots (audit H5, 2h): the in-person base the fee used, and the markup in force.
          serviceFeeBase,
          onlineMarkupBps: markupBps,
          customerName,
          customerPhone,
          vehicleMake: vehicleMake ?? null,
          vehicleColor: vehicleColor ?? null,
          vehiclePlate: vehiclePlate ?? null,
          // NEVER a fabricated stand-in — a missing optional field is stored NULL. (The old
          // `deliveryZip || '00000'` on the client is gone; see lib/delivery-address.)
          deliveryStreet: deliveryStreet?.trim() || null,
          deliveryUnit: deliveryUnit?.trim() || null,
          deliveryCity: deliveryCity?.trim() || null,
          deliveryState: deliveryState?.trim().toUpperCase() || null,
          deliveryZip: deliveryZip?.trim() || null,
          deliveryLat: deliveryGeo?.lat ?? null,
          deliveryLng: deliveryGeo?.lng ?? null,
          deliveryGeoPrecision: deliveryGeo?.precision ?? null,
          stripePaymentIntentId: paymentIntent.id,
          orderItems: {
            create: lineItems.map(item => ({
              menuItemId: item.menuItemId,
              itemName: item.itemName,
              vendorId: item.vendorId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              inPersonUnitPrice: item.inPersonUnitPrice,
              totalPrice: item.totalPrice,
              subtotal: item.subtotal,
              specialInstructions: item.specialInstructions,
            })),
          },
        },
        include: {
          orderItems: {
            include: {
              menuItem: { select: { name: true } },
              vendor: { select: { name: true } },
            },
          },
        },
      })

      // NOTE: VendorOrderStatus rows are intentionally NOT created here. They are
      // created by placePaidOrder() only after payment succeeds, so unpaid /
      // abandoned checkouts never appear on a vendor's dashboard.
      return created
    })

    // Invalidate cached recent orders for this customer
    revalidateTag(`orders-${dbUser.id}`, 'default')

    // ── 7. Patch PI metadata with orderId (best-effort) ────────────────────
    stripe.paymentIntents
      .update(paymentIntent.id, {
        metadata: { ...paymentIntent.metadata, orderId: order.id },
      })
      .catch(err =>
        logger.error('[Orders] Failed to patch PI metadata with orderId', { error: String(err) })
      )

    // NOTE: No Firebase push and no accept-timeout job here. Both are
    // vendor-visible side-effects and run only once payment succeeds, via
    // placePaidOrder() (called from the Stripe webhook and the client confirm
    // path). This is what prevents phantom orders from unpaid checkouts.

    // ── 8. Return to frontend ──────────────────────────────────────────────
    return success(
      {
        orderId: order.id,
        shortId: order.id.slice(-8).toUpperCase(),
        clientSecret: paymentIntent.client_secret,
        summary: {
          subtotal,
          deliveryFee,
          serviceCharge: serviceCharge > 0 ? serviceCharge : null,
          tip: tip > 0 ? tip : null,
          fairSynqFee,
          serviceFee,
          serviceFeeBase,
          onlineMarkupBps: markupBps,
          total,
          itemCount,
          fulfillmentType,
        },
      },
      201
    )
  } catch (err) {
    return handleApiError(err)
  }
}
