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
 *
 * Run:  npx tsx scripts/legal-pages-test.ts
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LegalDocument from '../app/_components/LegalDocument'
import { parseLegalMarkdown, LegalMarkdownError } from '../lib/legal/markdown'
import { VENDOR_AGREEMENT_TEXT, VENDOR_AGREEMENT_PATH } from '../lib/legal/vendor-agreement'
import { VENDOR_AGREEMENT_2026_01_01_TEXT } from '../lib/legal/vendor-agreement-2026-01-01'

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

console.log(`\n${fail === 0 ? '✅' : '❌'} legal pages: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
