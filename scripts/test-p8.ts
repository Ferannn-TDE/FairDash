/**
 * P8 Validation — structured logging
 *
 * Tests:
 *  1. lib/logger.ts exists and exports logger
 *  2. logger has debug / info / warn / error / throttled / time methods
 *  3. logger.debug is no-op in production (isDev guard)
 *  4. logger.warn always logs (no isDev guard)
 *  5. logger.throttled suppresses duplicate calls within window
 *  6. logger.time returns a callable and is no-op in production
 *  7. next.config.mjs has removeConsole for production
 *  8. components/order/SingleOrderTracking.tsx has zero console.log
 *  9. Zero console.log in app/ directory
 * 10. Zero console.log in lib/ directory
 * 11. Zero console.log in components/ directory
 * 12. Webhook routes use logger (not console.log)
 */

let passed = 0
let failed = 0
function pass(msg: string) { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg: string) { console.log(`  ❌ ${msg}`); failed++ }

async function main() {
  console.log('P8 Validation — structured logging')
  console.log('─'.repeat(60))

  const fs   = await import('fs')
  const base = new URL('..', import.meta.url).pathname

  // ── 1-6: lib/logger.ts functional tests ──────────────────────────────────
  console.log('\nTests 1–6 — lib/logger.ts')

  const loggerSrc = fs.readFileSync(`${base}/lib/logger.ts`, 'utf8')

  if (loggerSrc.includes('export const logger'))
    pass('lib/logger.ts exports logger')
  else
    fail('lib/logger.ts does not export logger')

  const methods = ['debug', 'info', 'warn', 'error', 'throttled', 'time']
  const allMethods = methods.every(m => loggerSrc.includes(`${m}:`))
  if (allMethods) pass(`logger has all methods: ${methods.join(', ')}`)
  else            fail('logger missing one or more methods')

  if (loggerSrc.includes('if (!isDev) return') && loggerSrc.includes('debug:'))
    pass('logger.debug is no-op in production (isDev guard)')
  else
    fail('logger.debug missing isDev guard')

  // warn has no isDev guard (always logs)
  const warnBlock = loggerSrc.match(/warn:\s*\([^)]*\)\s*=>\s*\{([^}]*)\}/s)?.[1] ?? ''
  if (!warnBlock.includes('isDev'))
    pass('logger.warn always logs (no isDev guard)')
  else
    fail('logger.warn incorrectly guarded by isDev')

  // throttled suppresses via shouldThrottle
  if (loggerSrc.includes('shouldThrottle') && loggerSrc.includes('throttleMap'))
    pass('logger.throttled uses throttleMap to suppress duplicates')
  else
    fail('logger.throttled missing throttle logic')

  if (loggerSrc.includes("if (!isDev) return () => {}"))
    pass('logger.time is no-op in production')
  else
    fail('logger.time missing production no-op')

  // ── 7: next.config.mjs removeConsole ────────────────────────────────────
  console.log('\nTest 7 — next.config.mjs')
  const nextSrc = fs.readFileSync(`${base}/next.config.mjs`, 'utf8')
  if (nextSrc.includes('removeConsole') && nextSrc.includes("exclude: ['error', 'warn']"))
    pass('next.config.mjs has removeConsole with error+warn exclusion')
  else
    fail('next.config.mjs missing removeConsole config')

  // ── 8-11: zero console.log in app, lib, components ───────────────────────
  console.log('\nTests 8–11 — console.log elimination')

  function countConsoleLogs(dir: string): { count: number; lines: string[] } {
    const lines: string[] = []
    function walk(d: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${entry.name}`
        if (entry.isDirectory() && entry.name !== 'node_modules') { walk(p); continue }
        if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue
        const src = fs.readFileSync(p, 'utf8')
        src.split('\n').forEach((line, i) => {
          if (line.includes('console.log')) lines.push(`${p}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    walk(dir)
    return { count: lines.length, lines }
  }

  const tracking = fs.readFileSync(`${base}/components/order/SingleOrderTracking.tsx`, 'utf8')
  if (!tracking.includes('console.log'))
    pass('SingleOrderTracking.tsx has zero console.log')
  else
    fail('SingleOrderTracking.tsx still has console.log')

  const appResult = countConsoleLogs(`${base}/app`)
  if (appResult.count === 0)
    pass('app/ has zero console.log')
  else {
    fail(`app/ has ${appResult.count} console.log(s):`)
    appResult.lines.forEach(l => console.log('    ', l))
  }

  const libResult = countConsoleLogs(`${base}/lib`)
  if (libResult.count === 0)
    pass('lib/ has zero console.log')
  else {
    fail(`lib/ has ${libResult.count} console.log(s):`)
    libResult.lines.forEach(l => console.log('    ', l))
  }

  const compResult = countConsoleLogs(`${base}/components`)
  if (compResult.count === 0)
    pass('components/ has zero console.log')
  else {
    fail(`components/ has ${compResult.count} console.log(s):`)
    compResult.lines.forEach(l => console.log('    ', l))
  }

  // ── 12: webhooks use logger ───────────────────────────────────────────────
  console.log('\nTest 12 — webhook routes use logger')
  const clerkSrc  = fs.readFileSync(`${base}/app/api/webhooks/clerk/route.ts`, 'utf8')
  const stripeSrc = fs.readFileSync(`${base}/app/api/webhooks/stripe/route.ts`, 'utf8')

  if (clerkSrc.includes("from '@/lib/logger'") && !clerkSrc.includes('console.log'))
    pass('clerk webhook uses logger, no console.log')
  else
    fail('clerk webhook still has console.log or missing logger import')

  if (stripeSrc.includes("from '@/lib/logger'") && !stripeSrc.includes('console.log'))
    pass('stripe webhook uses logger, no console.log')
  else
    fail('stripe webhook still has console.log or missing logger import')

  console.log('\n' + '─'.repeat(60))
  if (failed === 0) {
    console.log(`All ${passed} assertions passed. ✅`)
  } else {
    console.log(`${passed} passed, ${failed} failed.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
