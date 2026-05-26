import { testRedis } from '../lib/redis-test.js'

async function flush() {
  const keys = await testRedis.keys('*')
  if (keys.length) {
    await testRedis.del(...keys)
    console.log(`✅ Flushed ${keys.length} keys from test Redis`)
  } else {
    console.log('✅ Test Redis already empty')
  }
}

flush().catch(console.error)
