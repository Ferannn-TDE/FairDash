// Run a side effect after the response is sent, without ever blocking or failing it (S2 addition).
//
// In a request this is Next's after(): Vercel keeps the function alive until the task finishes,
// so a Slack notice isn't dropped when the response ends (a bare unawaited promise can be).
// after() throws outside a request scope, so a test that calls a route handler directly sets
// globalThis.__AFTER_RESPONSE_FOR_TEST to its own scheduler — the same seam pattern as
// __MOCK_CLERK. Production never sets it. Task errors are swallowed and logged: a side effect
// must not surface as a failed save.
import { after } from 'next/server'
import { logger } from '@/lib/logger'

export type AfterTask = () => Promise<void>

export function runAfterResponse(task: AfterTask): void {
  const safe: AfterTask = () => task().catch((err) => { logger.warn('[after-response] task failed', { error: String(err) }) })
  const testHook = (globalThis as { __AFTER_RESPONSE_FOR_TEST?: (t: AfterTask) => void }).__AFTER_RESPONSE_FOR_TEST
  if (testHook) return testHook(safe)
  after(safe)
}
