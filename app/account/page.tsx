import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import Link from 'next/link'

export const metadata = { title: 'Account — FairSynq' }

export default function AccountPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">
          <h1 className="font-bebas text-5xl text-white tracking-wide mb-8">My Account</h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Link
              href="/account/orders"
              className="bg-bg-card border border-white/10 rounded-2xl p-6 hover:border-white/20 hover:-translate-y-1 transition-all duration-300"
            >
              <h2 className="font-semibold text-white mb-2">Order History</h2>
              <p className="text-text-gray text-sm">View all your orders across every fair.</p>
            </Link>
            <Link
              href="/history"
              className="bg-bg-card border border-white/10 rounded-2xl p-6 hover:border-white/20 hover:-translate-y-1 transition-all duration-300"
            >
              <h2 className="font-semibold text-white mb-2">Past Fairs</h2>
              <p className="text-text-gray text-sm">Orders from fairs you&apos;ve attended.</p>
            </Link>
            <Link
              href="/favorites"
              className="bg-bg-card border border-white/10 rounded-2xl p-6 hover:border-white/20 hover:-translate-y-1 transition-all duration-300"
            >
              <h2 className="font-semibold text-white mb-2">Favorites</h2>
              <p className="text-text-gray text-sm">Your saved vendors and menu items.</p>
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
