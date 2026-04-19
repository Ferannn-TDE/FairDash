'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FairData {
  id: string
  name: string
  slug: string
  description: string | null
  primaryColor: string
  branding: {
    accentColor: string
    gradientFrom: string
    gradientTo: string
  }
  status: 'upcoming' | 'active' | 'completed' | 'paused'
  dates: {
    startDate: string
    endDate: string
  }
  // Optional fields not present in DB — pages handle them with conditional rendering
  tagline?: string
  location: { address: string; city: string; state: string }
  operatingHours: { open: string; close: string }
  admissionFree: boolean
  contactEmail?: string
  website?: string
}

export interface VendorData {
  id: string
  name: string
  slug: string          // = id (DB has no slug field)
  cuisineType: string
  description: string | null
  boothNumber: string | null
  logoUrl: string | null
  isBusy: boolean
  isOffline: boolean
  _count: { menuItems: number }
}

interface FairContextValue {
  fair: FairData
  vendors: VendorData[]
  fairLoading: boolean
  vendorsLoading: boolean
}

// ─── Context ──────────────────────────────────────────────────────────────────

const FairContext = createContext<FairContextValue | null>(null)

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeStatus(s: string): FairData['status'] {
  const map: Record<string, FairData['status']> = {
    UPCOMING: 'upcoming', upcoming: 'upcoming',
    ACTIVE: 'active',     active: 'active',
    COMPLETED: 'completed', completed: 'completed',
    PAUSED: 'paused',
  }
  return map[s] ?? 'upcoming'
}

function placeholderFair(fairSlug: string): FairData {
  return {
    id: fairSlug,
    name: '',
    slug: fairSlug,
    description: null,
    primaryColor: '#FF0077',
    branding: { accentColor: '#FF0077', gradientFrom: '#FF0077', gradientTo: '#7C3AED' },
    status: 'active',
    dates: { startDate: new Date().toISOString(), endDate: new Date().toISOString() },
    location: { address: '', city: '', state: '' },
    operatingHours: { open: '', close: '' },
    admissionFree: false,
  }
}

function normalizeEvent(raw: any): FairData {
  const color = raw.primaryColor ?? '#FF0077'
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.urlSlug,
    description: raw.description ?? null,
    primaryColor: color,
    branding: {
      accentColor: color,
      gradientFrom: color,
      gradientTo: '#7C3AED',
    },
    status: normalizeStatus(raw.status),
    dates: {
      startDate: raw.startDate,
      endDate: raw.endDate,
    },
    location: { address: '', city: '', state: '' },
    operatingHours: { open: '', close: '' },
    admissionFree: false,
  }
}

function normalizeVendor(raw: any): VendorData {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.id,
    cuisineType: raw.cuisineType,
    description: raw.description ?? null,
    boothNumber: raw.boothNumber ?? null,
    logoUrl: raw.logoUrl ?? null,
    isBusy: raw.isBusy ?? false,
    isOffline: raw.isOffline ?? false,
    _count: { menuItems: raw._count?.menuItems ?? 0 },
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface FairProviderProps {
  fairSlug: string
  children: ReactNode
}

export function FairProvider({ fairSlug, children }: FairProviderProps) {
  const [fair, setFair] = useState<FairData>(() => placeholderFair(fairSlug))
  const [vendors, setVendors] = useState<VendorData[]>([])
  const [fairLoading, setFairLoading] = useState(true)
  const [vendorsLoading, setVendorsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch(`/api/events/${fairSlug}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.success && json.data) setFair(normalizeEvent(json.data))
        setFairLoading(false)
      })
      .catch(() => { if (!cancelled) setFairLoading(false) })

    fetch(`/api/vendors?eventSlug=${fairSlug}&limit=100`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.success && Array.isArray(json.data)) setVendors(json.data.map(normalizeVendor))
        setVendorsLoading(false)
      })
      .catch(() => { if (!cancelled) setVendorsLoading(false) })

    return () => { cancelled = true }
  }, [fairSlug])

  const value = useMemo<FairContextValue>(
    () => ({ fair, vendors, fairLoading, vendorsLoading }),
    [fair, vendors, fairLoading, vendorsLoading],
  )

  return <FairContext.Provider value={value}>{children}</FairContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFair(): FairContextValue {
  const ctx = useContext(FairContext)
  if (!ctx) throw new Error('useFair must be used inside <FairProvider>')
  return ctx
}
