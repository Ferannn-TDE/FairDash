/**
 * ADMIN 403 TEXT (block header-signin-v1, 2026-11-24).
 *
 * When an admin's login was stale, actions like Reject and Refuse operator showed the server's own
 * words, "Forbidden — admin access required" (lib/auth.ts). Every admin screen rendered
 * json.error?.message as it arrived. A 403 on an admin screen now shows one fixed sentence,
 * ADMIN_NO_ACCESS (lib/admin-error-text.ts), and never the server's text. This is wording only:
 * who may do what is unchanged.
 *
 *   [0] positive controls: the scanner flags an unwrapped server message and passes a wrapped one
 *   [1] the helper: the exact sentence on a 403; any other status keeps the caller's text
 *   [2] every admin screen: each server-message read and each thrown error goes through adminErrorText
 *       (or throws fixed text). Three Batch-2 files are skipped by name, see SKIPPED.
 *   [3] who may do what is unchanged: the four admin gates still refuse with 403 FORBIDDEN
 *
 * Run:  npx tsx scripts/admin-forbidden-text-test.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const APPROVED = "You don't have access to do this right now. Sign out, sign back in, and try again."

/**
 * Files that may change in Feran's Batch 2 (event vendor lists, one menu across events, partner
 * payouts). Left alone in this block; to be done after Batch 2 merges.
 */
const SKIPPED: Record<string, string> = {
  'app/admin/[eventSlug]/vendors/page.tsx': 'Batch 2: event vendor lists',
  'app/admin/[eventSlug]/vendors/MenuRequestsPanel.tsx': 'Batch 2: one menu across events',
  'app/admin/[eventSlug]/money/page.tsx': 'Batch 2: partner payouts',
}

/** Code only: block comments (incl. JSX {/* *\/}) and whole-line // comments removed. Line count kept. */
const codeOnly = (s: string) => s.replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(full.replace(/\\/g, '/'))
  }
  return out
}

/** [start, end) of the argument text of every `<name>(` call: brackets matched, quoted text skipped. */
function callSpans(src: string, name: RegExp): [number, number][] {
  const out: [number, number][] = []
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
    out.push([start, i - 1])
  }
  return out
}

