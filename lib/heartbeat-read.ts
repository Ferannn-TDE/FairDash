import { getRealtimeDb } from '@/lib/firebase-admin'

/**
 * THE ONE BOUNDED RTDB HEARTBEAT READ. Every dashboard-class route calls this; none of them may
 * call rtdb.ref(...).get() directly. scripts/rtdb-bound-guard.ts enforces that.
 *
 * WHY THIS EXISTS AS A SHARED FUNCTION AND NOT A PATTERN TO COPY.
 * The admin dashboard hung and 504'd on prod because this read is the one unbounded external call
 * in the request path: on a cold serverless start, establishing a fresh authenticated RTDB
 * connection can HANG rather than error, and a promise that never settles is never caught by a
 * try/catch. That was fixed — in the admin route only. The two organizer routes were hand-copied
 * from the same original and did not receive the fix, so /organizer/fairs/<slug> and its analytics
 * tab kept hanging until they hit FUNCTION_INVOCATION_TIMEOUT. Three copies of a safety wrap is
 * three chances to fix two of them. So the wrap is not a pattern any more; it is this function.
 *
 * ALWAYS RESOLVES, NEVER THROWS, NEVER HANGS. Returns {} on: no credentials, timeout, RTDB error,
 * or an empty node. Callers must treat {} as "no live heartbeats" and fall through to the DB's
 * Vendor.lastHeartbeatAt — which every call site already does:
 *     heartbeats[v.id] ?? (v.lastHeartbeatAt ? v.lastHeartbeatAt.getTime() : 0)
 * That fallback is what keeps a timeout from trading a hang for a blank vendor grid: the grid still
 * renders in full, with connectivity sourced from the last heartbeat the DB recorded. Live
 * heartbeats are a nicety; they must never be able to time out a dashboard.
 */

/** Short on purpose: this races a page render, and the DB fallback is always available. */
export const HEARTBEAT_TIMEOUT_MS = 2500

export async function boundedHeartbeatRead(eventId: string): Promise<Record<string, number>> {
  const rtdb = getRealtimeDb()
  // No credentials configured → no live heartbeats. Not an error; the DB fallback covers it.
  if (!rtdb) return {}

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const snap = await Promise.race([
      rtdb.ref(`fairs/${eventId}/heartbeats`).get(),
      new Promise<null>((_, reject) => {
        timer = setTimeout(() => reject(new Error('heartbeat read timed out')), HEARTBEAT_TIMEOUT_MS)
      }),
    ])
    if (snap && snap.exists()) return (snap.val() as Record<string, number> | null) ?? {}
    return {}
  } catch {
    // Firebase unavailable OR too slow — degrade to the DB's lastHeartbeatAt, never hang.
    return {}
  } finally {
    // Clear the loser so a won race cannot hold the serverless function alive for the full timeout.
    if (timer) clearTimeout(timer)
  }
}
