/**
 * NEVER ASK TWICE: VENDOR (block never-ask-twice, 2026-11-24).
 *
 * Become a Vendor step 1 asked again, in empty boxes, for the name, email and phone the person had
 * just given Clerk at sign-up. It now starts filled in from the sign-in (every box stays editable),
 * the email box is labelled for what it is ('Business email') with a one-line hint that updates are
 * sent there, and the page is rendered per visitor so one person's details are never cached or
 * shown to another.
 *
 *   [0] positive controls: the source scanner ignores commented-out code
 *   [1] contactFromClerkUser: the primary email (not just the first), first + last name, the first
 *       phone, '' for anything missing; signed out gives all ''
 *   [2] fillEmptyFields: fills only empty boxes, never overwrites a value, never changes its input
 *   [3] the wizard, server-rendered with a prefill: step 1 shows the values, 'Business email', the hint
 *   [4] the wizard with no prefill: empty boxes, no hint
 *   [5] the page reads the sign-in on the server, passes it in, and is force-dynamic with no revalidate
 *
 * Every new export is checked before it is called, so against the old code the suite reports
 * failures instead of crashing (the bite test).
 *
 * Run:  npx tsx scripts/never-ask-twice-vendor-test.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** Code only: block comments (incl. JSX {/* *\/}) and whole-line // comments removed. */
const codeOnly = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const HINT = "We'll send your updates here. Change it now if needed."
/** The hint as React writes it into HTML (the apostrophe becomes &#x27;). */
const HINT_HTML = HINT.replace(/'/g, '&#x27;')
const PAGE = 'app/become-vendor/page.tsx'
const WIZARD = 'app/become-vendor/VendorOnboarding.tsx'
const HELPER = 'lib/contact-prefill.ts'
const SERVER_HELPER = 'lib/signed-in-contact.ts'

const FORCE_DYNAMIC = /export const dynamic = 'force-dynamic'/
const REVALIDATE = /export const revalidate\b/

type Contact = { name: string; email: string; phone: string }
type PrefillModule = {
  contactFromClerkUser?: (user: unknown) => Contact
  fillEmptyFields?: <T extends Record<string, unknown>>(base: T, prefill: Partial<Record<keyof T, string>>) => T
}

async function load<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null
  try {
    return await import(pathToFileURL(resolve(file)).href) as T
  } catch (e) {
    console.log(`  (could not load ${file}: ${(e as Error).message})`)
    return null
  }
}

console.log('[0] Positive controls')
assert(FORCE_DYNAMIC.test(codeOnly("export const dynamic = 'force-dynamic'\n")), '[0] finds force-dynamic in code')
assert(!FORCE_DYNAMIC.test(codeOnly("// export const dynamic = 'force-dynamic'\n/* export const dynamic = 'force-dynamic' */\n")), '[0] ignores force-dynamic inside comments')
assert(REVALIDATE.test(codeOnly('export const revalidate = 300\n')) && !REVALIDATE.test(codeOnly('// export const revalidate = 300\n')), '[0] finds a revalidate in code, not in a comment')

console.log('\n[1] Reading the sign-in')
const mod = await load<PrefillModule>(HELPER)
const fromClerk = typeof mod?.contactFromClerkUser === 'function' ? mod.contactFromClerkUser : null
assert(fromClerk !== null, `${HELPER} exports contactFromClerkUser`)
if (fromClerk) {
  const full = fromClerk({
    primaryEmailAddressId: 'e2',
    emailAddresses: [{ id: 'e1', emailAddress: 'old@example.com' }, { id: 'e2', emailAddress: 'jane@example.com' }],
    firstName: 'Jane', lastName: 'Smith',
    phoneNumbers: [{ phoneNumber: '+15551234567' }],
  })
  assert(full.email === 'jane@example.com', 'the primary email, not the first one in the list')
  assert(full.name === 'Jane Smith', 'first + last name')
  assert(full.phone === '+15551234567', 'the first phone')
  const bare = fromClerk({
    primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'solo@example.com' }],
    firstName: 'Solo', lastName: null, phoneNumbers: [],
  })
  assert(bare.name === 'Solo' && bare.phone === '' && bare.email === 'solo@example.com', 'no last name and no phone give "Solo" and ""')
  const none = fromClerk(null)
  assert(none.name === '' && none.email === '' && none.phone === '', 'signed out gives all empty')
  const noPrimary = fromClerk({
    primaryEmailAddressId: null, emailAddresses: [{ id: 'e1', emailAddress: 'other@example.com' }],
    firstName: null, lastName: null, phoneNumbers: [],
  })
  assert(noPrimary.email === '' && noPrimary.name === '', 'no primary email gives "" (never guesses another address)')
}

