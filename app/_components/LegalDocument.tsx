import { Fragment } from 'react'
import { parseLegalMarkdown, type Inline } from '@/lib/legal/markdown'

// Renders a legal document's markdown (lib/legal/markdown.ts) word for word: the Vendor Agreement
// on /vendor-agreement and in the sign-up wizard, the Privacy Policy and the Website Terms.
// No hooks and no server-only imports, so server pages and the client wizard can both use it.
// compact: the smaller type for the wizard's scroll box.

function Runs({ inline }: { inline: Inline }) {
  return (
    <>
      {inline.map((r, i) =>
        r.bold ? <strong key={i} className="font-semibold text-white">{r.text}</strong> : <Fragment key={i}>{r.text}</Fragment>,
      )}
    </>
  )
}

export default function LegalDocument({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = parseLegalMarkdown(text)
  const body = compact ? 'text-[0.8125rem]' : 'text-sm sm:text-[0.9375rem]'
  return (
    <div className={`text-text-gray leading-relaxed ${body}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'title':
            return (
              <h1 key={i} className={`font-bebas font-normal tracking-wide text-white m-0 ${compact ? 'text-2xl' : 'text-4xl sm:text-5xl'}`}>
                <Runs inline={b.inline} />
              </h1>
            )
          case 'heading':
            return (
              <h2 key={i} className={`font-semibold text-white ${compact ? 'text-sm mt-5 mb-1.5' : 'text-base sm:text-lg mt-8 mb-2'}`}>
                <Runs inline={b.inline} />
              </h2>
            )
          case 'paragraph':
            return (
              <p key={i} className="mt-3 mb-0">
                <Runs inline={b.inline} />
              </p>
            )
          case 'list':
            return (
              <ul key={i} className="mt-3 mb-0 list-disc pl-5 space-y-1.5">
                {b.items.map((item, k) => <li key={k}><Runs inline={item} /></li>)}
              </ul>
            )
          case 'table':
            return (
              <div key={i} className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-left">
                  <thead>
                    <tr>
                      {b.head.map((c, k) => (
                        <th key={k} scope="col" className="border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white align-top">
                          <Runs inline={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, k) => (
                          <td key={k} className={`border border-white/10 px-3 py-2 align-top ${k === 0 ? 'font-semibold text-white whitespace-nowrap' : ''}`}>
                            <Runs inline={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
