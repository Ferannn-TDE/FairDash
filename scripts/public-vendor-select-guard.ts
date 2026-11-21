/**
 * PUBLIC VENDOR SELECT GUARD — audit H2.
 *
 * GET /api/vendors has no auth. It used `include` with no select, so every Vendor column went to
 * signed-out callers: contact name, email and phone, the typed legal-signature name and IP, the
 * Stripe account id, commission rate, payout-freeze fields and document storage paths.
 *
 * The fix is lib/public-vendor-select.ts: one explicit select. This suite pins it to the approved
 * key list (an added key fails, not only a forbidden one), names the columns that must never be
 * in it, and checks as source that the route's GET uses it and has no include.
 *
 * Pure — no database, no server. Run: npx tsx scripts/public-vendor-select-guard.ts
 */

import { readFileSync } from 'node:fs'
import { PUBLIC_VENDOR_SELECT } from '../lib/public-vendor-select'
import { SELLABLE } from '../lib/menu/on-menu'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

/** The approved list (review of 2026-11-10). Changing the select means changing this too. */
const APPROVED_KEYS = [
  'id', 'name', 'slug', 'cuisineType', 'description', 'boothNumber', 'isBusy', 'isOffline', '_count',
] as const

/** Named columns that must never be public, plus every *Path column (matched by FORBIDDEN_PATTERN). */
const FORBIDDEN_KEYS = [
  'contactName', 'contactEmail', 'contactPhone',
  'termsAcceptedName', 'termsAcceptedIp',
  'stripeAccountId', 'commissionRate',
] as const
const FORBIDDEN_PATTERN = /Path$/

const forbiddenIn = (keys: readonly string[]) =>
  keys.filter(k => (FORBIDDEN_KEYS as readonly string[]).includes(k) || FORBIDDEN_PATTERN.test(k))

/** The column names of `model Vendor` in prisma/schema.prisma. */
function vendorColumns(): string[] {
  const schema = readSource('prisma/schema.prisma')
  const block = schema.match(/\nmodel Vendor \{\n([\s\S]*?)\n\}/)
  if (!block) return []
  return block[1].split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map(l => l.split(/\s+/)[0])
}

function main() {
  console.log('\n══ PUBLIC VENDOR SELECT (H2) ══')
  const keys = Object.keys(PUBLIC_VENDOR_SELECT)

  // ── [1] exact key list ──────────────────────────────────────────────────────────────────────
  console.log('\n[1] the select is exactly the approved key list')
  assert(JSON.stringify([...keys].sort()) === JSON.stringify([...APPROVED_KEYS].sort()),
    `keys are exactly ${APPROVED_KEYS.join(', ')} (got ${keys.join(', ')})`)

  // ── [2] forbidden columns ───────────────────────────────────────────────────────────────────
  console.log('\n[2] no contact, signature, Stripe, commission or document-path column')
  const columns = vendorColumns()
  const pathColumns = columns.filter(c => FORBIDDEN_PATTERN.test(c))
  assert(columns.includes('contactEmail') && columns.includes('stripeAccountId'),
    `[0] control: the schema parser found the Vendor columns (${columns.length} lines read)`)
  assert(pathColumns.length >= 3,
    `[0] control: the *Path pattern matches the real document columns (${pathColumns.join(', ')})`)
  assert(FORBIDDEN_KEYS.every(k => columns.includes(k)),
    `[0] control: every named forbidden key is a real Vendor column (missing: [${FORBIDDEN_KEYS.filter(k => !columns.includes(k)).join(', ')}])`)
  assert(forbiddenIn([...FORBIDDEN_KEYS, ...pathColumns]).length === FORBIDDEN_KEYS.length + pathColumns.length,
    '[0] positive control: the check flags every forbidden column when present')
  const found = forbiddenIn(keys)
  assert(found.length === 0, `no forbidden column is selected (found: [${found.join(', ')}])`)

  // ── [3] the menu count ──────────────────────────────────────────────────────────────────────
  console.log('\n[3] the menu count is the SELLABLE count and nothing more')
  const count = PUBLIC_VENDOR_SELECT._count
  assert(JSON.stringify(Object.keys(count)) === '["select"]' &&
    JSON.stringify(Object.keys(count.select)) === '["menuItems"]',
    '_count selects menuItems only')
  assert(JSON.stringify(count.select.menuItems) === JSON.stringify({ where: SELLABLE }),
    '_count.menuItems uses the shared SELLABLE predicate')

  // ── [4] route wiring, read as source ────────────────────────────────────────────────────────
  console.log('\n[4] GET /api/vendors uses the select and has no include')
  const raw = readSource('app/api/vendors/route.ts')
  const getStart = raw.indexOf('export async function GET')
  const postStart = raw.indexOf('export async function POST')
  assert(getStart >= 0 && postStart > getStart, '[0] control: found the GET handler and where it ends')
  const getRaw = raw.slice(getStart, postStart)
  const getSrc = getRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert(/audit H2/.test(getRaw) && !/audit H2/.test(getSrc), '[0] control: comment stripping works on this handler')
  assert((getSrc.match(/select: PUBLIC_VENDOR_SELECT/g) ?? []).length === 1, 'findMany uses select: PUBLIC_VENDOR_SELECT')
  assert(!/include:/.test(getSrc), 'no include: is left in the GET handler')
  assert(/return paginated\(vendors, total, page, limit\)/.test(getSrc), 'the response is the selected rows, unchanged otherwise')

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
