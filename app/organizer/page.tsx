import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import Link from 'next/link'

export const metadata = { title: 'For Organizers — FairSynq' }

export default function OrganizerPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white flex items-center justify-center px-4">
        <div className="text-center max-w-lg">
          <p className="text-text-gray text-sm font-semibold uppercase tracking-widest mb-3">Coming soon</p>
          <h1 className="font-bebas text-5xl text-white tracking-wide mb-4">Organizer Portal</h1>
          <p className="text-text-gray mb-8">
            The self-serve dashboard for fair organizers — create your event, invite vendors, and manage
            orders in real time. Launching soon.
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
