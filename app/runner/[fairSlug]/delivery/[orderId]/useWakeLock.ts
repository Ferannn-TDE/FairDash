'use client'

import { useEffect, useState } from 'react'

// ─── SCREEN WAKE LOCK — keeps the position feed alive while a delivery is active ─────────────
//
// WHY THIS EXISTS. The runner page shares GPS via navigator.geolocation.watchPosition. When the
// phone's screen sleeps, the browser suspends that watch — so the POSTs stop. Nothing errors.
// The customer keeps seeing the LAST fix, and the only clue is the "updated Ns ago" counter
// climbing. Stale-but-plausible is the dangerous failure mode, not a missing one: a dot that is
// four minutes old looks exactly like a live one if you are not reading the timestamp.
//
// The page already told the runner "Keep this screen on — sharing pauses if your phone sleeps",
// which put the whole burden on a human reading a caption. This makes the browser hold the
// screen instead, and — when it CAN'T — says so plainly rather than degrading in silence.
//
// ── THE THREE WAYS THIS FAILS, ALL HANDLED ───────────────────────────────────────────────────
//   unsupported — no navigator.wakeLock at all (notably iOS Safari before 16.4, which is
//                 exactly the "old phone in a car" case this feature is for).
//   denied      — request() rejects. The spec allows a UA to refuse (low battery is the common
//                 one), and it rejects rather than returning null, so it needs a catch.
//   released    — THE ONE THAT MATTERS MOST. A wake lock is automatically released whenever the
//                 document becomes hidden — switching tabs, taking a call, opening Maps. It does
//                 NOT come back on its own. Without a visibilitychange re-acquire, this feature
//                 would work exactly once and then quietly stop, which is the same silent
//                 failure it was built to remove.
//
// ⛔ NEVER A GATE. This is an aid. No custody action may depend on it, and its failure must
// never block collect / release / return / confirm. A runner whose browser has no wake lock is
// still a runner doing their job — they just get told to keep the screen awake themselves.

export type WakeLockState =
  | 'idle'         // not requested (delivery not active)
  | 'held'         // we hold the lock; the screen should stay on
  | 'unsupported'  // this browser has no Screen Wake Lock API
  | 'denied'       // the browser refused (or the request threw)

export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>('idle')

  useEffect(() => {
    if (!active) { setState('idle'); return }

    // `wakeLock` is still absent from some lib.dom versions; narrow through unknown rather than
    // widening the global Navigator type for one call site.
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    if (!nav.wakeLock) { setState('unsupported'); return }

    let cancelled = false
    let sentinel: WakeLockSentinelLike | null = null

    const acquire = async () => {
      // Requesting while hidden always rejects — skip rather than reporting a false 'denied'.
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        sentinel = await nav.wakeLock!.request('screen')
        if (cancelled) { void sentinel.release().catch(() => {}); return }
        setState('held')
        // Fires on automatic release too (tab hidden), so the UI stops claiming 'held' the
        // moment it stops being true.
        sentinel.addEventListener?.('release', () => {
          if (!cancelled) setState(s => (s === 'held' ? 'idle' : s))
        })
      } catch {
        if (!cancelled) setState('denied')
      }
    }

    // Re-acquire when the page becomes visible again — the automatic release on hide is not
    // recoverable any other way.
    const onVisibility = () => { if (document.visibilityState === 'visible') void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])

  return state
}

/** The slice of WakeLockSentinel we use — typed locally so this compiles on any lib.dom. */
interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener?: (type: 'release', listener: () => void) => void
}
