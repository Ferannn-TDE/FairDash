'use client'

import { useEffect, type RefObject } from 'react'
import Link from 'next/link'
import { HOME_HEADER } from '@/lib/homepage-copy'

// The Sign in chooser (Homepage v2), shared by the homepage header (HomeHeader) and the header on
// every other page (MarketplaceNavbar). One copy: the sign-in links are listed only here
// (scripts/header-signin-test.ts). It has no wrapper of its own: the parent supplies the
// `relative` box the panel opens under, so on the homepage it sits exactly where it always has.

export const HEADER_PILL = 'inline-flex items-center min-h-[44px] px-4 border border-[#3A3A3A] rounded-full text-white no-underline text-[15px] font-semibold bg-transparent cursor-pointer hover:border-neon-pink transition-colors'
export const HEADER_PANEL_BOX = 'absolute right-0 top-full mt-2 w-56 bg-bg-card border border-[#2E2E2E] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] py-1.5 z-50'
export const HEADER_PANEL_LINK = 'flex items-center min-h-[44px] px-4 text-[15px] text-white no-underline hover:bg-neon-pink/10 hover:text-[#FF3D94] transition-colors'

/** Close an open header panel on Escape, or on a click or tap outside `ref`. `close` must be stable (useCallback). */
export function usePanelDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

export default function SignInChooser({ open, onToggle, onChoose, panelId }: {
  open: boolean
  onToggle: () => void
  onChoose: () => void
  panelId: string
}) {
  return (
    <>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={HEADER_PILL}
      >
        {HOME_HEADER.signIn}
      </button>
      {open && (
        <nav id={panelId} aria-label={HOME_HEADER.signIn} className={HEADER_PANEL_BOX}>
          {HOME_HEADER.signInChoices.map(({ label, href }) => (
            <Link key={href} href={href} onClick={onChoose} className={HEADER_PANEL_LINK}>{label}</Link>
          ))}
        </nav>
      )}
    </>
  )
}
