import { dark } from '@clerk/themes'

/**
 * Clerk appearance — THE single source for every Clerk surface in the app.
 *
 * ⚠️ ONE CONFIG, TWO CONSUMERS. There used to be two: this file (applied at the ClerkProvider) and a
 * separate `clerkElements` object inside RoleAuthCard passed per-mount. Component-level appearance
 * merges OVER provider-level per slot, so the RoleAuthCard copy silently won on all five auth pages
 * — and the two had drifted apart (pill vs rounded-xl buttons, `py-12` vs `p-0` card). The result:
 * editing this file changed nothing an operator could see, while the auth pages were governed by a
 * copy nobody looked at. Same two-copies-one-lies shape this codebase keeps paying for.
 *
 * Both the ClerkProvider (app/_providers/ClerkClientProvider.tsx) and RoleAuthCard now import THIS
 * object. Do not reintroduce a local elements object in a component — restyle here instead.
 *
 * TREATMENT: watermelon auth-06, expressed in FairSynq's OWN palette literals. auth-06 is a
 * structure (bare centered column, horizontal pill social row, visible "or" divider, muted rounded
 * inputs, gradient accent button), not a palette — its "primary" is our #FF0077. Deliberately NO
 * shadcn semantic tokens (`bg-muted`, `text-muted-foreground`): this project defines zero CSS
 * variables, so those class names resolve to nothing here. Hex literals only:
 *
 *   #FF0077  primary (neon-pink)     #0F0F0F  background
 *   #1A1A1A  muted surface           #A1A1A1  muted text
 *
 * WHAT auth-06 HAS THAT WE DELIBERATELY DO NOT:
 *   - a single email field / "Continue with email". Our instance requires a PASSWORD, so Clerk
 *     renders both fields. The password field is styled to match the email field and is NEVER
 *     hidden — hiding a required field with CSS breaks sign-in.
 *   - a GitHub button. Our enabled providers are google / apple / facebook.
 *   - short social labels ("Google"). Clerk renders "Continue with Google"; changing that is the
 *     `localization` prop, not appearance, and is out of scope.
 *
 * Must come from @clerk/clerk-react / @clerk/themes (both use @clerk/shared v3). Do NOT import from
 * @clerk/nextjs here — it uses @clerk/shared v2, which creates a different React context object and
 * breaks useUser / useAuth hooks.
 */

/**
 * LOCALIZATION — copy, not wiring, and the reason the social buttons can sit side-by-side.
 *
 * Clerk's default label is "Continue with {{provider|titleize}}". Three of those ("Continue with
 * Google/Apple/Facebook") cannot fit across one column at any sane auth width, so the row wrapped
 * to one button per line and READ as stacked even though the container was already flex-row —
 * the layout was never the problem, the label length was. Shortening to the bare provider name is
 * what actually produces the auth-06 row.
 *
 * ⚠️ This changes the TEXT a user reads. It does not change which providers exist, the OAuth flow,
 * the session, or any redirect — `localization` is a string table consumed by the same render layer
 * as `appearance`. Kept in this file so the label and the layout that depends on it live together;
 * shortening one without widening the other is how this regresses.
 */
export const clerkLocalization = {
  socialButtonsBlockButton: '{{provider|titleize}}',
}

/** auth-06's raised-surface treatment: a 1px inner highlight over a soft drop shadow. */
const INSET_HIGHLIGHT =
  '!shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_1px_2px_-1px_rgba(0,0,0,0.4),0_2px_4px_0_rgba(0,0,0,0.3)]'

