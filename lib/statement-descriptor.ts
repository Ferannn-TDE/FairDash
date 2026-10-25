// CARD STATEMENT DESCRIPTOR — what a customer's bank statement says for a FairSynq order.
//
// Charges are created on the platform account (separate charges & transfers, no
// on_behalf_of), so the statement reads the platform's shortened descriptor, then "* ", then a
// per-charge suffix: "FAIRSYNQ* ITALIAN FEST". The suffix is what tells the customer which fair
// the charge was, and the fewer "what is this charge?" disputes the better.
//
// STRIPE'S RULES for the suffix, which this file enforces before Stripe ever sees it:
//   • prefix + "* " + suffix is at most 22 characters, so with FAIRSYNQ the suffix gets 12;
//   • Latin characters only, none of < > \ ' " *;
//   • at least one letter.
// A suffix Stripe rejects fails paymentIntents.create, which fails checkout. So the rule here is
// stricter than Stripe's (A–Z, 0–9, space, & . -), and anything that doesn't survive cleaning
// is DROPPED: the charge then shows the prefix alone. Never a failed checkout over a label.
//
// No imports: the organizer settings page reads this for its live preview.

/**
 * The platform's shortened descriptor, as set in Stripe → Settings → Public details. Must match
 * the Stripe account: it decides how much room the suffix gets. Checked against a real test-mode
 * charge by scripts/statement-descriptor-test.ts.
 */
export const STATEMENT_PREFIX = 'FAIRSYNQ'
export const STATEMENT_MAX_TOTAL = 22
/** "* " between prefix and suffix. */
export const STATEMENT_SUFFIX_MAX = STATEMENT_MAX_TOTAL - STATEMENT_PREFIX.length - 2

/**
 * PURE. A name cleaned to Stripe's rules and fitted to the room left after the prefix, or null
 * when nothing usable is left. Accents are folded ("Fête" → "FETE"), anything outside
 * A–Z 0–9 space & . - is removed, and a name that is too long is cut at a word boundary
 * ("ITALIAN FEST 2026" → "ITALIAN FEST"), or hard-cut when its first word alone is too long.
 */
export function cleanStatementName(raw: string | null | undefined, max = STATEMENT_SUFFIX_MAX): string | null {
  if (!raw) return null
  let s = raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/['’‘`]/g, '') // O'BRIEN'S → OBRIENS, not "O BRIEN S"
    .replace(/[^A-Z0-9 &.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) {
    const cut = s.slice(0, max + 1).lastIndexOf(' ')
    s = cut > 0 ? s.slice(0, cut) : s.slice(0, max)
  }
  s = s.replace(/[\s&.\-]+$/, '').replace(/^[\s&.\-]+/, '')
  return /[A-Z]/.test(s) ? s : null
}

/**
 * PURE. The suffix for a charge at this fair: the organizer's statement name if it survives
 * cleaning, else the fair's own name, else null (send no suffix; the prefix stands alone).
 */
export function statementSuffix(fair: { statementName?: string | null; name: string }): string | null {
  return cleanStatementName(fair.statementName) ?? cleanStatementName(fair.name)
}

/** What the customer's statement will read, for previews. */
export function statementPreview(fair: { statementName?: string | null; name: string }): string {
  const suffix = statementSuffix(fair)
  return suffix ? `${STATEMENT_PREFIX}* ${suffix}` : STATEMENT_PREFIX
}

/**
 * PURE. The organizer's settings input → what to store. Empty clears it (the fair name's short
 * form is then used). Anything with no letter left after cleaning is refused with a message,
 * never stored as a guess. The stored value is already clean, so the preview the organizer sees
 * after saving is exactly what statements show.
 */
export function parseStatementNameInput(raw: unknown):
  | { ok: true; value: string | null }
  | { ok: false; message: string } {
  const s = raw == null ? '' : String(raw).trim()
  if (s === '') return { ok: true, value: null }
  const cleaned = cleanStatementName(s)
  return cleaned
    ? { ok: true, value: cleaned }
    : { ok: false, message: 'Statement name needs at least one letter (A–Z). Accents are fine; other symbols are removed.' }
}
