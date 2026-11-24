// Homepage copy rules (Jordan, 2026-11-23): ONE place for the words the homepage must never say,
// and for the admin-editable vendor sign-up banner text.
//
// scripts/homepage-stats-guard.ts imports these patterns for its negative checks [5], and the
// "Homepage: vendor sign-up banner text" setting (lib/settings.ts) uses parseBannerText as its
// parser, so the save route and the guard can never disagree about what is allowed.
// No database and no React: the guard runs without a database.

import { HOME_HERO } from './homepage-copy'

// ── Words the homepage never says (guard [5], every homepage file and the rendered copy) ──────
export const PCT = /\b1[05]\s*(%|percent\b)/i
export const SOLD_OUT = /\bsold[\s-]*out\b/i
export const DELIVER = /\b(deliver|delivers|delivered|delivering|delivery|deliveries)\b/i
export const COMPETITOR = /\b(DoorDash|Uber|Uber\s*Eats|Grubhub|Postmates|Square|Clover|Shopify|Eventbrite|Waitwhile)\b/i
export const TOAST = /\bToast\b/ // capital T only: "toast" is also the app's notification word
export const GET_STARTED = /get started/i

// The banner text is stricter than the page as a whole: no percentage at all ("100% of tips"
// is fine in the Groups tab, but the banner makes no number-with-% claims).
export const ANY_PCT = /\d\s*(%|percent\b)/i

// ── The hero vendor sign-up banner ───────────────────────────────────────────────────────────
export const BANNER_MAX_CHARS = 60
/** The words shown when the banner is On and no text is saved. */
export const BANNER_DEFAULT_TEXT: string = HOME_HERO.vendorButton

// Line breaks, tabs and other control characters, and the Unicode line/paragraph separators.
const NOT_PLAIN = /[<>\p{Cc}\p{Zl}\p{Zp}]/u

/** The first rule the text breaks, as one plain sentence for the admin; null when it is fine. */
export function bannerTextProblem(text: string): string | null {
  if ([...text].length > BANNER_MAX_CHARS) return `Keep the banner to ${BANNER_MAX_CHARS} characters or fewer.`
  if (NOT_PLAIN.test(text)) return 'Use plain text only: no line breaks or < > signs.'
  if (ANY_PCT.test(text)) return 'Leave out percentages.'
  if (DELIVER.test(text)) return 'Leave out delivery wording.'
  if (COMPETITOR.test(text) || TOAST.test(text)) return "Leave out other companies' names."
  if (SOLD_OUT.test(text)) return 'Leave out "sold out".'
  if (GET_STARTED.test(text)) return 'Leave out "Get Started".'
  return null
}

export type BannerTextParse = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * The setting's parser. Trims the text. Empty, or exactly the default words, means "use the
 * default" (null: no row is kept, and the change log records the change to "default"). Anything
 * else is saved only if bannerTextProblem finds nothing.
 */
export function parseBannerText(raw: unknown): BannerTextParse {
  if (raw == null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Enter the banner text as text' }
  const text = raw.trim()
  if (!text || text === BANNER_DEFAULT_TEXT) return { ok: true, value: null }
  const problem = bannerTextProblem(text)
  return problem ? { ok: false, error: problem } : { ok: true, value: text }
}

/**
 * What the homepage shows: null (no banner) unless the switch is exactly On; then the saved text,
 * or the default words when none is saved or a stored text breaks the rules (e.g. saved before a
 * rule was added).
 */
export function heroBannerText(enabled: unknown, savedText: unknown): string | null {
  if (enabled !== true) return null
  if (typeof savedText === 'string' && savedText.trim() && bannerTextProblem(savedText.trim()) === null) return savedText.trim()
  return BANNER_DEFAULT_TEXT
}
