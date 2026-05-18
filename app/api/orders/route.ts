import { NextRequest } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { FulfillmentType, EventStatus, VendorStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getOrderQueue, JOB_UNACCEPTED } from '@/lib/queues'
import { VENDOR_ACCEPT_TIMEOUT_MS } from '@/lib/constants'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DELIVERY_FEE = 2.99 // fallback when FulfillmentConfig.homeDeliveryFee is unset

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  menuItemId: string
  quantity: number
  specialInstructions?: string
}

interface CreateOrderBody {
  vendorId: string
  eventId: string
  fulfillmentType: FulfillmentType
  items: CartItem[]
  customerName: string
  customerPhone: string
  // Curbside — required when fulfillmentType === CURBSIDE
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  // Home delivery — required when fulfillmentType === HOME_DELIVERY
  deliveryStreet?: string
  deliveryCity?: string
  deliveryZip?: string
}

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// List orders for the authenticated user (customer view). Cursor-paginated.

export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return success({ orders: [], nextCursor: null })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)
    const cursor = searchParams.get('cursor') ?? undefined

    const orders = await db.order.findMany({
      where: { customerId: dbUser.id },
      orderBy: { placedAt: 'desc' },
      take: limit,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      include: {
        vendor: { select: { name: true, boothNumber: true } },
        orderItems: {
          include: { menuItem: { select: { name: true, imageUrl: true } } },
        },
      },
    })

    return success({
      orders,
      nextCursor: orders.length === limit ? orders[orders.length - 1].id : null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Create a new order + Stripe PaymentIntent. Returns clientSecret to frontend.
//
// Flow:
//   1. Auth + body validation
//   2. DB validation — event active, vendor online, items available, fulfillment mode enabled
//   3. Re-price from DB (never trust frontend prices)
//   4. Resolve user record (upsert stub if Clerk webhook hasn't fired yet)
//   5. Create Stripe PaymentIntent with application_fee on subtotal only
//   6. Write Order + OrderItems atomically in a DB transaction
//   7. Patch PI metadata with orderId (best-effort, non-blocking)
//   8. Write to Firebase RTDB for real-time vendor notification (best-effort)
//   9. Return { orderId, clientSecret, summary }

export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()

    // ── 1. Parse + validate body ───────────────────────────────────────────
    const body: CreateOrderBody = await req.json()
    const {
      vendorId,
      eventId,
      fulfillmentType,
      items,
      customerName,
      customerPhone,
      vehicleMake,
      vehicleColor,
      vehiclePlate,
      deliveryStreet,
      deliveryCity,
      deliveryZip,
    } = body

    if (!vendorId || !eventId || !fulfillmentType || !customerName || !customerPhone) {
      throw new ApiError(
        'vendorId, eventId, fulfillmentType, customerName, and customerPhone are required',
        400,
        'VALIDATION_ERROR'
      )
    }

    if (!items?.length) {
      throw new ApiError('items must be a non-empty array', 400, 'VALIDATION_ERROR')
    }

    for (const item of items) {
      if (!item.menuItemId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new ApiError(
          'Each item must have a valid menuItemId and a positive integer quantity',
          400,
          'VALIDATION_ERROR'
        )
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
      if (!deliveryStreet || !deliveryCity || !deliveryZip) {
        throw new ApiError(
          'deliveryStreet, deliveryCity, and deliveryZip are required for HOME_DELIVERY orders',
          400,
          'VALIDATION_ERROR'
        )
      }
    }

    // ── 2. DB validation ───────────────────────────────────────────────────

    // Event: must be ACTIVE; fulfillment type must be enabled in FulfillmentConfig
    const event = await db.event.findUnique({
      where: { id: eventId },
      include: { fulfillmentConfig: true },
    })

    if (!event) throw new ApiError('Event not found', 404, 'EVENT_NOT_FOUND')

    if (event.status !== EventStatus.ACTIVE) {
      throw new ApiError('This event is not currently active', 409, 'EVENT_INACTIVE')
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

    // Vendor: must be ACTIVE, online, and belong to this event
    const vendor = await db.vendor.findUnique({ where: { id: vendorId } })

    if (!vendor) throw new ApiError('Vendor not found', 404, 'VENDOR_NOT_FOUND')

    if (vendor.eventId !== eventId) {
      throw new ApiError('Vendor does not belong to this event', 400, 'VENDOR_EVENT_MISMATCH')
    }

    if (vendor.status !== VendorStatus.ACTIVE) {
      throw new ApiError('Vendor is not currently accepting orders', 409, 'VENDOR_INACTIVE')
    }

    if (vendor.isOffline) {
      throw new ApiError('Vendor is currently offline', 409, 'VENDOR_OFFLINE')
    }

    if (vendor.isBusy && vendor.busyUntil && vendor.busyUntil > new Date()) {
      throw new ApiError(
        'Vendor is currently busy — please try again in a few minutes',
        409,
        'VENDOR_BUSY'
      )
    }

    // Menu items: all must exist under this vendor and be available
    const menuItemIds = items.map(i => i.menuItemId)
    const dbMenuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds }, vendorId },
    })

    if (dbMenuItems.length !== menuItemIds.length) {
      const foundIds = new Set(dbMenuItems.map(i => i.id))
      const missing = menuItemIds.filter(id => !foundIds.has(id))
      throw new ApiError(
        `Menu item(s) not found or do not belong to this vendor: ${missing.join(', ')}`,
        404,
        'MENU_ITEM_NOT_FOUND'
      )
    }

    const unavailable = dbMenuItems.filter(i => !i.isAvailable)
    if (unavailable.length > 0) {
      throw new ApiError(
        `The following item(s) are currently unavailable: ${unavailable.map(i => i.name).join(', ')}`,
        409,
        'ITEM_UNAVAILABLE'
      )
    }

    // ── 3. Re-price from DB (never trust frontend prices) ─────────────────
    const priceById = new Map(dbMenuItems.map(i => [i.id, i.price]))

    let subtotalAccumulator = 0
    const lineItems = items.map(cartItem => {
      const unitPrice = priceById.get(cartItem.menuItemId)!
      const lineSubtotal = parseFloat((unitPrice * cartItem.quantity).toFixed(2))
      subtotalAccumulator += lineSubtotal
      return {
        menuItemId: cartItem.menuItemId,
        quantity: cartItem.quantity,
        specialInstructions: cartItem.specialInstructions ?? null,
        unitPrice,
        subtotal: lineSubtotal,
      }
    })

    const subtotal = parseFloat(subtotalAccumulator.toFixed(2))

    // Fee: vendor.commissionRate % of subtotal only — delivery fee goes entirely to platform/runner pool
    const fairSynqFee = parseFloat((subtotal * vendor.commissionRate).toFixed(2))
    const vendorPayout = parseFloat((subtotal - fairSynqFee).toFixed(2))

    // Delivery fee: only for HOME_DELIVERY; sourced from FulfillmentConfig
    const deliveryFee: number | null =
      fulfillmentType === FulfillmentType.HOME_DELIVERY
        ? parseFloat((config?.homeDeliveryFee ?? DEFAULT_DELIVERY_FEE).toFixed(2))
        : null

    // Service charge: operator-set per-order fee applied when enabled on the event
    const serviceCharge =
      event.serviceChargeEnabled && event.serviceChargeAmount
        ? parseFloat(event.serviceChargeAmount.toFixed(2))
        : 0

    const total = parseFloat((subtotal + (deliveryFee ?? 0) + serviceCharge).toFixed(2))

    const itemCount = lineItems.reduce((sum, i) => sum + i.quantity, 0)

    // ── 4. Resolve user in DB ──────────────────────────────────────────────
    // Upsert a stub if the Clerk `user.created` webhook hasn't fired yet.
    let dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) {
      const clerkUser = await currentUser()
      dbUser = await db.user.upsert({
        where: { clerkId },
        create: {
          clerkId,
          email:
            clerkUser?.emailAddresses?.[0]?.emailAddress ??
            `${clerkId}@pending.invalid`,
          name: clerkUser?.firstName
            ? `${clerkUser.firstName}${clerkUser.lastName ? ' ' + clerkUser.lastName : ''}`.trim()
            : undefined,
          phone: clerkUser?.phoneNumbers?.[0]?.phoneNumber ?? undefined,
        },
        update: {},
      })
    }

    // ── 5. Create Stripe PaymentIntent ─────────────────────────────────────
    //
    // Destination charge breakdown:
    //   Customer pays:        total  (subtotal + deliveryFee)
    //   application_fee:      fairSynqFee + deliveryFee  → stays with platform
    //   Vendor receives:      total − application_fee = subtotal − fairSynqFee ✓
    //
    // If vendor has no Stripe Connect account (OPTION_B / not yet onboarded),
    // we create a plain PI and handle the payout manually at event settlement.

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

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        vendorId,
        eventId,
        customerId: dbUser.id,
        fulfillmentType,
        fairSynqFee: fairSynqFee.toFixed(2),
        deliveryFee: (deliveryFee ?? 0).toFixed(2),
        serviceCharge: serviceCharge.toFixed(2),
        // orderId patched in step 7 after DB write
      },
    }

    if (vendor.stripeAccountId && vendor.stripeVerified) {
      piParams.application_fee_amount = Math.round(
        (fairSynqFee + (deliveryFee ?? 0)) * 100
      )
      piParams.transfer_data = { destination: vendor.stripeAccountId }
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams)

    // ── 6. Write Order + OrderItems atomically ─────────────────────────────
    const order = await db.$transaction(async tx => {
      return tx.order.create({
        data: {
          eventId,
          customerId: dbUser!.id,
          vendorId,
          status: OrderStatus.PENDING_PAYMENT,
          fulfillmentType,
          // Pricing
          subtotal,
          deliveryFee,
          serviceCharge: serviceCharge > 0 ? serviceCharge : null,
          total,
          fairSynqFee,
          vendorPayout,
          // Customer
          customerName,
          customerPhone,
          // Curbside
          vehicleMake: vehicleMake ?? null,
          vehicleColor: vehicleColor ?? null,
          vehiclePlate: vehiclePlate ?? null,
          // Home delivery
          deliveryStreet: deliveryStreet ?? null,
          deliveryCity: deliveryCity ?? null,
          deliveryZip: deliveryZip ?? null,
          // Stripe
          stripePaymentIntentId: paymentIntent.id,
          // Line items
          orderItems: {
            create: lineItems.map(item => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              specialInstructions: item.specialInstructions,
            })),
          },
        },
        include: {
          orderItems: {
            include: { menuItem: { select: { name: true } } },
          },
        },
      })
    })

    // ── 7. Patch PI metadata with orderId (best-effort, non-blocking) ──────
    stripe.paymentIntents
      .update(paymentIntent.id, {
        metadata: { ...paymentIntent.metadata, orderId: order.id },
      })
      .catch(err =>
        console.error('[Orders] Failed to patch PI metadata with orderId:', err)
      )

    // ── 8. Firebase RTDB — real-time vendor push ───────────────────────────
    // Path: fairs/{eventId}/orders/{vendorId}/{orderId}
    // The vendor dashboard listens on this path for incoming order alerts.
    const rtdb = getRealtimeDb()
    if (rtdb) {
      const itemSummary = order.orderItems
        .map(i => `${i.menuItem.name} ×${i.quantity}`)
        .join(', ')

      rtdb
        .ref(`fairs/${eventId}/orders/${vendorId}/${order.id}`)
        .set({
          orderId: order.id,
          status: 'PENDING_PAYMENT',
          fulfillmentType,
          customerName,
          customerPhone,
          subtotal,
          deliveryFee: deliveryFee ?? 0,
          total,
          itemCount,
          itemSummary,
          placedAt: Date.now(),
        })
        .catch(err => console.error('[Orders] Firebase RTDB write failed:', err))
    }

    // ── 9. Schedule 2-minute accept timeout ───────────────────────────────
    // If the vendor does not accept within VENDOR_ACCEPT_TIMEOUT_MS, the worker
    // auto-cancels the order and issues a full refund.
    const ordersQueue = getOrderQueue()
    if (ordersQueue) {
      ordersQueue
        .add(
          JOB_UNACCEPTED,
          { orderId: order.id, vendorId, eventId },
          { delay: VENDOR_ACCEPT_TIMEOUT_MS }
        )
        .catch(err => console.error('[Orders] Failed to schedule JOB_UNACCEPTED:', err))
    }

    // ── 10. Return to frontend ─────────────────────────────────────────────
    return success(
      {
        orderId: order.id,
        clientSecret: paymentIntent.client_secret,
        summary: {
          subtotal,
          deliveryFee,
          serviceCharge: serviceCharge > 0 ? serviceCharge : null,
          fairSynqFee,
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
