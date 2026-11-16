/**
 * VIDEO SLOT GUARD (item 12, B1.15) — the video rules that a type check can't see.
 *
 *   [0] the source scanner finds a planted string and misses an absent one (controls)
 *   [1] PitchVideo renders nothing without a source or after a load error, fetches nothing
 *       before it is near the viewport (preload="none", src only when near), plays inline,
 *       sets muted on the element, and never autoplays for reduced-motion visitors
 *   [2] the placements: /sign-in/vendor and /become-vendor read vendorPitch, /partners reads partnerPitch,
 *       /organizers reads organizerPitch (under the intro and buttons), all
 *       through lib/videos (cached under the tag the settings API revalidates)
 *   [3] no video goes through Supabase storage
 *
 * Run:  npx tsx scripts/video-slot-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const has = (src: string, s: string | RegExp) => (typeof s === 'string' ? src.includes(s) : s.test(src))

console.log('[0] scanner controls')
assert(has('<video preload="none" />', 'preload="none"'), '[0] positive control: finds a planted attribute')
assert(!has('<video preload="auto" />', 'preload="none"'), '[0] baseline: misses it when absent')

console.log('[1] PitchVideo')
const pv = readFileSync('app/_components/PitchVideo.tsx', 'utf8')
assert(has(pv, "if (!source || failed) return null"), 'renders nothing without a source or after an error')
assert(has(pv, 'onError={() => setFailed(true)}'), 'a load error hides the player')
assert(has(pv, 'preload="none"') && has(pv, 'src={near ? source.url : undefined}'), 'no src (no bytes) until near the viewport')
assert(has(pv, 'new IntersectionObserver('), 'nearness comes from an IntersectionObserver')
assert(has(pv, 'playsInline'), 'plays inline on iPhone')
assert(has(pv, 'el.muted = auto'), 'muted is set on the element (React does not write the attribute)')
assert(has(pv, "const auto = autoPlay && !reducedMotion") && has(pv, "useState(true) // assume reduced"), 'reduced motion means no autoplay, and it is assumed until known')
assert(has(pv, 'controls'), 'controls are always shown (unmute, pause)')

console.log('[2] placements')
const vids = readFileSync('lib/videos.ts', 'utf8')
assert(has(vids, "tags: [VIDEOS_CACHE_TAG]"), 'lib/videos caches under the videos tag')
const route = readFileSync('app/api/admin/settings/route.ts', 'utf8')
assert(has(route, /startsWith\('video\.'\)[\s\S]{0,80}revalidateTag\(VIDEOS_CACHE_TAG/), 'saving a video.* key revalidates that tag')
const signin = readFileSync('app/sign-in/vendor/page.tsx', 'utf8')
const signinClient = readFileSync('app/sign-in/vendor/VendorSignIn.tsx', 'utf8')
assert(has(signin, "getVideoSlot('vendorPitch')") && has(signinClient, '<PitchVideo source={video}'), '/sign-in/vendor shows the vendor pitch under the pitch points')
const become = readFileSync('app/become-vendor/page.tsx', 'utf8')
const becomeClient = readFileSync('app/become-vendor/VendorOnboarding.tsx', 'utf8')
assert(has(become, "getVideoSlot('vendorPitch')") && has(becomeClient, "{step === 1 && <PitchVideo source={video}"), '/become-vendor shows the vendor pitch at the top of step 1')
const partners = readFileSync('app/partners/PartnerVideoSlot.tsx', 'utf8')
assert(has(partners, "getVideoSlot('partnerPitch')") && has(partners, '<PitchVideo'), '/partners shows the partner pitch')
const orgSlot = readFileSync('app/organizers/OrganizerVideoSlot.tsx', 'utf8')
const orgPage = readFileSync('app/organizers/page.tsx', 'utf8')
assert(has(orgSlot, "getVideoSlot('organizerPitch')") && has(orgSlot, '<PitchVideo'), '/organizers shows the organizer pitch')
assert(orgPage.indexOf('{P.secondaryButton.label}') > 0 && orgPage.indexOf('<OrganizerVideoSlot />') > orgPage.indexOf('{P.secondaryButton.label}')
  && orgPage.indexOf('<OrganizerVideoSlot />') < orgPage.indexOf('P.canDo.heading'), '/organizers places it under the intro and buttons, above "What you can do"')
assert(has(vids, "organizerPitch: ['video.organizerPitch.url', 'video.organizerPitch.posterUrl']"), 'lib/videos reads the organizer keys')

console.log('[2b] the Content-Security-Policy lets videos and posters load')
const cfg = readFileSync('next.config.mjs', 'utf8')
assert(/"media-src 'self' https:"/.test(cfg), "media-src allows https (without it default-src 'self' blocks every video)")
assert(/"img-src [^"]* https:"/.test(cfg), 'img-src allows https posters')

console.log('[3] never Supabase storage for video')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : /\.tsx?$/.test(n) && out.push(q) }
  return out
}
const videoFiles = ['app/_components/PitchVideo.tsx', 'lib/videos.ts', 'app/partners/PartnerVideoSlot.tsx', 'app/organizers/OrganizerVideoSlot.tsx', 'app/sign-in/vendor/page.tsx', 'app/sign-in/vendor/VendorSignIn.tsx', 'app/become-vendor/page.tsx', 'app/become-vendor/VendorOnboarding.tsx']
assert(walk('app').length > 50, 'scanned the app tree')
assert(videoFiles.every(f => !/supabase/i.test(readFileSync(f, 'utf8'))), 'no video file mentions Supabase')

console.log(`\n${fail === 0 ? '✅' : '❌'} video slot guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
