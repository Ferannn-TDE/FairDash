// The small part of markdown the legal documents use (item 11, legal pages): a "# " title, "## " or
// "### " headings, paragraphs, **bold**, "- " bullet lists and pipe tables. Nothing else.
//
// Anything it does not understand (an unclosed **, a table row with the wrong number of cells, a
// table with no separator row) throws instead of being shown wrongly, so a legal text can never be
// published with its words silently changed. app/_components/LegalDocument.tsx renders the blocks;
// scripts/legal-pages-test.ts proves every word of each source appears on the page, in order.

export interface Run { text: string; bold: boolean }
export type Inline = Run[]

export type LegalBlock =
  | { kind: 'title'; inline: Inline }
  | { kind: 'heading'; inline: Inline }
  | { kind: 'paragraph'; inline: Inline }
  | { kind: 'list'; items: Inline[] }
  | { kind: 'table'; head: Inline[]; rows: Inline[][] }

export class LegalMarkdownError extends Error {
  constructor(message: string, public line: number) {
    super(`${message} (line ${line})`)
    this.name = 'LegalMarkdownError'
  }
}

/** "**bold** and plain" → runs. An odd number of ** markers is refused. */
export function parseInline(text: string, line: number): Inline {
  const parts = text.split('**')
  if (parts.length % 2 === 0) throw new LegalMarkdownError('Unclosed ** (bold) marker', line)
  return parts
    .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
    .filter(r => r.text.length > 0)
}

const HEADING = /^(#{1,3}) (.+)$/
const BULLET = /^- (.+)$/
const TABLE_ROW = /^\|.*\|$/
const TABLE_SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+$/

function cells(row: string): string[] {
  return row.slice(1, -1).split('|').map(c => c.trim())
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || BULLET.test(line) || TABLE_ROW.test(line)
}

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: LegalBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const n = i + 1
    if (line.trim() === '') { i++; continue }

    const h = line.match(HEADING)
    if (h) {
      blocks.push({ kind: h[1].length === 1 ? 'title' : 'heading', inline: parseInline(h[2], n) })
      i++
      continue
    }

    if (BULLET.test(line)) {
      const items: Inline[] = []
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(parseInline(lines[i].match(BULLET)![1], i + 1))
        i++
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    if (TABLE_ROW.test(line)) {
      const head = cells(line)
      if (i + 1 >= lines.length || !TABLE_SEPARATOR.test(lines[i + 1])) throw new LegalMarkdownError('Table has no |---| separator row', n + 1)
      if (cells(lines[i + 1]).length !== head.length) throw new LegalMarkdownError('Table separator has the wrong number of cells', n + 1)
      i += 2
      const rows: Inline[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        const c = cells(lines[i])
        if (c.length !== head.length) throw new LegalMarkdownError(`Table row has ${c.length} cells, expected ${head.length}`, i + 1)
        rows.push(c.map(t => parseInline(t, i + 1)))
        i++
      }
      blocks.push({ kind: 'table', head: head.map(t => parseInline(t, n)), rows })
      continue
    }

    // A paragraph: this line plus any following lines that don't start another block.
    const parts = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      parts.push(lines[i].trim())
      i++
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(parts.join(' '), n) })
  }
  return blocks
}
