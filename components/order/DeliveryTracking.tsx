'use client'

import { PhoneIcon, TruckIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { DELIVERY_SEGMENTS, type DeliveryProgress } from '@/lib/delivery-progress'
import type { Order } from './types'

/**
 * The runner-fulfilled tracking surface (5a). Every element here renders from ONE
 * DeliveryProgress result — there is deliberately no second status reader (the old
 * pill-vs-banner pair disagreed: "Ready / 80%" while the banner had vanished in transit).
 */

// ─── 7-segment progress bar ───────────────────────────────────────────────────
export function DeliverySegmentBar({ progress }: { progress: DeliveryProgress }) {
  const failed = progress.state === 'failed'
  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5">
      <div className="flex gap-1">
        {DELIVERY_SEGMENTS.map((label, idx) => {
          const reached = !failed && idx <= progress.activeIndex
          const current = !failed && idx === progress.activeIndex && progress.state === 'active'
          return (
            <div key={label} className="flex-1 min-w-0">
              <div className={`h-1.5 rounded-full transition-colors duration-500 ${
                failed ? 'bg-red-400/20'
                : reached ? (progress.state === 'complete' ? 'bg-emerald-400' : 'bg-[#FF0077]')
                : 'bg-white/10'
              } ${current ? 'animate-pulse' : ''}`} />
              <p className={`mt-1.5 text-[0.55rem] sm:text-[0.6rem] leading-tight text-center truncate ${
                reached ? 'text-white/80 font-semibold' : 'text-white/25'
              }`}>{label}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── The ONE status line ──────────────────────────────────────────────────────
export function DeliveryStatusLine({ progress }: { progress: DeliveryProgress }) {
  const cfg = progress.state === 'failed'
    ? { Icon: XCircleIcon, cls: 'bg-red-500/10 border-red-500/20 text-red-300' }
    : progress.state === 'complete'
      ? { Icon: CheckCircleIcon, cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' }
      : progress.activeIndex >= 3
        ? { Icon: TruckIcon, cls: 'bg-[#FF0077]/10 border-[#FF0077]/20 text-[#FF0077]' }
        : { Icon: ClockIcon, cls: 'bg-blue-500/10 border-blue-500/20 text-blue-300' }
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.cls}`}>
      <cfg.Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <p className="text-sm font-medium leading-snug">{progress.message}</p>
    </div>
  )
}

// ─── Driver info card ─────────────────────────────────────────────────────────
// Shown once a runner claims. Vehicle info comes from the CLAIM-TIME SNAPSHOT on the
// order (what car was actually driving when this order moved) — never the runner's
// mutable profile; until the snapshot columns land (item D), the vehicle line simply
// doesn't render rather than showing a value that could have been edited since.
export function DriverCard({ order }: { order: Order }) {
  if (!order.runnerId) return null
  const name = order.runner?.user?.name ?? 'Your runner'
  const phone = order.runner?.user?.phone ?? null
  const vehicle = [order.runnerVehicleColor, order.runnerVehicleMake].filter(Boolean).join(' ')
  const plate = order.runnerVehiclePlate ?? null
  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-5">
      <p className="text-[0.6875rem] uppercase tracking-wide text-[#A1A1A1] font-semibold mb-3">Your Runner</p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#FF0077]/10 flex items-center justify-center shrink-0">
          <TruckIcon className="w-5 h-5 text-[#FF0077]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{name}</p>
          {(vehicle || plate) && (
            <p className="text-[#A1A1A1] text-xs">{[vehicle, plate].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        {phone && (
          <a href={`tel:${phone}`}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-xs font-semibold hover:bg-white/10 transition-colors shrink-0">
            <PhoneIcon className="w-3.5 h-3.5" /> Call
          </a>
        )}
      </div>
    </div>
  )
}
