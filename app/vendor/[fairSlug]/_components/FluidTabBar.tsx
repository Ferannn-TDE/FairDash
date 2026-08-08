'use client'

import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * PRESENTATION ONLY — a moving-pill tab bar.
 *
 * This component does not know what a vendor is, does not filter anything, and holds NO active
 * state. It renders exactly the items it is handed and highlights exactly the key it is told is
 * active. Every decision that matters — WHICH routes an operator may be offered, and WHICH one is
 * current — is made by MobileBottomNav in VendorPortalShell.tsx and passed down as props.
 *
 * That split is deliberate and load-bearing in two directions:
 *
 *  1. The nav list must keep coming from vendorShellNavKeys() inside the shell. A non-admitted
 *     operator gets the carve-out set (2 items) and nothing that re-enters the portal — see
 *     lib/vendor-operator-state.ts:128. If this file ever built its own item array, that filter
 *     would have a second, unfiltered copy, which is the exact hole that filter was added to close.
 *
 *  2. `active` is DERIVED from the URL upstream, never mirrored into state here. A useState +
 *     useEffect(setActive) would render one frame with the wrong pill lit and then snap — the
 *     flicker class scripts/flicker-class-guard.ts exists to catch.
 *
 * The tabs are real next/link <Link>s, not buttons with onClick. The pill animates AROUND them;
 * it does not own the click. Vendors run this on a phone at a booth, so prefetch, real hrefs, and
 * long-press/"open in new tab" all still work.
 */

export interface FluidTab {
  key: string
  label: string
  href: string
  icon: React.ElementType
}

interface Props {
  tabs: readonly FluidTab[]
  /** The key to highlight, already derived from the pathname by the caller. */
  activeKey: string | null
}

// One shared spring for the pill slide and the label reveal, so they read as a single motion
// rather than two effects that happen to fire together.
const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const

export default function FluidTabBar({ tabs, activeKey }: Props) {
  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 pt-2 pointer-events-none"
      // Copies OrganizerShell.tsx:268 — without this the bar sits under the home indicator on a
      // notched phone, which is precisely where a vendor's thumb lands.
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
    >
      <nav
        aria-label="Vendor portal"
        className="pointer-events-auto mx-auto w-fit max-w-full flex items-center gap-0 p-1.5
                   rounded-2xl bg-bg-dark/95 backdrop-blur-md border border-white/[0.06]
                   shadow-[0_8px_28px_rgba(0,0,0,0.55)]"
      >
        {tabs.map(({ key, label, href, icon: Icon }) => {
          const active = key === activeKey
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center justify-center rounded-xl px-3 py-2.5
                          no-underline transition-colors duration-200 ${
                            active ? 'text-neon-pink' : 'text-text-gray hover:text-white'
                          }`}
            >
              {active && (
                <motion.span
                  layoutId="vendorNavPill"
                  transition={SPRING}
                  className="absolute inset-0 rounded-xl bg-neon-pink/10 border border-neon-pink/20"
                />
              )}

              <Icon className="relative w-5 h-5 shrink-0" />

              {/* The label belongs to the ACTIVE tab only — that is what keeps five tabs (one of
                  them two words) inside a 360px screen. Width animates from 0 so the pill grows
                  into the label instead of the row jumping. */}
              <AnimatePresence initial={false}>
                {active && (
                  <motion.span
                    key="label"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={SPRING}
                    className="relative overflow-hidden whitespace-nowrap"
                  >
                    {/* Padding lives INSIDE the animated box: a gap on the flex parent would
                        leave a stray gutter next to a collapsed (width: 0) label. */}
                    <span className="block pl-1.5 text-[0.6875rem] font-semibold leading-none">
                      {label}
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
