/**
 * EMAIL LOOK v1 (email-look-v1, Nov 25) — every email the app sends, rendered for real by
 * lib/email/templates.ts through the one layout in lib/email/layout.ts. No database, no network.
 *
 *   [1] The layout itself: 600px, #F2F2F4 page, black header with "Fair"/"Synq" text, 4px pink line,
 *       one <style> block, hidden preheader, footers, pink / outline button, admin tag + table
 *   [2] Escaping in the layout: every value, the button link, an unsafe link gets no button
 *   [3] Every template: subject, plain text (word for word + footer) AND html (multipart), one
 *       layout per email, the approved heading / preheader / button, decline and admin variants,
 *       no <img>, no image URLs, no <script>; every template name has a sample
 *   [4] Hostile names and reasons in every template: only escaped forms reach the html
 *   [5] Approved wording changes: C1 reason full stop, C2 no support sentence in declined html,
 *       C3 approved subjects, C5 override subject, C6 "(no name given)", C7 "an organizer";
 *       the admin "Submitted" time in Central time
 *   [6] Copy rules: no FairDash / Fair Dash, no fee percentages, no competitor names, no delivery words
 *   [7] Source rules: no DRAFT notes left in the templates, no <img in the layout
 *   [8] Snapshots: each email's html equals scripts/email-snapshots/<id>.html
 *       (UPDATE_EMAIL_SNAPSHOTS=1 rewrites them; review the previews before committing new ones)
 *
 * Run:  npx tsx scripts/email-layout-test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMAIL_SAMPLES, HOSTILE, SAMPLE_CREATED_AT, hostileSamples } from './email-samples'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
/** One section; an exception (e.g. a missing export in old code) is a failure, not a crash. */
async function section(title: string, body: () => Promise<void>) {
  console.log(`\n${title}`)
  try { await body() } catch (e) { fail++; console.log(`  ❌ section threw: ${e instanceof Error ? e.message : String(e)}`) }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SNAP_DIR = join(HERE, 'email-snapshots')
const UPDATE = process.env.UPDATE_EMAIL_SNAPSHOTS === '1'

type Rendered = { subject: string; text: string; html?: string }
type RenderFn = (template: string, payload: unknown, context?: { createdAt?: Date }) => Rendered

const count = (hay: string, needle: string) => hay.split(needle).length - 1
const IMAGE_PATTERNS: [RegExp, string][] = [
  [/<img\b/i, '<img'], [/url\s*\(/i, 'CSS url('], [/\bbackground\s*=/i, 'background= attribute'],
  [/<svg\b/i, '<svg'], [/data:image/i, 'data:image'], [/<script\b/i, '<script'],
]

async function main() {
  const L = await import('../lib/email/layout')
  const T = await import('../lib/email/templates') as unknown as { renderEmail: RenderFn; EMAIL_TEMPLATES?: readonly string[] }
  const esc = L.escapeHtml

  await section('[1] The layout', async () => {
    const html = L.renderEmailLayout({
      variant: 'standard', title: 'Subject here', preheader: 'Preheader words', heading: 'Heading words',
      paragraphs: ['First paragraph.'], button: { label: 'Press me', url: 'https://www.fairsynq.com/x' },
    })
    assert(html.startsWith('<!DOCTYPE html'), 'starts with a doctype')
    assert(html.includes('width="600"') && html.includes('max-width:600px'), '600px wide')
    assert(html.includes('background-color:#F2F2F4'), 'light gray page #F2F2F4')
    assert(html.includes('bgcolor="#0A0A0A"'), 'black #0A0A0A header')
    assert(html.includes('<span style="color:#FFFFFF;">Fair</span><span style="color:#FF0077;">Synq</span>'), 'header text: "Fair" white, "Synq" pink')
    assert(/font-size:24px;line-height:28px;font-weight:bold;/.test(html), 'header 24px bold')
    assert(html.includes('height="4" bgcolor="#FF0077"'), '4px #FF0077 line under the header')
    assert(html.includes('font-size:24px;line-height:1.3;font-weight:bold;color:#111111;">Heading words</h1>'), 'heading 24px bold #111111')
    assert(html.includes('font-size:16px;line-height:1.55;color:#333333;">First paragraph.</p>'), 'text 16px #333333, line-height 1.55')
    assert(count(html, '<style') === 1, 'exactly one <style> block')
    assert(html.includes('max-width:620px') && html.includes('.fs-btn-table{width:100% !important;}'), 'phones: full-width button')
    assert(html.includes('prefers-color-scheme: dark') && html.includes('name="color-scheme" content="light dark"'), 'dark mode colors declared')
    assert(/<div style="display:none;[^"]*mso-hide:all;[^"]*">Preheader words/.test(html), 'preheader is hidden and first in the body')
    assert(html.includes('bgcolor="#FF0077" class="fs-btn-cell"') && html.includes('font-size:19px') && html.includes('border-radius:8px'), 'pink button, 19px, 8px corners')
    assert(html.includes('color:#FFFFFF;text-decoration:none;border-radius:8px;">Press me</a>'), 'button text white')
    assert(html.includes(L.BUTTON_FALLBACK) && count(html, 'href="https://www.fairsynq.com/x"') === 2, '"Button not working? Copy this link:" plus the link')
    assert(html.includes(esc(L.FOOTER_QUESTIONS)) && html.includes(esc(L.FOOTER_TAGLINE)) && !html.includes(esc(L.FOOTER_ADMIN)), 'standard footer')
    assert(L.FOOTER_QUESTIONS === 'Questions? Just reply to this email, or write to support@fairsynq.com.', 'footer words exactly as approved')
    assert(L.FOOTER_TAGLINE === 'FairSynq · Order ahead and skip the line at fairs and festivals.', 'tagline exactly as approved')
    assert(L.FOOTER_ADMIN === 'FairSynq admin alert · sent to the alerts address in Platform settings.', 'admin footer exactly as approved')
    assert(!html.includes('>ADMIN<'), 'no ADMIN tag on a standard email')
    for (const [re, name] of IMAGE_PATTERNS) assert(!re.test(html), `no ${name}`)

    const decline = L.renderEmailLayout({ variant: 'decline', title: 't', preheader: 'p', heading: 'h', paragraphs: ['x'], button: { label: 'Email support', url: 'mailto:support@fairsynq.com' } })
    assert(decline.includes('class="fs-btn-cell fs-btn-outline"') && decline.includes('border:2px solid #0A0A0A') && !decline.includes('bgcolor="#FF0077" class="fs-btn-cell"'), 'decline: black outline button, not pink')
    assert(decline.includes('>support@fairsynq.com</a>'), 'mailto link shown as the plain address')

    const adm = L.renderEmailLayout({ variant: 'admin', title: 't', preheader: 'p', heading: 'h', paragraphs: ['x'], details: [['Business', 'Taco Stand'], ['Phone', null]] })
    assert(adm.includes('>ADMIN</span>'), 'admin: ADMIN tag in the header')
    assert(adm.includes('>Business</td>') && adm.includes('>Taco Stand</td>') && adm.includes('&mdash;'), 'admin: two-column details, empty value shows —')
    assert(adm.includes(esc(L.FOOTER_ADMIN)) && !adm.includes(esc(L.FOOTER_TAGLINE)), 'admin footer replaces the standard one')
    assert(L.emailTextWithFooter('Body', 'standard') === `Body\n\n${L.FOOTER_QUESTIONS}\n${L.FOOTER_TAGLINE}`, 'plain-text footer, standard')
    assert(L.emailTextWithFooter('Body', 'admin') === `Body\n\n${L.FOOTER_ADMIN}`, 'plain-text footer, admin')
  })

  await section('[2] Escaping in the layout', async () => {
    assert(esc(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;', `escapeHtml covers & < > " '`)
    const html = L.renderEmailLayout({
      variant: 'admin', title: HOSTILE, preheader: HOSTILE, heading: HOSTILE, paragraphs: [HOSTILE], lines: [HOSTILE],
      details: [[HOSTILE, HOSTILE]], button: { label: HOSTILE, url: 'https://www.fairsynq.com/ok' },
    })
    assert(!html.includes('<script'), 'no raw <script> anywhere')
    assert(!html.includes(HOSTILE), 'the raw hostile text never appears')
    assert(count(html, esc(HOSTILE)) >= 7, 'escaped form appears in title, preheader, heading, paragraph, line, details, button')
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/relative/path', 'https://x.test/"onmouseover="alert(1)']) {
      const h = L.renderEmailLayout({ variant: 'standard', title: 't', preheader: 'p', heading: 'h', paragraphs: ['x'], button: { label: 'Go', url: bad } })
      assert(!h.includes('>Go</a>') && !h.includes(L.BUTTON_FALLBACK), `unsafe link gets no button: ${bad}`)
    }
    assert(L.isSafeEmailLink('http://localhost:3000/x') && !L.isSafeEmailLink('http://example.com'), 'http only on localhost')
  })

  const rendered = new Map<string, Rendered>()

  await section('[3] Every template: multipart, one layout, approved heading / preheader / button', async () => {
    const names = T.EMAIL_TEMPLATES
    assert(Array.isArray(names) && names.length === 7, 'EMAIL_TEMPLATES lists the 7 templates')
    for (const name of names ?? []) assert(EMAIL_SAMPLES.some(s => s.template === name), `has a sample: ${name}`)
    let threw = false
    try { T.renderEmail('no_such_template', {}) } catch { threw = true }
    assert(threw, 'an unknown template throws')

    for (const s of EMAIL_SAMPLES) {
      const r = T.renderEmail(s.template, s.payload, { createdAt: SAMPLE_CREATED_AT })
      rendered.set(s.id, r)
      const html = r.html ?? ''
      const e = s.expect
      const tag = `[${s.id}]`
      assert(r.subject === e.subject, `${tag} subject: ${JSON.stringify(r.subject)}`)
      assert(r.text === L.emailTextWithFooter(e.text, s.variant), `${tag} plain text word for word, then the footer`)
      assert(html.length > 0, `${tag} has an html part`)
      assert(count(html, L.EMAIL_LAYOUT_MARKER) === 1, `${tag} built by the one shared layout`)
      assert(html.includes(`>${esc(e.heading)}</h1>`), `${tag} heading "${e.heading}"`)
      assert(html.includes(`mso-hide:all;color:#F2F2F4;">${esc(e.preheader)}`), `${tag} preheader "${e.preheader}"`)
      assert(html.includes(`<title>${esc(e.subject)}</title>`), `${tag} title is the subject`)
      if (e.button) {
        assert(html.includes(`href="${esc(e.button.url)}"`) && html.includes(`>${esc(e.button.label)}</a>`), `${tag} button "${e.button.label}" → ${e.button.url}`)
      } else {
        assert(!html.includes(L.BUTTON_FALLBACK), `${tag} no button`)
      }
      // The class name is also in the dark-mode style block, so look for it on the button cell.
      if (s.variant === 'decline') assert(html.includes('class="fs-btn-cell fs-btn-outline"') && !html.includes('bgcolor="#FF0077" class="fs-btn-cell"'), `${tag} decline: outline button, not pink`)
      else assert(!html.includes('class="fs-btn-cell fs-btn-outline"'), `${tag} not a decline: no outline button`)
      if (s.variant === 'admin') {
        assert(html.includes('>ADMIN</span>'), `${tag} ADMIN tag`)
        for (const label of ['Business', 'Contact', 'Email', 'Phone', 'Submitted']) assert(html.includes(`>${label}</td>`), `${tag} details row: ${label}`)
        assert(/>Submitted<\/td><td[^>]*>[^<&]*2026[^<]*<\/td>/.test(html), `${tag} Submitted shows the date`)
      } else {
        assert(!html.includes('>ADMIN</span>'), `${tag} no ADMIN tag`)
      }
      for (const [re, name] of IMAGE_PATTERNS) assert(!re.test(html), `${tag} no ${name}`)
    }
  })

  await section('[4] Hostile names and reasons in every template', async () => {
    for (const h of hostileSamples()) {
      const r = T.renderEmail(h.template, h.payload, { createdAt: SAMPLE_CREATED_AT })
      const html = r.html ?? ''
      assert(html.length > 0 && !html.includes('<script') && !html.includes(HOSTILE), `[${h.id}] no raw hostile text in the html`)
      assert(html.includes(esc(HOSTILE)), `[${h.id}] escaped form is shown`)
    }
  })

  await section('[5] Approved wording changes C1, C2, C3, C5, C6, C7', async () => {
    const t = (id: string) => rendered.get(id)?.text ?? ''
    const h = (id: string) => rendered.get(id)?.html ?? ''
    const sub = (id: string) => rendered.get(id)?.subject ?? ''
    // C1
    assert(t('declined-vendor').includes('Reason: Missing insurance. If you have'), 'C1: a reason with no end mark gets one full stop')
    assert(t('declined-vendor-by-organizer').includes('Reason: The fair is full. If you have') && !t('declined-vendor-by-organizer').includes('..'), 'C1: a reason ending in "." gets no second one')
    assert(t('declined-organizer').includes('Reason: We could not verify the event! If you have'), 'C1: a reason ending in "!" gets no full stop')
    assert(!t('declined-partner-no-reason').includes('Reason:') && t('declined-partner-no-reason').includes('right now. If you have'), 'C1: no reason → no "Reason:" part')
    const blank = T.renderEmail('decision_rejected', { kind: 'vendor', name: 'Taco Stand', contactName: 'Ana', reason: '   ' })
    assert(!blank.text.includes('Reason:'), 'C1: a blank reason → no "Reason:" part')
    // C2
    for (const id of ['declined-vendor', 'declined-organizer', 'declined-partner-no-reason']) {
      assert(!h(id).includes('If you have questions, contact'), `C2 [${id}]: html leaves out the support sentence`)
      assert(t(id).includes('If you have questions, contact support@fairsynq.com.'), `C2 [${id}]: plain text keeps it`)
    }
    // C3
    assert(sub('approved-vendor') === 'Taco Stand is approved on FairSynq', 'C3: vendor subject')
    assert(sub('approved-partner') === 'Rotary Club is approved on FairSynq', 'C3: partner subject')
    assert(sub('approved-organizer') === 'Your FairSynq organizer account is approved', 'C3: organizer subject')
    // C5
    assert(sub('override-approved') === 'FairSynq made a decision on Taco Stand at Italian Fest', 'C5: override subject (approved)')
    assert(sub('override-rejected') === 'FairSynq made a decision on Taco Stand at Italian Fest', 'C5: override subject (rejected)')
    // C6
    assert(sub('admin-organizer-no-name') === 'New organizer application: (no name given)', 'C6: subject says (no name given)')
    assert(t('admin-organizer-no-name').startsWith('(no name given) applied to join FairSynq'), 'C6: text says (no name given)')
    assert(/>Business<\/td><td[^>]*>\(no name given\)<\/td>/.test(h('admin-organizer-no-name')), 'C6: details Business row says (no name given)')
    const named = T.renderEmail('signup_admin_alert', { kind: 'organizer', name: 'County Fair Board', contactName: null, email: 'lee@example.com', phone: null })
    assert(named.subject === 'New organizer application: County Fair Board', 'C6: a real organizer name is kept')
    const vendorSameAsEmail = T.renderEmail('signup_admin_alert', { kind: 'vendor', name: 'x@example.com', contactName: null, email: 'x@example.com', phone: null })
    assert(vendorSameAsEmail.subject === 'New vendor application: x@example.com', 'C6 applies to organizers only')
    // C7
    assert(t('admin-organizer').startsWith('County Fair Board applied to join FairSynq as an organizer.'), 'C7: text says "an organizer"')
    assert(h('admin-organizer').includes('applied to join FairSynq as an organizer.</p>'), 'C7: html says "an organizer"')
    assert(t('admin-vendor').includes('as a vendor.') && t('admin-partner').includes('as a partner organization.'), 'C7: "a vendor" and "a partner organization" unchanged')
    assert(!/\ba organizer\b/.test(`${sub('admin-organizer')} ${t('admin-organizer')} ${h('admin-organizer')}`), 'C7: "a organizer" appears nowhere')
    // Submitted time (Jordan, Nov 25): Central, "Nov 25, 2026, 12:20 PM CST"
    assert(/>Submitted<\/td><td[^>]*>Nov 25, 2026, 12:20 PM CST<\/td>/.test(h('admin-vendor')), 'Submitted: "Nov 25, 2026, 12:20 PM CST" (18:20 UTC in Central time)')
    const summer = T.renderEmail('signup_admin_alert', { kind: 'vendor', name: 'Taco Stand', contactName: null, email: null, phone: null }, { createdAt: new Date('2026-07-04T17:05:00Z') })
    assert(/>Submitted<\/td><td[^>]*>Jul 4, 2026, 12:05 PM CDT<\/td>/.test(summer.html ?? ''), 'Submitted in summer: "Jul 4, 2026, 12:05 PM CDT"')
    const noTime = T.renderEmail('signup_admin_alert', { kind: 'vendor', name: 'Taco Stand', contactName: null, email: null, phone: null })
    assert(/>Submitted<\/td><td[^>]*>&mdash;<\/td>/.test(noTime.html ?? ''), 'Submitted with no time given: —')
  })

  await section('[6] Copy rules in every email', async () => {
    const { PCT, DELIVER, COMPETITOR, TOAST } = await import('../lib/homepage-copy-rules')
    for (const [id, r] of rendered) {
      const all = `${r.subject}\n${r.text}\n${r.html ?? ''}`
      assert(!/fair\s*-?\s*dash/i.test(all), `[${id}] never says FairDash / Fair Dash`)
      assert(!PCT.test(all), `[${id}] no fee percentage`)
      assert(!COMPETITOR.test(all) && !TOAST.test(all), `[${id}] no competitor names`)
      assert(!DELIVER.test(all), `[${id}] no delivery words`)
    }
  })

  await section('[7] Source rules', async () => {
    const templates = readFileSync(join(ROOT, 'lib/email/templates.ts'), 'utf8')
    const layout = readFileSync(join(ROOT, 'lib/email/layout.ts'), 'utf8')
    assert(!/DRAFT\s*[–-]\s*not approved/i.test(templates), 'no DRAFT notes left in lib/email/templates.ts (C4)')
    assert(!/<img\b/i.test(layout), 'no <img in lib/email/layout.ts')
    assert(!/<\/?(html|body|p|div|table|tr|td|a|span|br|h1|b|strong|style)\b/i.test(templates.replace(/\/\/.*$/gm, '')),'templates write no HTML tags themselves (all HTML comes from the layout)')
  })

  await section('[8] Snapshots', async () => {
    if (UPDATE) mkdirSync(SNAP_DIR, { recursive: true })
    for (const s of EMAIL_SAMPLES) {
      const html = rendered.get(s.id)?.html ?? ''
      const file = join(SNAP_DIR, `${s.id}.html`)
      if (UPDATE && html) { writeFileSync(file, html); assert(true, `[${s.id}] snapshot written`); continue }
      if (!existsSync(file)) { assert(false, `[${s.id}] snapshot missing: scripts/email-snapshots/${s.id}.html`); continue }
      assert(readFileSync(file, 'utf8') === html, `[${s.id}] html matches its snapshot`)
    }
  })

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
