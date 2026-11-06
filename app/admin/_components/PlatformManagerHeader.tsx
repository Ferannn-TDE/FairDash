import Link from 'next/link'
import AdminSignOutButton from './AdminSignOutButton'

// The minimal header a platform_manager (no admin role) sees: the only two pages they can open,
// plus sign out. No fair picker, no fair links.
export default function PlatformManagerHeader({ current }: { current: 'approvals' | 'settings' }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${on ? 'bg-white/10 text-white' : 'text-text-gray hover:text-white'}`}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-4">
        <span className="font-bebas text-xl tracking-widest text-white">FAIR<span className="text-neon-pink">SYNQ</span></span>
        <nav className="flex items-center gap-1">
          {link('/admin/approvals', 'Approvals', current === 'approvals')}
          {link('/admin/settings', 'Platform settings', current === 'settings')}
        </nav>
      </div>
      <AdminSignOutButton />
    </div>
  )
}
