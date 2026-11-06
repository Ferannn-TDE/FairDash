'use client'

import { useClerk } from '@clerk/clerk-react'
import { LogOut } from 'lucide-react'

// Sign out for the minimal platform_manager header on /admin/settings (that user has no
// other admin chrome to sign out from).
export default function AdminSignOutButton() {
  const { signOut } = useClerk()
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectUrl: '/admin/login' })}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-text-gray hover:text-white text-xs font-semibold transition-colors cursor-pointer"
    >
      <LogOut className="w-3.5 h-3.5" /> Sign out
    </button>
  )
}
