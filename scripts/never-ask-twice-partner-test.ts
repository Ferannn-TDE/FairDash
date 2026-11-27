/**
 * NEVER ASK TWICE: PARTNER APPLICATION (block never-ask-twice, 2026-11-24).
 *
 * The partner application (/partners) asked a signed-in visitor again, in empty boxes, for the
 * name, email and phone they had already given Clerk. It now starts filled in from the sign-in
 * (signed-out visitors still see empty boxes), the email box is labelled 'Organization email'
 * with the shared one-line hint, every box stays editable, and the email does not have to match
 * the login. The page is rendered per visitor so one person's details are never cached or shown
 * to another.
 *
 *   [0] positive controls: the source scanner ignores commented-out code
 *   [1] the form, server-rendered with a prefill: contact name, phone and email hold the sign-in
 *       values, the other boxes stay empty, 'Organization email', the hint, still editable
 *   [2] no prefill (signed out): empty boxes, no hint
 *   [3] the email does not have to match the login, and a Clerk-format phone passes validation
 *   [4] /partners reads the sign-in on the server and passes it in; /partners and /become-vendor
 *       are both force-dynamic with no revalidate
 *   [5] one copy of the hint: the form uses PREFILLED_EMAIL_HINT
 *
 * Every new prop and export is checked before it is used, so against the old code the suite
 * reports failures instead of crashing (the bite test).
 *
 * Run:  npx tsx scripts/never-ask-twice-partner-test.ts
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
const FORM = 'app/partners/PartnerApplicationForm.tsx'
const PARTNER_PAGE = 'app/partners/page.tsx'
const VENDOR_PAGE = 'app/become-vendor/page.tsx'

const FORCE_DYNAMIC = /export const dynamic = 'force-dynamic'/
const REVALIDATE = /export const revalidate\b/

async function load<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null
  try {
    return await import(pathToFileURL(resolve(file)).href) as T
  } catch (e) {
    console.log(`  (could not load ${file}: ${(e as Error).message})`)
    return null
  }
}

/** The <input …> tag with this id ('' when missing). */
const inputTag = (html: string, id: string) => html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? ''
const valueOf = (tag: string) => tag.match(/\bvalue="([^"]*)"/)?.[1] ?? null

console.log('[0] Positive controls')
assert(FORCE_DYNAMIC.test(codeOnly("export const dynamic = 'force-dynamic'\n")), '[0] finds force-dynamic in code')
assert(!FORCE_DYNAMIC.test(codeOnly("// export const dynamic = 'force-dynamic'\n/* export const dynamic = 'force-dynamic' */\n")), '[0] ignores force-dynamic inside comments')
assert(valueOf(inputTag('<input id="p-x" value="a"/><input id="p-y" value="b"/>', 'p-y')) === 'b', '[0] the input finder reads the right box')

console.log('\n[1] The form with the sign-in details')
const mod = await load<{ default?: React.ComponentType<Record<string, unknown>> }>(FORM)
const Form = typeof mod?.default === 'function' ? mod.default : null
assert(Form !== null, `${FORM} loads`)
const render = (props: Record<string, unknown>): string => {
  if (!Form) return ''
  try {
    return renderToStaticMarkup(React.createElement(Form, props))
  } catch (e) {
    console.log(`  (render failed: ${(e as Error).message})`)
    return ''
  }
}
const withPrefill = render({ prefill: { name: 'Jane Smith', email: 'jane@example.com', phone: '+15551234567' } })
assert(withPrefill.length > 0, 'the form renders')
assert(valueOf(inputTag(withPrefill, 'p-contact')) === 'Jane Smith', 'Contact name starts as the sign-in name')
assert(valueOf(inputTag(withPrefill, 'p-phone')) === '+15551234567', 'Phone starts as the sign-in phone')
assert(valueOf(inputTag(withPrefill, 'p-email')) === 'jane@example.com', 'the email box starts as the sign-in email')
assert(valueOf(inputTag(withPrefill, 'p-name')) === '' && valueOf(inputTag(withPrefill, 'p-city')) === '',
  'Organization name and City stay empty (never asked before)')
