// Phone numbers on the vendor, partner and organizer forms and settings — ONE rule, used in the
// browser (to block the step and show the message) and in every server route that saves one (the
// real gate). Pure and import-free, so it is safe in a 'use client' component.
//
// The rule (sign-up-fixes, commit 1): strip everything but digits; 11 digits starting with 1 drop
// the 1; then exactly 10 digits, with the area code and the next three digits each starting 2–9.
// A new or changed number is saved as +1XXXXXXXXXX. A number that was already stored and comes
// back unchanged is left exactly as it is, so existing rows are never rewritten.

/** The one message every phone refusal shows, in the browser and from the server. */
export const PHONE_ERROR = 'Enter a 10-digit US phone number, like (217) 555-0134.'

/** The API error code for a refused phone. lib/toast-error.ts maps it to PHONE_ERROR. */
export const INVALID_PHONE = 'INVALID_PHONE'

/** A plausible US number in any common format → +1XXXXXXXXXX, or null if it isn't one. */
export function normalizeUsPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  // NANP: area code and exchange both start 2–9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null
  return `+1${digits}`
}

export type PhoneCheck =
  | { ok: true; value: string | null; unchanged: boolean }
  | { ok: false; error: string }

/**
 * Check a phone typed on a form.
 *
 *  - Exactly the stored `previous` value (ignoring surrounding spaces) → ok, `unchanged: true`, and
 *    the stored value is returned as it is. The caller should not write it.
 *  - Blank → refused when `required`, otherwise ok with `value: null` (clears the number).
 *  - Anything else must pass normalizeUsPhone, and is returned as +1XXXXXXXXXX.
 */
export function checkPhone(
  raw: unknown,
  opts: { required: boolean; previous?: string | null },
): PhoneCheck {
  if (raw != null && typeof raw !== 'string') return { ok: false, error: PHONE_ERROR }
  const typed = (raw ?? '').trim()
  const previous = opts.previous ?? null
  if (previous !== null && typed === previous.trim()) {
    return { ok: true, value: previous, unchanged: true }
  }
  if (!typed) {
    if (opts.required) return { ok: false, error: PHONE_ERROR }
    return { ok: true, value: null, unchanged: previous === null }
  }
  const normalized = normalizeUsPhone(typed)
  if (!normalized) return { ok: false, error: PHONE_ERROR }
  return { ok: true, value: normalized, unchanged: normalized === previous }
}
