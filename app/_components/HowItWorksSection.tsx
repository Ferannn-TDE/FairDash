'use client'

import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Reveal, TIMING } from '@/components/animations/motion'
import { MapPinIcon, BuildingStorefrontIcon, ShoppingBagIcon } from '@heroicons/react/24/outline'

const STEPS = [
  {
    number: '01',
    title: 'Find a Fair',
    description: 'Discover events happening near you. Live, upcoming, and more.',
    Icon: MapPinIcon,
  },
  {
    number: '02',
    title: 'Browse Vendors',
    description: "Explore every food vendor's full menu before you even arrive.",
    Icon: BuildingStorefrontIcon,
  },
  {
    number: '03',
    title: 'Order & Enjoy',
    description: 'Pay ahead, skip the line, and pick up your order fresh.',
    Icon: ShoppingBagIcon,
  },
]

// ── Desktop connector with animated draw + arrowhead ─────────────────────────

function DesktopConnector({ idx }: { idx: number }) {
  return (
    <motion.div
      className="hidden sm:flex items-center self-center shrink-0 w-8 md:w-12"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 0.7 + idx * 0.1, duration: 0.4 }}
    >
      <div className="flex-1 border-t-2 border-dashed border-[#FF0077]/40" />
      <svg width="6" height="8" viewBox="0 0 6 8" className="shrink-0 -ml-px" aria-hidden>
        <path d="M0 0 L6 4 L0 8" fill="rgba(255,0,119,0.4)" />
      </svg>
    </motion.div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export default function HowItWorksSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [isHovering, setIsHovering] = useState(false)

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!sectionRef.current) return
    const rect = sectionRef.current.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <section
      ref={sectionRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="relative py-12 sm:py-20 px-5 sm:px-[6%] lg:px-8 overflow-hidden"
    >
      {/* Cursor glow — raw CSS left/top (no transition on position), only opacity transitions */}
      <div
        className="pointer-events-none absolute z-0 transition-opacity duration-300"
        style={{
          left: mousePos.x - 200,
          top: mousePos.y - 200,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,0,119,0.12) 0%, transparent 70%)',
          opacity: isHovering ? 1 : 0,
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto">

        {/* Header */}
        <Reveal className="text-center mb-12 sm:mb-16">
          <p className="text-text-gray text-xs sm:text-sm font-semibold uppercase tracking-widest mb-3">
            Simple by design
          </p>
          <h2 className="font-bebas text-3xl sm:text-4xl md:text-5xl text-white tracking-wide">
            How It <span className="text-neon-pink">Works</span>
          </h2>
        </Reveal>

        {/* ── Fix 6: Mobile layout — vertical flow with dots + arrows ── */}
        <div className="sm:hidden relative">
          {/* Vertical dashed line behind cards */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-3 bottom-10 pointer-events-none"
            style={{ width: 2, borderLeft: '2px dashed rgba(255,0,119,0.25)' }}
          />
          <div className="flex flex-col items-center gap-4">
            {STEPS.map((step, i) => (
              <div key={step.number} className="relative w-full max-w-[320px]">
                {/* Connector dot on the line */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 w-6 h-6 rounded-full bg-bg-dark border-2 border-neon-pink flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-neon-pink" />
                </div>
                {/* Card */}
                <div className="mt-4 bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col items-center text-center">
                  <step.Icon className="w-6 h-6 mb-3 text-neon-pink" />
                  <p className="font-bebas text-3xl mb-1" style={{ color: 'rgba(255,0,119,0.35)' }}>
                    {step.number}
                  </p>
                  <h3 className="font-bebas text-lg text-white tracking-wide mb-2">{step.title}</h3>
                  <p className="text-text-gray text-sm leading-relaxed">{step.description}</p>
                </div>
                {/* Down arrow between cards */}
                {i < STEPS.length - 1 && (
                  <div className="flex justify-center mt-2 mb-2" aria-hidden>
                    <svg width="12" height="16" viewBox="0 0 12 16">
                      <path
                        d="M6 0 L6 12 M1 8 L6 14 L11 8"
                        stroke="rgba(255,0,119,0.5)"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Fix 1: Desktop layout — flex row, uniform min-height cards ── */}
        <div className="hidden sm:flex items-stretch">
          {STEPS.map((step, i) => (
            <div key={step.number} className="contents">
              <Reveal delay={i * TIMING.staggerSlow} className="flex-1">
                {/* Fix 1A: min-h-[260px] + flex-col so all cards same height */}
                <div className="group bg-bg-card border border-white/10 rounded-2xl p-6 md:p-7 w-full h-full
                                flex flex-col items-center text-center
                                min-h-[240px] md:min-h-[260px]
                                hover:border-[#FF0077]/30 hover:shadow-[0_0_40px_rgba(255,0,119,0.08)]
                                transition-all duration-300">
                  <step.Icon className="w-8 h-8 md:w-10 md:h-10 mb-3 text-neon-pink group-hover:scale-110 transition-transform duration-300" />
                  <p className="font-bebas text-4xl md:text-5xl mb-2" style={{ color: 'rgba(255,0,119,0.3)' }}>
                    {step.number}
                  </p>
                  <h3 className="font-bebas text-lg md:text-xl text-white tracking-wide mb-2">{step.title}</h3>
                  {/* flex-1 pushes description to fill remaining space → equal card heights */}
                  <p className="text-text-gray text-sm leading-relaxed flex-1">{step.description}</p>
                </div>
              </Reveal>
              {i < STEPS.length - 1 && <DesktopConnector idx={i} />}
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
