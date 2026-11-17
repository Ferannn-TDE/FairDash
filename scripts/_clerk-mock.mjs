// Test substitute for @clerk/nextjs/server. Only auth()/currentUser() are used by
// the route graph. Identity is controlled per-call via globalThis.__MOCK_CLERK so
// the proof can "log in" as any seeded runner. This mocks AUTHENTICATION only —
// every authorization check under test is the real route code, unmocked.
export async function auth() {
  const u = globalThis.__MOCK_CLERK
  return { userId: u?.userId ?? null }
}
export async function currentUser() {
  const u = globalThis.__MOCK_CLERK
  // Name fields are optional: a test that wants a reviewer name (lib/reviewer-label.ts) sets them;
  // every other test sees exactly the shape it always did.
  return u?.userId ? {
    id: u.userId, publicMetadata: u.publicMetadata ?? {},
    ...(u.fullName !== undefined && { fullName: u.fullName }),
    ...(u.firstName !== undefined && { firstName: u.firstName }),
    ...(u.lastName !== undefined && { lastName: u.lastName }),
  } : null
}
