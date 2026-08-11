import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { currentUser } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { FulfillmentType, EventStatus, VendorStatus, OrderStatus } from '@prisma/client'
import { isVendorReadinessEnforced, vendorReady } from '@/lib/vendor-readiness'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { validateDeliveryAddress } from '@/lib/delivery-address'
import { deriveEventLiveState, formatEventDateRange } from '@/lib/event-date'
import { hasPreviewAccess } from '@/lib/preview-access'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { ensureDbUser } from '@/lib/ensure-db-user'
import { enforceRateLimit } from '@/lib/ratelimit'
import { calculateServiceFee } from '@/lib/constants'
import { logger } from '@/lib/logger'

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
    const ip = req.headers.get('x-forwarded-for') ?? 'anonymous'
    const { allowed, headers: rlHeaders } = await enforceRateLimit(ip, 'orderCreate', { failClosed: true })
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: { message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } },
        { status: 429, headers: rlHeaders }
      )
    }

    const clerkId = await requireAuth()

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
    for (const item of items) {
      if (!item.menuItemId || typeof item.menuItemId !== 'string') {
        return apiError('Invalid item in cart', 400, 'VALIDATION_ERROR')
      }
      if (!item.quantity || item.quantity < 1 || item.quantity > 99) {
        return apiError('Invalid quantity', 400, 'VALIDATION_ERROR')
      }
      if (!item.vendorId || typeof item.vendorId !== 'string') {
        return apiError('Invalid vendorId in cart item', 400, 'VALIDATION_ERROR')
      }
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

    const config = event.fulfillmentConfig
    if (config) {
      const enabledMap: Record<FulfillmentType, boolean> = {
        BOOTH_PICKUP: config.boothPickupEnabled,
        CURBSIDE: config.curbsideEnabled,
        HOME_DELIVERY: config.homeDeliveryEnabled,
      }
      if (!enabledMap[fulfillmentType]) {
        throw new ApiError(
          `${fulfillmentType} is not enabled for this event`,
          409,
          'FULFILLMENT_DISABLED'
        )
      }
    }

    // Validate all unique vendors are active and belong to this event
    const uniqueVendorIds = [...new Set(items.map(i => i.vendorId))]
    const vendors = await db.vendor.findMany({
      where: { id: { in: uniqueVendorIds } },
      include: { _count: { select: { menuItems: { where: { isAvailable: true } } } } },
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
      if (!mi.isAvailable) {
        throw new ApiError(
          `${mi.name} is currently unavailable`,
          409,
          'ITEM_UNAVAILABLE'
        )
      }
    }

    // ── 3. Re-price from DB ────────────────────────────────────────────────
    const vendorMap = new Map(vendors.map(v => [v.id, v]))

    let subtotalAccumulator = 0

    const lineItems = items.map(cartItem => {
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
      const unitPrice = mi.price
      const lineSubtotal = parseFloat((unitPrice * cartItem.quantity).toFixed(2))
      subtotalAccumulator += lineSubtotal
      return {
        menuItemId: cartItem.menuItemId,
        itemName: mi.name,
        vendorId: cartItem.vendorId,
        quantity: cartItem.quantity,
        specialInstructions: cartItem.specialInstructions ?? null,
        unitPrice,
        totalPrice: lineSubtotal,
        subtotal: lineSubtotal,
      }
    })

    const subtotal = parseFloat(subtotalAccumulator.toFixed(2))

    // The applicable runner-fulfilled fee (delivery OR curbside), server-derived
    // from config — never client-supplied. Stored in Order.deliveryFee (the fee
    // line the reconciler already understands). Null for booth pickup.
    const deliveryFee: number | null =
      fulfillmentType === FulfillmentType.HOME_DELIVERY
        ? parseFloat((config?.homeDeliveryFee ?? DEFAULT_DELIVERY_FEE).toFixed(2))
        : fulfillmentType === FulfillmentType.CURBSIDE
          ? parseFloat((config?.curbsideFee ?? 0).toFixed(2))
          : null

    // Tip: runner-fulfilled orders only (delivery + curbside). 100% the runner's;
    // no service fee, no split. Forced to 0 for booth pickup (ignore client input).
    const isRunnerFulfilled =
      fulfillmentType === FulfillmentType.HOME_DELIVERY ||
      fulfillmentType === FulfillmentType.CURBSIDE
    if (tipInput != null && (!Number.isFinite(tipInput) || tipInput < 0)) {
      throw new ApiError('Invalid tip amount', 400, 'VALIDATION_ERROR')
    }
    const tip = isRunnerFulfilled && tipInput && tipInput > 0
      ? parseFloat(tipInput.toFixed(2))
      : 0

    const serviceCharge =
      event.serviceChargeEnabled && event.serviceChargeAmount
        ? parseFloat(event.serviceChargeAmount.toFixed(2))
        : 0

    // ── Fee model ──────────────────────────────────────────────────────────
    // FairSynq's sole revenue is the 10% service fee charged to the CUSTOMER on
    // top of the subtotal, kept CLEAN (Stripe fees do NOT come out of it).
    // Vendors absorb the Stripe processing fee: each vendor receives their
    // subtotal slice minus their proportional share of the real settled fee.
    // That per-vendor math runs in the PAYOUT WORKER at fulfillment, when the
    // balance transaction has settled — NOT here and NOT at placement.
    //
    // `fairSynqFee` records FairSynq's revenue (= the service fee) for dashboards.
    // `vendorPayout` is NOT meaningful per-order under multi-vendor; the real
    // per-vendor payout amounts are recorded as Payout rows by the worker. We
    // store 0 on the draft (column is non-null) — do not read it for payouts.
    const serviceFee = calculateServiceFee(subtotal)
    const fairSynqFee = serviceFee
    const vendorPayout = 0

    // Money identity (5 terms): subtotal + serviceFee(10%×subtotal) + deliveryFee
    // + serviceCharge + tip. 10% is on subtotal ONLY — never on the fee or tip.
    const total = parseFloat((subtotal + (deliveryFee ?? 0) + serviceCharge + serviceFee + tip).toFixed(2))
    const itemCount = lineItems.reduce((sum, i) => sum + i.quantity, 0)

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
    // ⚠️ N IS BOUNDED BY THE 20-ITEM CAP ABOVE (`items.length > 20`, :113), NOT by a vendor cap.
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
        deliveryFee: (deliveryFee ?? 0).toFixed(2),
        serviceCharge: serviceCharge.toFixed(2),
        tip: tip.toFixed(2),
        vendorIds: uniqueVendorIds.join(','),
        vendorSubtotalCents: JSON.stringify(vendorSubtotalCents),
      },
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
          stripePaymentIntentId: paymentIntent.id,
          orderItems: {
            create: lineItems.map(item => ({
              menuItemId: item.menuItemId,
              itemName: item.itemName,
              vendorId: item.vendorId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
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
