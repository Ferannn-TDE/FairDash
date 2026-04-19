import { redirect } from 'next/navigation'
import { mockAdminEvents } from '@/lib/mock/admin'

export const metadata = { title: 'Admin — FairSynq' }

export default function AdminIndexPage() {
  // Redirect to the first active event's dashboard, or the first event
  const firstActive = mockAdminEvents.find(e => e.status === 'ACTIVE') ?? mockAdminEvents[0]
  if (firstActive) {
    redirect(`/admin/${firstActive.slug}/dashboard`)
  }

  // Fallback: no events yet
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <p className="text-[#555] text-sm font-inter uppercase tracking-widest mb-3">No Events</p>
        <h1 className="font-bebas text-4xl text-white tracking-wide mb-4">No events configured</h1>
        <p className="text-[#666] text-sm font-inter">Contact a super admin to create your first event.</p>
      </div>
    </div>
  )
}
