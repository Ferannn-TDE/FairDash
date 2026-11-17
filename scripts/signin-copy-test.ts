/**
 * SIGN-IN REDESIGN (BATCH-1 §21, Q1–Q10, 2026-11-17) — static checks, no DB.
 *
 *   [0] scanner controls
 *   [1] every role's copy, word for word (the approved strings)
 *   [2] vendor and organizer reuse their locked pitch copy verbatim; the organizer two-part split
 *       changes no words
 *   [3] the removed lines are gone, and sign-up exists only where decided
 *   [4] customer ?redirect=: kept after switching tabs and after sign-in and sign-up; only
 *       same-site paths are followed (external → /fairs)
 *   [5] layout rules: one H1, card H2, video subline only with a video, tabs only with sign-up,
 *       no text links under the form, 44px back link, admin quiet, video after the card
 *   [6] the one input style and the one button style on the Clerk form
 *
 * Run:  npx tsx scripts/signin-copy-test.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { SIGNIN_COPY, SIGN_IN_TAB } from '../lib/signin-copy'
import { VENDOR_PITCH } from '../lib/vendor-pitch'
import { ORGANIZERS_PAGE } from '../lib/organizer-copy'
import { authDestinations } from '../lib/auth-destinations'
import { initialAuthMode } from '../lib/auth-mode'
import { clerkAppearance } from '../lib/clerk-appearance'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const read = (f: string) => readFileSync(f, 'utf8')
const card = read('app/_components/RoleAuthCard.tsx')
const PAGES = {
  vendor: 'app/sign-in/vendor/page.tsx', organizer: 'app/organizer/login/page.tsx', runner: 'app/sign-in/runner/page.tsx',
  customer: 'app/sign-in/customer/page.tsx', admin: 'app/admin/login/page.tsx',
} as const
const allText = (o: unknown): string => JSON.stringify(o)
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length

console.log('[0] scanner controls')
assert(count('<h1>a</h1><h1>b</h1>', /<h1\b/g) === 2, '[0] the H1 counter counts planted H1s')
assert(/Manage your menu/.test('x Manage your menu y') && !/Manage your menu/.test(allText(SIGNIN_COPY)), '[0] the removed-line scanner finds a planted line, and the copy has none')

console.log('\n[1] copy, word for word')
const C = SIGNIN_COPY
assert(SIGN_IN_TAB === 'Sign in', 'first tab on every role: "Sign in"')
assert(C.vendor.eyebrow === 'FOR VENDORS' && C.vendor.signUpTab === 'Apply to sell' && C.vendor.cardHeading === 'Run your booth'
  && C.vendor.videoSubline === 'Watch how a booth runs on FairSynq, then sign in or apply.' && C.vendor.line === undefined,
  'vendor: FOR VENDORS · Apply to sell · Run your booth · the video subline, no other line')
assert(C.organizer.eyebrow === 'FOR FAIRS & FESTIVALS' && C.organizer.signUpTab === 'Apply to host' && C.organizer.cardHeading === 'Host your event'
  && C.organizer.videoSubline === 'Watch how a fair runs on FairSynq, then sign in or apply.' && C.organizer.line === undefined,
  'organizer: FOR FAIRS & FESTIVALS · Apply to host · Host your event · the video subline, no other line')
assert(C.runner.heading === 'Runner sign-in' && C.runner.eyebrow === undefined
  && C.runner.line === 'Sign in to see and claim curbside orders at your event.' && C.runner.signUpTab === undefined,
  'runner: H1 "Runner sign-in", no eyebrow, the approved curbside line, sign-in only')
assert(C.customer.heading === 'Almost there' && C.customer.line === 'Sign in to place your order and track it live across the fairgrounds.'
  && C.customer.signUpTab === 'Create account' && C.customer.eyebrow === undefined && C.customer.cardHeading === undefined && !C.customer.points,
  'customer: Almost there + the existing line · Create account · no eyebrow, no card H2, nothing below')
assert(C.admin.eyebrow === 'Admin · internal' && C.admin.heading === 'Admin sign-in'
  && C.admin.line === 'Restricted access. Sign in with your FairSynq admin account.' && C.admin.signUpTab === undefined && !C.admin.points,
  'admin: Admin · internal · Admin sign-in + the existing line · no sign-up, nothing below')

console.log('\n[2] reused copy is the locked source, verbatim')
assert(C.vendor.heading === VENDOR_PITCH.heading, 'vendor H1 = VENDOR_PITCH.heading')
assert(C.vendor.points!.length === 4 && C.vendor.points!.every((p, i) => p.title === VENDOR_PITCH.points[i].lead && p.text === VENDOR_PITCH.points[i].text),
  'vendor cards = the four VENDOR_PITCH points (lead as title, sentence under it)')
assert(C.organizer.heading === ORGANIZERS_PAGE.heading && C.organizer.eyebrow === ORGANIZERS_PAGE.eyebrow, 'organizer H1 and eyebrow = ORGANIZERS_PAGE')
const op = C.organizer.points!
assert(op.length === 6 && op.every((p, i) => (p.text ? `${p.title} ${p.text}` : p.title) === ORGANIZERS_PAGE.canDo.points[i]),
  'organizer cards = the six canDo points, no words changed')
assert(op.map(p => Boolean(p.text)).join() === 'true,true,false,false,false,false'
  && op[0].title === 'Set up your fair.' && op[1].title === 'See and manage your vendors.',
  'exactly two points have two parts ("Set up your fair." and "See and manage your vendors.")')

console.log('\n[3] removed lines, and where sign-up exists')
const removed = ['Vendor sign-in', 'Manage your menu, take orders', 'Organizer sign-in', 'Create fairs, see and manage the vendors',
  'Claim deliveries', 'get paid per drop', 'Deliver & earn', 'New here?', 'Already registered?', 'Create an account']
const pageSrc = Object.values(PAGES).map(read).join('\n')
assert(removed.every(s => !allText(SIGNIN_COPY).includes(s) && !card.includes(s) && !pageSrc.includes(s)),
  'gone: the "Vendor sign-in" and "Organizer sign-in" eyebrows, both old blurbs, the runner delivery line, the text links')
assert(!existsSync('app/sign-in/vendor/VendorSignIn.tsx'), 'the old vendor client page is gone (the shell renders the pitch)')
assert(Object.entries(PAGES).every(([role, f]) => new RegExp(`<RoleAuthCard role="${role}"`).test(read(f))), 'each page renders the shared shell with its own role')
assert(['vendor', 'organizer', 'customer'].every(r => C[r as keyof typeof C].signUpTab) && !C.runner.signUpTab && !C.admin.signUpTab,
  'sign-up on vendor, organizer and customer only')
assert(initialAuthMode('apply', Boolean(C.runner.signUpTab)) === 'sign-in' && initialAuthMode('apply', Boolean(C.admin.signUpTab)) === 'sign-in'
  && initialAuthMode('apply', Boolean(C.vendor.signUpTab)) === 'sign-up', '?mode=apply opens sign-up on vendor, is ignored on runner and admin')
assert(card.includes('const allowSignUp = Boolean(copy.signUpTab)'), 'the shell allows sign-up exactly where the copy has a sign-up tab')

console.log('\n[4] customer ?redirect=')
const cust = (raw: string | null) => authDestinations('customer', raw, '/fairs')
const ck = cust('/fair/x/checkout')
assert(ck.afterSignIn === '/fair/x/checkout', 'after sign-in: back to checkout')
assert(ck.afterSignUp === '/onboarding?role=customer&redirect=%2Ffair%2Fx%2Fcheckout', 'after sign-up: through onboarding, return URL carried')
const onboarding = read('app/onboarding/page.tsx')
assert(/safeRedirect\(redirectParam, REDIRECT_MAP\[role\]\)/.test(onboarding), 'onboarding validates and honors that ?redirect=')
assert(cust('/account/orders/cmabc').afterSignIn === '/account/orders/cmabc' && cust('/account/orders').afterSignIn === '/account/orders', 'tracking and order history kept')
// Tabs: the destinations come from ?redirect= alone; nothing about the tab feeds them.
const destLine = card.match(/const \{ dest, afterSignIn, afterSignUp \} = authDestinations\((.*)\);/)
assert(Boolean(destLine) && destLine![1] === 'role, searchParams.get("redirect"), redirectTo', 'destinations come from ?redirect= alone (switching tabs keeps it)')
assert(/onClick=\{\(\) => setMode\(m\)\}/.test(card) && count(card, /router\.(push|replace)\(/g) === 1,
  'a tab click only switches the form; it never navigates')
assert(/<SignIn [^>]*forceRedirectUrl=\{afterSignIn\}/.test(card) && /<SignUp [^>]*forceRedirectUrl=\{afterSignUp\}/.test(card), 'both forms use those destinations')
for (const bad of ['https://evil.com', '//evil.com', '/\t/evil.com']) {
  const d = cust(bad)
  assert(d.afterSignIn === '/fairs' && d.afterSignUp === '/onboarding?role=customer', `external ${JSON.stringify(bad)} → /fairs (sign-in) and no return URL on sign-up`)
}
assert(cust(null).afterSignIn === '/fairs', 'no ?redirect= → /fairs')
const v = authDestinations('vendor', '/vendor/x/orders', '/vendor')
assert(v.afterSignIn === '/onboarding?role=vendor&redirect=%2Fvendor%2Fx%2Forders', 'control: operators still go through onboarding on sign-in (unchanged)')

console.log('\n[5] layout rules')
assert(count(card, /<h1\b/g) === 1 && /<h1[^>]*>\s*\{copy\.heading\}/.test(card), 'one H1 on every role: the headline')
assert(/copy\.cardHeading && \([\s\S]{0,40}<h2\b/.test(card), 'the card heading is an H2')
assert(/hasVideo && copy\.videoSubline &&/.test(card), 'the video subline shows only with a video')
assert(/\{allowSignUp && \(\s*<div role="tablist"/.test(card), 'tabs only where sign-up is allowed')
assert(/min-h-\[44px\][^"]*"[^>]*>\s*<ArrowLeft[\s\S]{0,120}Back to FairSynq/.test(card), 'the back link is at least 44px tall')
assert(/\{!quiet && \(\s*<div aria-hidden="true"/.test(card) && /<RoleAuthCard role="admin"[^>]*\bquiet\b/.test(read(PAGES.admin)), 'admin is quiet: no glow')
assert(card.indexOf('{card}') < card.indexOf('<PitchVideo'), 'phones: the card comes before the video')
assert(/hasVideo && \(/.test(card), 'no video = no video area')
assert(/getVideoSlot\('vendorPitch'\)/.test(read(PAGES.vendor)) && /getVideoSlot\('organizerPitch'\)/.test(read(PAGES.organizer)),
  'vendor reads the vendor slot; organizer sign-in reuses the organizer slot')
assert(['runner', 'customer', 'admin'].every(r => !/video=/.test(read(PAGES[r as keyof typeof PAGES]))), 'runner, customer and admin have no video')

console.log('\n[6] the one input and one button style')
const el = clerkAppearance.elements as Record<string, string>
assert(/!h-12\b/.test(el.formFieldInput) && /!rounded-xl\b/.test(el.formFieldInput) && /placeholder:!text-\[#8A8A8A\]/.test(el.formFieldInput),
  'input: 48px, rounded-xl, placeholder #8A8A8A')
assert(/!h-\[52px\]/.test(el.formButtonPrimary) && /!bg-\[#FF0077\]/.test(el.formButtonPrimary) && /hover:!bg-\[#e0006b\]/.test(el.formButtonPrimary)
  && /!text-\[19px\]/.test(el.formButtonPrimary) && /!font-bold/.test(el.formButtonPrimary) && /!rounded-xl/.test(el.formButtonPrimary)
  && !/gradient/.test(el.formButtonPrimary), 'button: flat #FF0077 (hover #e0006b), rounded-xl, 19px bold, no gradient')

console.log(`\n${fail === 0 ? '✅' : '❌'} sign-in redesign: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
