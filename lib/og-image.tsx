// The share image (Open Graph) — one brand frame for the site card and every fair card.
// Fonts are bundled (assets/fonts, OFL licences beside them), never fetched at request time.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

const PINK = '#FF0077', BG = '#0F0F0F', GRAY = '#A1A1A1'

export async function ogFonts() {
  const [bebas, inter, interSemi] = await Promise.all([
    readFile(join(process.cwd(), 'assets/fonts/bebas-neue-latin-400-normal.woff')),
    readFile(join(process.cwd(), 'assets/fonts/inter-latin-400-normal.woff')),
    readFile(join(process.cwd(), 'assets/fonts/inter-latin-600-normal.woff')),
  ])
  return [
    { name: 'Bebas Neue', data: bebas, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: inter, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: interSemi, weight: 600 as const, style: 'normal' as const },
  ]
}

/** Long fair names shrink rather than spill. */
function titleSize(title: string) {
  return title.length <= 18 ? 150 : title.length <= 30 ? 118 : title.length <= 44 ? 92 : 72
}

export function OgFrame({ kicker, title, lines }: { kicker: string; title: string; lines: string[] }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, color: '#FFFFFF', fontFamily: 'Inter', position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, background: PINK, display: 'flex' }} />
      <div style={{ position: 'absolute', right: -160, top: -160, width: 520, height: 520, borderRadius: 520, background: 'rgba(255,0,119,0.18)', display: 'flex' }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', padding: '64px 80px 56px 98px' }}>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, letterSpacing: 4, color: PINK, textTransform: 'uppercase' }}>{kicker}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: titleSize(title), lineHeight: 0.95, letterSpacing: 1 }}>{title}</div>
          {lines.map(l => (
            <div key={l} style={{ display: 'flex', fontSize: 38, color: GRAY, marginTop: 14 }}>{l}</div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontFamily: 'Bebas Neue', fontSize: 64, letterSpacing: 2 }}>
            <span>FAIR</span><span style={{ color: PINK }}>SYNQ</span>
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: GRAY }}>fairsynq.com</div>
        </div>
      </div>
    </div>
  )
}
