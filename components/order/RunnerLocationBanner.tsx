'use client'

import { useEffect, useRef, useState } from 'react'
import { TruckIcon } from '@heroicons/react/24/outline'

// ─── THE LOCATION FEED — one axis, and NOT the order's state ─────────────────────────────────
//
// WHAT THIS USED TO DO, AND WHY IT WAS WRONG. This component worded the ORDER's state itself:
// "Runner not yet assigned" / "Runner assigned — not en route yet" / "Runner is en route — …".
// That made it a SECOND derivation of "where is this order", competing with
// lib/delivery-progress.ts (deriveDeliveryProgress), which is the guarded single source and is
// rendered by SingleOrderTracking directly below this component on the same page.
//
// They DISAGREED, at exactly one state. `enRoute` here means `status === RUNNER_COLLECTED`
// (app/api/orders/[id]/runner-location/route.ts:56) — but RUNNER_COLLECTED is set at CLAIM, not
// at pickup (schema.prisma:499-500: "claim == RUNNER_COLLECTED today, and a real 'collect from
// vendor' action sets collectedAt"). So a runner who had merely claimed the order — food still
// on the vendor's counter — was announced to the customer as "en route". deriveDeliveryProgress
// gets this right by keying on collectedAt, and its docstring exists to say so.
//
// THE COLLAPSE IS BY DELETION, NOT RELOCATION. This component does not call
// deriveDeliveryProgress either — that would put the same sentence on screen twice, once here
// and once in the tracking view below. Order state has exactly one renderer; this one keeps the
// axis that source does not model:
//
//   ORDER state  — "where is my order in its lifecycle"      → deriveDeliveryProgress (there)
//   FEED  state  — "do we have a fresh fix from the runner"  → here, and only here
//
// Those are genuinely different questions. A live order with a dead GPS feed is a real state,
// and deriveDeliveryProgress must NOT be widened to model it — telemetry freshness is not a
// stage of the order.
//
// HONESTY SIGNALS ARE LOad-BEARING. Accuracy (±Nm) and staleness ("updated Ns ago", amber past
// 30s) are why a stale fix cannot pass as a live one. Anything rendering this feed must keep
// them.

interface LocationResponse {
  runnerAssigned: boolean
  enRoute?: boolean
  hasLocation?: boolean
  lat?: number
  lng?: number
  accuracy?: number | null
  updatedAt?: string
}

// Only fetch once a runner could plausibly be involved — home-delivery / curbside
// orders that have reached READY or beyond.
const FULFILLED_BY_RUNNER = new Set(['HOME_DELIVERY', 'CURBSIDE'])
const RELEVANT_STATUS = new Set(['READY', 'RUNNER_COLLECTED'])

/** A fix older than this reads as stale — amber, and labelled. */
export const STALE_AFTER_SEC = 30

export default function RunnerLocationBanner({
  orderId,
  fulfillmentType,
  status,
}: {
  orderId: string
  fulfillmentType: string
  status: string
}) {
  const [loc, setLoc] = useState<LocationResponse | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const active = FULFILLED_BY_RUNNER.has(fulfillmentType) && RELEVANT_STATUS.has(status)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const fetchLoc = () =>
      fetch(`/api/orders/${orderId}/runner-location`)
        .then(r => (r.ok ? r.json() : null))
        .then(json => { if (!cancelled && json?.success) setLoc(json.data) })
        .catch(() => {})

    fetchLoc()
    pollRef.current = setInterval(fetchLoc, 10_000)
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current) }
  }, [orderId, active])

  // Tick a second-counter so "updated Ns ago" stays honest between polls.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  if (!active || !loc) return null

  // NOT SHARING YET — render nothing. The order's own state line (deriveDeliveryProgress, in
  // the tracking view below) already tells the customer a runner hasn't claimed it, or has
  // claimed it and is heading to the booth. Saying it again here is the duplication this
  // component was carrying; saying it in this component's OWN words is how the two drifted.
  if (!loc.runnerAssigned || !loc.enRoute) return null

  const hasFix = loc.hasLocation && loc.lat != null && loc.lng != null && Boolean(loc.updatedAt)

  // FEED state only. No claim about where the order is in its lifecycle.
  let body: React.ReactNode
  if (!hasFix) {
    body = <span className="text-[#A1A1A1]">Waiting for your runner&rsquo;s location…</span>
  } else {
    const ageSec = Math.max(0, Math.round((now - new Date(loc.updatedAt!).getTime()) / 1000))
    const stale = ageSec > STALE_AFTER_SEC
    body = (
      <span className="text-white">
        <span className="font-mono">{loc.lat!.toFixed(5)}, {loc.lng!.toFixed(5)}</span>
        {loc.accuracy != null && <span className="text-[#A1A1A1]"> · ±{Math.round(loc.accuracy)}m</span>}
        <span className={stale ? 'text-amber-400' : 'text-emerald-400'}> · updated {ageSec}s ago{stale ? ' (stale)' : ''}</span>
      </span>
    )
  }

  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-4 flex items-center gap-2.5 text-sm">
      <TruckIcon className="w-4 h-4 text-[#FF0077] shrink-0" />
      {body}
    </div>
  )
}
