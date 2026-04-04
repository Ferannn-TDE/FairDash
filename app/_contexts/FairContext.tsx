'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { getFairBySlug, getVendorsByFairSlug, type Fair, type MockVendor } from '@/lib/mock'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FairContextValue {
  fair: Fair
  vendors: MockVendor[]
}

// ─── Context ──────────────────────────────────────────────────────────────────

const FairContext = createContext<FairContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

interface FairProviderProps {
  fairSlug: string
  children: ReactNode
}

export function FairProvider({ fairSlug, children }: FairProviderProps) {
  const fair = getFairBySlug(fairSlug)

  if (!fair) {
    // This should not happen if the layout does a notFound() check first
    throw new Error(`FairProvider: no fair found for slug "${fairSlug}"`)
  }

  const vendors = useMemo(() => getVendorsByFairSlug(fairSlug), [fairSlug])

  const value = useMemo<FairContextValue>(() => ({ fair, vendors }), [fair, vendors])

  return <FairContext.Provider value={value}>{children}</FairContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFair(): FairContextValue {
  const ctx = useContext(FairContext)
  if (!ctx) throw new Error('useFair must be used inside <FairProvider>')
  return ctx
}