assert(/>Organization email</.test(withPrefill), "the email box is labelled 'Organization email'")
assert(!/>Email</.test(withPrefill), "the old 'Email' label is gone")
assert(withPrefill.includes(HINT_HTML), `the one-line hint reads exactly: ${HINT}`)
const emailTag = inputTag(withPrefill, 'p-email')
assert(emailTag.length > 0 && !/readonly|disabled/i.test(emailTag), 'the email box stays editable')

console.log('\n[2] Signed out: no sign-in details')
const noPrefill = render({})
assert(noPrefill.length > 0 && valueOf(inputTag(noPrefill, 'p-email')) === '' && valueOf(inputTag(noPrefill, 'p-contact')) === ''
  && valueOf(inputTag(noPrefill, 'p-phone')) === '', 'no prefill: empty boxes')
assert(noPrefill.length > 0 && !noPrefill.includes(HINT_HTML), 'no prefill: no hint')
assert(/>Organization email</.test(noPrefill), "no prefill: still labelled 'Organization email'")
const blankPrefill = render({ prefill: { name: '', email: '', phone: '' } })
assert(blankPrefill.length > 0 && !blankPrefill.includes(HINT_HTML), 'an empty prefill shows no hint')

console.log('\n[3] The email does not have to match the login')
type Validation = {
  validatePartnerApplication?: (input: Record<string, unknown>) => Record<string, string | undefined>
  GROUP_TYPES?: readonly { value: string }[]
  US_STATES?: readonly (readonly [string, string])[]
}
const v = await load<Validation>('lib/partner-application.ts')
if (typeof v?.validatePartnerApplication === 'function' && v.GROUP_TYPES?.length && v.US_STATES?.length) {
  const filled = {
    name: 'Riverside Lions Club', groupType: v.GROUP_TYPES[0].value, groupTypeOther: '',
    contactName: 'Jane Smith', email: 'group@example.org', phone: '+12175550134',
    city: 'Collinsville', state: v.US_STATES[0][0], interests: '', staffHours: '', note: '',
    // The Terms box is required since sign-up-fixes commit 4; the phone follows the US rule from
    // commit 1 (an exchange can't start with 1, so the old +15551234567 is now refused, correctly).
    agreedToTerms: true,
  }
  const errors = v.validatePartnerApplication(filled)
  assert(!errors.email, 'a changed email (not the login one) is accepted')
  assert(!errors.phone, 'a Clerk-format phone (+12175550134) is accepted')
  assert(Object.keys(errors).filter(k => errors[k]).length === 0, 'a filled-in form has no errors')
} else {
  assert(false, 'lib/partner-application.ts exports validatePartnerApplication, GROUP_TYPES and US_STATES')
}

console.log('\n[4] Both pages are personal')
const partnerPage = codeOnly(read(PARTNER_PAGE))
assert(/import \{ getSignedInContact \} from '@\/lib\/signed-in-contact'/.test(partnerPage) && /await getSignedInContact\(\)/.test(partnerPage),
  '/partners reads the sign-in on the server')
assert(/<PartnerApplicationForm[^>]*\bprefill=\{/.test(partnerPage), 'and passes it to the form')
for (const [route, file] of [['/partners', PARTNER_PAGE], ['/become-vendor', VENDOR_PAGE]] as const) {
  const src = codeOnly(read(file))
  assert(src.length > 0 && FORCE_DYNAMIC.test(src), `${route} is force-dynamic (never prerendered or shared between visitors)`)
  assert(src.length > 0 && !REVALIDATE.test(src), `${route} has no revalidate`)
}

console.log('\n[5] One copy of the hint')
const form = codeOnly(read(FORM))
assert(/import \{[^}]*\bPREFILLED_EMAIL_HINT\b[^}]*\} from '@\/lib\/contact-prefill'/.test(form) && /\{PREFILLED_EMAIL_HINT\}/.test(form),
  'the form shows the shared PREFILLED_EMAIL_HINT')
assert(!form.includes('send your updates here'), 'the form has no typed-out copy of the hint')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
