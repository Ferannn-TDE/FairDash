import MarketplaceNavbar from '../_components/MarketplaceNavbar'
import Link from 'next/link'
import {
  ClipboardDocumentListIcon,
  HeartIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'

export const metadata = { title: 'Account — FairSynq' }

const CARDS = [
  {
    href: '/account/orders',
    icon: ClipboardDocumentListIcon,
    title: 'Order History',
    desc: 'View all your orders across every fair.',
  },
  {
    href: '/account/favorites',
    icon: HeartIcon,
    title: 'Favorites',
    desc: 'Your saved vendors and menu items.',
  },
  {
    href: '/account/settings',
    icon: Cog6ToothIcon,
    title: 'Settings',
    desc: 'Manage your profile and notification preferences.',
  },
]

export default function AccountPage() {
  return (
    <>
      <MarketplaceNavbar />
      <div className="pt-16 min-h-screen bg-bg-dark text-white">
        <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4 py-12">
          <h1 className="font-bebas text-5xl text-white tracking-wide mb-8">My Account</h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {CARDS.map(({ href, icon: Icon, title, desc }) => (
              <Link
                key={href}
                href={href}
                className="group bg-bg-card border border-white/10 rounded-2xl p-6 hover:border-neon-pink/30 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(255,0,119,0.1)] transition-all duration-300"
              >
                <Icon className="w-8 h-8 text-neon-pink mb-4 transition-transform duration-300 group-hover:scale-110" />
                <h2 className="font-semibold text-white mb-2">{title}</h2>
                <p className="text-text-gray text-sm">{desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
