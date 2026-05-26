import { getRealtimeDb } from '@/lib/firebase-admin'

// ─── Test hook ────────────────────────────────────────────────────────────────
// Allows unit tests to inject a mock RTDB without needing Firebase credentials.
// Never set in production — only called from scripts/test-c3.ts.
type MockRef = { update: (d: object) => Promise<unknown>; set: (d: object) => Promise<unknown> }
type MockDb  = { ref: (path: string) => MockRef }
let _testDb: MockDb | null = null
export function __setRtdbForTest(db: MockDb | null) { _testDb = db }
function resolveDb() { return (_testDb ?? getRealtimeDb()) as MockDb | null }

/**
 * Fire-and-forget Firebase RTDB update with:
 *   - FIREBASE_ENABLED guard (skips silently in CI/local without Firebase creds)
 *   - 5-second timeout so a stalled Firebase never blocks the Vercel runtime
 *   - Structured error logging (path + orderId for fast incident diagnosis)
 *
 * Always call this inside after() in route handlers so Vercel keeps the
 * function alive long enough for the write to complete before shutdown.
 */
export function fireAndForgetFirebaseUpdate(
  path: string,
  data: unknown,
  context?: { orderId?: string }
) {
  if (process.env.FIREBASE_ENABLED !== 'true') return

  const rtdb = resolveDb()
  if (!rtdb) return

  Promise.race([
    rtdb.ref(path).update(data as object),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firebase write timeout')), 5000)
    ),
  ]).catch(err => {
    console.error('[Firebase write failed]', {
      path,
      orderId: context?.orderId,
      error: err instanceof Error ? err.message : err,
    })
  })
}

/**
 * Same as fireAndForgetFirebaseUpdate but uses set() instead of update().
 * Use when creating a new node rather than merging into an existing one.
 */
export function fireAndForgetFirebaseSet(
  path: string,
  data: unknown,
  context?: { orderId?: string }
) {
  if (process.env.FIREBASE_ENABLED !== 'true') return

  const rtdb = resolveDb()
  if (!rtdb) return

  Promise.race([
    rtdb.ref(path).set(data as object),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firebase write timeout')), 5000)
    ),
  ]).catch(err => {
    console.error('[Firebase set failed]', {
      path,
      orderId: context?.orderId,
      error: err instanceof Error ? err.message : err,
    })
  })
}
