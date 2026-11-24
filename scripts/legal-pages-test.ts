/**
 * LEGAL PAGES (item 11, Jordan 2026-11-23) — no database.
 *
 * The three texts in Legal/ (audit folder) are final for this release and are published word for
 * word. This test proves it:
 *
 *   [0] controls: the markdown reader on a planted sample (every block kind, bold), its refusals
 *       (unclosed **, a bad table), the word-for-word comparison catches one changed word, the
 *       old-terms scanner catches the old agreement
 *   [1] Vendor Agreement: its text is byte for byte the source file (SHA-256 locked); rendered, the
 *       page text equals the source words exactly, in order; title "Vendor Agreement" and
 *       "Effective November 23, 2026" shown; none of the old terms (10%, "match or be lower",
 *       $1,000,000, star ratings, the 2026-01-01 headings)
 *   [2] Privacy Policy (/privacy): byte for byte (SHA-256 locked); word for word on the page; title
 *       and effective date; 10 section headings; the "Information we collect" table, 5 rows; the
 *       page renders exactly this text
 *   [3] Website Terms of Service (/terms): the same checks; 14 section headings
 *   [4] /privacy and /terms are public: no protected pattern in proxy.ts catches them (positive
 *       control: the vendor portal still is protected, and the old /vendor(.*) pattern would catch
 *       /vendor-agreement)
 *   [5] Clerk's sign-in/sign-up screens: the "Terms" link goes to /terms and the "Privacy" link to
 *       /privacy (lib/clerk-appearance.ts; were both /refund-policy), equal to the lib/legal/ paths,
 *       each page exists (positive control: the old values fail)
 *
 * Run:  npx tsx scripts/legal-pages-test.ts
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LegalDocument from '../app/_components/LegalDocument'
import { parseLegalMarkdown, LegalMarkdownError } from '../lib/legal/markdown'
import { VENDOR_AGREEMENT_TEXT, VENDOR_AGREEMENT_PATH } from '../lib/legal/vendor-agreement'
import { VENDOR_AGREEMENT_2026_01_01_TEXT } from '../lib/legal/vendor-agreement-2026-01-01'
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_PATH } from '../lib/legal/privacy-policy'
import { WEBSITE_TERMS_TEXT, WEBSITE_TERMS_PATH } from '../lib/legal/website-terms'
import { clerkAppearance } from '../lib/clerk-appearance'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase()

// SHA-256 of each source file in Legal/ (audit folder), taken 2026-11-23. Any changed character
// in the published text changes the hash.
const SOURCE_SHA256 = {
  vendorAgreement: 'AADBC2D33BC18FFB1A6EE98F0782352687C9748411F938A6A46670FE8D2B30AE',
  privacyPolicy: '9B0F365CA1821FCEE1D2026D8D559A5FE73A6E999285C4287DCBF46C1ADDB62A',
  websiteTerms: '4136A654D16FC4D8F565AA36873939F526CB714D3AE98B1231787EBA0735B592',
} as const

const render = (text: string) => renderToStaticMarkup(createElement(LegalDocument, { text }))

/** The visible words of rendered HTML, one space between them. */
function pageWords(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
}

