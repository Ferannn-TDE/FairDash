'use client'

import type { ReactNode } from 'react'
import { FairProvider } from '../_contexts/FairContext'
import type { FairData, VendorData } from '../_contexts/FairContext'
import { FairCartProvider } from '../_contexts/FairCartContext'
import FairNavbar from './FairNavbar'
import FairBottomNav from './FairBottomNav'

interface FairShellProps {
  fairSlug: string
  children: ReactNode
  initialFair?: FairData | null
  initialVendors?: VendorData[]
}

export default function FairShell({ fairSlug, children, initialFair, initialVendors }: FairShellProps) {
  return (
    <FairProvider fairSlug={fairSlug} initialFair={initialFair} initialVendors={initialVendors}>
      <FairCartProvider fairSlug={fairSlug}>
        <FairNavbar />
        {/* pb-14 sm:pb-0 reserves space for mobile bottom nav */}
        <main className="pt-14 sm:pt-16 pb-14 sm:pb-0 min-h-screen bg-bg-dark">
          {children}
        </main>
        <FairBottomNav />
      </FairCartProvider>
    </FairProvider>
  )
}
