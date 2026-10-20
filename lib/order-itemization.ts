// ─────────────────────────────────────────────────────────────────────────────
// itemizeOrder — THE one breakdown of what a customer paid and got back
// ─────────────────────────────────────────────────────────────────────────────
//
// The customer order page, the organizer order detail and (Phase 5) the receipt
// and refund emails all render from this result. Nobody else adds up charge lines
// or refund amounts for display.
//
// Pure and DB-free on purpose: it takes rows the caller already loaded, so a
// route, an email job and a test can all call it the same way. It moves no money
// and decides nothing about money; it only describes rows the engines wrote.
//
// Refund truth comes from two records, never from Cancellation.refundIssued/
// refundAmount (deprecated, drifted on ~80% of rows):
//   - Refund rows (lib/process-refund.ts): one per vendor slice. COMPLETED has
//     landed; PENDING is in flight; FAILED moved nothing and is not shown. An
//     amount above the vendor's food slice is that vendor's waived service fee.
//   - The owed-back marker (lib/tip-refund.ts): tipRefundId set means the tip
//     was refunded, plus deliveryFeeRefundCents of delivery/curbside fee (null on
//     markers written before the fee was owed back, i.e. tip only).
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemizationInput {
  fulfillmentType: string
  subtotal: number
  fairSynqFee: number
  deliveryFee?: number | null
  serviceCharge?: number | null
  tip?: number | null
  total: number
  orderItems: { vendorId: string; subtotal: number; vendor?: { name: string } | null }[]
  /** Optional name source when orderItems don't carry vendor names. */
  vendorNames?: Record<string, string>
  refunds: { vendorId: string; status: string; amountCents: number }[]
  tipRefundId?: string | null
  deliveryFeeRefundCents?: number | null
}

export type ChargeKey = 'subtotal' | 'delivery_fee' | 'tip' | 'service_charge' | 'service_fee'

export interface ChargeLine {
  key: ChargeKey
  label: string
  cents: number
}

export type RefundLine =
  | { key: 'food'; vendorId: string; vendorName: string; label: string; cents: number; status: 'REFUNDED' | 'PROCESSING' }
  | { key: 'service_fee'; label: string; cents: number; status: 'REFUNDED' | 'PROCESSING' }
  | { key: 'delivery_tip'; label: string; cents: number; tipCents: number; feeCents: number; status: 'REFUNDED' }

export interface OrderItemization {
  /** What was charged, in display order. Zero lines are omitted (subtotal always shown). */
  charges: ChargeLine[]
  /** The amount actually charged (Order.total). */
  totalCents: number
  /** Σ charges — equals totalCents on every well-formed order. */
  linesSumCents: number
  reconciles: boolean
  /** Each refund part, in the order it is shown. Empty when nothing was refunded. */
  refunds: RefundLine[]
  refundedCents: number
  processingCents: number
  /** Every vendor's food refunded in full (landed or processing): a full cancel. */
  fullCancel: boolean
  /** The service fee not returned, shown ONLY on a full cancel. On a partial cancel the
   *  rest of the order went ahead, so the fee is simply part of what was bought. */
  serviceFeeKept: { label: string; cents: number } | null
  /** totalCents − refundedCents. */
  netPaidCents: number
  /** e.g. "Food refunded $35.00 · Delivery & tip refunded $15.99" ('' when none landed). */
  refundSummary: string
}