const MESSAGE_READ = /\.error\??\.message\b/g
const FIXED_TEXT = /^\s*(?:(['"])[^'"]*\1|`[^`$]*`)?\s*$/
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length

/** The offending lines of one file: unwrapped server-message reads, and throws of anything but fixed text. */
function offenders(src: string): { line: number; what: string }[] {
  const wrapped = callSpans(src, /\badminErrorText\(/)
  const inside = (at: number) => wrapped.some(([s, e]) => at >= s && at < e)
  const out: { line: number; what: string }[] = []
  for (const m of src.matchAll(MESSAGE_READ)) {
    if (!inside(m.index!)) out.push({ line: lineOf(src, m.index!), what: 'server message shown as is' })
  }
  for (const [s, e] of callSpans(src, /\bthrow new Error\(/)) {
    const args = src.slice(s, e)
    if (!FIXED_TEXT.test(args) && !/^\s*adminErrorText\(/.test(args)) out.push({ line: lineOf(src, s), what: 'throws text that is not fixed and not adminErrorText(…)' })
  }
  return out
}

console.log('[0] Positive controls')
assert(offenders("setError(json.error?.message ?? 'x')").length === 1, '[0] flags setError(json.error?.message ?? …)')
assert(offenders("throw new Error(json.error?.message ?? 'x')").length === 2, '[0] flags throw new Error(json.error?.message ?? …) (the read and the throw)')
assert(offenders("toast.error(json?.error?.message ?? 'x')").length === 1 && offenders('const m = json.error.message').length === 1,
  '[0] flags json?.error?.message and json.error.message too')
assert(offenders("if (!r.ok) throw new Error(\n  r.status === 504 ? 'Timed out' : `Request failed (${r.status})`)").length === 1,
  '[0] flags a thrown error built from the status, split over lines')
assert(offenders("setError(adminErrorText(res.status, json.error?.message ?? 'x'))").length === 0
    && offenders("throw new Error(adminErrorText(res.status, json.error?.message ?? 'x'))").length === 0,
  '[0] PASSES the same reads wrapped in adminErrorText(…)')
assert(offenders("setError(adminErrorText(res.status, missing?.length\n  ? `${json.error.message} Missing: ${missing.join(', ')}.`\n  : json.error?.message ?? 'x'))").length === 0,
  '[0] PASSES a wrapped call split over several lines')
assert(offenders("throw new Error('Save failed')").length === 0 && offenders('throw new Error()').length === 0,
  '[0] PASSES a throw of fixed text, or of nothing')
assert(offenders("setError('Could not (yet) save')").length === 0, '[0] a bracket inside quoted text does not confuse the scanner')

console.log('\n[1] The helper (lib/admin-error-text.ts)')
let helper: { ADMIN_NO_ACCESS?: unknown; adminErrorText?: (status: number, otherwise: string) => string } = {}
try {
  helper = await import(pathToFileURL(resolve('lib/admin-error-text.ts')).href)
} catch {
  helper = {}
}
assert(typeof helper.adminErrorText === 'function' && typeof helper.ADMIN_NO_ACCESS === 'string', 'lib/admin-error-text.ts exports ADMIN_NO_ACCESS and adminErrorText')
assert(helper.ADMIN_NO_ACCESS === APPROVED, `ADMIN_NO_ACCESS is the approved sentence, word for word: "${APPROVED}"`)
const run = (status: number, text: string) => (typeof helper.adminErrorText === 'function' ? helper.adminErrorText(status, text) : undefined)
assert(run(403, 'Forbidden — admin access required') === APPROVED, 'a 403 shows the fixed sentence, not the server\'s "Forbidden — admin access required"')
assert(run(403, 'Only an admin can change fees.') === APPROVED, 'a 403 never shows the server\'s text, whatever it says')
assert(run(400, 'x') === 'x' && run(401, 'x') === 'x' && run(409, 'x') === 'x' && run(500, 'x') === 'x', 'any other status keeps the caller\'s text, unchanged (400, 401, 409, 500)')

console.log('\n[2] Every admin screen')
const files = walk('app/admin').filter(f => f.endsWith('.tsx'))
assert(files.length >= 20, `${files.length} admin screen files scanned (≥20 expected — a scan that finds nothing is the vacuous pass)`)
for (const [f, why] of Object.entries(SKIPPED)) assert(existsSync(f), `skipped file still exists, so the skip list is not stale: ${f} (${why})`)
let wrappedCount = 0
const found: string[] = []
for (const f of files) {
  if (f in SKIPPED) continue
  const src = codeOnly(readFileSync(f, 'utf8'))
  wrappedCount += callSpans(src, /\badminErrorText\(/).length
  for (const o of offenders(src)) found.push(`${f}:${o.line} ${o.what}`)
}
for (const o of found) console.log(`       ${o}`)
assert(found.length === 0, `no admin screen shows server text unwrapped, or throws non-fixed text (${found.length} offenders)`)
assert(wrappedCount >= 20, `${wrappedCount} adminErrorText(…) sites found (≥20 expected)`)

console.log('\n[3] Who may do what is unchanged')
const auth = readFileSync('lib/auth.ts', 'utf8').replace(/\r\n/g, '\n')
const body = (name: string) => {
  const i = auth.indexOf(`export async function ${name}(`)
  const j = auth.indexOf('\nexport ', i + 1)
  return i >= 0 ? auth.slice(i, j > i ? j : undefined) : ''
}
for (const gate of ['requireAdminAuth', 'requireStrictAdminAuth', 'requireSettingsAdmin', 'requireApprovalsAdmin']) {
  assert(/throw new ApiError\('Forbidden — [a-z]+ access required', 403, 'FORBIDDEN'\)/.test(body(gate)), `${gate} still refuses with 403 FORBIDDEN`)
}

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
