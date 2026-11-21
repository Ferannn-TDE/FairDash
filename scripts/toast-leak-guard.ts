/**
 * TOAST LEAK GUARD — an error toast says what happened, never what we are made of.
 *
 * WHAT WENT WRONG. An audit of 133 toast calls found 26 that could render something other than
 * curated user copy, in four shapes:
 *   • the SERVER leaked first — handleApiError put Prisma's colliding COLUMN into the response
 *     ("conflicting field(s): urlSlug"), and 13 toasts faithfully rendered our schema;
 *   • `toast.error(err instanceof Error ? err.message : …)` — fine until res.json() met a Vercel
 *     502's HTML page and the user read `Unexpected token '<', "<!DOCTYPE "…`;
 *   • `toast.error(json.error || …)` — the envelope's `error` is an OBJECT, so React got a
 *     non-node and those error paths rendered NOTHING;
 *   • Stripe's `error.message`, which is written for the integrator on every type except
 *     card_error / validation_error.
 *
 * None of these were careless. Each was a locally reasonable choice, made 26 separate times,
 * which is exactly the shape a guard exists for: the rule cannot live in everyone's memory.
 *
 * THE ALLOWLIST REQUIRES A COMMENT. Two sites may legitimately show server text — Stripe's
 * cardholder errors, and checkout's create-order sentence (FAIR_NOT_OPEN names the real dates).
 * Being on the allowlist is not enough: the site must also carry the marker comment. An
 * allowlist without that becomes a quiet hole, where a later edit inherits permission nobody
 * granted it. With it, "this toast may show server text" is always a decision someone wrote
 * down and signed.
 *
 * [0] POSITIVE CONTROLS FIRST — every assertion here is NEGATIVE ("this shape is absent"), the
 *     kind that passes for free when the pattern is wrong. Each scanner is proven to flag the
 *     exact line it exists for, and to pass a clean one, before any result is trusted.
 *
 * Run: npx tsx scripts/toast-leak-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Guards scan CODE, not prose — this file's own examples must not fail the build. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Sites permitted to render server-authored text, each because its copy is written FOR the
 * person reading it. Every entry must also carry MARKER in the file — see the header.
 */
const ALLOWLIST = ['app/fair/[fairSlug]/checkout/page.tsx']
const MARKER = 'REVIEWED INTENTIONAL EXCEPTION'

// ── The scanners ────────────────────────────────────────────────────────────────────────────
/** A toast rendering a caught error's message, or a bare caught binding. */
const RAW_ERROR = /toast\.[a-z]+\(\s*[^)]*\b(err|error|e)\b\s*(instanceof\s+Error\s*\?\s*\1)?\.?message/
/** A toast interpolating a bare caught binding: toast.error(`… ${e} …`). */
const INTERP_ERROR = /toast\.[a-z]+\(\s*`[^`]*\$\{\s*(err|error|e)\s*\}/
/**
 * A toast interpolating something id-shaped, which is a CUID unless it went through the short
 * human code (id.slice(-8)). The first version of this matched `Id|ID|_id` and NOT a lowercase
 * `.id` — so it sailed straight past `${order.id}`, the single most likely leak in the codebase.
 * The positive control below is what caught it; without one this rule would have been a
 * decoration that always passed.
 */
const RAW_ID = /toast\.[a-z]+\(\s*`[^`]*\$\{(?![^}]*slice\(-8\))[^}]*(\.id\b|\bid\b|Id\b|ID\b|_id\b)[^}]*\}/

console.log('\n[0] POSITIVE CONTROLS — a scanner that cannot fail is not a scanner')
assert(RAW_ERROR.test("toast.error(err.message)"),
  '[0] flags toast.error(err.message)')
assert(RAW_ERROR.test("toast.error(err instanceof Error ? err.message : 'Failed to save')"),
  '[0] flags the `err instanceof Error ? err.message` shape (the 7 sites this fixed)')
assert(INTERP_ERROR.test('toast.error(`Something broke: ${e}`)'),
  '[0] flags an interpolated caught binding')