export const toCents = (dollars: number | null | undefined) => Math.round((dollars ?? 0) * 100)
export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`

function feeLabel(fulfillmentType: string) {
  return fulfillmentType === 'CURBSIDE' ? 'Curbside fee' : 'Delivery fee'
}

function deliveryTipLabel(fulfillmentType: string, tipCents: number, feeCents: number) {
  if (tipCents > 0 && feeCents > 0) return fulfillmentType === 'CURBSIDE' ? 'Curbside & tip' : 'Delivery & tip'
  if (feeCents > 0) return feeLabel(fulfillmentType)
  return 'Tip'
}

export function itemizeOrder(o: ItemizationInput): OrderItemization {
  const subtotalCents = toCents(o.subtotal)
  const feeCents = toCents(o.deliveryFee)
  const tipCents = toCents(o.tip)
  const serviceChargeCents = toCents(o.serviceCharge)
  const serviceFeeCents = toCents(o.fairSynqFee)
  const totalCents = toCents(o.total)

  const charges: ChargeLine[] = [{ key: 'subtotal', label: 'Subtotal', cents: subtotalCents }]
  if (feeCents > 0) charges.push({ key: 'delivery_fee', label: feeLabel(o.fulfillmentType), cents: feeCents })
  if (tipCents > 0) charges.push({ key: 'tip', label: 'Tip', cents: tipCents })
  if (serviceChargeCents > 0) charges.push({ key: 'service_charge', label: 'Event service charge', cents: serviceChargeCents })
  if (serviceFeeCents > 0) charges.push({ key: 'service_fee', label: 'Service fee', cents: serviceFeeCents })
  const linesSumCents = charges.reduce((s, l) => s + l.cents, 0)

  // Per-vendor food slices, and names, in first-seen item order (stable display).
  const sliceCents = new Map<string, number>()
  const names = new Map<string, string>()
  for (const it of o.orderItems) {
    sliceCents.set(it.vendorId, (sliceCents.get(it.vendorId) ?? 0) + toCents(it.subtotal))
    if (it.vendor?.name && !names.has(it.vendorId)) names.set(it.vendorId, it.vendor.name)
  }
  const vendorOrder = [...sliceCents.keys()]
  const nameOf = (id: string) => o.vendorNames?.[id] ?? names.get(id) ?? 'Vendor'

  const refunds: RefundLine[] = []
  const waived = { REFUNDED: 0, PROCESSING: 0 }
  const live = o.refunds
    .filter(r => (r.status === 'COMPLETED' || r.status === 'PENDING') && r.amountCents > 0)
    .sort((a, b) => vendorOrder.indexOf(a.vendorId) - vendorOrder.indexOf(b.vendorId))
  for (const r of live) {
    const status = r.status === 'COMPLETED' ? 'REFUNDED' : 'PROCESSING'
    // Food first: a partial override never exceeds the slice; anything above the
    // slice is the vendor's waived service-fee share (process-refund waiveFee).
    const food = Math.min(r.amountCents, sliceCents.get(r.vendorId) ?? r.amountCents)
    waived[status] += r.amountCents - food
    const vendorName = nameOf(r.vendorId)
    refunds.push({ key: 'food', vendorId: r.vendorId, vendorName, label: `Food · ${vendorName}`, cents: food, status })
  }
  for (const status of ['REFUNDED', 'PROCESSING'] as const) {
    if (waived[status] > 0) refunds.push({ key: 'service_fee', label: 'Service fee', cents: waived[status], status })
  }

  if (o.tipRefundId) {
    const refundedFee = o.deliveryFeeRefundCents ?? 0
    if (tipCents + refundedFee > 0) {
      refunds.push({
        key: 'delivery_tip',
        label: deliveryTipLabel(o.fulfillmentType, tipCents, refundedFee),
        cents: tipCents + refundedFee,
        tipCents,
        feeCents: refundedFee,
        status: 'REFUNDED',
      })
    }
  }

  // Full cancel = every vendor's food refunded IN FULL (landed or processing). A partial
  // amount on any vendor, or a vendor with no refund, makes it a partial cancel.
  const foodBack = new Map<string, number>()
  for (const r of refunds) if (r.key === 'food') foodBack.set(r.vendorId, (foodBack.get(r.vendorId) ?? 0) + r.cents)
  const fullCancel = vendorOrder.length > 0 && vendorOrder.every(v => (foodBack.get(v) ?? 0) >= (sliceCents.get(v) ?? 0))
  const keptCents = serviceFeeCents - waived.REFUNDED - waived.PROCESSING

  const refundedCents = refunds.filter(r => r.status === 'REFUNDED').reduce((s, r) => s + r.cents, 0)
  const processingCents = refunds.filter(r => r.status === 'PROCESSING').reduce((s, r) => s + r.cents, 0)

  const landed = refunds.filter(r => r.status === 'REFUNDED')
  const foodLanded = landed.filter(r => r.key === 'food').reduce((s, r) => s + r.cents, 0)
  const parts: string[] = []
  if (foodLanded > 0) parts.push(`Food refunded ${formatCents(foodLanded)}`)
  for (const r of landed) {
    if (r.key === 'service_fee') parts.push(`Service fee refunded ${formatCents(r.cents)}`)
    if (r.key === 'delivery_tip') parts.push(`${r.label} refunded ${formatCents(r.cents)}`)
  }

  return {
    charges,
    totalCents,
    linesSumCents,
    reconciles: linesSumCents === totalCents,
    refunds,
    refundedCents,
    processingCents,
    fullCancel,
    serviceFeeKept: fullCancel && keptCents > 0 ? { label: 'Service fee (non-refundable)', cents: keptCents } : null,
    netPaidCents: totalCents - refundedCents,
    refundSummary: parts.join(' · '),
  }
}
