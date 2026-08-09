'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'

/**
 * PRESENTATION ONLY — a prev/next pager whose page number rolls like an odometer.
 *
 * Same split as FluidTabBar.tsx, for the same reason: this component holds NO state. Not the
 * page, not the cursor, not the direction of travel. It renders exactly the page it is handed
 * and animates exactly the way it is told. Every decision that matters — which page was
 * actually FETCHED, whether another one exists, which way the user just moved — is made by the
 * list that owns the data and passed down as props.
 *
 * That split is load-bearing in three directions:
 *
 *  1. NO useState HERE. The source this is adapted from tracked the previous digits in state
 *     and reconciled them DURING RENDER (`if (prevDigits !== digits) setPrevDigits(...)` in the
 *     render body). Update-during-render is the flicker class this repo has fixed eight times
 *     and guards in scripts/flicker-class-guard.ts: it renders one frame of a stale value and
 *     then corrects it. The rework is not "move that into useEffect" — it is to need no
 *     previous-value state at all. AnimatePresence already knows a digit changed, because the
 *     key changed. The only thing a diff could tell us that a key cannot is which DIRECTION to
 *     roll, and the caller already knows that: it just handled the click.
 *
 *  2. `page` MUST be derived upstream from fetched data, never mirrored from a click. A pager
 *     that increments its own counter on click will happily read "3 of 8" over page 2's rows
 *     the moment a fetch fails or races. This component cannot make that mistake because it
 *     has no counter to increment.
 *
 *  3. NO JUMP-TO-PAGE. There are deliberately no numbered buttons. The list behind this is
 *     cursor-paginated (lib/vendor-order-history.ts) — "the row after this id" — so page 7 has
 *     no address until pages 2–6 have been walked. Rendering buttons that cannot honour a click
 *     would be a lie, and at 360px (a vendor on a phone at their booth) fifteen of them would
 *     not fit anyway.
 */

interface Props {
  /** 1-based, DERIVED from what was actually fetched (e.g. cursorStack.length + 1). */
  page: number
  /** Total pages for the CURRENT filter. Caller computes it from a real server-side count. */
  totalPages: number
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  /** A page fetch is in flight — both arrows lock so a double-tap can't skip a page. */
  busy?: boolean
  /** Which way the last move went: 1 forward, -1 back. Drives the roll; the caller knows it. */
  direction?: 1 | -1
}

const ARROW_BASE =
  'h-11 w-11 shrink-0 grid place-items-center rounded-xl text-base transition-colors duration-200 border'

const ARROW_ENABLED =
  'bg-neon-pink border-neon-pink text-white hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] cursor-pointer'

// Disabled is a real state, not a dimmed enabled one: no pink, no shadow, no pointer.
const ARROW_DISABLED =
  'bg-white/5 border-white/10 text-white/25 cursor-not-allowed'

export default function AnimatedPagination({
  page,
  totalPages,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  busy = false,
  direction = 1,
}: Props) {
  const prevDisabled = !hasPrev || busy
  const nextDisabled = !hasNext || busy

  return (
    <div className="w-full flex items-center justify-between gap-3 bg-bg-card border border-white/10 rounded-2xl p-1.5">
      <button
        type="button"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous page"
        className={`${ARROW_BASE} ${prevDisabled ? ARROW_DISABLED : ARROW_ENABLED}`}
      >
        <FiChevronLeft />
      </button>

      <p
        className="flex items-center gap-1.5 text-xs font-semibold text-text-gray select-none"
        // The whole indicator is one announcement — a screen reader should hear "Page 3 of 8",
        // not each digit as it rolls in.
        aria-live="polite"
        aria-label={`Page ${page} of ${totalPages}`}
      >
        <span className="uppercase tracking-wide text-[0.6875rem]">Page</span>
        <RollingNumber value={page} direction={direction} />
        <span className="text-[0.6875rem]">of {totalPages}</span>
      </p>

      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Next page"
        className={`${ARROW_BASE} ${nextDisabled ? ARROW_DISABLED : ARROW_ENABLED}`}
      >
        <FiChevronRight />
      </button>
    </div>
  )
}

/**
 * The odometer. Each digit position owns its own AnimatePresence, keyed by the digit itself —
 * so 9 → 10 rolls only the places that actually changed, and a re-render for any other reason
 * (a `busy` toggle, a parent update) animates nothing, because no key moved.
 */
function RollingNumber({ value, direction }: { value: number; direction: 1 | -1 }) {
  const digits = String(value).split('')

  return (
    <span className="inline-flex text-sm font-bold text-white tabular-nums" aria-hidden="true">
      {digits.map((digit, i) => (
        // Position-keyed wrapper: a fixed slot the digit rolls through. overflow-hidden is what
        // makes it read as a wheel rather than a fade.
        <span key={i} className="relative inline-block w-[0.6em] h-[1.35em] overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={digit}
              // Forward: the new digit rises from below and the old one leaves upward.
              // Back: exactly reversed, so Previous feels like rewinding, not another step on.
              initial={{ y: `${direction * 100}%`, opacity: 0 }}
              animate={{ y: '0%', opacity: 1 }}
              exit={{ y: `${direction * -100}%`, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
              className="absolute inset-0 grid place-items-center"
            >
              {digit}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
