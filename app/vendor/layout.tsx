import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { vendorPortalStatus } from '@/lib/portal-state'
import VendorResumeScreen from './_components/VendorResumeScreen'

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
    // Via lib/portal-state.ts, which the DOORS also read (through /api/auth/access). The gate
    // CALLING the shared predicate — rather than merely agreeing with it — is what stops the
    // door and the gate from drifting apart again; a predicate the gate doesn't call would be
    // one more derivation of the same question. Same single query as before, same outcome:
    // 'active' iff a VendorMember row exists.
    const { state } = await vendorPortalStatus(dbUser.id)

    if (state !== 'active') {
      // ⛔ ACCESS HAS ALREADY BEEN DENIED BY THE LINE ABOVE. ⛔
      // Everything in this block chooses between TWO TERMINAL OUTCOMES — a resume screen or
      // the unauthorized page. Neither admits anyone. Nothing below can grant access, and
      // nothing below may ever be moved above the `member` check.
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
  }

  return <>{children}</>
}