console.log('\n[2] Only filling empty boxes')
const fill = typeof mod?.fillEmptyFields === 'function' ? mod.fillEmptyFields : null
assert(fill !== null, `${HELPER} exports fillEmptyFields`)
if (fill) {
  const base = { contactName: '', email: 'saved@example.com', phone: '', note: '' }
  const before = JSON.stringify(base)
  const out = fill(base, { contactName: 'Jane Smith', email: 'jane@example.com', phone: '' })
  assert(out.contactName === 'Jane Smith', 'an empty box is filled')
  assert(out.email === 'saved@example.com', 'a box that already has a value is never overwritten')
  assert(out.phone === '', 'an empty prefill value leaves the box empty')
  assert(out.note === '', 'a box with no prefill is left alone')
  assert(JSON.stringify(base) === before, 'the starting values are not changed in place')
  assert(fill({ contactName: '' }, { contactName: '   ' }).contactName === '', 'a spaces-only prefill fills nothing')
}

console.log('\n[3] The wizard with the sign-in details')
const wiz = await load<{ default?: React.ComponentType<Record<string, unknown>> }>(WIZARD)
const Wizard = typeof wiz?.default === 'function' ? wiz.default : null
assert(Wizard !== null, `${WIZARD} loads`)
const render = (props: Record<string, unknown>): string => {
  if (!Wizard) return ''
  try {
    return renderToStaticMarkup(React.createElement(Wizard, props))
  } catch (e) {
    console.log(`  (render failed: ${(e as Error).message})`)
    return ''
  }
}
const withPrefill = render({ video: null, prefill: { name: 'Jane Smith', email: 'jane@example.com', phone: '+15551234567' } })
assert(withPrefill.length > 0, 'the wizard renders')
assert(withPrefill.includes('value="Jane Smith"'), 'Contact Name starts as the sign-in name')
assert(withPrefill.includes('value="jane@example.com"'), 'the email box starts as the sign-in email')
assert(withPrefill.includes('value="+15551234567"'), 'Phone Number starts as the sign-in phone')
assert(withPrefill.includes('>Business email<'), "the email box is labelled 'Business email'")
assert(!withPrefill.includes('>Email Address<'), "the old 'Email Address' label is gone")
assert(withPrefill.includes(HINT_HTML), `the one-line hint reads exactly: ${HINT}`)
const emailTag = withPrefill.match(/<input[^>]*value="jane@example\.com"[^>]*>/)?.[0] ?? ''
assert(emailTag.length > 0 && !/readonly|disabled/i.test(emailTag), 'the email box stays editable')

console.log('\n[4] The wizard with no sign-in details')
const noPrefill = render({ video: null })
assert(noPrefill.length > 0 && !noPrefill.includes('jane@example.com') && !noPrefill.includes(HINT_HTML), 'no prefill: empty boxes and no hint')
assert(noPrefill.includes('>Business email<'), "no prefill: still labelled 'Business email'")
const blankPrefill = render({ video: null, prefill: { name: '', email: '', phone: '' } })
assert(blankPrefill.length > 0 && !blankPrefill.includes(HINT_HTML), 'an empty prefill shows no hint')

console.log('\n[5] The page')
const page = codeOnly(read(PAGE))
assert(page.length > 0, `${PAGE} exists`)
assert(FORCE_DYNAMIC.test(page), `${PAGE} is force-dynamic (never prerendered or shared between visitors)`)
assert(!REVALIDATE.test(page), `${PAGE} has no revalidate`)
assert(/import \{ getSignedInContact \} from '@\/lib\/signed-in-contact'/.test(page) && /await getSignedInContact\(\)/.test(page),
  'the page reads the sign-in on the server')
assert(/<VendorOnboarding[^>]*\bprefill=\{/.test(page), 'and passes it to the wizard')
const server = codeOnly(read(SERVER_HELPER))
assert(/import \{ currentUser \} from '@clerk\/nextjs\/server'/.test(server) && /contactFromClerkUser\(/.test(server),
  `${SERVER_HELPER} reads Clerk's currentUser() through contactFromClerkUser`)
assert(/catch\b/.test(server), `${SERVER_HELPER} falls back to empty boxes if Clerk fails`)

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
