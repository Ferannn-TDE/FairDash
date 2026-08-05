import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import VendorResumeScreen from './_components/VendorResumeScreen'
import VendorOperatorGateScreen from './_components/VendorOperatorGateScreen'
import { hasPreviewAccess } from '@/lib/preview-access'
import { isVendorGateCarveOut, vendorOperatorState } from '@/lib/vendor-operator-state'

// AUTHORITY guard for the Vendor Portal (DB VendorMember row). Middleware is the
// fast filter; this is the source of truth + stale-token backstop. The vendor
// login lives at /sign-in/vendor (outside this prefix), so only the in-prefix
// /vendor/unauthorized page needs exempting to avoid a self-loop.
export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? ''

  if (pathname !== '/vendor/unauthorized') {
    const { userId: clerkId } = await auth()
    if (!clerkId) redirect(`/sign-in/vendor?redirect=${encodeURIComponent(pathname || '/vendor')}`)

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) redirect('/vendor/unauthorized')

    // ── THE GATE. The ONLY thing that admits anyone to this portal. ────────────────────────
    //
    // TWO CHECKS, IN ORDER, AND THEY ARE DIFFERENT QUESTIONS:
    //   1. does a VendorMember row exist  — "is this person attached to a booth at all"
    //   2. is it APPROVED                 — "may this human operate it"  ← added in step 3
    // (2) was the hole: membership EXISTENCE alone admitted anyone, so a rejected operator kept
    // full portal access. Both are answered from ONE query.
    //
    // 🔑 READ FRESH FROM THE DB, DELIBERATELY NOT THROUGH getVendorAuth. That cache holds a
    // membership for 600s + jitter at role 'owner' — and every operator on this fair is an
    // 'owner' — so routing this decision through it would let a just-rejected operator keep
    // working for ~10 minutes, and a just-re-approved one stay walled for the same. Fail-closed
    // in both directions costs one indexed lookup per portal navigation. (The cache invalidation
    // the approve/reject routes already perform protects the API routes that DO read through
    // getVendorAuth; it is not what makes this line correct.)
    //
    // findMany, NOT findFirst: see vendorOperatorState — one APPROVED membership admits, and an
    // unordered findFirst could return a PENDING row while an APPROVED one exists, walling an
    // operator who was admitted. The old query only asked "any row?", where that could not bite.
    const memberships = await db.vendorMember.findMany({
      where: { userId: dbUser.id },
      select: {
        id: true,
        approvalStatus: true,
        rejectionReason: true,
        vendor: { select: { event: { select: { urlSlug: true } } } },
      },
    })

    if (memberships.length === 0) {
      // ⛔ ACCESS HAS ALREADY BEEN DENIED BY THE LINE ABOVE. ⛔
      // Everything in this block chooses between TWO TERMINAL OUTCOMES — a resume screen or
      // the unauthorized page. Neither admits anyone. Nothing below can grant access, and
      // nothing in THIS BLOCK may ever be moved above the `memberships.length` check. (The
      // admittance gate below is a further REFUSAL, not a grant, and is correctly placed after.)
      //
      // THE SIGNAL: unsafeMetadata.intendedRole — "what this person clicked at signup".
      //
      // ⚠️ unsafeMetadata is CLIENT-WRITABLE. Anyone can set intendedRole to anything from the
      // browser. That is precisely why it is confined to this block: the worst a forged value
      // can do is show a stranger a "finish setting up" screen instead of "access restricted".
      // Both are refusals. It is NOT an authorization input and must NEVER become one — do not
      // read it above the gate, do not add it to lib/auth.ts, do not let it decide what a
      // person may see once inside. It is one careless edit away from being mistaken for
      // roles[], which is a different field with a different meaning and a different trust
      // level. scripts/intended-role-purity-guard.ts enforces that separation, because this
      // paragraph will not survive on its own.
      const clerkUser = await currentUser()
      const signupIntent = typeof clerkUser?.unsafeMetadata?.intendedRole === 'string'
        ? clerkUser.unsafeMetadata.intendedRole
        : null

      // Started, not finished → resume. (Since roles[] became DB-backed, an incomplete signup
      // also has no role and no navbar door, so this screen is the only way back into the
      // funnel — which is why it ships alongside that change, not after it.)
      if (signupIntent === 'vendor') return <VendorResumeScreen />

      // No signal at all → the existing terminal state, unchanged.
      redirect('/vendor/unauthorized')
    }

    // ── ADMITTANCE (step 3) — the second question, asked only of people who passed the first.
    const admittance = vendorOperatorState(memberships)

    if (admittance.state !== 'ADMITTED') {
      // THE CARVE-OUT, checked before anything expensive. A gated operator must still reach
      // onboarding and settings — settings is where Stripe Connect is launched — or the gate
      // becomes a deadlock: refused for being incomplete, then locked out of the only screens
      // that would complete it. Pure string test, no I/O. See isVendorGateCarveOut for why it
      // insists on three path segments (`/vendor/settings` is a FAIR page, not this).
      const carvedOut = isVendorGateCarveOut(pathname)

      // The admin preview bypass, unchanged in meaning: an admin previewing the portal must not
      // be walled by a gate aimed at operators. Evaluated LAST because it is the only branch
      // that can cost a Clerk round-trip, and only ever for someone already being refused — an
      // admitted operator never pays for it. (It short-circuits to false when the env flag is
      // off, so this is free in any environment where preview isn't enabled.)
      if (!carvedOut && !(await hasPreviewAccess())) {
        // The fair to point the exits at. First membership: at 1:1 this is exact, and it is
        // only ever used to build links on the gate screen — never to decide access.
        const fairSlug = memberships[0]?.vendor?.event?.urlSlug ?? null
        return <VendorOperatorGateScreen view={admittance} fairSlug={fairSlug} />
      }
    }
  }

  return <>{children}</>
}
