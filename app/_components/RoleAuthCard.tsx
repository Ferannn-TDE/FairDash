"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { SignIn, SignUp, useUser, useClerk } from "@clerk/clerk-react";
import { ArrowLeft, LogOut, type LucideIcon } from "lucide-react";
import { safeRedirect } from "@/lib/safe-redirect";

// Shared mono-pink auth shell for every role login (vendor / runner / organizer /
// admin). One reusable component so all operator logins are consistent with the
// landing's design language. Preserves the real Clerk flow — only presentation +
// the role-tailored heading/copy/redirect differ per role.

export interface RoleAuthProps {
  role: string;
  Icon: LucideIcon;
  eyebrow: string;        // e.g. "Vendor sign-in"
  heading: string;        // e.g. "Manage your booth"
  blurb: string;          // role-tailored one-liner
  redirectTo: string;     // where Clerk lands after auth
  allowSignUp?: boolean;  // operators can create accounts; admin cannot
  quiet?: boolean;        // admin = unbranded, no marketing atmosphere
}

const clerkElements = {
  rootBox: "w-full",
  card: "bg-transparent shadow-none p-0 w-full gap-2 border-0",
  header: "hidden",
  headerTitle: "hidden",
  headerSubtitle: "hidden",
  logoBox: "hidden",
  logoImage: "hidden",
  socialButtonsBlockButton:
    "relative bg-white/[0.04] border border-white/[0.08] text-white hover:bg-white/[0.08] hover:border-white/[0.14] transition-all duration-200 rounded-xl h-10 font-inter mt-0",
  socialButtonsBlockButtonText: "font-inter text-sm text-gray-200 font-medium",
  socialButtonsProviderIcon: "w-4 h-4",
  dividerLine: "bg-white/[0.06]",
  dividerText: "text-gray-600 font-inter text-xs uppercase tracking-wider bg-[#111111] px-3",
  formFieldLabel: "text-[10px] font-inter text-gray-400 uppercase tracking-wider mb-1",
  formFieldInput:
    "w-full h-10 px-3 bg-white/[0.03] border border-white/[0.08] text-white text-sm font-inter rounded-xl placeholder:text-gray-600 focus:border-[#FF0077]/50 focus:ring-2 focus:ring-[#FF0077]/25 focus:bg-white/[0.05] focus:shadow-[0_0_20px_rgba(255,0,119,0.15)] transition-all duration-200 outline-none",
  formFieldInputShowPasswordButton: "text-gray-500 hover:text-gray-300",
  formButtonPrimary:
    "w-full h-10 bg-[#FF0077] hover:bg-[#FF0077]/90 active:scale-[0.98] text-white font-inter font-semibold text-sm uppercase tracking-wider rounded-xl transition-all duration-200 shadow-[0_4px_20px_rgba(255,0,119,0.25)] hover:shadow-[0_6px_30px_rgba(255,0,119,0.4)]",
  formFieldAction: "text-[#FF0077] hover:text-[#FF0077]/80 font-inter text-xs transition-colors",
  identityPreviewEditButton: "text-[#FF0077] hover:text-[#FF0077]/80",
  formResendCodeLink: "text-[#FF0077] hover:text-[#FF0077]/80",
  backLink: "text-[#FF0077] hover:text-[#FF0077]/80",
  footer: "hidden",
  footerAction: "hidden",
  footerPages: "hidden",
  alert: "bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm p-3",
};

const REVEAL =
  "motion-safe:opacity-0 motion-safe:animate-fadeIn motion-safe:[animation-fill-mode:forwards]";
const reveal = (ms: number): React.CSSProperties => ({ animationDelay: `${ms}ms` });

// useSearchParams requires a Suspense boundary at prerender — wrap the inner card.
export default function RoleAuthCard(props: RoleAuthProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <RoleAuthInner {...props} />
    </Suspense>
  );
}

