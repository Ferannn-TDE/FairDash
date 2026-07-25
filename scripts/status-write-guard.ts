/**
 * STATUS-WRITE GUARD — no unconditional status write outside the aggregator.
 *
 * THE BUG THIS EXISTS FOR. Two routes advanced a status with a read-then-write:
 * read the current value in one query, check it against a local transition table, then
 * `update({ where: { <id> } })` with no status filter. Two taps — a double-click, two tablets
 * on one booth, or a vendor racing the 60s sweep — both pass the check and the second
 * overwrites the first. It is MONEY-RELEVANT: DECLINED/REFUNDED/CANCELLED are exactly what
 * payableVendorIds excludes (lib/process-payout.ts:129), so a lost race flips a portion
 * between payable and not.
 *
 * The correct shape was already in the codebase — the runner claim puts the CONTESTED value
 * in the `where` and lets the database arbitrate (count 0 ⇒ someone else moved it first).
 *
 * WHAT THIS GUARD REALLY PROTECTS: not the two line changes, but the SHAPE. A fourth
 * transition table, or a fifth unconditional writer, cannot appear quietly.
 *
 * [0] POSITIVE CONTROLS FIRST — the scanner must be provably able to fail, or a green run
 *     means nothing (it could be matching nothing at all).
 *
 * Run: npx tsx scripts/status-write-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

/** The ONE place allowed to write a status without an inline contested guard. */
const AGGREGATOR = 'lib/reconcile-order-status.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  // Guards scan CODE, not prose — a comment mentioning the bad shape must not fail the build,
  // or the reasoning gets deleted to stay green (the guards-scan-code-not-prose lesson).
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Finds `db.<model>.update({ ... })` / `.updateMany` calls that WRITE status, and reports the
 * ones whose `where` clause does not constrain status. Brace-matched, so nested objects and
 * multi-line calls are handled rather than line-sniffed.
 */
function unconditionalStatusWrites(src: string): string[] {
  const code = stripComments(src)
  const hits: string[] = []
  const re = /\b(?:db|tx|prisma)\.(order|vendorOrderStatus)\.(update|updateMany|upsert)\s*\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    // brace-match the argument object
    let depth = 1, i = re.lastIndex
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') depth--
      i++
    }
    const call = code.slice(m.index, i)
    const writesStatus = /\bdata\s*:\s*\{[\s\S]*?\bstatus\s*:/.test(call) || /\bstatus\s*:\s*(newStatus|target)/.test(call)
    if (!writesStatus) continue
    const whereMatch = /\bwhere\s*:\s*\{([\s\S]*?)\}\s*,/.exec(call)
    const whereBody = whereMatch?.[1] ?? ''
    const guarded = /\bstatus\s*:/.test(whereBody)
    if (!guarded) {
      const line = code.slice(0, m.index).split('\n').length
      hits.push(`${m[1]}.${m[2]} @~line ${line}`)
    }
  }
  return hits
}

console.log('\n════ STATUS-WRITE GUARD ════')

// ── [0] POSITIVE CONTROLS — the scanner can actually fail ─────────────────────
console.log('\n[0] POSITIVE CONTROLS: the scanner detects the bad shape and accepts the good one')

const BAD = `
  const x = await db.vendorOrderStatus.update({
    where: { orderId_vendorId: { orderId, vendorId } },
    data: { status: newStatus, version: { increment: 1 } },
  })
`
const GOOD = `
  const claim = await db.vendorOrderStatus.updateMany({
    where: { orderId, vendorId, status: vendorStatus.status },
    data: { status: newStatus, version: { increment: 1 } },
  })
`
const UNRELATED = `
  const y = await db.order.update({
    where: { id: order.id },
    data: { deliveryProofPath: proofPath },
  })
`
assert(unconditionalStatusWrites(BAD).length === 1, 'an UNCONDITIONAL status write is DETECTED (probe can fail)')
assert(unconditionalStatusWrites(GOOD).length === 0, 'a CONTESTED-guard write is ACCEPTED (no false positive)')
assert(unconditionalStatusWrites(UNRELATED).length === 0, 'a non-status write is IGNORED (scanner is specific)')
assert(unconditionalStatusWrites('// db.order.update({ where: { id }, data: { status: x } })').length === 0,
  'a COMMENT describing the bad shape does NOT fail the build (guards scan code, not prose)')

