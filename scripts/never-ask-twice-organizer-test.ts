/**
 * NEVER ASK TWICE: ORGANIZER SETTINGS NEVER BLANK SAVED VALUES (block never-ask-twice, 2026-11-24).
 *
 * The bug: app/organizer/settings/page.tsx loads the saved profile into its boxes. If that load
 * failed, the catch stayed silent, the boxes stayed empty, and Save sent the empty name, phone and
 * organization name, overwriting what was saved. Now Save is off until the page has loaded the
 * saved profile successfully, and a failed load says so instead of showing empty boxes.
 *
 *   [0] positive controls: each scanner finds the right shape in a planted good example and
 *       rejects a planted bad one
 *   [1] a profileLoaded flag starts false
 *   [2] it turns true only on the success path of the load (never in catch or finally)
 *   [2b] an error answer (res.ok false, or no success: true with data) is thrown before any box
 *        is filled, so it lands in catch as a failed load
 *   [3] handleSave returns when the profile is not loaded, before it sends anything
 *   [4] the Save button is disabled while the profile is not loaded
 *   [5] a failed load shows the fixed sentence in place of the boxes and Save
 *
 * The page loads in the browser (a server render only shows the loading skeleton), so this reads
 * the page's code as text with comments removed, like scripts/vendor-agreement-test.ts.
 *
 * Run:  npx tsx scripts/never-ask-twice-organizer-test.ts
 */
