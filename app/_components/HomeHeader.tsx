'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/clerk-react'
import { HOME_HEADER } from '@/lib/homepage-copy'
import SignInChooser, { HEADER_PANEL_BOX, HEADER_PANEL_LINK, HEADER_PILL, usePanelDismiss } from './SignInChooser'

type Panel = 'signin' | 'menu' | null

// Homepage-only header (design v2). The Sign in chooser is shared with MarketplaceNavbar, the header
// on every other page (app/_components/SignInChooser.tsx); the ☰ menu is homepage-only.
export default function HomeHeader() {
  const { isLoaded, isSignedIn } = useUser()
  const [panel, setPanel] = useState<Panel>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closePanel = useCallback(() => setPanel(null), [])

  // Close on Esc or a tap outside the header controls.
  usePanelDismiss(wrapRef, panel !== null, closePanel)

  const toggle = (p: Exclude<Panel, null>) => setPanel(cur => (cur === p ? null : p))

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 px-5 py-3 bg-bg-dark border-b border-[#262626]">
      <Link href="/" aria-label="FairSynq home" className="font-bebas text-[30px] tracking-[2px] leading-none no-underline text-white">
        FAIR<span className="text-neon-pink">SYNQ</span>
      </Link>

      <div ref={wrapRef} className="relative flex items-center gap-2">
        {/* Account slot. Auth is unknown until Clerk loads (and always on the server): hold a
            fixed footprint instead of guessing, so nobody sees the wrong button flash
            (flicker-class-guard [J]). */}
        {!isLoaded ? (
          <div aria-hidden="true" className="w-[5.5rem] h-11" />
        ) : isSignedIn === true ? (
          <Link href={HOME_HEADER.account.href} className={HEADER_PILL}>{HOME_HEADER.account.label}</Link>
        ) : (
          <SignInChooser open={panel === 'signin'} onToggle={() => toggle('signin')} onChoose={closePanel} panelId="home-signin-panel" />
        )}

        <button
          type="button"
          aria-label={HOME_HEADER.menuLabel}
          aria-haspopup="true"
          aria-expanded={panel === 'menu'}
          aria-controls="home-menu-panel"
          onClick={() => toggle('menu')}
          className="inline-flex items-center justify-center w-11 h-11 border border-[#3A3A3A] rounded-full bg-transparent text-white cursor-pointer hover:border-neon-pink transition-colors"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>

        {panel === 'menu' && (
          <nav id="home-menu-panel" aria-label="Menu" className={HEADER_PANEL_BOX}>
            {HOME_HEADER.menu.map(({ label, href }) => (
              <Link key={href} href={href} onClick={() => setPanel(null)} className={HEADER_PANEL_LINK}>{label}</Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
