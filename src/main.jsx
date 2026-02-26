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
 * Clerk appearance — FairDash × Spotify-style layout.
 *
 * Design tokens:
 *   neon-pink: #FF0077 | pure-black: #000000 | bg-input: #121212 | text-muted: #b3b3b3
 */
const clerkAppearance = {
  baseTheme: dark,

  variables: {
    colorPrimary: '#FF0077',
    colorDanger: '#ef4444',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',

    colorBackground: '#0f0f0f',
    colorInputBackground: '#121212',

    colorText: '#ffffff',
    colorTextSecondary: '#b3b3b3',
    colorTextOnPrimaryBackground: '#000000',

    colorNeutral: '#535353',

    fontFamily: 'Inter, sans-serif',
    fontFamilyButtons: 'Inter, sans-serif',
    fontSize: '1rem',
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },

    borderRadius: '62.5rem',
    spacing: '1rem',
  },

  layout: {
    logoImageUrl: '/images/image4.png',
    logoLinkUrl: '/home',
    logoPlacement: 'inside',
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
    showOptionalFields: false,
    animations: true,
    shimmer: false,
    termsPageUrl: '/refund-policy',
    privacyPageUrl: '/refund-policy',
  },

  elements: {
    // ── Root & modal ──
    rootBox: 'w-full',
    modalBackdrop: '!bg-black/80 !backdrop-blur-sm',
    modalContent: '!bg-black !border-0 !rounded-lg !shadow-none',
    cardBox: '!rounded-lg',

    // ── Card — pure black, no border ──
    card: '!bg-black !border-0 !shadow-none !rounded-lg !py-12 !px-6 !max-w-[28rem] !mx-auto',

    // ── Logo & header ──
    logoBox: '!justify-center !mb-12',
    logoImage: '!h-24 !w-auto !mix-blend-screen ![filter:brightness(1.2)]',
    headerTitle: '!text-[2rem] !font-bold !text-white !mb-8 !text-center !tracking-[0.02em]',
    headerSubtitle: '!hidden',

    // ── Social buttons — full-width pill, stacked ──
    socialButtonsProviders: '!gap-3 !w-full !flex !flex-col',
    socialButtonsBlockButton: [
      '!relative !w-full !h-12 !rounded-[62.5rem]',
      '!border !border-[#727272] !bg-transparent',
      '!text-white !font-bold',
      'hover:!border-white hover:!bg-white/[0.05] hover:!scale-[1.02]',
      'active:!scale-[0.98]',
      'transition-all !duration-200',
    ].join(' '),
    socialButtonsBlockButtonText: '!text-white !font-bold',
    socialButtonsProviderIcon: '!w-6 !h-6',

    // ── Divider ──
    dividerRow: '!my-8',
    dividerLine: '!bg-[#292929]',
    dividerText: '!hidden',

    // ── Form fields ──
    formFieldRow: '!mb-4',
    formFieldLabel: '!text-white !text-[0.875rem] !font-bold !mb-2 !tracking-[0.02em]',
    formFieldHintText: '!hidden',
    formFieldInput: [
      '!bg-[#121212] !border !border-[#727272] !text-white',
      '!rounded-[0.25rem] !py-3.5 !px-4 !text-[1rem] !min-h-[3rem]',
      'placeholder:!text-[#6a6a6a]',
      'focus:!border-white focus:!ring-0 focus:!shadow-none',
      'hover:!border-white',
      'transition-all !duration-200',
    ].join(' '),
    formFieldInputShowPasswordButton: '!text-[#b3b3b3] hover:!text-white !mr-1',
    formFieldErrorText: '!text-[#f15e6c] !text-[0.875rem] !mt-1',

    // ── Primary CTA — pill, black text ──
    formButtonPrimary: [
      '!bg-[#FF0077] hover:!bg-[#ff3399]',
      '!text-[#000000] !font-bold uppercase !tracking-[0.1em]',
      '!min-h-[3.5rem] !rounded-[62.5rem]',
      '!shadow-none',
      'hover:!scale-[1.02]',
      'active:!scale-[0.98]',
      'transition-all !duration-200',
      '!mt-8',
    ].join(' '),

    // ── Footer ──
    footer: '!mt-8',
    footerAction: '!pt-8 ![border-top:1px_solid_#292929] !justify-center',
    footerActionLink: '!text-white hover:!text-[#FF0077] !font-semibold transition-colors !duration-200 !ml-1 !underline',
    footerActionText: '!text-[#b3b3b3]',

    // ── Identity preview (after entering email) ──
    identityPreview: '!bg-white/[0.04] !border !border-[#727272] !rounded-[0.25rem] !py-3.5 !px-4',
    identityPreviewEditButton: '!text-[#FF0077] hover:!text-[#ff3399]',
    identityPreviewText: '!text-white !text-[0.875rem]',

    // ── Verification / OTP ──
    formResendCodeLink: '!text-[#FF0077] hover:!text-[#ff3399]',
    otpCodeFieldInput: [
      '!border !border-[#727272] !bg-[#121212] !text-white',
      '!rounded-[0.25rem] !h-[3rem] !w-[3rem] !text-xl !font-bold',
      'focus:!border-white focus:!ring-0 focus:!shadow-none',
      'transition-all !duration-200',
    ].join(' '),

    // ── Back link ──
    backLink: '!text-white hover:!text-[#FF0077] !underline transition-colors !duration-200',

    // ── Forgot password / form actions ──
    formFieldAction: '!text-white hover:!text-[#FF0077] !font-semibold !underline transition-colors !duration-200',

    // ── Alert / error banners ──
    alert: '!bg-[#2e77d0]/10 !border !border-[#2e77d0]/20 !text-white !rounded-[0.25rem] !text-sm !p-4',
    alertText: '!text-white !text-[0.875rem]',

    // ── Badge — float above button, don't affect spacing ──
    badge: '!absolute !-top-2 !right-4 !bg-transparent !text-[#b3b3b3] !text-[0.75rem] !font-medium !p-0 !border-0 !shadow-none !z-10 !m-0 !leading-none',

    // ── Hide Clerk branding ──
    footerPages: '!hidden',
  },
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkAppearance}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)
