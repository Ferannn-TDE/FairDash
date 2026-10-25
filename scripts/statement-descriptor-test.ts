/**
 * STATEMENT DESCRIPTOR (readiness 1.6) — the card statement reads "FAIRSYNQ* <FAIR>", and a fair
 * name can never fail a checkout.
 *
 * A suffix Stripe rejects fails paymentIntents.create, and with it the order. Stripe test mode
 * rejects `*`, `'` and a digits-only suffix at create time (probed 2026-10-25; the live script
 * scripts/statement-descriptor-live.ts re-checks that, which is the control proving the cleaner
 * is load-bearing). It does NOT check length at create, so the 22-character total is ours alone.
 *
 *   [1] cleanStatementName: real names, accents, banned characters, length cuts, nothing left
 *   [2] fuzz: any input → null or a suffix that satisfies every rule
 *   [3] statementSuffix fallback order + statementPreview
 *   [4] the organizer's input rule (parseStatementNameInput) and the settings route using it
 *   [5] the order route: suffix sent only when non-null, decided before paymentIntents.create
 *
 * No database, no network. Run:  npx tsx scripts/statement-descriptor-test.ts
 */

import { readFileSync } from 'node:fs'
import {
  cleanStatementName, statementSuffix, statementPreview, parseStatementNameInput,
  STATEMENT_PREFIX, STATEMENT_SUFFIX_MAX, STATEMENT_MAX_TOTAL,
} from '../lib/statement-descriptor'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const eq = (got: unknown, want: unknown, label: string) => assert(got === want, `${label} → ${JSON.stringify(want)}${got === want ? '' : ` (got ${JSON.stringify(got)})`}`)

