/**
 * Facebook mark — heroicons ships no social/brand icons, so this is hand-rolled.
 *
 * ONE copy. The same <svg> was pasted into app/contact/page.tsx and
 * app/MarketplaceLanding.tsx, each with its own local `FacebookIcon` declaration
 * and an identical 400-character path string. Two copies of a thing is how one of
 * them ends up subtly different — and a brand mark that renders differently on
 * two pages is the visible kind of drift.
 *
 * `currentColor` + a `className` pass-through, so callers control size and colour
 * exactly the way they do with a heroicon and this drops into the same slots.
 */
export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export default FacebookIcon
