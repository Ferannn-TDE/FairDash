import Link from 'next/link'
import MarketplaceNavbar from '@/app/_components/MarketplaceNavbar'

export default function FairNotFound() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center px-5 text-center pt-16">

        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-text-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="font-bebas text-[clamp(2rem,5vw,3rem)] tracking-wide text-white mb-2">
          Fair <span className="text-neon-pink">Unavailable</span>
        </h1>
        <p className="text-text-gray text-sm max-w-sm mb-8">
          This fair could not be found. It may have ended, been removed, or the link might be incorrect.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/fairs"
            className="inline-flex items-center justify-center px-6 py-3 bg-neon-pink text-white font-semibold rounded-xl text-sm hover:bg-[#e0006b] shadow-[0_4px_12px_rgba(255,0,119,0.3)] transition-colors"
          >
            Browse Other Fairs
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 bg-white/5 border border-white/10 text-white font-semibold rounded-xl text-sm hover:bg-white/10 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </>
  )
}
