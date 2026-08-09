'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { PlusIcon, MinusIcon } from '@heroicons/react/24/outline'
import { ShoppingBag, Store, Truck, CalendarDays } from 'lucide-react'
import { EASE, TIMING, Reveal } from '@/components/animations/motion'
import { FAQ_CATEGORIES } from './faq-content'

/**
 * Landing-page FAQ — tabbed, one category visible at a time.
 *
 * Content is NOT owned here. It comes from ./faq-content, which app/faq/page.tsx
 * also reads — the stacked server-rendered page and this tabbed client section
 * are two renderers over one array, so the 15 answers can never drift apart.
 *
 * Both motions are copied from patterns this codebase already owns rather than
 * invented:
 *   • the moving pill is FluidTabBar's layoutId trick
 *     (app/vendor/[fairSlug]/_components/FluidTabBar.tsx:74-78) — one <motion.span>
 *     with a shared layoutId makes framer-motion SLIDE the pill between tabs
 *     instead of cross-fading it out and back in.
 *   • the answer expands via height:'auto', which framer-motion measures for us.
 *     A CSS max-height hack would need a magic number bigger than the tallest
 *     answer, and eases wrong for every answer shorter than it.
 *
 * REDUCED MOTION is honoured the way Reveal does it (components/animations/motion.tsx:108-111):
 * when the OS asks for less motion, the pill stops sliding and the answer stops
 * gliding — but every tab and every answer still works. That degradation is house
 * behaviour, not a nicety.
 */

// Same spring as the vendor tab bar (FluidTabBar.tsx:45), so the two pills in the
// product read as one motion language.
const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  customers:  ShoppingBag,
  vendors:    Store,
  runners:    Truck,
  organizers: CalendarDays,
}

export default function FAQSection() {
  const [activeTab, setActiveTab] = useState(0)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const prefersReduced = useReducedMotion()

  const active = FAQ_CATEGORIES[activeTab]

  // Switching category closes whatever was open — otherwise an index from the
  // previous tab can collide with a different question in the new one.
  const selectTab = (i: number) => {
    setActiveTab(i)
    setOpenItem(null)
  }

  return (
    <section className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] lg:px-8 py-12 sm:py-20">
      <Reveal className="text-center mb-10">
        <p className="text-[11px] text-neon-pink font-inter font-semibold uppercase tracking-[0.2em] mb-3">
          Need help?
        </p>
        <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
          Frequently asked <span className="text-neon-pink">questions</span>
        </h2>
        <p className="mt-3 text-text-gray text-sm sm:text-base max-w-xl mx-auto">
          Answers for customers, vendors, runners, and organizers.
        </p>
      </Reveal>

      <div className="max-w-3xl mx-auto">

        {/* ── Category tabs — moving pill ── */}
        <div
          role="tablist"
          aria-label="FAQ categories"
          className="w-fit max-w-full mx-auto mb-8 flex items-center gap-0 p-1.5 rounded-2xl
                     bg-bg-dark/95 backdrop-blur-md border border-white/[0.06] overflow-x-auto"
        >
          {FAQ_CATEGORIES.map((cat, i) => {
            const Icon = CATEGORY_ICONS[cat.id]
            const isActive = i === activeTab
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectTab(i)}
                className={`relative flex items-center gap-1.5 shrink-0 px-4 py-2 rounded-xl
                            text-sm font-medium transition-colors duration-200 ${
                              isActive ? 'text-neon-pink' : 'text-text-gray hover:text-white'
                            }`}
              >
                {isActive && (
                  prefersReduced ? (
                    <span className="absolute inset-0 rounded-xl bg-neon-pink/10 border border-neon-pink/20" />
                  ) : (
                    <motion.span
                      layoutId="faqTabPill"
                      transition={SPRING}
                      className="absolute inset-0 rounded-xl bg-neon-pink/10 border border-neon-pink/20"
                    />
                  )
                )}

                {Icon && <Icon className="relative w-4 h-4 shrink-0" />}
                <span className="relative whitespace-nowrap">{cat.label}</span>
              </button>
            )
          })}
        </div>

        {/* ── Questions for the active category ── */}
        <div className="flex flex-col gap-3">
          {active.items.map((item, i) => {
            const key = `${activeTab}-${i}`
            const isOpen = openItem === key

            const answer = (
              <>
                <p className="px-5 pb-4 text-text-gray text-sm leading-relaxed">{item.a}</p>
                {item.cta && (
                  <a
                    href={item.cta.href}
                    className="inline-block px-5 pb-4 text-neon-pink text-sm font-medium hover:text-white transition-colors"
                  >
                    {item.cta.label} →
                  </a>
                )}
              </>
            )

            return (
              <div
                key={key}
                className={`bg-bg-card rounded-xl border transition-colors ${
                  isOpen ? 'border-neon-pink/20' : 'border-white/10'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenItem(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="text-white text-sm font-medium">{item.q}</span>
                  <span className="shrink-0 w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                    {isOpen
                      ? <MinusIcon className="w-4 h-4 text-neon-pink" />
                      : <PlusIcon className="w-4 h-4 text-text-gray" />}
                  </span>
                </button>

                {prefersReduced ? (
                  isOpen && <div>{answer}</div>
                ) : (
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: TIMING.fast, ease: EASE.smooth }}
                        className="overflow-hidden"
                      >
                        {answer}
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </section>
  )
}
