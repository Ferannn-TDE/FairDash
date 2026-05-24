import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Strict — for order creation (Stripe charge risk): 10 per user per minute
export const orderRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: true,
})

// Loose — for public menu/vendor endpoints (scraping protection): 60 per minute
export const publicRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '1 m'),
  analytics: true,
})

// Vendor status mutations — 30 per vendor per minute.
// Covers both PATCH /api/orders/:id/status and PATCH /api/orders/:id/vendor-status.
// Keyed by clerkId (not IP) so shared proxies don't lock out multiple vendors.
export const vendorStatusRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
})