function RoleAuthInner({
  role, Icon, eyebrow, heading, blurb, redirectTo, allowSignUp = true, quiet = false,
}: RoleAuthProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const dest = safeRedirect(searchParams.get("redirect"), redirectTo);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

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

  // Preserve the return URL through sign-up too — onboarding honors ?redirect=,
  // so a customer who creates an account at checkout still lands back at checkout.
  // Only forward it if it's a safe in-app path (dest already validated above).
  const redirectParam = dest !== redirectTo ? dest : null;
  const afterSignUp = `/onboarding?role=${role}${
    redirectParam ? `&redirect=${encodeURIComponent(redirectParam)}` : ""
  }`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0a] relative overflow-hidden px-5 py-10">
      {/* Atmosphere — static; quieter for admin */}
      {!quiet && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[140%] h-[55%] bg-gradient-to-b from-[#FF0077]/8 to-transparent" />
          <div className="absolute -top-[10%] left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full bg-[#FF0077]/8 blur-[130px]" />
        </div>
      )}
      <div className="h-px w-full max-w-md absolute top-0 left-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#FF0077]/40 to-transparent" />

      <div className="relative z-10 w-full max-w-sm">
        <Link href="/" className={`group inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors mb-8 ${REVEAL}`} style={reveal(0)}>
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span className="font-bebas tracking-[0.2em] text-base">
            <span className="text-white group-hover:text-[#FF0077] transition-colors">FAIR</span>
            <span className="text-[#FF0077] group-hover:text-white transition-colors">SYNQ</span>
          </span>
        </Link>

        <div className={`flex items-center gap-2.5 mb-6 ${REVEAL}`} style={reveal(80)}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#FF0077]/12 border border-[#FF0077]/25">
            <Icon className="w-4 h-4 text-[#FF0077]" />
          </div>
          <p className="text-[10px] text-gray-500 font-inter uppercase tracking-[0.15em]">{eyebrow}</p>
        </div>

        {denied ? (
          // ── Terminal state: signed in, but this account lacks the role. ──────
          // No redirect, no link back to a login — this is a dead end on purpose.
          <>
            <h1 className={`font-bebas text-4xl text-white uppercase tracking-wide leading-none ${REVEAL}`} style={reveal(140)}>
              No {roleLabel} Access
            </h1>
            <p className={`mt-2 text-xs text-gray-400 font-inter leading-relaxed ${REVEAL}`} style={reveal(180)}>
              You&apos;re signed in
              {user?.primaryEmailAddress?.emailAddress ? (
                <> as <span className="text-gray-200">{user.primaryEmailAddress.emailAddress}</span></>
              ) : null}
              , but this account doesn&apos;t have {role} access. Switch accounts or head back home.
            </p>

            <div className="mt-4 mb-4 h-px bg-white/[0.06]" />

            <div className={`flex flex-col gap-3 ${REVEAL}`} style={reveal(240)}>
              <button
                onClick={() => signOut({ redirectUrl: "/" })}
                className="inline-flex items-center justify-center gap-2 h-10 bg-[#FF0077] hover:bg-[#FF0077]/90 active:scale-[0.98] text-white font-inter font-semibold text-sm rounded-xl transition-all duration-200"
              >
                <LogOut className="w-4 h-4" />
                Sign out &amp; switch account
              </button>
              <Link
                href="/"
                className="inline-flex items-center justify-center h-10 bg-white/[0.04] border border-white/[0.08] text-gray-200 hover:bg-white/[0.08] font-inter text-sm rounded-xl transition-all duration-200"
              >
                Go home
              </Link>
            </div>
          </>
        ) : checking ? (
          // ── Signed in, resolving access (or access granted, navigating). ─────
          <div className="flex flex-col items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-white/20 border-t-[#FF0077] rounded-full animate-spin" />
            <p className="mt-4 text-xs text-gray-500 font-inter">Checking access…</p>
          </div>
        ) : (
          // ── Signed out: the actual sign-in / sign-up form. ──────────────────
          <>
            <h1 className={`font-bebas text-4xl text-white uppercase tracking-wide leading-none ${REVEAL}`} style={reveal(140)}>
              {heading}
            </h1>
            <p className={`mt-2 text-xs text-gray-400 font-inter leading-relaxed ${REVEAL}`} style={reveal(180)}>
              {blurb}
            </p>

            <div className="mt-4 mb-4 h-px bg-white/[0.06]" />

            <div className={REVEAL} style={reveal(240)}>
              {mode === "sign-in" ? (
                <SignIn routing="hash" forceRedirectUrl={dest} appearance={{ elements: clerkElements }} />
              ) : (
                <SignUp routing="hash" forceRedirectUrl={afterSignUp} appearance={{ elements: clerkElements }} />
              )}
            </div>

            {allowSignUp && (
              <div className={`mt-5 pt-4 border-t border-white/[0.06] text-center ${REVEAL}`} style={reveal(300)}>
                {mode === "sign-in" ? (
                  <p className="text-xs text-gray-500 font-inter">
                    New here?{" "}
                    <button onClick={() => setMode("sign-up")} className="text-[#FF0077] hover:text-white font-medium transition-colors cursor-pointer bg-transparent border-0 p-0">
                      Create an account
                    </button>
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 font-inter">
                    Already registered?{" "}
                    <button onClick={() => setMode("sign-in")} className="text-[#FF0077] hover:text-white font-medium transition-colors cursor-pointer bg-transparent border-0 p-0">
                      Sign in
                    </button>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