/** Every rule Stripe applies to a suffix, plus ours (length). */
const valid = (s: string) =>
  s.length >= 1 && s.length <= STATEMENT_SUFFIX_MAX && /[A-Z]/.test(s) && !/[<>\\'"*]/.test(s) &&
  /^[A-Z0-9 &.\-]+$/.test(s) && s === s.trim() && !/^[&.\-]|[&.\-]$/.test(s)
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

console.log('[0] the room')
eq(STATEMENT_PREFIX, 'FAIRSYNQ', 'prefix matches the Stripe shortened descriptor')
eq(STATEMENT_SUFFIX_MAX, 12, 'suffix room = 22 − "FAIRSYNQ" − "* "')

console.log('\n[1] cleaning real-looking names')
eq(cleanStatementName('Italian Fest 2026'), 'ITALIAN FEST', 'too long → cut at a word boundary')
eq(cleanStatementName('TEST – Domain Check'), 'TEST DOMAIN', 'en dash removed, then cut')
eq(cleanStatementName('Fête des Fleurs'), 'FETE DES', 'accents folded')
eq(cleanStatementName(`O'Brien's "Best" <BBQ>*`), 'OBRIENS BEST', 'apostrophes vanish; quotes, <, >, * removed')
eq(cleanStatementName('Rock & Roll Fest'), 'ROCK & ROLL', '& kept')
eq(cleanStatementName('Superlongfairname'), 'SUPERLONGFAI', 'one word longer than the room → hard cut')
eq(cleanStatementName('ABCDEF GHIJK'), 'ABCDEF GHIJK', 'exactly 12 → unchanged')
eq(cleanStatementName('ABCDE - FGHIJ KL'), 'ABCDE', 'a cut never leaves trailing punctuation ("ABCDE -" → "ABCDE")')
eq(cleanStatementName('  springfield   fair  '), 'SPRINGFIELD', 'spaces collapsed, then cut')
eq(cleanStatementName('2026'), null, 'digits only → null (Stripe rejects it)')
eq(cleanStatementName('🎡🎪'), null, 'emoji only → null')
eq(cleanStatementName('東京まつり'), null, 'non-Latin only → null')
eq(cleanStatementName(''), null, 'empty → null')
eq(cleanStatementName('   '), null, 'whitespace → null')
eq(cleanStatementName(null), null, 'null → null')

console.log('\n[2] fuzz: every output is null or obeys every rule')
let bad: string[] = []
const alphabet = `abcXYZ019 &.-*'"<>\\/#,!éÉñ東🎡\t–—’`
for (let i = 0; i < 5000; i++) {
  const n = Math.floor(Math.random() * 40)
  let s = ''
  for (let j = 0; j < n; j++) s += [...alphabet][Math.floor(Math.random() * [...alphabet].length)]
  const out = cleanStatementName(s)
  if (out !== null && !valid(out)) bad.push(`${JSON.stringify(s)} → ${JSON.stringify(out)}`)
  if (out !== null && `${STATEMENT_PREFIX}* ${out}`.length > STATEMENT_MAX_TOTAL) bad.push(`too long: ${out}`)
}
assert(bad.length === 0, `5000 random inputs → all valid or null${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`)
// Control on the validator itself, so [2] can't pass because `valid` accepts anything.
assert(!valid('BAD*NAME') && !valid("O'BRIEN") && !valid('12345') && !valid('ABCDEFGHIJKLM') && !valid('ENDS-') && valid('ITALIAN FEST'),
  'control: the rule checker rejects *, \', digits-only, 13 chars, trailing punctuation, and accepts a good one')

console.log('\n[3] which name, and the preview')
eq(statementSuffix({ statementName: 'Fest', name: 'Italian Fest 2026' }), 'FEST', "the organizer's statement name wins")
eq(statementSuffix({ statementName: '1234', name: 'Italian Fest 2026' }), 'ITALIAN FEST', 'an unusable statement name → the fair name')
eq(statementSuffix({ statementName: null, name: 'Italian Fest 2026' }), 'ITALIAN FEST', 'none set → the fair name')
eq(statementSuffix({ statementName: '!!', name: '2026' }), null, 'nothing usable anywhere → null (prefix alone)')
eq(statementPreview({ name: 'Italian Fest 2026' }), 'FAIRSYNQ* ITALIAN FEST', 'preview with a suffix')
eq(statementPreview({ name: '2026' }), 'FAIRSYNQ', 'preview without one')

console.log('\n[4] the organizer setting')
const p1 = parseStatementNameInput('Fête des Fleurs!')
assert(p1.ok && p1.value === 'FETE DES', 'input is stored cleaned ("FETE DES")')
const p2 = parseStatementNameInput('  ')
assert(p2.ok && p2.value === null, 'empty → cleared (null), the fair name is used')
assert(parseStatementNameInput(null).ok && (parseStatementNameInput(null) as { value: unknown }).value === null, 'null → cleared')
const p3 = parseStatementNameInput('1234')
assert(!p3.ok && /at least one letter/.test(p3.message), 'no letter → refused with a message, nothing stored')
const settings = strip(readFileSync('app/api/organizer/fairs/[fairSlug]/settings/route.ts', 'utf8'))
assert(/'statementName',/.test(settings), 'statementName is an allowed settings field')
assert(/parseStatementNameInput\(data\.statementName\)/.test(settings) && /if \(!parsed\.ok\) return apiError\(parsed\.message, 400/.test(settings),
  'the settings route stores parseStatementNameInput\'s value and refuses with its message')
assert(settings.indexOf('parseStatementNameInput(') < settings.indexOf('db.event.update('), 'parsed before the write')
const page = readFileSync('app/organizer/fairs/[fairSlug]/settings/page.tsx', 'utf8')
assert(/statementName:\s+settings\.statementName/.test(page) && /statementPreview\(/.test(page), 'the settings page saves it and shows the live preview')

console.log('\n[5] the order route')
const route = strip(readFileSync('app/api/orders/route.ts', 'utf8'))
assert(/const statementDescriptorSuffix = statementSuffix\(event\)/.test(route), 'the suffix comes from statementSuffix(event)')
assert(/if \(statementDescriptorSuffix\) piParams\.statement_descriptor_suffix = statementDescriptorSuffix/.test(route),
  'it is sent only when non-null (never an empty or raw value)')
assert((route.match(/statement_descriptor_suffix/g) ?? []).length === 1, 'nothing else sets statement_descriptor_suffix')
assert(!/statement_descriptor[^_]/.test(route), 'no full statement_descriptor override (cards use prefix + suffix)')
const decided = route.indexOf('statementSuffix(event)'), created = route.indexOf('stripe.paymentIntents.create(piParams)')
assert(decided > 0 && created > decided, 'decided before paymentIntents.create')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} statement-descriptor: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
