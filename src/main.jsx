import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import App from './App.jsx'
import './index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key. Set VITE_CLERK_PUBLISHABLE_KEY in your .env file.')
}

/**
 * Clerk appearance — global theme for all Clerk components.
 *
 * Base: @clerk/themes `dark` — fills in sensible dark-mode defaults
 * so our overrides only need to handle FairDash-specific values.
 *
 * Design tokens:
 *   neon-pink: #FF0077 | bg-dark: #0F0F0F | bg-card: #1A1A1A | text-gray: #A1A1A1
 */
const clerkAppearance = {
  // Dark theme as base — handles backdrop, scrollbars, and system chrome
  baseTheme: dark,

  variables: {
    // Primary action color — neon pink throughout
    colorPrimary: '#FF0077',
    colorDanger: '#ef4444',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',

    // Background
    colorBackground: '#1A1A1A',       // Card / modal background
    colorInputBackground: '#0f0f0f', // Input fields — deeper dark

    // Text
    colorText: '#ffffff',
    colorTextSecondary: '#A1A1A1',
    colorTextOnPrimaryBackground: '#ffffff',

    // Neutral (borders, dividers, placeholders)
    colorNeutral: '#A1A1A1',

    // Typography
    fontFamily: 'Inter, system-ui, sans-serif',
    fontFamilyButtons: '"Bebas Neue", cursive',
    fontSize: '0.9375rem',
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },

    // Shape — matches rounded-xl used throughout FairDash
    borderRadius: '0.75rem',
  },

  layout: {
    logoImageUrl: '/images/logo/fairdash-logo.png',
    logoLinkUrl: '/home',
    logoPlacement: 'inside',
    socialButtonsVariant: 'iconButton',
    socialButtonsPlacement: 'bottom',
    showOptionalFields: true,
    animations: true,
    shimmer: true,
    termsPageUrl: 'https://fairdash.app/refund-policy',
    privacyPageUrl: 'https://fairdash.app/refund-policy',
  },

  elements: {
    // ── Modal overlay & container ──
    modalBackdrop: 'bg-black/80 backdrop-blur-sm',
    modalContent: '!shadow-[0_25px_60px_rgba(0,0,0,0.6)]',
    card: '!bg-[#1A1A1A] !border !border-white/[0.08] !rounded-2xl !shadow-none',
    rootBox: 'w-full',
    cardBox: '!rounded-2xl',

    // ── Header — logo handles branding, title hidden ──
    headerTitle: '!hidden',
    logoBox: '!justify-center !mb-2',
    logoImage: '!h-12',
    headerSubtitle: '!text-[#A1A1A1] !text-sm !mt-2',

    // ── Social login icon buttons — large 60×60 targets ──
    socialButtonsProviders: '!gap-5 justify-center',
    socialButtonsIconButton: [
      '!w-[60px] !h-[60px] !rounded-2xl',
      '!border-2 !border-white/10 !bg-white/[0.04]',
      'hover:!bg-white/[0.1] hover:!border-[#FF0077]/50 hover:!scale-105',
      'active:!scale-95',
      'transition-all duration-200 ease-out',
      '!shadow-[0_2px_8px_rgba(0,0,0,0.2)]',
    ].join(' '),
    socialButtonsProviderIcon: '!w-6 !h-6',
    socialButtonsBlockButton: [
      '!h-14 !rounded-xl',
      '!border-2 !border-white/10 !bg-white/[0.04]',
      'hover:!bg-white/[0.08] hover:!border-[#FF0077]/40',
      'transition-all duration-200',
    ].join(' '),
    socialButtonsBlockButtonText: '!text-white !font-semibold',

    // ── "or" divider ──
    dividerRow: '!my-7',
    dividerLine: '!bg-white/[0.08]',
    dividerText: '!text-[#A1A1A1] !text-[11px] uppercase !tracking-[2px] !px-5',

    // ── Form fields ──
    formFieldRow: '!mb-5',
    formFieldLabel: '!text-[#A1A1A1] !text-[13px] !font-semibold !mb-2',
    formFieldInput: [
      '!bg-[#0f0f0f] !border-2 !border-white/10 !text-white',
      '!h-[52px] !px-5 !rounded-xl !text-[15px]',
      'placeholder:!text-white/25',
      'focus:!border-[#FF0077] focus:!ring-2 focus:!ring-[#FF0077]/15',
      'hover:!border-white/20',
      'transition-all duration-200',
    ].join(' '),
    formFieldInputShowPasswordButton: '!text-[#A1A1A1] hover:!text-[#FF0077] !mr-1',
    formFieldErrorText: '!text-red-400 !text-xs !mt-1',

    // ── Primary CTA ──
    formButtonPrimary: [
      '!bg-[#FF0077] hover:!bg-[#e0006b]',
      '!h-[56px] !text-sm !font-bold uppercase !tracking-[2px] !rounded-xl',
      '!shadow-[0_4px_12px_rgba(255,0,119,0.3)]',
      'hover:!shadow-[0_6px_20px_rgba(255,0,119,0.5)]',
      'hover:!translate-y-[-1px]',
      'active:!scale-[0.98] active:!translate-y-0',
      'transition-all duration-300 ease-out',
      '!mt-3',
    ].join(' '),

    // ── Footer ("Don't have an account?") ──
    footer: '!mt-7',
    footerAction: '!pt-5 !border-t !border-white/[0.06] !justify-center',
    footerActionLink: '!text-[#FF0077] hover:!text-[#ff3399] !font-bold transition-colors duration-200 !ml-1',
    footerActionText: '!text-[#A1A1A1] !text-sm',

    // ── Identity preview (after entering email) ──
    identityPreview: '!bg-white/[0.04] !border-2 !border-white/10 !rounded-xl !py-3.5 !px-5',
    identityPreviewEditButton: '!text-[#FF0077] hover:!text-[#ff3399]',
    identityPreviewText: '!text-white',

    // ── Verification / OTP ──
    formResendCodeLink: '!text-[#FF0077] hover:!text-[#ff3399]',
    otpCodeFieldInput: [
      '!border-2 !border-white/10 !bg-[#0f0f0f] !text-white',
      '!rounded-xl !h-[52px] !w-[52px] !text-lg !font-bold',
      'focus:!border-[#FF0077] focus:!ring-2 focus:!ring-[#FF0077]/15',
      'transition-all duration-200',
    ].join(' '),

    // ── Back link ──
    backLink: '!text-[#FF0077] hover:!text-[#ff3399] transition-colors duration-200',

    // ── Alert / error banners ──
    alert: '!bg-red-500/10 !border-2 !border-red-500/20 !text-red-300 !rounded-xl !text-sm !p-4',
    alertText: '!text-red-300',

    // ── Internal spacing ──
    main: '!px-10 !py-8',

    // ── Clerk badge ──
    footerPages: '!mt-5 !opacity-40 hover:!opacity-70 transition-opacity duration-200',
  },
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkAppearance}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)
