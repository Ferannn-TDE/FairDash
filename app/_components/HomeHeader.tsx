'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/clerk-react'
import { HOME_HEADER } from '@/lib/homepage-copy'

type Panel = 'signin' | 'menu' | null

// Homepage-only header (design v2). The shared MarketplaceNavbar is not touched: other pages
// (/become-vendor, /partners, /fairs, /account …) keep it as is.
export default function HomeHeader() {
  const { isLoaded, isSignedIn } = useUser()
  const [panel, setPanel] = useState<Panel>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on Esc or a tap outside the header controls.
  useEffect(() => {
    if (!panel) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPanel(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  const toggle = (p: Exclude<Panel, null>) => setPanel(cur => (cur === p ? null : p))
  const pill = 'inline-flex items-center min-h-[44px] px-4 border border-[#3A3A3A] rounded-full text-white no-underline text-[15px] font-semibold bg-transparent cursor-pointer hover:border-neon-pink transition-colors'
  const panelBox = 'absolute right-0 top-full mt-2 w-56 bg-bg-card border border-[#2E2E2E] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] py-1.5 z-50'
  const panelLink = 'flex items-center min-h-[44px] px-4 text-[15px] text-white no-underline hover:bg-neon-pink/10 hover:text-[#FF3D94] transition-colors'

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
          <Link href={HOME_HEADER.account.href} className={pill}>{HOME_HEADER.account.label}</Link>
        ) : (
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={panel === 'signin'}
            aria-controls="home-signin-panel"
            onClick={() => toggle('signin')}
            className={pill}
          >
            {HOME_HEADER.signIn}
          </button>
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

        {panel === 'signin' && (
          <nav id="home-signin-panel" aria-label={HOME_HEADER.signIn} className={panelBox}>
            {HOME_HEADER.signInChoices.map(({ label, href }) => (
              <Link key={href} href={href} onClick={() => setPanel(null)} className={panelLink}>{label}</Link>
            ))}
          </nav>
        )}
        {panel === 'menu' && (
          <nav id="home-menu-panel" aria-label="Menu" className={panelBox}>
            {HOME_HEADER.menu.map(({ label, href }) => (
              <Link key={href} href={href} onClick={() => setPanel(null)} className={panelLink}>{label}</Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
