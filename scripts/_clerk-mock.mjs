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
  return u?.userId ? { id: u.userId, publicMetadata: u.publicMetadata ?? {} } : null
}
