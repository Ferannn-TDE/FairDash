'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { getFairBySlug, getVendorsByFairSlug } from '@/lib/mock'
import type { Fair as MockFair, MockVendor } from '@/lib/mock'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FulfillmentConfig {
  boothPickupEnabled: boolean
  curbsideEnabled: boolean
  homeDeliveryEnabled: boolean
  homeDeliveryFee: number | null
  curbsideZoneDescription: string | null
}

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
  fulfillmentConfig: FulfillmentConfig | null
  serviceChargeEnabled: boolean
  serviceChargeAmount: number | null
  // Optional fields not present in DB — pages handle them with conditional rendering
  tagline?: string
  location: { address: string; city: string; state: string }
  operatingHours: { open: string; close: string }
  hours?: Array<{ day: string; open: string; close: string }>
  admission?: { required: boolean; pricing: string }
  contact?: { email?: string; phone?: string; website?: string }
  admissionFree: boolean
  contactEmail?: string
  website?: string
  // Featured Today customization
  featuredVendorIds?: string[]
  featuredLabel?: string | null
  featuredEnabled?: boolean
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
  featured?: boolean
  featuredReason?: string
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
    fulfillmentConfig: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false, homeDeliveryFee: null, curbsideZoneDescription: null },
    serviceChargeEnabled: false,
    serviceChargeAmount: null,
    location: { address: '', city: '', state: '' },
    operatingHours: { open: '', close: '' },
    admissionFree: false,
  }
}

function normalizeMockFair(f: MockFair): FairData {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    tagline: f.tagline,
    description: f.description ?? null,
    primaryColor: f.branding?.accentColor ?? '#FF0077',
    branding: {
      accentColor: f.branding?.accentColor ?? '#FF0077',
      gradientFrom: f.branding?.gradientFrom ?? '#FF0077',
      gradientTo: f.branding?.gradientTo ?? '#7C3AED',
    },
    status: f.status === 'draft' || f.status === 'archived' ? 'upcoming' : f.status,
    dates: { startDate: f.dates.startDate, endDate: f.dates.endDate },
    fulfillmentConfig: { boothPickupEnabled: true, curbsideEnabled: true, homeDeliveryEnabled: true, homeDeliveryFee: 2.99, curbsideZoneDescription: null },
    serviceChargeEnabled: false,
    serviceChargeAmount: null,
    location: f.location,
    operatingHours: f.operatingHours,
    hours: f.hours,
    admission: f.admission,
    contact: f.contact,
    admissionFree: f.admissionFree,
    contactEmail: f.contactEmail,
    website: f.website,
  }
}

function normalizeMockVendor(v: MockVendor): VendorData {
  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    cuisineType: v.cuisineType,
    description: v.description ?? null,
    boothNumber: v.boothNumber ?? null,
    logoUrl: v.logoUrl ?? null,
    isBusy: v.isBusy ?? false,
    isOffline: false,
    featured: v.featured,
    featuredReason: v.featuredReason,
    _count: { menuItems: v.menu?.length ?? 0 },
  }
}

function normalizeEvent(raw: any): FairData {
  const color = raw.primaryColor ?? '#FF0077'
  const fc = raw.fulfillmentConfig ?? null
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
    fulfillmentConfig: fc ? {
      boothPickupEnabled: fc.boothPickupEnabled,
      curbsideEnabled: fc.curbsideEnabled,
      homeDeliveryEnabled: fc.homeDeliveryEnabled,
      homeDeliveryFee: fc.homeDeliveryFee ?? null,
      curbsideZoneDescription: fc.curbsideZoneDescription ?? null,
    } : null,
    serviceChargeEnabled: raw.serviceChargeEnabled ?? false,
    serviceChargeAmount: raw.serviceChargeAmount ?? null,
    location: {
      address: raw.address ?? raw.location ?? '',
      city: raw.city ?? '',
      state: raw.state ?? '',
    },
    operatingHours: {
      open: raw.openTime ?? raw.operatingHoursOpen ?? '',
      close: raw.closeTime ?? raw.operatingHoursClose ?? '',
    },
    admissionFree: raw.admissionFree ?? false,
  }
}

function normalizeVendor(raw: any): VendorData {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug ?? raw.id,
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
  initialFair?: FairData | null
  initialVendors?: VendorData[]
}

export function FairProvider({ fairSlug, children, initialFair, initialVendors }: FairProviderProps) {
  const [fair, setFair] = useState<FairData>(() => initialFair ?? placeholderFair(fairSlug))
  const [vendors, setVendors] = useState<VendorData[]>(() => initialVendors ?? [])
  // If SSR passed initial data, we're not loading — skip the spinner flash
  const [fairLoading, setFairLoading] = useState(!initialFair)
  const [vendorsLoading, setVendorsLoading] = useState(!initialVendors?.length)

  // Hydrate from the API in the background. When SSR already provided initialFair
  // we skip the loading state — the fetch is purely a staleness refresh.
  useEffect(() => {
    if (!initialFair) setFairLoading(true)
    fetch(`/api/events/${fairSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data) {
          const normalized = normalizeEvent(json.data)
          // Supplement sparse DB data with mock fields (hours, admission, contact, location)
          const mockFair = getFairBySlug(fairSlug)
          if (mockFair) {
            const mock = normalizeMockFair(mockFair)
            setFair({
              ...normalized,
              location: normalized.location.address ? normalized.location : mock.location,
              operatingHours: normalized.operatingHours.open ? normalized.operatingHours : mock.operatingHours,
              hours: normalized.hours ?? mock.hours,
              admission: normalized.admission ?? mock.admission,
              contact: normalized.contact ?? mock.contact,
              tagline: normalized.tagline ?? mock.tagline,
            })
          } else {
            setFair(normalized)
          }
        } else {
          const mockFair = getFairBySlug(fairSlug)
          if (mockFair) setFair(normalizeMockFair(mockFair))
        }
      })
      .catch(() => {
        const mockFair = getFairBySlug(fairSlug)
        if (mockFair) setFair(normalizeMockFair(mockFair))
      })
      .finally(() => setFairLoading(false))
  }, [fairSlug])

  useEffect(() => {
    if (!initialVendors?.length) setVendorsLoading(true)
    fetch(`/api/vendors?eventSlug=${fairSlug}&limit=100`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data?.length) {
          setVendors(json.data.map(normalizeVendor))
        } else {
          const mockVendorList = getVendorsByFairSlug(fairSlug)
          setVendors(mockVendorList.map(normalizeMockVendor))
        }
      })
      .catch(() => {
        const mockVendorList = getVendorsByFairSlug(fairSlug)
        setVendors(mockVendorList.map(normalizeMockVendor))
      })
      .finally(() => setVendorsLoading(false))
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
