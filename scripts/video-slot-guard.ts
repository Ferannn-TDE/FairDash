/**
 * VIDEO SLOT GUARD (item 12, B1.15) — the video rules that a type check can't see.
 *
 *   [0] the source scanner finds a planted string and misses an absent one (controls)
 *   [1] PitchVideo renders nothing without a source or after a load error, fetches nothing
 *       before it is near the viewport (preload="none", src only when near), plays inline,
 *       sets muted on the element, and never autoplays for reduced-motion visitors
 *   [2] the placements: /sign-in/vendor and /become-vendor read vendorPitch, /partners reads partnerPitch,
 *       /organizer/login reads organizerPitch (so does the parked /organizers page code), all
 *       through lib/videos (cached under the tag the settings API revalidates)
 *   [1b] the phone cut (BATCH-1 §21 Q6): lib/video-pick chooses the phone file and poster under
 *        640px only when a phone cut is saved; PitchVideo measures the screen once, before any src
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
assert(has(pv, 'preload="none"') && has(pv, 'src={near && picked ? picked.src : undefined}'), 'no src (no bytes) until near the viewport and the screen is measured')
assert(has(pv, 'new IntersectionObserver('), 'nearness comes from an IntersectionObserver')
assert(has(pv, 'playsInline'), 'plays inline on iPhone')
assert(has(pv, 'el.muted = auto'), 'muted is set on the element (React does not write the attribute)')
assert(has(pv, "const auto = autoPlay && !reducedMotion") && has(pv, "useState(true) // assume reduced"), 'reduced motion means no autoplay, and it is assumed until known')
assert(has(pv, 'controls'), 'controls are always shown (unmute, pause)')

console.log('[1b] phone cut')
{
  const { pickVideo, PHONE_MEDIA_QUERY } = await import('../lib/video-pick')
  const both = { url: 'https://x.test/wide.mp4', posterUrl: 'https://x.test/wide.jpg', phoneUrl: 'https://x.test/phone.mp4', phonePosterUrl: 'https://x.test/phone.jpg' }
  const wideOnly = { url: 'https://x.test/wide.mp4', posterUrl: 'https://x.test/wide.jpg', phoneUrl: null, phonePosterUrl: null }
  // Positive control on the probe: a phone with a phone cut DOES get a different file than desktop.
  assert(pickVideo(both, true).src !== pickVideo(both, false).src, '[0] control: the picker can tell phone from desktop')
  assert(JSON.stringify(pickVideo(both, true)) === JSON.stringify({ src: both.phoneUrl, poster: both.phonePosterUrl, phoneCut: true }), 'phone + phone cut → the phone file and phone poster')
  assert(JSON.stringify(pickVideo(both, false)) === JSON.stringify({ src: both.url, poster: both.posterUrl, phoneCut: false }), 'desktop → the main file and poster, even when a phone cut exists')
  assert(JSON.stringify(pickVideo(wideOnly, true)) === JSON.stringify({ src: wideOnly.url, poster: wideOnly.posterUrl, phoneCut: false }), 'phone without a phone cut → the main file (fallback)')
  assert(pickVideo({ ...both, phonePosterUrl: null }, true).poster === both.posterUrl, 'phone cut without a phone poster → the main poster')
  assert(pickVideo({ url: both.url, posterUrl: null }, true).src === both.url, 'a slot with no phone fields at all (partner) plays the main file')
  assert(PHONE_MEDIA_QUERY === '(max-width: 639px)', 'phones = narrower than 640px')
  const repicks = (src: string) => /setIsPhone\([^)]*\)[\s\S]{0,40}addEventListener|addEventListener\([^)]*setIsPhone/.test(src)
  assert(repicks("const on = () => setIsPhone(mq.matches); mq.addEventListener('change', on)"), '[0] control: the re-pick scanner finds a planted resize listener')
  assert(has(pv, 'window.matchMedia(PHONE_MEDIA_QUERY).matches') && !repicks(pv),
    'PitchVideo measures the screen once (no re-pick on resize, so one download)')
  assert(has(pv, 'useState<boolean | null>(null)') && has(pv, 'isPhone === null ? null : pickVideo(source, allowPhoneCut && isPhone)'), 'nothing is picked (no src, no poster) until the screen is measured')
  assert(has(pv, 'allowPhoneCut = true') && has(pv, 'allowPhoneCut && isPhone'), 'allowPhoneCut={false} makes a placement play the wide cut on every screen (default: phone cut allowed)')
  assert(has(pv, "picked?.phoneCut ? 'aspect-[9/16] max-h-[80vh]' : 'aspect-video'") && has(pv, 'object-cover'),
    'the phone cut fills the width, at most 80% of the screen tall, cropped to fit')
}

console.log('[2] placements')
const vids = readFileSync('lib/videos.ts', 'utf8')
assert(has(vids, "tags: [VIDEOS_CACHE_TAG]"), 'lib/videos caches under the videos tag')
const route = readFileSync('app/api/admin/settings/route.ts', 'utf8')
assert(has(route, /startsWith\('video\.'\)[\s\S]{0,80}revalidateTag\(VIDEOS_CACHE_TAG/), 'saving a video.* key revalidates that tag')
// Updated 2026-11-17 (sign-in redesign): the vendor and organizer sign-in pages hand their slot to the
// shared shell, which renders it in the video stage (after the card on phones).
const signin = readFileSync('app/sign-in/vendor/page.tsx', 'utf8')
const orgLogin = readFileSync('app/organizer/login/page.tsx', 'utf8')
const shell = readFileSync('app/_components/RoleAuthCard.tsx', 'utf8')
assert(has(shell, '<PitchVideo source={video}'), 'the sign-in shell renders the video it is given')
assert(has(signin, "getVideoSlot('vendorPitch')") && has(signin, 'video={video}'), '/sign-in/vendor shows the vendor pitch in the video stage')
assert(has(orgLogin, "getVideoSlot('organizerPitch')") && has(orgLogin, 'video={video}'), '/organizer/login reuses the organizer slot (Q7)')
const become = readFileSync('app/become-vendor/page.tsx', 'utf8')
const becomeClient = readFileSync('app/become-vendor/VendorOnboarding.tsx', 'utf8')
assert(has(become, "getVideoSlot('vendorPitch')") && has(becomeClient, "{step === 1 && <PitchVideo source={video}"), '/become-vendor shows the vendor pitch at the top of step 1')
// Positive control on the opt-out scanner, then the rule: /become-vendor never plays the phone cut.
const optsOut = (src: string) => /<PitchVideo\b[^>]*\ballowPhoneCut=\{false\}/.test(src)
assert(optsOut('<PitchVideo source={v} allowPhoneCut={false} />') && !optsOut('<PitchVideo source={v} />'), '[0] control: the opt-out scanner finds the prop and misses it when absent')
assert(optsOut(becomeClient), '/become-vendor opts out of the phone cut (wide cut above the application form on every screen)')
assert(!optsOut(readFileSync('app/organizers/OrganizerVideoSlot.tsx', 'utf8')), '/organizers keeps the phone cut')
const partners = readFileSync('app/partners/PartnerVideoSlot.tsx', 'utf8')
assert(has(partners, "getVideoSlot('partnerPitch')") && has(partners, '<PitchVideo'), '/partners shows the partner pitch')
const orgSlot = readFileSync('app/organizers/OrganizerVideoSlot.tsx', 'utf8')
const orgPage = readFileSync('app/organizers/page.tsx', 'utf8')
assert(has(orgSlot, "getVideoSlot('organizerPitch')") && has(orgSlot, '<PitchVideo'), '/organizers shows the organizer pitch')
assert(orgPage.indexOf('{P.secondaryButton.label}') > 0 && orgPage.indexOf('<OrganizerVideoSlot />') > orgPage.indexOf('{P.secondaryButton.label}')
  && orgPage.indexOf('<OrganizerVideoSlot />') < orgPage.indexOf('P.canDo.heading'), '/organizers places it under the intro and buttons, above "What you can do"')
assert(has(vids, "organizerPitch: { url: 'video.organizerPitch.url', poster: 'video.organizerPitch.posterUrl',")
  && has(vids, "phoneUrl: 'video.organizerPitch.phoneUrl', phonePoster: 'video.organizerPitch.phonePosterUrl' }"), 'lib/videos reads the organizer keys, phone cut included')
assert(has(vids, "phoneUrl: 'video.vendorPitch.phoneUrl', phonePoster: 'video.vendorPitch.phonePosterUrl' }"), 'lib/videos reads the vendor phone keys')
assert(has(vids, "partnerPitch: { url: 'video.partnerPitch.url', poster: 'video.partnerPitch.posterUrl' },"), 'the partner slot has no phone keys (no partner video yet)')
assert(has(vids, 'return url ? {'), 'no main video = no slot, even with a phone cut saved')

console.log('[2b] the Content-Security-Policy lets videos and posters load')
const cfg = readFileSync('next.config.mjs', 'utf8')
// Updated 2026-11-21 (merge decisions D4/D7): both name the one Vercel Blob host exactly; no bare https:.
const BLOB_HOST = 'https://8nu6qii9bn5wxpzs.public.blob.vercel-storage.com'
const mediaSrc = cfg.match(/"media-src ([^"]*)"/)?.[1] ?? ''
const imgSrc = cfg.match(/"img-src ([^"]*)"/)?.[1] ?? ''
assert(mediaSrc === `'self' ${BLOB_HOST}`, `media-src is exactly 'self' + the blob host (without it default-src 'self' blocks every video) (got "${mediaSrc}")`)
assert(imgSrc.split(/\s+/).includes(BLOB_HOST), 'img-src allows posters from the blob host')
assert(!/(^|\s)https:(\s|$)/.test(mediaSrc) && !/(^|\s)https:(\s|$)/.test(imgSrc), 'neither img-src nor media-src allows every https site (no bare https:)')
assert(/(^|\s)https:(\s|$)/.test("'self' https:") && !/(^|\s)https:(\s|$)/.test(`'self' ${BLOB_HOST}`), 'control: the bare-https check catches "https:" and passes a named host')

console.log('[3] never Supabase storage for video')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? walk(q, out) : /\.tsx?$/.test(n) && out.push(q) }
  return out
}
const videoFiles = ['app/_components/PitchVideo.tsx', 'lib/videos.ts', 'lib/video-pick.ts', 'app/partners/PartnerVideoSlot.tsx', 'app/organizers/OrganizerVideoSlot.tsx', 'app/sign-in/vendor/page.tsx', 'app/organizer/login/page.tsx', 'app/_components/RoleAuthCard.tsx', 'app/become-vendor/page.tsx', 'app/become-vendor/VendorOnboarding.tsx']
assert(walk('app').length > 50, 'scanned the app tree')
assert(videoFiles.every(f => !/supabase/i.test(readFileSync(f, 'utf8'))), 'no video file mentions Supabase')

console.log(`\n${fail === 0 ? '✅' : '❌'} video slot guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
