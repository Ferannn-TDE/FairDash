'use client'

import { useEffect, useRef, useState } from 'react'
import type { VideoSource } from '@/lib/videos'

// The one video component (item 12, B1.15).
//  - nothing renders without a source, or once the file fails to load
//  - no src until the player is near the viewport (preload="none" too), so no video bytes
//    are fetched before the visitor scrolls to it
//  - pitch videos autoplay muted and loop, inline on iPhone; controls let the visitor unmute.
//    Visitors who ask for reduced motion get no autoplay, just the poster and controls.
export default function PitchVideo({ source, label, autoPlay = true, className = '' }: {
  source: VideoSource | null
  label: string
  autoPlay?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [near, setNear] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true) // assume reduced until we know: never autoplay by surprise

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const on = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near, source?.url])

  const auto = autoPlay && !reducedMotion
  // React does not reliably write the muted ATTRIBUTE, and iPhone Safari only autoplays a video
  // that is muted, so set the property on the element itself.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = auto
    if (auto && near) el.play().catch(() => { /* blocked (Low Power Mode): the poster and controls stay */ })
  }, [auto, near])

  if (!source || failed) return null

  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-black aspect-video ${className}`}>
      <video
        ref={ref}
        key={source.url}
        src={near ? source.url : undefined}
        poster={source.posterUrl ?? undefined}
        preload="none"
        playsInline
        muted={auto}
        loop={auto}
        autoPlay={auto}
        controls
        aria-label={label}
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    </div>
  )
}
