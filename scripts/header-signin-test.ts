/**
 * THE SHARED HEADER'S SIGN-IN CHOOSER (block header-signin-v1, 2026-11-24).
 *
 * Every page except the homepage showed a "Get Started" button in the shared header
 * (app/_components/MarketplaceNavbar.tsx). It now shows the same Sign in chooser as the homepage
 * (Homepage v2). There is ONE chooser, app/_components/SignInChooser.tsx, used by both headers;
 * a second copy would drift the first time someone edits the sign-in links.
 *
 *   [0] positive controls: each scanner is shown to flag the shape it exists for, and to pass a clean one
 *   [1] the navbar has no "Get Started" and shows the chooser to signed-out visitors, after Clerk loads
 *   [2] one chooser: the sign-in links are listed in exactly one file, and both headers import it
 *   [3] the chooser: the three sign-in links, screen-reader attributes, a phone-sized touch target,
 *       a panel that fits a phone, and Escape / tap-outside closing
 *
 * Run:  npx tsx scripts/header-signin-test.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** Code only: block comments (incl. JSX {/* *\/}) and whole-line // comments removed. */
const codeOnly = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(full)
  }
  return out
}

const GET_STARTED = /Get Started/i
const CHOICES_LIST = /signInChoices\.map\(/

const NAVBAR = 'app/_components/MarketplaceNavbar.tsx'
const HOME_HEADER_FILE = 'app/_components/HomeHeader.tsx'
const CHOOSER = 'app/_components/SignInChooser.tsx'

/** The navbar's signed-out arm: from the last `) : (` after `: isSignedIn ? (` up to `</nav>`. */
function signedOutArm(src: string): string {
  const start = src.indexOf(': isSignedIn ? (')
  const end = src.indexOf('</nav>', start)
  if (start < 0 || end < 0) return ''
  const arm = src.lastIndexOf(') : (', end)
  return arm > start ? src.slice(arm, end) : ''
}

console.log('[0] Positive controls')
assert(GET_STARTED.test(codeOnly('<Link href="/fairs">\n  Get Started\n</Link>')), '[0] flags "Get Started" in code')
assert(!GET_STARTED.test(codeOnly('// flashed "Get Started" before\n{/* was "Get Started" */}\n<SignInChooser />')), '[0] ignores "Get Started" inside comments')
const plantedNav = '{!isLoaded ? (\n  <div />\n) : isSignedIn ? (\n  <div>avatar</div>\n) : (\n  <div className="relative"><SignInChooser open={x} /></div>\n)}\n</nav>'
assert(signedOutArm(plantedNav).includes('<SignInChooser'), '[0] the signed-out slice finds a chooser that is there')
assert(!signedOutArm(plantedNav.replace('<SignInChooser open={x} />', '<Link href="/fairs">Get Started</Link>')).includes('<SignInChooser'),
  '[0] the signed-out slice does not find a chooser that is not there')
assert(CHOICES_LIST.test('{HOME_HEADER.signInChoices.map(({ label, href }) => (') && !CHOICES_LIST.test('HOME_HEADER.signInChoices.length'),
  '[0] the one-copy scanner flags a rendered list of sign-in links, not a mere mention')

console.log('\n[1] The shared header')
const navSrc = read(NAVBAR)
const navCode = codeOnly(navSrc)
assert(navSrc.length > 0, `${NAVBAR} exists`)
assert(!GET_STARTED.test(navCode), 'the shared header has no "Get Started" in its code')
assert(/import SignInChooser(, \{[^}]*\})? from '\.\/SignInChooser'/.test(navCode), 'the shared header imports ./SignInChooser')
assert(/\{!isLoaded \? \([\s\S]{0,400}?\) : isSignedIn \? \(/.test(navCode), 'the right-hand slot still waits for Clerk to load before choosing')
assert(signedOutArm(navCode).includes('<SignInChooser'), 'signed-out visitors get the sign-in chooser')

console.log('\n[2] One chooser')
const listers = [...walk('app'), ...walk('components')]
  .filter(f => CHOICES_LIST.test(codeOnly(readFileSync(f, 'utf8'))))
  .map(f => f.replace(/\\/g, '/'))
assert(listers.length === 1 && listers[0] === CHOOSER,
  `the sign-in links are listed in exactly one file, ${CHOOSER} (found: ${listers.join(', ') || 'none'})`)
const homeCode = codeOnly(read(HOME_HEADER_FILE))
assert(/import SignInChooser(, \{[^}]*\})? from '\.\/SignInChooser'/.test(homeCode) && homeCode.includes('<SignInChooser'),
  'the homepage header uses the same chooser')

console.log('\n[3] The chooser')
const chooser = codeOnly(read(CHOOSER))
assert(chooser.length > 0, `${CHOOSER} exists`)
assert(chooser.includes('HOME_HEADER.signIn}') && CHOICES_LIST.test(chooser), 'it shows the "Sign in" label and the list of sign-in links')
const copy = await import(pathToFileURL(resolve('lib/homepage-copy.ts')).href) as {
  HOME_HEADER: { signIn: string; signInChoices: readonly { label: string; href: string }[] }
}
const choices = copy.HOME_HEADER.signInChoices.map(c => `${c.label} → ${c.href}`)
assert(copy.HOME_HEADER.signIn === 'Sign in'
    && JSON.stringify(choices) === JSON.stringify(['Vendor sign-in → /sign-in/vendor', 'Organizer sign-in → /organizer/login', 'Fairgoer sign-in → /sign-in/customer']),
  `the three choices go to the right sign-in pages (${choices.join('; ')})`)
assert(/aria-haspopup="true"/.test(chooser) && /aria-expanded=\{open\}/.test(chooser) && /aria-controls=\{panelId\}/.test(chooser) && /id=\{panelId\}/.test(chooser),
  'the button tells screen readers it opens a panel, whether it is open, and which panel')
assert(/min-h-\[44px\]/.test(chooser), 'the button is at least 44px tall (a phone-sized touch target)')
assert(/absolute right-0 top-full[^'"`]*w-56/.test(chooser), 'the panel is 224px wide and opens right-aligned under the button (fits a 320px phone)')
assert(/'Escape'/.test(chooser) && /'mousedown'/.test(chooser) && /'touchstart'/.test(chooser), 'Escape, a click outside or a tap outside closes it')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