/** The words a reader should see for a markdown source: the markers removed, nothing else. */
function sourceWords(md: string): string {
  return md.split('\n')
    .filter(l => !/^\|(\s*:?-{3,}:?\s*\|)+$/.test(l))
    .map(l => l.replace(/^#{1,3} /, '').replace(/^- /, '').replace(/^\|(.*)\|$/, (_, inner: string) => inner.split('|').join(' ')))
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').trim()
}

const OLD_TERMS = /\b10%|service fee on top|match or be lower|\$1,000,000|\bstars?\b|Last Updated|FAIRSYNQ VENDOR AGREEMENT|CUSTOMER REVIEWS & RATINGS|binding arbitration/i

function refuses(md: string): boolean {
  try { parseLegalMarkdown(md); return false } catch (e) { return e instanceof LegalMarkdownError }
}

console.log('[0] controls')
const planted = '# Title\n\nEffective May 1, 2026\n\nA **bold** word and\na wrapped line.\n\n### 1. Part\n\n- one\n- **two**\n\n| A | B |\n|---|---|\n| x | y z |\n| p | q |\n'
assert(same(parseLegalMarkdown(planted), [
  { kind: 'title', inline: [{ text: 'Title', bold: false }] },
  { kind: 'paragraph', inline: [{ text: 'Effective May 1, 2026', bold: false }] },
  { kind: 'paragraph', inline: [{ text: 'A ', bold: false }, { text: 'bold', bold: true }, { text: ' word and a wrapped line.', bold: false }] },
  { kind: 'heading', inline: [{ text: '1. Part', bold: false }] },
  { kind: 'list', items: [[{ text: 'one', bold: false }], [{ text: 'two', bold: true }]] },
  { kind: 'table', head: [[{ text: 'A', bold: false }], [{ text: 'B', bold: false }]], rows: [
    [[{ text: 'x', bold: false }], [{ text: 'y z', bold: false }]],
    [[{ text: 'p', bold: false }], [{ text: 'q', bold: false }]],
  ] },
]), '[0] positive control: the reader turns a planted sample into title, paragraphs, bold, heading, list and table')
const plantedHtml = render(planted)
assert(/<h1[^>]*>Title<\/h1>/.test(plantedHtml) && /<h2[^>]*>1\. Part<\/h2>/.test(plantedHtml) && /<strong[^>]*>bold<\/strong>/.test(plantedHtml)
  && (plantedHtml.match(/<li>/g) ?? []).length === 2 && (plantedHtml.match(/<tr>/g) ?? []).length === 3 && (plantedHtml.match(/<td /g) ?? []).length === 4,
  '[0] positive control: rendered as h1, h2, strong, two list items, a table of 1 header + 2 rows (4 cells)')
assert(pageWords(plantedHtml) === sourceWords(planted), '[0] positive control: the planted sample renders word for word')
assert(pageWords(render(planted.replace('wrapped', 'rapped'))) !== sourceWords(planted), '[0] positive control: one changed word is caught')
assert(refuses('A **bold word') && refuses('| A | B |\n| x | y |') && refuses('| A | B |\n|---|---|\n| x |') && !refuses('plain text'),
  '[0] the reader refuses an unclosed **, a table with no separator row and a short table row; plain text is fine')
assert(OLD_TERMS.test(VENDOR_AGREEMENT_2026_01_01_TEXT) && !OLD_TERMS.test('Free to join. Stripe card processing.'),
  '[0] positive control: the old-terms scanner flags the 2026-01-01 agreement and passes clean text')
assert(sha256(VENDOR_AGREEMENT_TEXT + ' ') !== SOURCE_SHA256.vendorAgreement, '[0] positive control: one added character changes the hash')

console.log('[1] Vendor Agreement (/vendor-agreement)')
assert(sha256(VENDOR_AGREEMENT_TEXT) === SOURCE_SHA256.vendorAgreement, 'the text is byte for byte Legal/vendor-agreement.md (SHA-256 locked)')
const vaHtml = render(VENDOR_AGREEMENT_TEXT)
assert(pageWords(vaHtml) === sourceWords(VENDOR_AGREEMENT_TEXT), 'rendered, the page shows every word of the source, in order, and nothing else')
assert(/<h1[^>]*>Vendor Agreement<\/h1>/.test(vaHtml), 'title "Vendor Agreement" shown as the page heading')
assert(/<p[^>]*>Effective November 23, 2026<\/p>/.test(vaHtml), '"Effective November 23, 2026" shown, exactly as written')
assert((vaHtml.match(/<h2[^>]*>/g) ?? []).length === 15, 'all 15 numbered sections are headings')
assert(/<strong[^>]*>You are the seller of everything you list\.<\/strong>/.test(vaHtml), 'bold text stays bold')
assert(!OLD_TERMS.test(pageWords(vaHtml)), 'none of the old terms: no 10%, "match or be lower", $1,000,000, star ratings or the 2026-01-01 headings')
assert(VENDOR_AGREEMENT_PATH === '/vendor-agreement' && existsSync('app/vendor-agreement/page.tsx'), '/vendor-agreement has its page')

// The same checks for each new document and its page.
function checkDocument(o: { label: string; text: string; hash: string; title: string; path: string; pathConst: string; textConst: string; page: string; headings: number }) {
  assert(sha256(o.text) === o.hash, `the text is byte for byte its source file (SHA-256 locked)`)
  const html = render(o.text)
  assert(pageWords(html) === sourceWords(o.text), 'rendered, the page shows every word of the source, in order, and nothing else')
  assert(new RegExp(`<h1[^>]*>${o.title}</h1>`).test(html), `title "${o.title}" shown as the page heading`)
  assert(/<p[^>]*>Effective November 23, 2026<\/p>/.test(html), '"Effective November 23, 2026" shown, exactly as written')
  assert((html.match(/<h2[^>]*>/g) ?? []).length === o.headings, `all ${o.headings} section headings are headings`)
  const pageSrc = existsSync(o.page) ? readFileSync(o.page, 'utf8') : ''
  assert(pageSrc !== '' && new RegExp(`<LegalDocument text=\\{${o.textConst}\\} />`).test(pageSrc) && pageSrc.includes('<MarketplaceNavbar />'),
    `${o.path} has its page (${o.page}), with the navbar, rendering ${o.textConst}`)
  assert(pageSrc.includes(`canonical: ${o.pathConst}`), `${o.path} declares itself as its canonical address`)
  return html
}

console.log('[2] Privacy Policy (/privacy)')
assert(PRIVACY_POLICY_PATH === '/privacy', 'the path is /privacy')
const ppHtml = checkDocument({ label: 'Privacy Policy', text: PRIVACY_POLICY_TEXT, hash: SOURCE_SHA256.privacyPolicy, title: 'Privacy Policy',
  path: '/privacy', pathConst: 'PRIVACY_POLICY_PATH', textConst: 'PRIVACY_POLICY_TEXT', page: 'app/privacy/page.tsx', headings: 10 })
const ppTable = ppHtml.match(/<table[\s\S]*?<\/table>/g) ?? []
assert(ppTable.length === 1 && (ppTable[0].match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length === 5
  && /<th[^>]*>Who<\/th>/.test(ppTable[0]) && /<th[^>]*>What we collect<\/th>/.test(ppTable[0]),
  'one table, headed "Who" / "What we collect", with 5 rows')
assert(/<strong[^>]*>We do not sell your personal information\.<\/strong>/.test(ppHtml), 'bold text stays bold')

console.log('[3] Website Terms of Service (/terms)')
assert(WEBSITE_TERMS_PATH === '/terms', 'the path is /terms')
const wtHtml = checkDocument({ label: 'Website Terms', text: WEBSITE_TERMS_TEXT, hash: SOURCE_SHA256.websiteTerms, title: 'Website Terms of Service',
  path: '/terms', pathConst: 'WEBSITE_TERMS_PATH', textConst: 'WEBSITE_TERMS_TEXT', page: 'app/terms/page.tsx', headings: 14 })
assert((wtHtml.match(/<li>/g) ?? []).length === 7, 'the "You agree not to" list has all 7 items')
assert(wtHtml.includes('support@fairsynq.com · FairSynq LLC'), 'the contact line keeps its "·" exactly')

console.log('[4] /privacy and /terms are public')
// Same reading of proxy.ts as scripts/vendor-agreement-test.ts [5].
const proxy = readFileSync('proxy.ts', 'utf8')
const protectedStart = proxy.indexOf('isProtectedRoute = createRouteMatcher([')
const protectedBlock = proxy.slice(protectedStart, proxy.indexOf('])', protectedStart))
const patterns = [...protectedBlock.matchAll(/^\s*'([^']+)',/gm)].map(m => m[1])
const toRe = (p: string) => new RegExp('^' + p.replace(/\(\.\*\)/g, '.*') + '$')
const isProtected = (path: string) => patterns.some(p => toRe(p).test(path))
assert(protectedStart >= 0 && patterns.length > 0 && isProtected('/vendor/springfield/dashboard') && isProtected('/vendor'),
  '[0] control: the protected list is read, and the vendor portal is still protected')
assert(toRe('/vendor(.*)').test('/vendor-agreement'), '[0] positive control: a too-wide pattern like /vendor(.*) WOULD catch a public page')
for (const p of [PRIVACY_POLICY_PATH, WEBSITE_TERMS_PATH, VENDOR_AGREEMENT_PATH]) {
  assert(!isProtected(p), `${p} is public (no protected pattern catches it)`)
}

console.log('[5] Clerk "Terms" and "Privacy" links')
const clerkLinksOk = (layout: { termsPageUrl?: string; privacyPageUrl?: string }) =>
  layout.termsPageUrl === WEBSITE_TERMS_PATH && layout.privacyPageUrl === PRIVACY_POLICY_PATH
assert(!clerkLinksOk({ termsPageUrl: '/refund-policy', privacyPageUrl: '/refund-policy' }) && !clerkLinksOk({ termsPageUrl: '/privacy', privacyPageUrl: '/terms' }),
  '[0] positive control: the old /refund-policy values, or the two swapped, fail the check')
const layout = clerkAppearance.layout as { termsPageUrl?: string; privacyPageUrl?: string }
assert(clerkLinksOk(layout), `Clerk's terms link is ${layout.termsPageUrl} and its privacy link is ${layout.privacyPageUrl} (the lib/legal/ paths /terms and /privacy)`)
assert(layout.termsPageUrl !== '/refund-policy' && layout.privacyPageUrl !== '/refund-policy', 'neither goes to /refund-policy any more')
assert(existsSync('app/terms/page.tsx') && existsSync('app/privacy/page.tsx'), 'both pages exist')

console.log(`\n${fail === 0 ? '✅' : '❌'} legal pages: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
