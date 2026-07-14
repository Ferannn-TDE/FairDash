'use client'

import Link from 'next/link'
import { useClerk } from '@clerk/clerk-react'
import { Clock, ShieldX, Ban } from 'lucide-react'
import type { OrganizerPortalView } from '@/lib/organizer-portal-state'

/**
 * The organizer's own side of the #7 gate. Shown INSTEAD of the portal (server-side, from the
 * layout) whenever organizerPortalState says they may not operate — so a pending/rejected/
 * suspended organizer sees a clean, honest screen, never the dashboard-of-403s they used to.
 *
 * THREE STATES, VISUALLY DISTINCT — the organizer's view of slice 3's two axes:
 *   AWAITING  (approval) — amber, "under review". Nobody stopped you; we haven't decided yet.
 *   DECLINED  (approval) — the reason IS shown. This is the payload the whole reason-
 *                          requirement existed to deliver: an explanation, not a silent wall.
 *   SUSPENDED (operating) — red. You WERE approved, then stopped; the reason (if any) is shown.
 *
 * The heading/body come from organizerPortalState, whose message is the SAME text the server
 * gate 403s with — the screen cannot contradict the gate.
 */

const META: Record<
  Exclude<OrganizerPortalView['state'], 'ACTIVE'>,
  { Icon: React.ElementType; tone: string; ring: string; title: string; blurb: string; reasonLabel: string }
> = {
  AWAITING: {
    Icon: Clock,
    tone: 'text-amber-400',
    ring: 'border-amber-500/25 bg-amber-500/[0.06]',
    title: 'Application under review',
    blurb: 'Your organizer account is awaiting approval from a FairSynq admin. You’ll get access to the portal as soon as it’s reviewed — nothing more is needed from you right now.',
    reasonLabel: '',
  },
  DECLINED: {
    Icon: ShieldX,
    tone: 'text-red-400',
    ring: 'border-red-500/25 bg-red-500/[0.06]',
    title: 'Application declined',
    blurb: 'Your organizer application was not approved.',
    reasonLabel: 'Reason',
  },
  SUSPENDED: {
    Icon: Ban,
    tone: 'text-red-400',
    ring: 'border-red-500/30 bg-red-500/[0.08]',
    title: 'Account suspended',
    blurb: 'Your organizer access has been suspended. The portal is unavailable until this is lifted.',
    reasonLabel: 'Reason',
  },
}

export default function OrganizerGateScreen({ view }: { view: OrganizerPortalView }) {
  const { signOut } = useClerk()
  if (view.state === 'ACTIVE') return null // defensive — the layout never renders this for ACTIVE
  const m = META[view.state]
  const Icon = m.Icon

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-md text-center">
        <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border ${m.ring}`}>
          <Icon className={`h-8 w-8 ${m.tone}`} />
        </div>

        <h1 className="font-bebas text-4xl tracking-wide text-white">{m.title}</h1>
        <p className="mt-3 text-sm font-inter text-[#999] leading-relaxed">{m.blurb}</p>

        {/* The reason — surfaced to the organizer, the same text the admin recorded and the
            gate returns. A declined/suspended organizer knows WHY, not just that. */}
        {m.reasonLabel && view.reason && (
          <div className={`mt-5 rounded-xl border px-4 py-3 text-left ${m.ring}`}>
            <p className="text-[0.6875rem] uppercase tracking-wide font-semibold text-[#888]">{m.reasonLabel}</p>
            <p className={`mt-1 text-sm font-inter ${m.tone}`}>{view.reason}</p>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <a
            href="mailto:support@fairsynq.com"
            className="w-full rounded-xl bg-[#FF0077] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#e0006b]"
          >
            Contact support
          </a>
          <div className="flex items-center gap-4 text-xs font-inter text-[#666]">
            <Link href="/" className="hover:text-white transition-colors">Back to FairSynq</Link>
            <span className="text-[#333]">·</span>
            <button
              onClick={() => signOut({ redirectUrl: '/' })}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
