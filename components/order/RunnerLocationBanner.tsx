'use client'

import { useEffect, useRef, useState } from 'react'
import { TruckIcon } from '@heroicons/react/24/outline'

// Phase 1 customer surface for live runner location: raw coordinate pair + honest
// staleness, NO map. Self-polls GET /api/orders/:id/runner-location on the same
// ~10s cadence as the status poll. The endpoint is scoped to the owning customer,
// so this simply renders whatever state it is allowed to see.

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

  let body: React.ReactNode
  if (!loc.runnerAssigned) {
    body = <span className="text-[#A1A1A1]">Runner not yet assigned</span>
  } else if (!loc.enRoute) {
    body = <span className="text-[#A1A1A1]">Runner assigned — not en route yet</span>
  } else if (!loc.hasLocation || loc.lat == null || loc.lng == null || !loc.updatedAt) {
    body = <span className="text-[#A1A1A1]">Runner is en route — waiting for their location…</span>
  } else {
    const ageSec = Math.max(0, Math.round((now - new Date(loc.updatedAt).getTime()) / 1000))
    const stale = ageSec > 30
    body = (
      <span className="text-white">
        <span className="font-mono">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span>
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
