// "Ordering is paused" (item 10 / B1.13 stage 3, S3-Q4). When the money settings can't be read,
// POST /api/orders refuses with 503 and this module tells Feran on Slack — at most once per
// 10 minutes, so a busy fair can't flood the channel.
//
// The limit is a REDIS key with a 10-minute expiry (SET … NX EX 600), not memory: Vercel runs many
// instances, and memory would let each one alert. If Redis can't be reached (or takes > 2 s), the
// alert is sent anyway: a missing alert is worse than a duplicate one.
//
// The customer only ever sees ORDERING_PAUSED_MESSAGE; the key names go to the log and Slack.
import { Redis } from '@upstash/redis'
import { notifyOrderingPaused } from '@/lib/notify'

export { ORDERING_PAUSED_MESSAGE, ORDERING_PAUSED_CODE } from '@/lib/ordering-paused-copy'
export const ORDERING_PAUSED_ALERT_KEY = 'alert:ordering-paused'
export const ORDERING_PAUSED_ALERT_TTL_S = 600
const REDIS_TIMEOUT_MS = 2_000

type SetNx = (key: string, ttlSeconds: number) => Promise<boolean> // true = we set it (first alert)

function upstashSetNx(): SetNx | null {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const redis = new Redis({ url, token })
  return async (key, ttl) => (await redis.set(key, '1', { nx: true, ex: ttl })) === 'OK'
}

export type AlertOutcome = 'sent' | 'suppressed' | 'sent-redis-unavailable'

export async function alertOrderingPaused(
  detail: { missing: string[]; invalid: string[] },
  deps: { setNx?: SetNx | null; notify?: typeof notifyOrderingPaused } = {},
): Promise<AlertOutcome> {
  const setNx = deps.setNx === undefined ? upstashSetNx() : deps.setNx
  const notify = deps.notify ?? notifyOrderingPaused
  let first: boolean | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (setNx) {
      first = await Promise.race([
        setNx(ORDERING_PAUSED_ALERT_KEY, ORDERING_PAUSED_ALERT_TTL_S),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('redis timeout')), REDIS_TIMEOUT_MS) }),
      ])
    }
  } catch { first = null } finally { clearTimeout(timer) }
  if (first === false) return 'suppressed'
  await notify(detail)
  return first === true ? 'sent' : 'sent-redis-unavailable'
}
