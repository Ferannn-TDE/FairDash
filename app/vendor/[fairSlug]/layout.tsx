'use client'

import { useState, useEffect, use } from 'react'
import { useUser } from '@clerk/clerk-react'
import { VendorContext, type VendorMeta } from '@/lib/contexts/VendorContext'
import VendorPortalShell from './_components/VendorPortalShell'

interface Props {
  params: Promise<{ fairSlug: string }>
  children: React.ReactNode
}

function LoadingShell() {
  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
        <p className="text-text-gray text-sm">Loading vendor portal…</p>
      </div>
    </div>
  )
}

function NotAuthorized() {
  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="font-bebas text-3xl text-white tracking-wide mb-2">Access Denied</h2>
        <p className="text-text-gray text-sm">
          No vendor account is linked to your login. Contact your event organizer.
        </p>
      </div>
    </div>
  )
}

export default function VendorFairLayout({ params: paramsPromise, children }: Props) {
  const params = use(paramsPromise)
  const { user } = useUser()
  const [vendorMeta, setVendorMeta] = useState<VendorMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    // Fair-scoped: resolve the vendor this user owns AT THIS fair (not their newest
    // globally). Without this param the portal could show the wrong own-vendor.
    fetch(`/api/vendors/me?fairSlug=${encodeURIComponent(params.fairSlug)}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) { setError(true); return }
        const v = json.data.vendor
        setVendorMeta({
          vendorId:    v.id,
          vendorName:  v.name,
          eventId:     v.eventId,
          fairSlug:    params.fairSlug,
          logoUrl:     v.logoUrl ?? null,
          cuisineType: v.cuisineType,
          isOffline:   Boolean(v.isOffline),
          status:      String(v.status ?? 'PENDING'),
        })
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [params.fairSlug])

  if (loading) return <LoadingShell />
  if (error || !vendorMeta) return <NotAuthorized />

  return (
    <VendorContext.Provider value={vendorMeta}>
      <VendorPortalShell
        fairSlug={params.fairSlug}
        vendorName={vendorMeta.vendorName}
        userName={user?.firstName ?? ''}
        userEmail={user?.emailAddresses?.[0]?.emailAddress ?? ''}
      >
        {children}
      </VendorPortalShell>
    </VendorContext.Provider>
  )
}