// ── [1] THE INVARIANT — named set on failure, never a count ───────────────────
console.log('\n[1] no unconditional status write to Order / VendorOrderStatus outside the aggregator')

/**
 * DELIBERATE EXCEPTIONS — each with the reason it is correct to be unconditional.
 * An exception must be justified by "this write is AUTHORITATIVE over any concurrent
 * value", never by "the guard was inconvenient".
 */
const ALLOWED_UNCONDITIONAL: Record<string, string> = {
  // Money already went back to the customer. REFUNDED is a FACT, not a transition, and it
  // must win over any concurrent vendor advance — a vendor tapping COMPLETED must not be
  // able to un-refund a portion. Contesting on the prior status here would let the refund
  // silently lose the race, which is the dangerous direction.
  'lib/process-refund.ts': 'REFUNDED is authoritative — the money already moved',
}

const files = [...walk('app'), ...walk('lib'), ...walk('workers')]
  .filter(f => !f.replace(/\\/g, '/').endsWith(AGGREGATOR))

const offenders: string[] = []
for (const f of files) {
  const rel = f.replace(/\\/g, '/')
  if (ALLOWED_UNCONDITIONAL[rel]) continue
  const hits = unconditionalStatusWrites(readFileSync(f, 'utf8'))
  for (const h of hits) offenders.push(`${rel} → ${h}`)
}
assert(offenders.length === 0,
  `every status write is contested-guarded (offenders: ${offenders.length ? '\n     ' + offenders.join('\n     ') : 'none'})`)

// ── [2] THE AGGREGATOR ITSELF still guards its writes ────────────────────────
console.log('\n[2] the aggregator keeps its own monotonic guard (it is the exception, not exempt)')
const agg = stripComments(readFileSync(AGGREGATOR, 'utf8'))
assert(/updateMany\(\{[\s\S]*?where:\s*\{[\s\S]*?status:\s*\{\s*in:\s*WRITE_GUARD\[target\]/.test(agg),
  'reconcileMasterStatus writes through updateMany gated on WRITE_GUARD[target]')
assert(/export function canAdvance/.test(agg) && /MASTER_RANK\[derived\] > MASTER_RANK\[stored\]/.test(agg),
  'canAdvance still enforces strictly-increasing rank')

// ── [3] NO FOURTH TRANSITION TABLE ───────────────────────────────────────────
// The duplicate-derivation class. VENDOR_TRANSITIONS was deleted; ALLOWED_TRANSITIONS (the
// per-vendor table) is the known remaining copy and is tracked as the post-fair follow-up
// (CURRENT_STATE §7, Option B). Anything NEW fails here.
console.log('\n[3] no NEW status-transition table has appeared')
const KNOWN = new Set(['CUSTOMER_TRANSITIONS', 'RUNNER_TRANSITIONS', 'ALLOWED_TRANSITIONS', 'MASTER_RANK', 'WRITE_GUARD'])
const tables = new Set<string>()
for (const f of [...walk('app'), ...walk('lib')]) {
  const code = stripComments(readFileSync(f, 'utf8'))
  for (const m of code.matchAll(/const\s+([A-Z_]{4,})\s*:\s*(?:Partial<)?Record<[^>]*>[^=]*=\s*\{/g)) {
    const name = m[1]
    // _RANK / _GUARD, not bare RANK — a local display-sort `const RANK` (e.g. admin/organizers
    // ordering PENDING/APPROVED/REJECTED) is not a status-transition table and must not trip this.
    if (/TRANSITION|_RANK|_GUARD|_FLOW/.test(name)) tables.add(`${name} (${f.replace(/\\/g, '/')})`)
  }
}
const unknown = [...tables].filter(t => !KNOWN.has(t.split(' ')[0]))
assert(unknown.length === 0, `only known transition tables exist (new: ${unknown.join(', ') || 'none'})`)
assert(![...tables].some(t => t.startsWith('VENDOR_TRANSITIONS')), 'VENDOR_TRANSITIONS is gone (the deleted dead-path table)')

console.log('\n────────────────────────────────────')
console.log(failed === 0 ? `  ✅ ${passed} passed, 0 failed` : `  ❌ ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
