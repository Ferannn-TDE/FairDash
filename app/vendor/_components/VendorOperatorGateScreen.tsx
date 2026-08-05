'use client'

import Link from 'next/link'
import { useClerk } from '@clerk/clerk-react'
import { Clock, ShieldX } from 'lucide-react'
import type { VendorOperatorView } from '@/lib/vendor-operator-state'

/**
 * The OPERATOR's side of the admittance door (step 3). Rendered INSTEAD of the portal by the
 * server layout when vendorOperatorState says this human may not operate — so a pending or
 * declined operator gets an honest screen instead of a dashboard whose every query 403s.
 *
 * ⚠️ IMPORT DISCIPLINE — THIS IS A `'use client'` FILE. ⚠️
 * Nothing reachable from here may touch `lib/db`, `@prisma/client`, `stripe`, `ioredis`,
 * `firebase-admin`, or `@clerk/nextjs/server`. The previous attempt at this feature died on
 * first page load for exactly that reason, having passed `tsc --noEmit` and the full suite
 * twice — a bundle boundary is invisible to type-checking. The status is read in the SERVER
 * layout and arrives here as a prop; `lib/vendor-operator-state` is deliberately import-free
 * (see the warning at the top of that file). Keep it that way: `@clerk/clerk-react` here is the
 * browser SDK and is correct; `@clerk/nextjs/server` would not be.
 *
 * TWO STATES:
 *   AWAITING — amber. Nobody refused you; an admin hasn't decided yet. No action needed.
 *   DECLINED — red, and THE REASON IS SHOWN. This is what the required-reason rule exists to
 *              deliver. The sibling booth-reject route validates a reason and discards it; this
 *              axis persists it precisely so it can be read here.
 *
 * TERMINAL WITH EXITS, and the exits are the point. A refused operator is not stranded: the
 * carve-out keeps onboarding and settings (which is where Stripe Connect is launched) reachable
 * in both states, and this screen LINKS there rather than leaving them to guess a URL. An
 * operator whose application stalled on a missing payout destination can go fix the thing that
 * would make them approvable.
 */

const META: Record<
  Exclude<VendorOperatorView['state'], 'ADMITTED'>,
  { Icon: React.ElementType; tone: string; ring: string; title: string; blurb: string; showReason: boolean }
> = {
  AWAITING: {
    Icon: Clock,
    tone: 'text-amber-400',
    ring: 'border-amber-500/25 bg-amber-500/[0.06]',
    title: 'Awaiting approval',
    blurb: 'Your access to this booth is waiting on review by a FairSynq admin. Nothing more is needed from you right now — you’ll be let into the portal as soon as it’s reviewed.',
    showReason: false,
  },
  DECLINED: {
    Icon: ShieldX,
    tone: 'text-red-400',
    ring: 'border-red-500/25 bg-red-500/[0.06]',
    title: 'Access declined',
    blurb: 'You have not been approved to operate this booth. If this was a mistake, or you’ve since fixed what was raised, contact support — this decision can be reversed.',
    showReason: true,
  },
}

export default function VendorOperatorGateScreen({
  view,
  fairSlug,
}: {
  view: VendorOperatorView
  fairSlug: string | null
}) {
  const { signOut } = useClerk()
  if (view.state === 'ADMITTED') return null // defensive — the layout never renders this admitted
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

        {/* The reason the admin recorded, verbatim. Without this the required-reason rule is
            theatre — validated, stored, and never seen by the one person it is for. */}
        {m.showReason && view.reason && (
          <div className={`mt-5 rounded-xl border px-4 py-3 text-left ${m.ring}`}>
            <p className="text-[0.6875rem] uppercase tracking-wide font-semibold text-[#888]">Reason</p>
            <p className={`mt-1 text-sm font-inter ${m.tone}`}>{view.reason}</p>
          </div>
        )}

        {/* THE EXITS. These are the carve-out routes — reachable in both gated states by
            design, so this is a door and not a dead end. Rendered only when we know which fair
            to point at; the sign-out/support exits below always render. */}
        {fairSlug && (
          <div className="mt-6 flex flex-col gap-2">
            <Link
              href={`/vendor/${fairSlug}/settings`}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Booth settings &amp; payouts
            </Link>
            <Link
              href={`/vendor/${fairSlug}/onboarding`}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Finish onboarding
            </Link>
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
