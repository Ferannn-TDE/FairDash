// BELL LINK CHECK (audit H5, step 3c). A bell notification may only send people to a page on this
// site. Import-free on purpose: the bell runs it in the browser and the test runs it directly.
//
// Allowed: a path starting with one "/" (e.g. /admin/my-fair/approvals).
// Refused: anything else, including
//   //evil.example     (the browser reads it as another site)
//   /\evil.example     (browsers treat "\" as "/", so this is //evil.example too)
//   https://..., javascript:..., relative paths
//   any backslash, space or control character anywhere (browsers drop tabs and newlines, so
//   "/<tab>/evil.example" would become //evil.example)

export function safeBellLink(link: unknown): string | null {
  if (typeof link !== 'string' || link.length === 0 || link.length > 2048) return null
  if (link[0] !== '/') return null
  if (link[1] === '/' || link[1] === '\\') return null
  if (link.includes('\\')) return null
  for (let i = 0; i < link.length; i++) {
    const code = link.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return null
  }
  return link
}
