import { Redis } from '@upstash/redis'

if (!process.env.TEST_REDIS_URL || !process.env.TEST_REDIS_TOKEN) {
  throw new Error('TEST_REDIS_URL and TEST_REDIS_TOKEN required for tests')
}

export const testRedis = new Redis({
  url:   process.env.TEST_REDIS_URL,
  token: process.env.TEST_REDIS_TOKEN,
})
