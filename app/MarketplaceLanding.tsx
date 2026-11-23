'use client'

import type { ReactNode } from 'react'
import HomeHeader from './_components/HomeHeader'
import HomeAudienceSections, { AudienceLink } from './_components/HomeAudienceSections'
import {
  HOME_FOOTER,
  HOME_HERO,
  HOME_STRIP,
  HOME_TILES,
  PICK_YOUR_PATH,
  WHO_ARE_YOU,
  type AudienceKey,
} from '@/lib/homepage-copy'

// Homepage v2 (design approved 2026-11-22: homepage-v2-design.html). All wording and links come
// from lib/homepage-copy.ts; scripts/homepage-stats-guard.ts locks them.

// ── Icons (from the design) ───────────────────────────────────────────────────────────────────

function Icon({ children, pink = true }: { children: ReactNode; pink?: boolean }) {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={pink ? '#FF0077' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const TILE_ICONS: Record<AudienceKey, ReactNode> = {
  food: <><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  vendor: <><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9h16v2a3 3 0 0 1-5.3 2A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1A3 3 0 0 1 4 11V9z" /><path d="M5 14v6h14v-6" /></>,
  organizer: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  group: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
}

const STRIP_ICONS: ReactNode[] = [
  <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M3 3l18 18" /></>,
  <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M11 17h2" /></>,
  <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></>,
]

// ── Hero + "Who are you?" tiles ───────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="max-w-[1040px] mx-auto px-5 pt-9 pb-7 flex flex-col gap-[18px]">
      <p className="m-0 text-xs font-bold tracking-[2.5px] text-[#FF3D94]">{HOME_HERO.eyebrow}</p>
      <h1 className="m-0 font-bebas font-normal text-[68px] lg:text-[96px] leading-[0.92] tracking-[0.5px]">
        {HOME_HERO.headingLine1}
        <br />
        <span className="text-neon-pink">{HOME_HERO.headingLine2}</span>
      </h1>
      <p className="m-0 text-[17px] leading-normal text-[#B3B3B3] max-w-2xl">{HOME_HERO.subhead}</p>
      <AudienceLink
        audience="vendor"
        className="self-start inline-flex items-center min-h-[44px] px-[18px] rounded-full bg-[#2A0014] border border-neon-pink text-[#FF3D94] no-underline text-[15px] font-bold hover:bg-[#3A001C] transition-colors"
      >
        {HOME_HERO.vendorButton}
      </AudienceLink>

      <p className="mt-2.5 mb-0 text-[13px] font-bold tracking-[2px] text-white">{WHO_ARE_YOU}</p>
      {/* Two across on phones, four across from laptop width. */}
      <div id="paths" className="grid grid-cols-2 lg:grid-cols-4 gap-3 scroll-mt-20">
        {HOME_TILES.map(({ key, title, line }) => {
          const food = key === 'food'
          return (
            <AudienceLink
              key={key}
              audience={key}
              className={`flex flex-col gap-2.5 p-4 min-h-[150px] rounded-[18px] no-underline text-white transition-colors ${
                food ? 'bg-neon-pink hover:bg-[#e0006b]' : 'bg-bg-card border border-[#2E2E2E] hover:border-neon-pink'
              }`}
            >
              <Icon pink={!food}>{TILE_ICONS[key]}</Icon>
              <span className="font-bebas text-[26px] leading-none">{title}</span>
              <span className={`text-sm leading-[1.35] ${food ? 'text-white font-semibold' : 'text-[#B3B3B3]'}`}>{line}</span>
            </AudienceLink>
          )
        })}
      </div>
    </section>
  )
}

// ── Three-item strip ──────────────────────────────────────────────────────────────────────────

function Strip() {
  return (
    <section className="max-w-[1040px] mx-auto px-5 pt-2 pb-9">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[18px] px-4 py-[22px] border border-[#2E2E2E] rounded-[18px] bg-[#151515] text-center">
        {HOME_STRIP.map(({ title, line }, i) => (
          <div key={title} className="flex flex-col items-center gap-1.5">
            <Icon>{STRIP_ICONS[i]}</Icon>
            <span className="font-bebas text-[30px] leading-none text-white">{title}</span>
            <span className="text-sm text-[#B3B3B3]">{line}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Ready? Pick your path ─────────────────────────────────────────────────────────────────────

function PickYourPath() {
  const last = PICK_YOUR_PATH.links.length - 1
  return (
    <section className="max-w-[720px] mx-auto px-5 pt-8 pb-10">
      <div className="flex flex-col gap-3.5 px-5 py-6 border border-neon-pink rounded-[20px] bg-[#160009]">
        <h2 className="m-0 font-bebas font-normal text-[40px] leading-[0.95]">
          {PICK_YOUR_PATH.heading} <span className="text-neon-pink">{PICK_YOUR_PATH.headingAccent}</span>
        </h2>
        {PICK_YOUR_PATH.links.map(({ key, label }, i) => (
          <AudienceLink
            key={key}
            audience={key}
            className={`flex items-center justify-between min-h-[52px] px-1 text-white no-underline text-[17px] font-semibold hover:text-[#FF3D94] transition-colors ${
              i < last ? 'border-b border-[#2E2E2E]' : ''
            }`}
          >
            {label} <span aria-hidden="true" className="text-neon-pink">→</span>
          </AudienceLink>
        ))}
      </div>
    </section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────────────────────

function HomeFooter() {
  return (
    <footer className="max-w-[720px] mx-auto px-5 pt-7 pb-10 border-t border-[#1F1F1F] flex flex-col gap-3">
      <span className="font-bebas text-[26px] tracking-[2px]">
        FAIR<span className="text-neon-pink">SYNQ</span>
      </span>
      <p className="m-0 text-sm text-[#B3B3B3]">
        {HOME_FOOTER.questionsLead}{' '}
        <a href={`mailto:${HOME_FOOTER.supportEmail}`} className="text-[#FF3D94] hover:text-[#FF73B0]">{HOME_FOOTER.supportEmail}</a>
      </p>
      <p className="m-0 text-[13px] text-[#8C8C8C]">{HOME_FOOTER.copyright}</p>
    </footer>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────

export default function MarketplaceLanding() {
  return (
    <div className="min-h-screen bg-bg-dark text-white font-inter">
      <HomeHeader />
      <main>
        <Hero />
        <Strip />
        <HomeAudienceSections />
        <PickYourPath />
      </main>
      <HomeFooter />
    </div>
  )
}