assert(RAW_ID.test('toast.success(`Updated ${order.id}`)'),
  '[0] flags a lowercase `.id` interpolation (the version that missed this passed vacuously)')
assert(RAW_ID.test('toast.error(`Failed ${vendorId}`)'),
  '[0] flags a camelCase id interpolation')
assert(!RAW_ID.test('toast.success(`${item.name} marked available`)'),
  '[0] does NOT flag ordinary user data (item names, labels)')
assert(!RAW_ID.test('toast.success(`Order ${order.id.slice(-8).toUpperCase()} placed`)'),
  '[0] does NOT flag the short human order code (id.slice(-8))')
assert(!RAW_ERROR.test("toast.error('Could not save — please try again')"),
  '[0] PASSES a curated message (not flag-everything)')
assert(!RAW_ERROR.test("toastError(json.error?.code, 'Couldn’t save — please try again')"),
  '[0] PASSES a toastError() call')

// ── The scan ────────────────────────────────────────────────────────────────────────────────
console.log('\n[1] no toast renders a raw exception, and no allowlisted site is undocumented')
const files = walk('app').filter(f => /toast\./.test(readFileSync(f, 'utf8')))
assert(files.length >= 20, `${files.length} files call toast (≥20 expected — a glob matching nothing is the vacuous pass)`)

