'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/clerk-react'
import {
  AUDIENCES,
  AUDIENCE_HREF,
  AUDIENCE_ORDER,
  DEFAULT_TAB,
  FAQ_HEADER,
  HOW_IT_WORKS,
  VENDOR_SIGNUP_SIGNED_IN,
  VENDOR_SIGNUP_SIGNED_OUT,
  type AudienceKey,
} from '@/lib/homepage-copy'

// The one link every homepage path uses (tiles, hero button, tab buttons, "Pick your path").
// The vendor path depends on sign-in: /onboarding?role=vendor bounces a signed-out visitor to the
// fairgoer sign-in, so signed-out visitors start on the vendor sign-up tab instead. Until Clerk has
// loaded, the signed-out path is used; it also continues to /onboarding?role=vendor after sign-up.
export function AudienceLink({ audience, className, children }: { audience: AudienceKey; className: string; children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser()
  const href = audience === 'vendor'
    ? (isLoaded && isSignedIn === true ? VENDOR_SIGNUP_SIGNED_IN : VENDOR_SIGNUP_SIGNED_OUT)
    : AUDIENCE_HREF[audience]
  return <Link href={href} className={className}>{children}</Link>
}

export default function HomeAudienceSections() {
  const [selected, setSelected] = useState<AudienceKey>(DEFAULT_TAB)
  const [openFaq, setOpenFaq] = useState<number>(0)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const baseId = useId()
  const audience = AUDIENCES[selected]

  const choose = (key: AudienceKey) => {
    setSelected(key)
    setOpenFaq(0)
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern), Home/End jump to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = AUDIENCE_ORDER.indexOf(selected)
    const last = AUDIENCE_ORDER.length - 1
    const next =
      e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) :
      e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) :
      e.key === 'Home' ? 0 :
      e.key === 'End' ? last : -1
    if (next < 0) return
    e.preventDefault()
    const key = AUDIENCE_ORDER[next]
    choose(key)
    tabRefs.current[key]?.focus()
  }

  return (
    <>
      <section id="how" className="max-w-[720px] mx-auto px-5 py-8 border-t border-[#1F1F1F] flex flex-col gap-[18px] scroll-mt-20">
        <p className="m-0 text-xs font-bold tracking-[2.5px] text-[#FF3D94]">{HOW_IT_WORKS.eyebrow}</p>
        <h2 className="m-0 font-bebas font-normal text-[46px] leading-[0.95]">
          {HOW_IT_WORKS.heading} <span className="text-neon-pink">{HOW_IT_WORKS.headingAccent}</span>
        </h2>

        <div role="tablist" aria-label={HOW_IT_WORKS.tabsLabel} className="flex gap-2 overflow-x-auto pb-1">
          {AUDIENCE_ORDER.map(key => {
            const on = key === selected
            return (
              <button
                key={key}
                ref={el => { tabRefs.current[key] = el }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${key}`}
                aria-selected={on}
                aria-controls={`${baseId}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(key)}
                onKeyDown={onTabKey}
                className={`shrink-0 min-h-[44px] px-4 rounded-full border font-inter text-[15px] cursor-pointer transition-colors ${
                  on ? 'border-neon-pink bg-[#2A0014] text-[#FF3D94] font-bold' : 'border-[#2E2E2E] bg-transparent text-[#B3B3B3] font-semibold hover:text-white'
                }`}
              >
                {AUDIENCES[key].name}
              </button>
            )
          })}
        </div>

        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${selected}`} className="flex flex-col gap-3">
          <ol className="m-0 p-0 list-none flex flex-col gap-3">
            {audience.steps.map(([title, text], i) => (
              <li key={title} className="flex gap-4 items-start p-[18px] bg-bg-card border border-[#2E2E2E] rounded-2xl">
                <span aria-hidden="true" className="font-bebas text-[40px] leading-[0.9] text-neon-pink min-w-[40px]">0{i + 1}</span>
                <div className="flex flex-col gap-1">
                  <span className="font-bebas text-2xl leading-[1.05]">{title}</span>
                  <span className="text-[15px] leading-[1.45] text-[#B3B3B3]">{text}</span>
                </div>
              </li>
            ))}
          </ol>
          <AudienceLink
            audience={selected}
            className="flex items-center justify-center min-h-[56px] rounded-2xl bg-neon-pink text-white no-underline text-[19px] font-bold hover:bg-[#e0006b] transition-colors"
          >
            {audience.cta}
          </AudienceLink>
        </div>
      </section>

      <section id="faq" className="max-w-[720px] mx-auto px-5 py-8 border-t border-[#1F1F1F] flex flex-col gap-3.5 scroll-mt-20">
        <p className="m-0 text-xs font-bold tracking-[2.5px] text-[#FF3D94]">{FAQ_HEADER.eyebrow}</p>
        <h2 className="m-0 font-bebas font-normal text-[46px] leading-[0.95]">
          {FAQ_HEADER.heading} <span className="text-neon-pink">{FAQ_HEADER.headingAccent}</span>
        </h2>
        <p className="m-0 text-[15px] text-[#B3B3B3]">
          {FAQ_HEADER.showingFor} <strong className="text-white">{audience.name.toLowerCase()}</strong>. {FAQ_HEADER.pickAnother}
        </p>
        <div className="flex flex-col gap-2.5">
          {audience.faqs.map(([q, a], i) => {
            const open = i === openFaq
            const answerId = `${baseId}-faq-${i}`
            return (
              <div key={q} className="bg-bg-card border border-[#2E2E2E] rounded-[14px]">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={answerId}
                  onClick={() => setOpenFaq(open ? -1 : i)}
                  className="w-full flex items-center justify-between gap-3 min-h-[56px] px-4 py-3.5 bg-transparent border-0 text-white font-inter text-base font-semibold text-left cursor-pointer"
                >
                  <span>{q}</span>
                  <span aria-hidden="true" className={`text-[22px] ${open ? 'text-neon-pink' : 'text-[#B3B3B3]'}`}>{open ? '−' : '+'}</span>
                </button>
                <p id={answerId} hidden={!open} className="m-0 px-4 pb-4 text-[15px] leading-normal text-[#B3B3B3]">{a}</p>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
