import MarketplaceNavbar from '../../_components/MarketplaceNavbar'
import Link from 'next/link'

export const metadata = { title: 'Order History — FairSynq' }

export default function AccountOrdersPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/account" className="text-text-gray hover:text-white transition-colors text-sm">
              ← Account
            </Link>
            <h1 className="font-bebas text-5xl text-white tracking-wide">Order History</h1>
          </div>

          {/* Empty state — real data requires auth + API */}
          <div className="bg-bg-card border border-white/10 rounded-2xl p-12 text-center">
            <p className="text-text-gray mb-4">No orders yet. Find a fair and start ordering!</p>
            <Link
              href="/fairs"
              className="inline-flex items-center px-6 py-3 rounded-xl bg-neon-pink text-white font-semibold hover:bg-[#e0006b] transition-colors"
            >
              Find a Fair
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
