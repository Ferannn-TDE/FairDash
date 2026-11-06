// Home delivery availability (Batch 1 item 6, B1.2) — ONE answer for every reader.
//
// Delivery to an address is offered only when the platform switch (setting `delivery.enabled`,
// default OFF) AND the event's own FulfillmentConfig.homeDeliveryEnabled are both on. A fair with
// no FulfillmentConfig at all offers booth pickup only — never "everything on" (the old hole).
//
// Gates NEW orders only. Orders that already exist (in flight, or created before the switch and
// paid after: T-4) keep completing, paying out and refunding through their existing paths.

import { db } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export interface FulfillmentFlags {
  boothPickupEnabled: boolean
  curbsideEnabled: boolean
  homeDeliveryEnabled: boolean
}

/** Booth pickup only: what a fair with no FulfillmentConfig offers. */
export const NO_CONFIG_FULFILLMENT: FulfillmentFlags = { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false }

/** The truth table: platform switch AND the event's flag; a missing config is never delivery. */
export function deliveryAvailable(platformOn: boolean, config: { homeDeliveryEnabled: boolean } | null | undefined): boolean {
  return platformOn && !!config?.homeDeliveryEnabled
}

/** The modes a customer can actually choose, with delivery already gated. */
export function effectiveFulfillment(platformOn: boolean, config: FulfillmentFlags | null | undefined): FulfillmentFlags {
  if (!config) return { ...NO_CONFIG_FULFILLMENT }
  return {
    boothPickupEnabled: config.boothPickupEnabled,
    curbsideEnabled: config.curbsideEnabled,
    homeDeliveryEnabled: deliveryAvailable(platformOn, config),
  }
}

/** The platform switch. Uncached on purpose: order creation reads it fresh (one indexed query). */
export async function isDeliveryEnabled(): Promise<boolean> {
  return (await getSetting('delivery.enabled')) === true
}

export const DELIVERY_OFF_PLATFORM = 'DELIVERY_OFF_PLATFORM'
export const DELIVERY_OFF_MESSAGE = 'Delivery is turned off for the whole platform.'

/** A per-event write may not switch delivery ON while the platform switch is off. Keeping an
 *  existing true flag (an unrelated save) or switching it off is always allowed. */
export function turnsDeliveryOn(requested: boolean | undefined | null, current: boolean | undefined | null): boolean {
  return requested === true && current !== true
}

/** Events that will start offering delivery the moment the platform switch goes on: their own
 *  flag is on, and they're real (not archived, not drafts). Shown before anyone flips it. */
export async function listEventsWithDeliveryOn(): Promise<Array<{ name: string; slug: string }>> {
  const rows = await db.event.findMany({
    where: { archivedAt: null, status: { not: 'DRAFT' }, fulfillmentConfig: { homeDeliveryEnabled: true } },
    select: { name: true, urlSlug: true },
    orderBy: { name: 'asc' },
  })
  return rows.map(r => ({ name: r.name, slug: r.urlSlug }))
}
