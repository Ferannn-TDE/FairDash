import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin Portal — FairSynq' }

// Pass-through only. The gate + AdminShell live in app/admin/[eventSlug]/layout.tsx
// so that /admin/login renders WITHOUT the gate (no redirect loop) and WITHOUT
// the admin chrome.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
