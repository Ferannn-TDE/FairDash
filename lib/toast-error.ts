'use client'

import toast from 'react-hot-toast'

/**
 * TOAST ERRORS — the one place an error becomes something a user reads.
 *
 * WHAT WENT WRONG. Error toasts were written one at a time, and three different habits grew:
 *   • `toast.error(json.error?.message ?? '…')` — renders whatever the server sent, which was
 *     fine until handleApiError started naming Prisma's colliding COLUMN in the message;
 *   • `toast.error(err instanceof Error ? err.message : '…')` — usually a server sentence, but
 *     on a Vercel 502 the HTML error page fails res.json() and the user reads
 *     `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`;
 *   • `toast.error(json.error || …)` — the envelope's `error` is an OBJECT, so this handed a
 *     non-ReactNode to the toast and the error path rendered nothing at all.
 * Each was locally reasonable. Together they meant "what the user sees when something breaks"
 * was decided 26 times, by whoever was closest.
 *
 * WHY THIS TAKES A CODE AND NOT THE RESPONSE. The obvious signature is
 * `toastError(json, fallback)` — and it would be wrong. A helper holding the response also
 * holds `error.message`, and a helper that HAS the message is one well-meaning refactor away
 * from rendering it ("just show the server's sentence when it's more specific"). The guarantee
 * here is structural, not disciplinary: the untrusted text is never in scope. There are exactly
 * two inputs — a code, which is looked up in the allowlist below, and a fallback string the
 * CALLER wrote. No argument slot exists through which a server message, an exception, or a
 * stack can reach the screen.
 *
 * It also means the type system rejects the leaky call outright: `toastError(err, '…')` does
 * not compile, because an Error is not a `string | undefined`. That is the same shape as
 * lib/upload-limits and the earnings invariant — the wrong thing fails the build, rather than
 * relying on the next person remembering the rule.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: forbid ever showing server text. One site
 * (app/fair/[fairSlug]/checkout/page.tsx) surfaces the server's own sentence on purpose —
 * FAIR_NOT_OPEN names the real dates, and the address validator names the field that's wrong.
 * That copy is written for customers and is more useful than anything generic. It keeps its
 * bespoke handling and is an ALLOWLISTED exception in scripts/toast-leak-guard.ts, which
 * requires a comment at the site so "this one may show server text" stays a decision someone
 * made and signed, not a hole.
 */

/**
 * Codes whose meaning is stable enough to write copy for, with copy written HERE rather than
 * taken from the wire. Anything not in this map falls back to the caller's sentence — a new
 * server code cannot start rendering its own text just by existing.
 */
const CODE_COPY: Record<string, string> = {
  // Uploads (lib/upload-limits)
  FILE_TOO_LARGE:          'That file is too large — please pick a smaller one.',
  INVALID_MIME:            'That file type isn’t supported.',

  // Access / state
  FORBIDDEN:               'You don’t have access to do that.',
  UNAUTHORIZED:            'Please sign in and try again.',
  NOT_FOUND:               'We couldn’t find that.',
  ORDER_NOT_FOUND:         'We couldn’t find that order.',
  ORDER_VOIDED:            'That order was voided by an admin.',
  INVALID_STATE:           'That can’t be done at this stage of the order.',
  CONFLICT:                'Someone else changed that first — reload and try again.',
  UNIQUE_CONSTRAINT:       'That’s already taken — please use a different value.',
  ALREADY_CLAIMED:         'Just claimed by another runner.',

  // Approval / availability
  RUNNER_NOT_APPROVED:     'Your runner account is awaiting admin approval.',
  VENDOR_OFFLINE:          'That vendor is currently offline.',

  // Infrastructure — actionable by an operator, never a stack trace
  STORAGE_NOT_CONFIGURED:  'File storage isn’t set up yet — please contact support.',
  DB_POOL_TIMEOUT:         'The server is busy — please retry in a moment.',
  RATE_LIMITED:            'Too many requests — please slow down.',
}

/**
 * Show an error toast for an API failure.
 *
 * @param code     `json.error?.code` from the response envelope — NOT the message.
 * @param fallback The caller's own sentence, used whenever the code isn't recognised. Write it
 *                 for the person reading it: say what didn't happen and what to do next.
 */
export function toastError(
  code: string | undefined | null,
  fallback: string,
  /** Passed through to react-hot-toast — `id` lets an error replace a pending loading toast. */
  opts?: { id?: string; duration?: number },
): void {
  toast.error((code && CODE_COPY[code]) || fallback, opts)
}

/** The map, for the guard and for tests. Not for rendering. */
export const KNOWN_ERROR_CODES = CODE_COPY