import { existsSync, readFileSync } from 'node:fs'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** Code only: block comments (incl. JSX {/* *\/}) and whole-line // comments removed. */
const codeOnly = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const PAGE = 'app/organizer/settings/page.tsx'
const MESSAGE = "We couldn't load your saved profile. Reload the page to try again."

/** The load function's try / catch / finally parts ('' when a part is missing). */
function splitLoad(src: string): { tryPart: string; catchPart: string; finallyPart: string } {
  const start = src.indexOf('const loadProfile = useCallback(')
  const end = start < 0 ? -1 : src.indexOf('}, [])', start)
  if (start < 0 || end < 0) return { tryPart: '', catchPart: '', finallyPart: '' }
  const body = src.slice(start, end)
  const t = body.indexOf('try {')
  const c = body.indexOf('} catch')
  const f = body.indexOf('} finally')
  return {
    tryPart: t >= 0 && c > t ? body.slice(t, c) : '',
    catchPart: c >= 0 ? body.slice(c, f > c ? f : body.length) : '',
    finallyPart: f >= 0 ? body.slice(f) : '',
  }
}

/** True when the load sets profileLoaded only on its success path, after the boxes are filled. */
function setsLoadedOnlyOnSuccess(src: string): boolean {
  const { tryPart, catchPart, finallyPart } = splitLoad(src)
  const at = tryPart.indexOf('setProfileLoaded(true)')
  return at >= 0 && at > tryPart.indexOf('setOrgName(')
    && !catchPart.includes('setProfileLoaded(true)') && !finallyPart.includes('setProfileLoaded(true)')
}

/** True when an error answer (res.ok false, or no success: true with data) is thrown before any box is filled. */
function rejectsErrorsBeforeFilling(src: string): boolean {
  const { tryPart } = splitLoad(src)
  const fill = Math.min(...['setProfile(', 'setName(', 'setPhone(', 'setOrgName('].map(s => {
    const i = tryPart.indexOf(s)
    return i < 0 ? Infinity : i
  }))
  const notOk = tryPart.search(/if \(!res\.ok\) throw\b/)
  const notSuccess = tryPart.search(/if \(json\?\.success !== true \|\| !json\.data\) throw\b/)
  return Number.isFinite(fill) && notOk >= 0 && notSuccess >= 0 && notOk < fill && notSuccess < fill
}

/** handleSave's body ('' when missing). */
function saveBody(src: string): string {
  const start = src.indexOf('const handleSave = async () => {')
  const end = start < 0 ? -1 : src.indexOf('\n  }\n', start)
  return start >= 0 && end > start ? src.slice(start, end) : ''
}

/** True when handleSave leaves before its fetch while the profile is not loaded. */
function saveGuardedBeforeFetch(src: string): boolean {
  const body = saveBody(src)
  const guard = body.search(/if \(!profileLoaded\) return\b/)
  const send = body.indexOf('fetch(')
  return guard >= 0 && send > guard
}

console.log('[0] Positive controls')
const goodLoad = [
  'const loadProfile = useCallback(async () => {',
  '    try {', '      setOrgName(data.organizationName ?? \'\')', '      setProfileLoaded(true)',
  '    } catch {', '      setProfileLoaded(false)', '    } finally {', '      setProfileLoading(false)', '    }', '  }, [])',
].join('\n')
assert(setsLoadedOnlyOnSuccess(goodLoad), '[0] a load that sets the flag after filling the boxes passes')
assert(!setsLoadedOnlyOnSuccess(goodLoad.replace('setProfileLoading(false)', 'setProfileLoading(false); setProfileLoaded(true)')),
  '[0] a load that sets the flag in finally is caught')
assert(!setsLoadedOnlyOnSuccess(goodLoad.replace('setProfileLoaded(false)', 'setProfileLoaded(true)')), '[0] a load that sets the flag in catch is caught')
const goodChecks = [
  'const loadProfile = useCallback(async () => {',
  '    try {', '      if (!res.ok) throw new Error(\'x\')', '      if (json?.success !== true || !json.data) throw new Error(\'x\')',
  '      setProfile(data)', '      setName(data.name ?? \'\')', '    } catch {', '    } finally {', '    }', '  }, [])',
].join('\n')
assert(rejectsErrorsBeforeFilling(goodChecks), '[0] a load that rejects error answers before filling the boxes passes')
assert(!rejectsErrorsBeforeFilling(goodChecks.replace("      if (json?.success !== true || !json.data) throw new Error('x')\n", '')),
  '[0] a load with no success check is caught')
assert(!rejectsErrorsBeforeFilling(goodChecks.replace("      if (json?.success !== true || !json.data) throw new Error('x')\n      setProfile(data)",
  "      setProfile(data)\n      if (json?.success !== true || !json.data) throw new Error('x')")),
  '[0] a load that checks success after filling a box is caught')
const goodSave ="const handleSave = async () => {\n    if (!profileLoaded) return\n    const res = await fetch('/api/organizer/profile')\n  }\n"
assert(saveGuardedBeforeFetch(goodSave), '[0] a save that checks the flag before fetch passes')
assert(!saveGuardedBeforeFetch("const handleSave = async () => {\n    const res = await fetch('/x')\n    if (!profileLoaded) return\n  }\n"),
  '[0] a save that checks the flag after fetch is caught')
assert(!/useState\(false\)/.test(codeOnly('// const [profileLoaded, setProfileLoaded] = useState(false)\n')), '[0] the scanner ignores commented-out code')

const page = codeOnly(read(PAGE))
assert(page.length > 0, `${PAGE} exists`)

console.log('\n[1] A loaded flag that starts off')
assert(/const \[profileLoaded, setProfileLoaded\] = useState\(false\)/.test(page), 'profileLoaded starts false')

console.log('\n[2] The flag turns on only after a successful load')
assert(setsLoadedOnlyOnSuccess(page), 'setProfileLoaded(true) is on the success path, after the boxes are filled, never in catch or finally')

console.log('\n[2b] An error answer is a failed load')
assert(rejectsErrorsBeforeFilling(page), 'res.ok false, or no success: true with data, throws before setProfile and before any box is filled')

console.log('\n[3] Save refuses to send for a page that did not load')
assert(saveGuardedBeforeFetch(page), 'handleSave returns when !profileLoaded, before its fetch')

console.log('\n[4] The Save button is off until the profile has loaded')
const saveButton = page.match(/<button\s+onClick=\{handleSave\}[\s\S]*?>/)?.[0] ?? ''
assert(saveButton.length > 0, 'the Save button is found')
assert(/disabled=\{[^}]*!profileLoaded[^}]*\}/.test(saveButton), 'the Save button is disabled while !profileLoaded')

console.log('\n[5] A failed load says so, in place of the boxes')
const quoted = MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
assert(new RegExp(`const PROFILE_LOAD_FAILED = (["\`])${quoted}\\1`).test(page), `the sentence reads exactly: ${MESSAGE}`)
const branch = page.search(/profileLoading \? \(?\s*<SkeletonCard \/>\s*\)? : !profileLoaded \? \(/)
const shown = page.indexOf('{PROFILE_LOAD_FAILED}')
const boxes = page.indexOf('onChange={(e) => setName(e.target.value)}')
assert(branch >= 0, 'after loading, a page that did not load takes its own branch before the profile boxes')
assert(shown > branch && boxes > shown, 'that branch shows the sentence, and the boxes and Save are only in the loaded branch')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
