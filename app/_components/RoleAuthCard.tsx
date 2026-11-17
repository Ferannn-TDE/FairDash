"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { SignIn, SignUp, useUser, useClerk } from "@clerk/clerk-react";
import { ArrowLeft, LogOut } from "lucide-react";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { initialAuthMode, AUTH_MODE_PARAM, type AuthMode } from "@/lib/auth-mode";
import { authDestinations } from "@/lib/auth-destinations";
import { SIGNIN_COPY, SIGN_IN_TAB, type SigninRole } from "@/lib/signin-copy";
import PitchVideo from "@/app/_components/PitchVideo";
import type { VideoSource } from "@/lib/videos";

// THE sign-in page for every role (vendor / organizer / runner / customer / admin), the "video
// stage" redesign (BATCH-1 §21, 2026-11-17). One component, one copy of the auth logic: the Clerk
// flow, the access gate and the destinations are unchanged from the old card; only the layout and
// the per-role copy (lib/signin-copy.ts) are new.
//
// Layout, one grid for every role:
//   desktop  — left: eyebrow, the page's only H1, line / video subline, then the video;
//              right: the card. With a video the card and video overlap the band's bottom edge.
//              Without one the video area disappears and the band closes up (Q3).
//   phones   — headline, card, then the video (Q6), then the points.
//   below    — the role's points as cards (vendor 4, organizer 6), none for the other roles.
// Admin is `quiet`: no pink glow (Q10).

export interface RoleAuthProps {
  role: SigninRole;
  redirectTo: string;          // where Clerk lands after auth
  quiet?: boolean;             // admin: plainer look, no glow
  video?: VideoSource | null;  // vendor and organizer only; null/absent = no video area
  videoLabel?: string;
}

// useSearchParams requires a Suspense boundary at prerender — wrap the inner card.
export default function RoleAuthCard(props: RoleAuthProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0F0F0F]" />}>
      <RoleAuthInner {...props} />
    </Suspense>
  );
}

