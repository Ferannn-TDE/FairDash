// app/not-found.tsx
// FairSynq 404 — themed after the Watermelon "error-1" block.
// Grid + SVG colours are hardcoded hex (inline styles / SVG attrs can't read
// Tailwind classes); every value mirrors tailwind.config.js — keep in step:
//   neon-pink #FF0077 · bg-dark #0F0F0F · text-gray #A1A1A1 · shadow.glow
// Requires Inter 900 in the globals.css @import (added for the outline numeral).

import Link from 'next/link';

const ACCENT = '#FF0077'; // neon-pink

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-dark px-6 py-16 text-white">
      {/* grid backdrop, faded toward the edges via a radial mask */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.12]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 19px, ${ACCENT} 19px, ${ACCENT} 20px, transparent 20px, transparent 39px, ${ACCENT} 39px, ${ACCENT} 40px),
            repeating-linear-gradient(90deg, transparent, transparent 19px, ${ACCENT} 19px, ${ACCENT} 20px, transparent 20px, transparent 39px, ${ACCENT} 39px, ${ACCENT} 40px),
            radial-gradient(circle at 20px 20px, ${ACCENT} 2px, transparent 2px),
            radial-gradient(circle at 40px 40px, ${ACCENT} 2px, transparent 2px)
          `,
          backgroundSize: '40px 40px, 40px 40px, 40px 40px, 40px 40px',
          WebkitMaskImage: 'radial-gradient(circle at center, black, transparent 72%)',
          maskImage: 'radial-gradient(circle at center, black, transparent 72%)',
        }}
      />

      <section
        aria-labelledby="notfound-title"
        className="z-10 mx-auto flex w-full max-w-lg flex-col items-center text-center"
      >
        {/* dashed-outline 404 */}
        <svg
          viewBox="0 0 800 300"
          className="w-full max-w-[20rem] select-none sm:max-w-md"
          aria-hidden="true"
        >
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-black tracking-tighter"
            style={{ fontSize: '20rem' }}
            fill={ACCENT}
            fillOpacity={0.15}
            stroke={ACCENT}
            strokeWidth={2}
            strokeDasharray="40 20"
          >
            404
          </text>
        </svg>

        <div className="flex flex-col items-center gap-2">
          <h1
            id="notfound-title"
            className="text-xl font-bold leading-snug tracking-tight sm:text-2xl"
          >
            Route not found
          </h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-text-gray sm:max-w-sm sm:text-base">
            The destination you&apos;re looking for has been moved, renamed, or no
            longer exists. It may have been relocated during a recent update.
          </p>
        </div>

        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-full bg-neon-pink px-6 text-sm font-semibold text-black shadow-glow transition-opacity hover:opacity-90"
        >
          Go Back Home
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true"
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
          </svg>
        </Link>
      </section>
    </main>
  );
}
