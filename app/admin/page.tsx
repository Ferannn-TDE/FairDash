import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import Link from 'next/link'

export const metadata = { title: 'Admin — FairSynq' }

export default function AdminPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white flex items-center justify-center px-4">
        <div className="text-center max-w-lg">
          <p className="text-text-gray text-sm font-semibold uppercase tracking-widest mb-3">Restricted</p>
          <h1 className="font-bebas text-5xl text-white tracking-wide mb-4">Admin Dashboard</h1>
          <p className="text-text-gray mb-8">
            Platform administration tools. This area is restricted to FairSynq staff.
          </p>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-semibold hover:bg-white/10 transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </>
  )
}
