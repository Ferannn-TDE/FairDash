// Single validator for the ?redirect= convention — the one way to say "return
// here after auth" (used by RoleAuthCard, the /login shim, onboarding, and
// account/redirect). Because every auth flow honors ?redirect=, it's also a
// single attack surface: a crafted ?redirect=https://evil.com would bounce a
// freshly-authenticated user to a phishing page. So we accept ONLY relative,
// in-app paths and fall back to a safe default on anything else.
//
// Rejects: absolute URLs (https://…), protocol-relative (//evil.com),
// backslash tricks (/\evil.com, which some browsers normalize to //), and
// anything not starting with a single '/'.
export function safeRedirect(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (value[0] !== '/') return fallback        // must be an in-app absolute path
  if (value[1] === '/') return fallback        // protocol-relative //evil.com
  if (value.includes('\\')) return fallback    // \ can be normalized to / by browsers
  if (value.includes('://')) return fallback   // belt-and-suspenders vs schemes
  return value
}