function RoleAuthInner({ role, redirectTo, quiet = false, video = null, videoLabel = "FairSynq video" }: RoleAuthProps) {
  const copy = SIGNIN_COPY[role];
  const allowSignUp = Boolean(copy.signUpTab); // no sign-up tab = sign-in only (runner, admin)
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  // Destinations depend on ?redirect= only, never on the tab, so switching tabs keeps the return URL.
  const { dest, afterSignIn, afterSignUp } = authDestinations(role, searchParams.get("redirect"), redirectTo);
  // ?mode=apply opens on sign-up where sign-up is allowed (lib/auth-mode.ts); the tabs switch both ways.
  const [mode, setMode] = useState<AuthMode>(() => initialAuthMode(searchParams.get(AUTH_MODE_PARAM), allowSignUp));

  // Access gate: when signed in, ask the server whether this account actually has
  // the role — checked the SAME way the destination guard checks it. Only then do
  // we send them in. If not, we render a terminal "no access" state instead of
  // pushing into a portal that would bounce us straight back here (the loop bug).
  // null = not yet checked, true/false = answer.
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { setHasAccess(null); return; }
    let cancelled = false;
    fetch(`/api/auth/access?role=${encodeURIComponent(role)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setHasAccess(Boolean(j?.data?.hasAccess)); })
      .catch(() => { if (!cancelled) setHasAccess(false); });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, role]);

  // Exactly one clean hop in — never a render-time race with Clerk's own redirect.
  useEffect(() => {
    if (hasAccess === true) router.push(dest);
  }, [hasAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  // Show the spinner while Clerk loads, and while a signed-in user's access is
  // resolving or being navigated — so we never flash the form at someone who's
  // already signed in.
  const checking = !isLoaded || (isSignedIn === true && (hasAccess === null || hasAccess === true));
  // Signed in and definitively lacks the role → terminal state.
  const denied = isSignedIn === true && hasAccess === false;

  // Role intent rides on the Clerk user (unsafeMetadata), NOT the query param.
  // Clerk's post-verify redirect can drop/normalize ?role= through the CAPTCHA +
  // email-verification hops, which silently defaulted organizer signups to
  // customer (they then never provisioned). unsafeMetadata is written atomically
  // as part of user creation and is readable server-side regardless of redirects
  // or cookie timing — onboarding reads it as the authority.
  const signUpUnsafeMetadata = { intendedRole: role };

  const hasVideo = Boolean(video);
  const points = copy.points ?? [];

  // ── The card ────────────────────────────────────────────────────────────────────────────
  // Phones: edge to edge inside the 16px gutter (no border or padding), so Clerk's row of three
  // short-label social buttons keeps its width. From sm up it is a surface.
  const cardSurface =
    "sm:rounded-2xl sm:bg-[#1A1A1A] sm:border sm:border-white/10 sm:p-7 " +
    (quiet ? "sm:shadow-[0_24px_60px_rgba(0,0,0,0.6)]" : "sm:shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_20px_rgba(255,0,119,0.15)]");

  const card = (
    <div className={`w-full ${cardSurface}`}>
      {denied ? (
        // ── Terminal state: signed in, but this account lacks the role. ──────
        // No redirect, no link back to a login — this is a dead end on purpose.
        <>
          <h2 className="font-bebas text-4xl text-white uppercase tracking-wide leading-none">No {roleLabel} Access</h2>
          <p className="mt-2 text-xs text-gray-400 font-inter leading-relaxed">
            You&apos;re signed in
            {user?.primaryEmailAddress?.emailAddress ? (
              <> as <span className="text-gray-200">{user.primaryEmailAddress.emailAddress}</span></>
            ) : null}
            , but this account doesn&apos;t have {role} access. Switch accounts or head back home.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <button
              onClick={() => signOut({ redirectUrl: "/" })}
              className="inline-flex items-center justify-center gap-2 h-[52px] bg-[#FF0077] hover:bg-[#e0006b] active:scale-[0.98] text-white font-inter font-bold text-[19px] rounded-xl transition-all duration-200 shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
            >
              <LogOut className="w-5 h-5" />
              Sign out &amp; switch account
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center h-11 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-inter text-sm rounded-xl transition-all duration-200"
            >
              Go home
            </Link>
          </div>
        </>
      ) : checking ? (
        // ── Signed in, resolving access (or access granted, navigating). ─────
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-white/20 border-t-[#FF0077] rounded-full animate-spin" />
          <p className="mt-4 text-xs text-gray-500 font-inter">Checking access…</p>
        </div>
      ) : (
        // ── Signed out: tabs, the card heading, the Clerk form. ─────────────
        <>
          {allowSignUp && (
            <div role="tablist" aria-label={copy.heading} className="grid grid-cols-2 p-1 mb-5 rounded-xl bg-[#0F0F0F] border border-white/[0.06]">
              {(["sign-in", "sign-up"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`h-11 rounded-[9px] text-sm font-inter transition-colors ${
                    mode === m ? "bg-[#FF0077]/[0.14] text-white font-semibold" : "text-[#A1A1A1] hover:text-white font-medium"
                  }`}
                >
                  {m === "sign-in" ? SIGN_IN_TAB : copy.signUpTab}
                </button>
              ))}
            </div>
          )}
          {copy.cardHeading && (
            <h2 className="font-bebas text-4xl text-white tracking-wide leading-none mb-5">{copy.cardHeading}</h2>
          )}
          {mode === "sign-in" ? (
            <SignIn routing="hash" forceRedirectUrl={afterSignIn} appearance={clerkAppearance} />
          ) : (
            <SignUp routing="hash" forceRedirectUrl={afterSignUp} unsafeMetadata={signUpUnsafeMetadata} appearance={clerkAppearance} />
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-white font-inter">
      {/* Top: logo and the back link, nothing else (Q2). The back link is at least 44px tall. */}
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/" aria-label="FairSynq home" className="font-bebas text-[28px] tracking-[0.04em] leading-none">
            <span className="text-white">FAIR</span><span className="text-[#FF0077]">SYNQ</span>
          </Link>
          <Link href="/" className="group inline-flex items-center gap-1.5 min-h-[44px] px-1 text-sm text-[#A1A1A1] hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Back to FairSynq
          </Link>
        </div>
      </header>

      {/* The stage band. With a video, the video and the card hang over its bottom edge (lg). */}
      <section className={`relative bg-[#151515] border-b border-white/[0.06] ${hasVideo ? "pb-10 lg:pb-0" : "pb-10 lg:pb-14"}`}>
        {!quiet && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 left-1/4 w-[520px] h-[520px] rounded-full bg-[#FF0077]/[0.07] blur-[130px]" />
          </div>
        )}
        <div className="relative mx-auto max-w-[1280px] px-4 sm:px-8 pt-8 lg:pt-14 grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          {/* Headline: first on phones, top-left on desktop. */}
          <div className="lg:col-start-1 lg:row-start-1 flex flex-col gap-3">
            {copy.eyebrow && (
              <p className="text-xs font-semibold tracking-[0.16em] text-[#FF0077]">{copy.eyebrow}</p>
            )}
            <h1 className="font-bebas font-normal text-[44px] sm:text-6xl lg:text-[88px] leading-[0.92] tracking-[0.01em] max-w-[680px]">
              {copy.heading}
            </h1>
            {copy.line && <p className="text-base lg:text-[17px] leading-relaxed text-[#A1A1A1] max-w-[560px]">{copy.line}</p>}
            {hasVideo && copy.videoSubline && (
              <p className="text-base lg:text-[17px] leading-relaxed text-[#A1A1A1] max-w-[560px]">{copy.videoSubline}</p>
            )}
          </div>

          {/* Card: second on phones, right column (both rows) on desktop. */}
          <div className={`lg:col-start-2 lg:row-start-1 lg:row-span-2 ${hasVideo ? "lg:-mb-24" : ""}`}>{card}</div>

          {/* Video: after the card on phones, under the headline on desktop. Absent = no area. */}
          {hasVideo && (
            <div className="lg:col-start-1 lg:row-start-2 lg:-mb-24">
              <PitchVideo source={video} label={videoLabel} className="shadow-[0_24px_60px_rgba(0,0,0,0.6)]" />
            </div>
          )}
        </div>
      </section>

      {points.length > 0 && (
        <section className={`mx-auto max-w-[1280px] px-4 sm:px-8 pb-16 ${hasVideo ? "pt-10 lg:pt-[152px]" : "pt-10 lg:pt-14"}`}>
          <ul className={`grid gap-4 lg:gap-5 sm:grid-cols-2 ${points.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {points.map((p) => (
              <li key={p.title} className="flex flex-col gap-2.5 rounded-2xl bg-[#1A1A1A] border border-white/[0.06] p-5 lg:p-6">
                <strong className="font-bebas font-normal text-2xl tracking-[0.03em] leading-tight text-[#FF0077]">{p.title}</strong>
                {p.text && <span className="text-[15px] leading-relaxed text-[#A1A1A1]">{p.text}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