const totalCalls = files.reduce(
  (n, f) => n + (stripComments(readFileSync(f, 'utf8')).match(/toast\.[a-z]+\(/g) ?? []).length, 0)
assert(totalCalls >= 100, `${totalCalls} toast calls scanned (≥100 expected)`)

const rawOffenders: string[] = []
const idOffenders: string[] = []
for (const f of files) {
  const code = stripComments(readFileSync(f, 'utf8'))
  const allowed = ALLOWLIST.some(a => f.endsWith(a))
  for (const line of code.split('\n')) {
    if (!allowed && (RAW_ERROR.test(line) || INTERP_ERROR.test(line))) rawOffenders.push(`${f}: ${line.trim()}`)
    if (RAW_ID.test(line)) idOffenders.push(`${f}: ${line.trim()}`)
  }
}
for (const o of rawOffenders) console.log(`       RAW ERROR: ${o}`)
assert(rawOffenders.length === 0, `no toast renders a raw exception message (${rawOffenders.length} offenders)`)
for (const o of idOffenders) console.log(`       RAW ID: ${o}`)
assert(idOffenders.length === 0, `no toast interpolates an internal id (${idOffenders.length} offenders)`)

console.log('\n[2] every allowlisted site DOCUMENTS why it may show server text')
for (const a of ALLOWLIST) {
  const match = files.find(f => f.endsWith(a))
  assert(!!match, `allowlisted site still exists: ${a}`)
  if (match) {
    assert(readFileSync(match, 'utf8').includes(MARKER),
      `${a} carries the "${MARKER}" marker — permission is documented, not inherited`)
  }
}
// The Stripe branch lives in an allowlisted file, so the marker is what makes it reviewed
// rather than merely permitted. Assert the narrowing itself, not just the comment.
const checkout = readFileSync('app/fair/[fairSlug]/checkout/page.tsx', 'utf8')
assert(/error\.type === 'card_error'/.test(checkout) && /validation_error/.test(checkout),
  'the Stripe branch shows error.message ONLY for card_error / validation_error')

console.log('\n[3] the SERVER does not leak schema names into a response')
const apiError = readFileSync('lib/api-error.ts', 'utf8')
const LEAKS_TARGET = /apiError\(\s*`[^`]*\$\{\s*fields\s*\}/
assert(LEAKS_TARGET.test('return apiError(`Already exists — conflicting field(s): ${fields}`, 409)'),
  '[0] positive control: the scanner DOES flag the exact line that shipped column names')
assert(!LEAKS_TARGET.test(stripComments(apiError)),
  'lib/api-error.ts does not interpolate Prisma meta.target into a client response')
assert(/console\.error\('\[API Error\] Unique constraint violation/.test(apiError),
  'the colliding field is still LOGGED — the debugging value was kept, only the destination changed')

console.log('\n[4] one error envelope — a string `error` is what taught 5 sites to render objects')
const stringEnvelope = walk('app/api').filter(f =>
  /NextResponse\.json\(\s*\{\s*error:\s*'/.test(stripComments(readFileSync(f, 'utf8'))))
for (const f of stringEnvelope) console.log(`       STRING ENVELOPE: ${f}`)
assert(stringEnvelope.length === 0,
  `every route returns { error: { message, code } } (${stringEnvelope.length} string-shaped offenders)`)

// ── [5] organizer fair settings: a failed save shows fixed text ──────────────────────────────────
// The 2h markup work (425a909) put `${json.error.message}` in a toast on this page; the Linux gate
// caught it (Nov 16). RAW_ERROR above reads one line at a time and does not recognise `?.message`,
// so the same page's `json.error?.message ?? 'Failed to save'` passed it. These rows read WHOLE
// toast calls (brackets matched, multi-line) on this ONE page. The same shapes on other organizer
// and admin screens are a later step: widening RAW_ERROR now would fail them all at once.

/** The full argument text of every `<name>(` call in `src`: brackets matched, quoted text skipped. */
function callArgs(src: string, name: RegExp): string[] {
  const out: string[] = []
  const re = new RegExp(name.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length
    let depth = 1, i = start
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        i++
        while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++ }
      } else if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

/** Server or exception text: `.message` read from a response, its `error`, or a caught binding. */
const LEAKY_MESSAGE = /\b(json|err|error|e|res|data|body)\b\??\.(error\??\.)?message\b/
const leakyToast = (src: string) => callArgs(src, /toast\.[a-z]+\(/).some(a => LEAKY_MESSAGE.test(a))

console.log('\n[5] organizer fair settings: every failed save shows fixed text, never the server\'s')
assert(leakyToast("toast.error(`${json.error.message} Nothing was saved; press Save again to save your other changes.`)"),
  '[5] positive control: flags the toast that shipped in 2h (425a909)')
assert(leakyToast("toast.error(json.error?.message ?? 'Failed to save')"),
  '[5] positive control: flags the `json.error?.message ?? …` shape that RAW_ERROR does not see')
assert(leakyToast("toast.error(missing?.length\n  ? `${json.error.message} Missing: ${missing.join(', ')}.`\n  : json.error?.message ?? 'Action failed')"),
  '[5] positive control: flags a toast split over several lines')
assert(leakyToast("toast.error('Could not save :) ' + err.message)"),
  '[5] positive control: a bracket inside quoted text does not end the call early')
assert(!leakyToast('toast.error(saveFailedCopy(code, markupRangeRefused))')
    && !leakyToast('toast.error(markupParse.message)')
    && !leakyToast('toast.error(`${MARKUP_LOCKED_MESSAGE} Nothing was saved.`)'),
  '[5] PASSES fixed copy, the page\'s own parse message and a *_MESSAGE constant (not flag-everything)')

const SETTINGS_PAGE = 'app/organizer/fairs/[fairSlug]/settings/page.tsx'
const settingsPage = stripComments(readFileSync(SETTINGS_PAGE, 'utf8').replace(/\r\n/g, '\n'))
const settingsToasts = callArgs(settingsPage, /toast\.[a-z]+\(/)
assert(settingsToasts.length >= 4,
  `${settingsToasts.length} toast calls read on the settings page (≥4 expected: saved, markup check, refused save, network)`)
const leakySettingsToasts = settingsToasts.filter(a => LEAKY_MESSAGE.test(a))
for (const a of leakySettingsToasts) console.log(`       SERVER TEXT: ${SETTINGS_PAGE}: toast(${a.replace(/\s+/g, ' ').trim()})`)
assert(leakySettingsToasts.length === 0,
  `no toast on the settings page reads .message from json/err/error/e (${leakySettingsToasts.length} offenders)`)
const markupErrorArgs = callArgs(settingsPage, /setMarkupError\(/)
assert(markupErrorArgs.length >= 3 && markupErrorArgs.every(a => !/\bjson\b/.test(a)),
  'the markup box never shows the server\'s text (setMarkupError is never given json…)')

const copyAt = settingsPage.indexOf('const SAVE_FAILED_COPY')
const copyEnd = settingsPage.indexOf('return SAVE_FAILED\n', copyAt)
const copyBlock = copyAt >= 0 && copyEnd > copyAt ? settingsPage.slice(copyAt, copyEnd) : ''
const SETTINGS_CODES = [
  'UNAUTHORIZED', 'FORBIDDEN', 'ORGANIZER_NOT_APPROVED', 'ORGANIZER_REJECTED', 'ORGANIZER_SUSPENDED',
  'DB_POOL_TIMEOUT', 'NOT_FOUND', 'VALIDATION_ERROR', 'MARKUP_LOCKED',
]
const missingCodes = SETTINGS_CODES.filter(c => !copyBlock.includes(`'${c}'`))
assert(copyBlock.length > 0 && missingCodes.length === 0,
  `the copy table has fixed text for all ${SETTINGS_CODES.length} codes the settings PATCH sends${missingCodes.length ? ` (missing: ${missingCodes.join(', ')})` : ''}`)
assert(/const SAVE_FAILED = "Couldn't save settings\. Try again\."/.test(settingsPage) && copyEnd > 0,
  'any other code falls back to "Couldn\'t save settings. Try again."')
assert(/function saveFailedCopy\(code: string \| undefined, markupRangeRefused: boolean\): string/.test(settingsPage),
  'saveFailedCopy takes the error CODE and a yes/no, never the server\'s message')
assert(/toast\.error\(saveFailedCopy\(code, markupRangeRefused\)\)/.test(settingsPage),
  'a refused save toasts saveFailedCopy(…)')
assert(/catch \(err\) \{\s*console\.error\('\[FairSettings\] save failed', err\)\s*toast\.error\(SAVE_FAILED\)/.test(settingsPage),
  'a network failure or an HTML error page toasts the fixed sentence; the details go to the console')
assert(/console\.error\('\[FairSettings\] save failed', \{ status: res\.status, code, message: json\.error\?\.message \}\)/.test(settingsPage),
  'a refused save logs status, code and message to the browser console only')

// The page recognises a markup over 10% by comparing the server's message with MARKUP_RANGE_MESSAGE
// (the server has no separate code for it). These rows fail if that sentence stops being what
// lib/event-markup.ts sends, so the comparison cannot silently stop matching.
const price = await import(pathToFileURL(resolve('lib/menu/price.ts')).href) as {
  parseMarkupBps: (input: unknown) => { ok: boolean; message?: string }
  MARKUP_RANGE_MESSAGE: string
}
const refusals = [1001, -1, 2.5, '5', null].map(v => price.parseMarkupBps(v))
assert(refusals.every(r => !r.ok && r.message === price.MARKUP_RANGE_MESSAGE),
  'parseMarkupBps refuses 1001, -1, 2.5, "5" and null with exactly MARKUP_RANGE_MESSAGE')
const THROWS_RANGE = /const parsed = parseMarkupBps\(input\)\s*\n\s*if \(!parsed\.ok\) throw new ApiError\(parsed\.message, 400, 'VALIDATION_ERROR'\)/
assert(!THROWS_RANGE.test("const parsed = parseMarkupBps(input)\n  if (!parsed.ok) throw new ApiError('Markup must be 0–10%', 400, 'VALIDATION_ERROR')"),
  '[5] positive control: the tie row fails if event-markup.ts stops sending parseMarkupBps\'s message')
const eventMarkup = stripComments(readFileSync('lib/event-markup.ts', 'utf8').replace(/\r\n/g, '\n'))
assert(THROWS_RANGE.test(eventMarkup),
  'lib/event-markup.ts still sends parseMarkupBps\'s message as 400 VALIDATION_ERROR (what the page compares with)')

console.log(`\n${'─'.repeat(66)}`)
console.log(`  ${pass} passed, ${fail} failed`)
console.log(`${'─'.repeat(66)}\n`)
process.exit(fail === 0 ? 0 : 1)
