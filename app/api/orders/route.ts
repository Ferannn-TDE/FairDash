import { NextRequest, NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { currentUser } from '@clerk/nextjs/server'
import Stripe from 'stripe'
import { FulfillmentType, EventStatus, VendorStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { fireAndForgetFirebaseSet } from '@/lib/firebase-sync'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { getOrderQueue, JOB_UNACCEPTED } from '@/lib/queues'
import { enqueueJobSafely } from '@/lib/queue-safe'
import { VENDOR_ACCEPT_TIMEOUT_MS } from '@/lib/constants'

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
  // Curbside
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  // Home delivery
  deliveryStreet?: string
  deliveryCity?: string
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
        { error: 'Too many requests. Please slow down.' },
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
      deliveryCity,
      deliveryZip,
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
      if (!deliveryStreet || !deliveryCity || !deliveryZip) {
        throw new ApiError(
          'deliveryStreet, deliveryCity, and deliveryZip are required for HOME_DELIVERY orders',
          400,
          'VALIDATION_ERROR'
        )
      }
    }

    // ── 2. DB validation ───────────────────────────────────────────────────

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

    // Validate all unique vendors are active and belong to this event
    const uniqueVendorIds = [...new Set(items.map(i => i.vendorId))]
    const vendors = await db.vendor.findMany({
      where: { id: { in: uniqueVendorIds } },
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
    let fairSynqFeeAccumulator = 0

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
      const lineFee = parseFloat((lineSubtotal * vendor.commissionRate).toFixed(2))
      subtotalAccumulator += lineSubtotal
      fairSynqFeeAccumulator += lineFee
      return {
        menuItemId: cartItem.menuItemId,
        itemName: mi.name,     // snapshot at order time — eliminates join on dashboard queries
        vendorId: cartItem.vendorId,
        quantity: cartItem.quantity,
        specialInstructions: cartItem.specialInstructions ?? null,
        unitPrice,
        totalPrice: lineSubtotal,  // unitPrice * quantity — stored for SQL aggregation
        subtotal: lineSubtotal,
      }
    })

    const subtotal = parseFloat(subtotalAccumulator.toFixed(2))
    const fairSynqFee = parseFloat(fairSynqFeeAccumulator.toFixed(2))
    const vendorPayout = parseFloat((subtotal - fairSynqFee).toFixed(2))

    const deliveryFee: number | null =
      fulfillmentType === FulfillmentType.HOME_DELIVERY
        ? parseFloat((config?.homeDeliveryFee ?? DEFAULT_DELIVERY_FEE).toFixed(2))
        : null

    const serviceCharge =
      event.serviceChargeEnabled && event.serviceChargeAmount
        ? parseFloat(event.serviceChargeAmount.toFixed(2))
        : 0

    const total = parseFloat((subtotal + (deliveryFee ?? 0) + serviceCharge).toFixed(2))
    const itemCount = lineItems.reduce((sum, i) => sum + i.quantity, 0)

    // Primary vendor — first item's vendor (used for Order.vendorId and RTDB routing)
    const primaryVendorId = items[0].vendorId

    // ── 4. Resolve user in DB ──────────────────────────────────────────────
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

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        primaryVendorId,
        eventId,
        customerId: dbUser.id,
        fulfillmentType,
        fairSynqFee: fairSynqFee.toFixed(2),
        deliveryFee: (deliveryFee ?? 0).toFixed(2),
        serviceCharge: serviceCharge.toFixed(2),
        vendorIds: uniqueVendorIds.join(','),
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
          serviceCharge: serviceCharge > 0 ? serviceCharge : null,
          total,
          fairSynqFee,
          vendorPayout,
          customerName,
          customerPhone,
          vehicleMake: vehicleMake ?? null,
          vehicleColor: vehicleColor ?? null,
          vehiclePlate: vehiclePlate ?? null,
          deliveryStreet: deliveryStreet ?? null,
          deliveryCity: deliveryCity ?? null,
          deliveryZip: deliveryZip ?? null,
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

      // One VendorOrderStatus row per unique vendor — starts at PLACED
      await tx.vendorOrderStatus.createMany({
        data: uniqueVendorIds.map(vid => ({
          orderId: created.id,
          vendorId: vid,
          status: 'PLACED',
        })),
      })

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
        console.error('[Orders] Failed to patch PI metadata with orderId:', err)
      )

    // ── 8. Firebase RTDB — push to each vendor's path ─────────────────────
    const itemsByVendor: Record<string, string[]> = {}
    for (const oi of order.orderItems) {
      if (!itemsByVendor[oi.vendorId]) itemsByVendor[oi.vendorId] = []
      itemsByVendor[oi.vendorId].push(`${oi.itemName || oi.menuItem.name} ×${oi.quantity}`)
    }

    after(() => {
      for (const [vid, itemLines] of Object.entries(itemsByVendor)) {
        const vendorSubtotal = lineItems
          .filter(l => l.vendorId === vid)
          .reduce((s, l) => s + l.subtotal, 0)

        fireAndForgetFirebaseSet(
          `fairs/${eventId}/orders/${vid}/${order.id}`,
          {
            orderId: order.id,
            status: 'PENDING_PAYMENT',
            fulfillmentType,
            customerName,
            customerPhone,
            subtotal: parseFloat(vendorSubtotal.toFixed(2)),
            total: parseFloat(vendorSubtotal.toFixed(2)),
            itemCount: lineItems.filter(l => l.vendorId === vid).reduce((s, l) => s + l.quantity, 0),
            itemSummary: itemLines.join(', '),
            placedAt: Date.now(),
          },
          { orderId: order.id }
        )
      }
    })

    // ── 9. Schedule accept-timeout for primary vendor ──────────────────────
    const ordersQueue = getOrderQueue()
    if (ordersQueue) {
      const result = await enqueueJobSafely({
        queue:    ordersQueue,
        name:     JOB_UNACCEPTED,
        data:     { orderId: order.id, vendorId: primaryVendorId, eventId },
        jobId:    `unaccepted-${order.id}`,
        delay:    VENDOR_ACCEPT_TIMEOUT_MS,
        priority: 'normal',
      })

      if (result === 'dropped') {
        console.error('[CRITICAL] Job dropped with no fallback', { jobName: JOB_UNACCEPTED, orderId: order.id })
      }
    }

    // ── 10. Return to frontend ─────────────────────────────────────────────
    return success(
      {
        orderId: order.id,
        shortId: order.id.slice(-8).toUpperCase(),
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