export const clerkAppearance = {
  baseTheme: dark,

  variables: {
    colorPrimary: '#FF0077',
    colorDanger: '#ef4444',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorBackground: '#0F0F0F',
    colorInputBackground: '#1A1A1A',
    colorText: '#ffffff',
    colorTextSecondary: '#A1A1A1',
    // White, not black: the filled #FF0077 button reads better with white text at this weight, and
    // it matches the accent buttons already used elsewhere in RoleAuthCard.
    colorTextOnPrimaryBackground: '#ffffff',
    colorNeutral: '#A1A1A1',
    fontFamily: 'Inter, sans-serif',
    fontFamilyButtons: 'Inter, sans-serif',
    fontSize: '1rem',
    fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 } as const,
    // auth-06's default radius is rounded-lg. The social pills override to rounded-full per-slot.
    borderRadius: '0.5rem',
    spacing: '1rem',
  },

  layout: {
    logoPlacement: 'none' as const,
    socialButtonsVariant: 'blockButton' as const,
    socialButtonsPlacement: 'top' as const,
    showOptionalFields: false,
    animations: true,
    shimmer: false,
    termsPageUrl: '/refund-policy',
    privacyPageUrl: '/refund-policy',
  },

  elements: {
    rootBox: 'w-full',

    // ── The shell. auth-06 has NO card: a bare centered column on the page background. ──────────
    // RoleAuthCard supplies the surrounding chrome (brand mark, heading, atmosphere), so Clerk's
    // own card must contribute nothing visual at all.
    cardBox: '!shadow-none !border-0 !bg-transparent !w-full',
    card: '!bg-transparent !border-0 !shadow-none !p-0 !w-full !gap-2',
    modalBackdrop: '!bg-black/80 !backdrop-blur-sm',
    modalContent: '!bg-[#0F0F0F] !border !border-white/[0.08] !rounded-2xl !shadow-none',

    // Header + logo are RoleAuthCard's job (its own JSX, role-tailored copy). Clerk's are hidden
    // rather than restyled so the two can never both render.
    header: '!hidden',
    headerTitle: '!hidden',
    headerSubtitle: '!hidden',
    logoBox: '!hidden',
    logoImage: '!hidden',

    // ── Social row: auth-06's horizontal, wrapped, centered pills. ──────────────────────────────
    // The container flips from the stacked column Clerk defaults to; the buttons become auto-width
    // pills. With three providers these wrap to 2 + 1 on a narrow screen, which is the intended
    // auth-06 behaviour (flex-wrap, centered).
    // ROW GEOMETRY. `gap-y` is deliberately LARGER than `gap-x`: the "Last used" badge sits above
    // a button's top edge, so when the row wraps (narrow screens, or a long provider name) the
    // second row's badge would collide with the first row's buttons on a uniform gap. The extra
    // vertical gap plus `pt-3` is the room that badge lives in — desktop AND wrapped.
    socialButtons: '!flex !flex-row !flex-wrap !items-center !justify-center !gap-x-2.5 !gap-y-4 !w-full !pt-3',
    socialButtonsProviders: '!flex !flex-row !flex-wrap !items-center !justify-center !gap-x-2.5 !gap-y-4 !w-full !pt-3',
    socialButtonsBlockButton: [
      '!w-auto !grow-0 !h-10 !px-4 !gap-2',
      '!rounded-full !border !border-white/[0.10] !bg-[#1A1A1A]',
      '!text-white !text-sm !font-medium !normal-case',
      // The badge is absolutely positioned against THIS button and pokes above its top edge, so
      // the button must establish the positioning context and must NOT clip it.
      '!relative !overflow-visible',
      INSET_HIGHLIGHT,
      'hover:!bg-[#232323] hover:!border-white/[0.18]',
      'active:!scale-[0.98]',
      'transition-all !duration-200',
    ].join(' '),
    socialButtonsBlockButtonText: '!text-white !text-sm !font-medium !whitespace-nowrap',
    socialButtonsProviderIcon: '!w-4 !h-4 !shrink-0',

    // ── "LAST USED" BADGE. Clerk pins this pill to the previously-used provider button. ─────────
    // It was being CLIPPED: this slot existed before the auth-06 reskin and was dropped in the
    // rewrite, so it fell back to Clerk's default placement and got cut by the button edge.
    // Restored with three things it needs to survive a wrapping row:
    //   1. an OPAQUE background (#0F0F0F, the page) — it straddles the button's border, and a
    //      transparent pill reads as broken text over that edge
    //   2. z-10, so a neighbouring button that wrapped underneath cannot paint over it
    //   3. it sits inside the `pt-3` / `gap-y-4` room reserved by the container above
    badge: [
      '!absolute !-top-2 !right-3 !z-10 !m-0',
      '!bg-[#0F0F0F] !text-[#A1A1A1] !border !border-white/[0.10]',
      '!text-[0.625rem] !font-medium !leading-none !normal-case',
      '!px-1.5 !py-1 !rounded-full !shadow-none !whitespace-nowrap',
    ].join(' '),

    // ── Divider: auth-06 shows a VISIBLE "or" with a rule on both sides. ────────────────────────
    dividerRow: '!flex !items-center !gap-4 !my-5',
    dividerLine: '!bg-white/[0.10] !flex-1',
    dividerText: '!text-[#A1A1A1] !text-xs !font-medium !uppercase !tracking-[0.2em] !shrink-0',

    // ── Fields. Email AND password share one treatment — the password field is styled, never ────
    // hidden: it is required by the instance, so hiding it would break sign-in.
    form: '!gap-3',
    formFieldRow: '!mb-3',
    formFieldLabel: '!text-[#A1A1A1] !text-[0.6875rem] !font-semibold !uppercase !tracking-[0.12em] !mb-1.5',
    formFieldHintText: '!hidden',
    formFieldInput: [
      '!h-10 !px-3 !w-full',
      '!bg-[#1A1A1A] !border !border-white/[0.10] !text-white !text-sm',
      '!rounded-lg',
      'placeholder:!text-[#6a6a6a]',
      'focus:!border-[#FF0077]/50 focus:!ring-2 focus:!ring-[#FF0077]/20 focus:!shadow-none',
      'hover:!border-white/[0.18]',
      'transition-all !duration-200',
    ].join(' '),
    formFieldInputShowPasswordButton: '!text-[#A1A1A1] hover:!text-white !mr-1',
    formFieldErrorText: '!text-[#f15e6c] !text-xs !mt-1',
    formFieldAction: '!text-[#FF0077] hover:!text-white !text-xs !font-medium transition-colors',

    // ── Primary action: auth-06's top-lit gradient fill in our accent. ─────────────────────────
    // NO ::after arrow. auth-06 renders an arrow icon inside the button, but Clerk swaps the
    // button's contents for a spinner while submitting and a pseudo-element would survive that,
    // leaving "⟳ →" mid-request. Approximating it was optional; a clean button beats a hacked one.
    formButtonPrimary: [
      '!h-10 !w-full',
      '!bg-gradient-to-b !from-[#FF0077] !to-[#FF0077]/70',
      'hover:!from-[#ff2a8d] hover:!to-[#FF0077]/80',
      '!text-white !text-sm !font-semibold !normal-case !tracking-normal',
      '!rounded-lg !border-0',
      '!shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_4px_16px_-4px_rgba(255,0,119,0.45)]',
      'active:!scale-[0.98]',
      'transition-all !duration-200',
      '!mt-1',
    ].join(' '),

    // ── OTP (email code) — same surface treatment as the text fields. ───────────────────────────
    otpCodeFieldInput: [
      '!h-11 !w-11 !text-lg !font-semibold',
      '!bg-[#1A1A1A] !border !border-white/[0.10] !text-white !rounded-lg',
      'focus:!border-[#FF0077]/50 focus:!ring-2 focus:!ring-[#FF0077]/20 focus:!shadow-none',
      'transition-all !duration-200',
    ].join(' '),
    formResendCodeLink: '!text-[#FF0077] hover:!text-white transition-colors',

    identityPreview: '!bg-[#1A1A1A] !border !border-white/[0.10] !rounded-lg !py-2.5 !px-3',
    identityPreviewText: '!text-white !text-sm',
    identityPreviewEditButton: '!text-[#FF0077] hover:!text-white',
    backLink: '!text-[#FF0077] hover:!text-white transition-colors',

    alert: '!bg-[#1A1A1A] !border !border-white/[0.10] !text-white !rounded-lg !text-sm !p-3',
    alertText: '!text-white !text-sm',

    // RoleAuthCard renders its own sign-in/sign-up switcher below the form, so Clerk's footer stays
    // hidden — otherwise both would offer the same action twice.
    footer: '!hidden',
    footerAction: '!hidden',
    footerPages: '!hidden',
  },
}
