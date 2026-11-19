// "Partner earning missing" Slack alert (item 10 stage 4, reconciler Pattern L check 3), limited to
// ONCE PER ORDER PER 24 HOURS so a sweep every few minutes can't flood the channel.
//
// Same shape as lib/ordering-paused.ts: the limit is a REDIS key per order with a 24-hour expiry
// (SET … NX EX 86400), not memory. It uses the WORKER's Redis (REDIS_URL, the BullMQ one), because the
// reconciler runs in the worker. If Redis can't be reached (or takes > 2 s), the alert is sent anyway:
// a missing alert is worse than a duplicate one. The sweep's log line (sum.alerted) still names every
// flagged order on every sweep; only the Slack notice is limited.
//
// Relative imports only: the worker loads this.
import IORedis from 'ioredis'
import { notifyPartnerEarningMissing } from './notify'

export const PARTNER_ALERT_KEY_PREFIX = 'alert:partner-earning-missing:'
export const PARTNER_ALERT_TTL_S = 86_400
const REDIS_TIMEOUT_MS = 2_000

/** For each key: true = we set it (first alert in 24 h), false = it already existed. Throws if Redis is unusable. */
export type SetNxMany = (keys: string[], ttlSeconds: number) => Promise<boolean[]>

function ioredisSetNxMany(): SetNxMany | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  return async (keys, ttl) => {
    const r = new IORedis(url, {
      maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 1500, enableOfflineQueue: false,
      enableReadyCheck: false, disableClientInfo: true,
    })
    r.on('error', () => {}) // the failure surfaces as a rejected command below; don't also log it as unhandled
    try {
      await r.connect()
      const out: boolean[] = []
      for (const k of keys) out.push((await r.set(k, '1', 'EX', ttl, 'NX')) === 'OK')
      return out
    } finally {
      r.disconnect()
    }
  }
}

export interface PartnerAlertOutcome {
  sent: string[]        // order ids included in the Slack notice
  suppressed: string[]  // already alerted within 24 h
  redisUnavailable: boolean
}

export async function alertPartnerEarningMissing(
  orderIds: string[],
  deps: { setNxMany?: SetNxMany | null; notify?: typeof notifyPartnerEarningMissing } = {},
): Promise<PartnerAlertOutcome> {
  if (orderIds.length === 0) return { sent: [], suppressed: [], redisUnavailable: false }
  const setNxMany = deps.setNxMany === undefined ? ioredisSetNxMany() : deps.setNxMany
  const notify = deps.notify ?? notifyPartnerEarningMissing
  let first: boolean[] | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (setNxMany) {
      first = await Promise.race([
        setNxMany(orderIds.map(id => PARTNER_ALERT_KEY_PREFIX + id), PARTNER_ALERT_TTL_S),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('redis timeout')), REDIS_TIMEOUT_MS) }),
      ])
    }
  } catch { first = null } finally { clearTimeout(timer) }

  const redisUnavailable = first === null
  const sent = redisUnavailable ? [...orderIds] : orderIds.filter((_, i) => first![i])
  const suppressed = redisUnavailable ? [] : orderIds.filter((_, i) => !first![i])
  if (sent.length) await notify(sent)
  return { sent, suppressed, redisUnavailable }
}
