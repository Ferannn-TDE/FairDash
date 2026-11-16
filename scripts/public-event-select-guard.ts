/**
 * PUBLIC EVENT SELECT GUARD — audit M6.
 *
 * GET /api/events/[slug] has no auth. It used `include` with no select, so every Event and
 * FulfillmentConfig column went to signed-out callers: the operator's Stripe account id, the
 * organizer id, GPS boundaries, staging-zone and curbside-zone coordinates, the runner fee split
 * and the listing mode.
 *
 * The fix is lib/public-event-select.ts: one explicit select, plus a vendor-count `_count` the
 * route adds inline. This suite pins the select to the approved key lists (an added key fails,
 * not only a forbidden one), names the columns that must never be in it, and checks as source
 * that the route selects exactly the shared select plus the vendor count, with no include.
 *
 * Pure — no database, no server. Run: npx tsx scripts/public-event-select-guard.ts
 */

import { readFileSync } from 'node:fs'
import { PUBLIC_EVENT_SELECT } from '../lib/public-event-select'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

const sameKeys = (o: object, expected: readonly string[]) =>
  JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...expected].sort())

/** The approved lists (review of 2026-11-10). Changing the select means changing these too.
 *  onlineMarkupBps added by Jordan's approval, Nov 15 (audit H5, 2h: the checkout calculator). */
const APPROVED_EVENT_KEYS = [
  'id', 'name', 'urlSlug', 'description', 'status', 'primaryColor', 'startDate', 'endDate',
  'serviceChargeEnabled', 'serviceChargeAmount', 'onlineMarkupBps', 'admissionFree', 'openTime', 'closeTime',
  'fulfillmentConfig',
] as const
const APPROVED_FULFILLMENT_KEYS = [
  'boothPickupEnabled', 'curbsideEnabled', 'homeDeliveryEnabled', 'homeDeliveryFee', 'curbsideFee',
  'curbsideZoneDescription',
] as const

/** Must never be public, in either the Event select or the nested FulfillmentConfig select. */
const FORBIDDEN_EVENT_KEYS = [
  'operatorStripeAccountId', 'statementName', 'organizerId', 'gpsBoundaries',
  'stagingZoneLat', 'stagingZoneLng', 'listing',
] as const
const FORBIDDEN_FULFILLMENT_KEYS = [
  'runnerFeePercent', 'runnerTipsOnlyAck', 'curbsideZoneLat', 'curbsideZoneLng', 'curbsideMethod',
  'homeDeliveryRadiusKm', 'runnerTransportDescription',
] as const
const FORBIDDEN = [...FORBIDDEN_EVENT_KEYS, ...FORBIDDEN_FULFILLMENT_KEYS] as readonly string[]

/** The column names of a model in prisma/schema.prisma. */
function modelColumns(model: string): string[] {
  const schema = readSource('prisma/schema.prisma')
  const block = schema.match(new RegExp(`\\nmodel ${model} \\{\\n([\\s\\S]*?)\\n\\}`))
  if (!block) return []
  return block[1].split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map(l => l.split(/\s+/)[0])
}

function main() {
  console.log('\n══ PUBLIC EVENT SELECT (M6) ══')
  const eventKeys = Object.keys(PUBLIC_EVENT_SELECT)
  const fcKeys = Object.keys(PUBLIC_EVENT_SELECT.fulfillmentConfig.select)

  // ── [1] exact key lists ─────────────────────────────────────────────────────────────────────
  console.log('\n[1] the select is exactly the approved key lists')
  assert(sameKeys(PUBLIC_EVENT_SELECT, APPROVED_EVENT_KEYS),
    `Event keys are exactly the approved list (got ${eventKeys.join(', ')})`)
  assert(sameKeys(PUBLIC_EVENT_SELECT.fulfillmentConfig, ['select']),
    'fulfillmentConfig is a nested select, not `true` (which would load every column)')
  assert(sameKeys(PUBLIC_EVENT_SELECT.fulfillmentConfig.select, APPROVED_FULFILLMENT_KEYS),
    `FulfillmentConfig keys are exactly the approved list (got ${fcKeys.join(', ')})`)
  assert(!('_count' in PUBLIC_EVENT_SELECT), 'the select has no _count (the route adds the vendor count)')

  // ── [2] forbidden columns ───────────────────────────────────────────────────────────────────
  console.log('\n[2] no Stripe, organizer, location, runner-pay or listing column')
  const eventCols = modelColumns('Event')
  const fcCols = modelColumns('FulfillmentConfig')
  assert(eventCols.includes('operatorStripeAccountId') && fcCols.includes('runnerFeePercent'),
    `[0] control: the schema parser found both models (${eventCols.length} and ${fcCols.length} lines read)`)
  const missingEvent = FORBIDDEN_EVENT_KEYS.filter(k => !eventCols.includes(k))
  const missingFc = FORBIDDEN_FULFILLMENT_KEYS.filter(k => !fcCols.includes(k))
  assert(missingEvent.length === 0 && missingFc.length === 0,
    `[0] control: every forbidden key is a real column of its model (missing: [${[...missingEvent, ...missingFc].join(', ')}])`)
  const forbiddenIn = (keys: readonly string[]) => keys.filter(k => FORBIDDEN.includes(k))
  assert(forbiddenIn(FORBIDDEN).length === FORBIDDEN.length,
    '[0] positive control: the check flags every forbidden column when present')
  const inEvent = forbiddenIn(eventKeys)
  const inFc = forbiddenIn(fcKeys)
  assert(inEvent.length === 0, `no forbidden column in the Event select (found: [${inEvent.join(', ')}])`)
  assert(inFc.length === 0, `no forbidden column in the FulfillmentConfig select (found: [${inFc.join(', ')}])`)

  // ── [3] route wiring, read as source ────────────────────────────────────────────────────────
  console.log('\n[3] GET /api/events/[slug] selects the shared select plus the vendor count, no include')
  const raw = readSource('app/api/events/[slug]/route.ts')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert(/audit M6/.test(raw) && !/audit M6/.test(src), '[0] control: comment stripping works on this file')
  assert(!/include:/.test(src), 'no include: is left in the route')
  assert((src.match(/\.\.\.PUBLIC_EVENT_SELECT/g) ?? []).length === 1, 'the route spreads PUBLIC_EVENT_SELECT once')
  // The whole findFirst select, end to end: the shared select, then a _count of vendors only,
  // with the readiness filter, and nothing else before the findFirst call closes.
  const SELECT_BLOCK = new RegExp([
    String.raw`select:\s*\{\s*\.\.\.PUBLIC_EVENT_SELECT,`,
    String.raw`\s*_count:\s*\{\s*select:\s*\{\s*vendors:\s*\{`,
    String.raw`\s*where:\s*\{\s*status:\s*'ACTIVE',\s*isOffline:\s*false,\s*\.\.\.readinessWhereIfEnforced\(\)\s*\},?`,
    String.raw`\s*\},?\s*\},?\s*\},?`,
    String.raw`\s*\},?\s*\}\)`,
  ].join(''))
  assert(SELECT_BLOCK.test(src), 'select is exactly { ...PUBLIC_EVENT_SELECT, _count: { select: { vendors: { where: <readiness gate> } } } }')
  assert(!SELECT_BLOCK.test(src.replace("_count: {", "_count: { extra: true,")),
    '[0] positive control: the block check fails if anything is added to _count')
  assert(/return success\(event\)/.test(src), 'the response is the selected row, unchanged otherwise')

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
