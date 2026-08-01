import Link from 'next/link'

/**
 * THE THIRD STATE — started, not finished.
 *
 * The vendor guard had two answers: you have a VendorMember row, or you are unauthorized.
 * Someone who signed up as a vendor and did not complete /become-vendor fell into the second
 * bucket and was told they had no access — which is both wrong (they are mid-signup, not
 * rejected) and a dead end (the unauthorized page offers "Back to FairSynq" and nothing else).
 * An incomplete signup is a RESUMABLE state.
 *
 * TWO OCCUPANTS, AND WE CANNOT TELL THEM APART — so this screen does not pretend to:
 *   (a) an incomplete application — they need to finish the form;
 *   (b) a vendor whose booth is already listed but whose login was never linked to it. 16
 *       vendors are in this state on the live fair, and 15 of them have contactEmail NULL, so
 *       there is no field to match a signed-in person to their row. Both occupants also arrive
 *       carrying intendedRole 'vendor', so the signal cannot separate them either.
 * Rather than guess and tell half of them something false, both paths are named and the person
 * picks the one that is true for them. If a link-by-email path ever exists, this screen should
 * branch on it instead of offering the choice.
 *
 * NOT A GRANT. Rendering this means the VendorMember check already FAILED. It is one of two
 * terminal outcomes (the other is /vendor/unauthorized); neither admits anyone to the portal.
 */
export default function VendorResumeScreen({ fairSlug }: { fairSlug?: string }) {
  const applyHref = fairSlug ? `/become-vendor?event=${encodeURIComponent(fairSlug)}` : '/become-vendor'

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-neon-pink/10 border border-neon-pink/25 flex items-center justify-center mb-5">
          <svg className="w-7 h-7 text-neon-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>

        <h1 className="font-bebas text-4xl text-white tracking-wide leading-none mb-2">
          Finish setting up
        </h1>
        <p className="text-[#888] font-inter text-sm leading-relaxed mb-6">
          Your vendor application isn&apos;t complete yet, so there&apos;s no booth to open. Pick up
          where you left off and you&apos;ll be in.
        </p>

        <Link
          href={applyHref}
          className="flex items-center justify-center w-full h-11 bg-[#FF0077] text-white font-inter font-semibold text-sm rounded-xl hover:bg-[#e0006b] transition-colors no-underline"
        >
          Finish setting up →
        </Link>

        <div className="mt-5 pt-5 border-t border-white/[0.06]">
          <p className="text-[#666] font-inter text-xs leading-relaxed">
            <span className="text-[#999] font-semibold">Already have a booth at the fair?</span>{' '}
            If your stall is already listed, your account just needs to be linked to it — your
            event organizer can do that. Contact them rather than applying again, so you keep your
            existing menu and booth number.
          </p>
        </div>

        <div className="mt-6">
          <Link href="/" className="text-[#666] font-inter text-xs hover:text-white transition-colors">
            ← Back to FairSynq
          </Link>
        </div>
      </div>
    </div>
  )
}
