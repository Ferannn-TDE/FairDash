// Single validator for the ?redirect= convention — the one way to say "return
// here after auth" (used by RoleAuthCard, the /login shim, onboarding, and
// account/redirect). Because every auth flow honors ?redirect=, it's also a
// single attack surface: a crafted ?redirect=https://evil.com would bounce a
// freshly-authenticated user to a phishing page. So we accept ONLY relative,
// in-app paths and fall back to a safe default on anything else.
//
// Rejects: absolute URLs (https://…), protocol-relative (//evil.com),
// backslash tricks (/\evil.com, which some browsers normalize to //), control
// characters, and anything not starting with a single '/'.
//
// CONTROL CHARACTERS (2026-11-17): browsers strip tab and newline from a URL before
// using it, so '/<TAB>/evil.com' passed every check below and then navigated as
// '//evil.com' — off the site. Any code 0-31 or 127 is now refused outright.
// DEFENCE IN DEPTH: whatever survives is resolved the way a browser would, against the
// site's origin, and must still be on that origin. Tests: scripts/safe-redirect-test.ts.
const SITE_ORIGIN = 'https://www.fairsynq.com'
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function safeRedirect(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (CONTROL_CHARS.test(value)) return fallback // tab/newline etc. are stripped by browsers
  if (value[0] !== '/') return fallback        // must be an in-app absolute path
  if (value[1] === '/') return fallback        // protocol-relative //evil.com
  if (value.includes('\\')) return fallback    // \ can be normalized to / by browsers
  if (value.includes('://')) return fallback   // belt-and-suspenders vs schemes
  try {
    if (new URL(value, SITE_ORIGIN).origin !== SITE_ORIGIN) return fallback
  } catch {
    return fallback
  }
  return value
}
