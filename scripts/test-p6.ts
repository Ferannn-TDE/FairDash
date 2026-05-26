/**
 * P6 Validation — organizer auth consolidation
 *
 * Tests (all static source checks — routes require auth):
 *  1. requireOrganizerAuth() returns { clerkId, organizerId } (lib/auth.ts)
 *  2. requireOrganizerAuth() does db.orgMember lookup (lib/auth.ts)
 *  3. organizer/fairs/route.ts uses requireOrganizerAuth, no manual orgMember
 *  4. organizer/fairs/[fairSlug]/orders/route.ts — same
 *  5. organizer/fairs/[fairSlug]/settings/route.ts — same
 *  6. organizer/fairs/[fairSlug]/vendors/route.ts — same
 *  7. organizer/orders/route.ts — same
 *  8. organizer/stats/route.ts — same
 *  9. organizer/vendors/route.ts — same
 * 10. organizer/profile/route.ts — still uses requireAuth (intentionally optional orgMember)
 * 11. GET /api/organizer/fairs → 401 (unauthenticated, route reached)
 * 12. GET /api/organizer/stats → 401 (unauthenticated, route reached)
 * 13. GET /api/organizer/orders → 401 (unauthenticated, route reached)
 * 14. GET /api/organizer/vendors → 401 (unauthenticated, route reached)
 */

const BASE_URL = 'http://localhost:3000'

let passed = 0
let failed = 0
function pass(msg: string) { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg: string) { console.log(`  ❌ ${msg}`); failed++ }

// ─── Static Checks ────────────────────────────────────────────────────────────

async function test1_2_authFunctionSignature() {
  console.log('\nTests 1–2 — requireOrganizerAuth() returns { clerkId, organizerId }')

  const fs  = await import('fs')
  const src = fs.readFileSync(
    new URL('../lib/auth.ts', import.meta.url).pathname, 'utf8'
  )

  if (src.includes('organizerId: orgMember.organizerId'))
    pass('requireOrganizerAuth returns organizerId from orgMember')
  else
    fail('requireOrganizerAuth does not return organizerId')

  if (src.includes("db.orgMember.findFirst({ where: { userId: dbUser.id } })"))
    pass('requireOrganizerAuth does db.orgMember lookup')
  else
    fail('requireOrganizerAuth missing db.orgMember lookup')

  if (src.includes("Promise<{ clerkId: string; organizerId: string }>"))
    pass('requireOrganizerAuth return type is { clerkId, organizerId }')
  else
    fail('requireOrganizerAuth return type not updated')
}

async function test3_to_10_staticRouteChecks() {
  console.log('\nTests 3–10 — static route source checks')

  const fs   = await import('fs')
  const base = new URL('../app/api/organizer', import.meta.url).pathname

  function checkRoute(label: string, filePath: string, expectConsolidated: boolean) {
    const src = fs.readFileSync(filePath, 'utf8')

    const usesConsolidated  = src.includes('requireOrganizerAuth')
    const hasManualOrgMember = src.includes('db.orgMember.findFirst')
    const hasManualDbUser   = src.includes("db.user.findUnique({ where: { clerkId } })")

    if (expectConsolidated) {
      if (usesConsolidated)   pass(`${label}: uses requireOrganizerAuth`)
      else                    fail(`${label}: does NOT use requireOrganizerAuth`)
      if (!hasManualOrgMember) pass(`${label}: no manual orgMember lookup`)
      else                    fail(`${label}: still has manual orgMember lookup`)
      if (!hasManualDbUser)   pass(`${label}: no manual dbUser lookup for auth`)
      else                    fail(`${label}: still has manual dbUser lookup for auth`)
    } else {
      if (!usesConsolidated)  pass(`${label}: correctly uses requireAuth (optional orgMember)`)
      else                    fail(`${label}: incorrectly uses requireOrganizerAuth`)
    }
  }

  checkRoute('fairs',                `${base}/fairs/route.ts`,                     true)
  checkRoute('fairs/[slug]/orders',  `${base}/fairs/[fairSlug]/orders/route.ts`,   true)
  checkRoute('fairs/[slug]/settings',`${base}/fairs/[fairSlug]/settings/route.ts`, true)
  checkRoute('fairs/[slug]/vendors', `${base}/fairs/[fairSlug]/vendors/route.ts`,  true)
  checkRoute('orders',               `${base}/orders/route.ts`,                    true)
  checkRoute('stats',                `${base}/stats/route.ts`,                     true)
  checkRoute('vendors',              `${base}/vendors/route.ts`,                   true)
  checkRoute('profile',              `${base}/profile/route.ts`,                   false)
}

// ─── Live Endpoint Checks ─────────────────────────────────────────────────────

async function test11_to_14_liveEndpoints() {
  console.log('\nTests 11–14 — unauthenticated organizer routes return 401')

  const endpoints = [
    '/api/organizer/fairs',
    '/api/organizer/stats',
    '/api/organizer/orders',
    '/api/organizer/vendors',
  ]

  for (const path of endpoints) {
    const res = await fetch(`${BASE_URL}${path}`)
    if (res.status === 401)
      pass(`GET ${path} → 401 (auth required)`)
    else
      fail(`GET ${path} → ${res.status} (expected 401)`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('P6 Validation — organizer auth consolidation')
  console.log('─'.repeat(60))

  await test1_2_authFunctionSignature()
  await test3_to_10_staticRouteChecks()
  await test11_to_14_liveEndpoints()

  console.log('\n' + '─'.repeat(60))
  if (failed === 0) {
    console.log(`All ${passed} assertions passed. ✅`)
  } else {
    console.log(`${passed} passed, ${failed} failed.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
