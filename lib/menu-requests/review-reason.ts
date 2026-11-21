// MENU-REQUEST REVIEW REASON (independent review F16; Jordan, Nov 17). The ONE place the approver's
// free-text reason is checked. Import-free: lib/menu-requests/apply-decision.ts calls it before any
// database read (both the organizer and the admin decision routes go through that function), and the
// organizer's menu-requests page uses REVIEW_REASON_MAX as its input limit.
//
// The reason is stored (MenuRequest.reviewNote), pushed to the vendor's notification feed and written
// to the audit log, so it must be bounded, single-line text:
//   • missing (undefined or null) → no reason;
//   • not a string → refused (it used to reach the database and give a 500);
//   • line breaks, tabs and other control characters (and the Unicode line/paragraph separators)
//     become spaces, repeated spaces become one, and the ends are trimmed;
//   • blank after that → no reason;
//   • more than REVIEW_REASON_MAX characters (whole characters, so an emoji counts once) → refused.

/** At most this many characters in a review reason (Jordan, Nov 17). */
export const REVIEW_REASON_MAX = 500

/** Sent with 400 VALIDATION_ERROR when the reason is not text (Jordan's wording, Nov 17). */
export const REVIEW_REASON_NOT_TEXT_MESSAGE = 'The reason must be text.'

/** Sent with 400 VALIDATION_ERROR when the reason is too long (Jordan's wording, Nov 17). */
export const REVIEW_REASON_TOO_LONG_MESSAGE = `The reason can be at most ${REVIEW_REASON_MAX} characters.`

/** Control characters (C0, DEL, C1 — CR, LF and tab among them) and the Unicode line/paragraph separators. */
const LINE_BREAKS_AND_CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]/gu

export type ReviewReasonResult =
  | { ok: true; reason: string | null }
  | { ok: false; message: string }

/** Checks and cleans an approver's reason. Never throws; the caller turns a refusal into a 400. */
export function parseReviewReason(raw: unknown): ReviewReasonResult {
  if (raw === undefined || raw === null) return { ok: true, reason: null }
  if (typeof raw !== 'string') return { ok: false, message: REVIEW_REASON_NOT_TEXT_MESSAGE }
  const cleaned = raw.replace(LINE_BREAKS_AND_CONTROLS, ' ').replace(/ {2,}/g, ' ').trim()
  if (cleaned === '') return { ok: true, reason: null }
  if (Array.from(cleaned).length > REVIEW_REASON_MAX) return { ok: false, message: REVIEW_REASON_TOO_LONG_MESSAGE }
  return { ok: true, reason: cleaned }
}
