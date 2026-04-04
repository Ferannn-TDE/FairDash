// ─── Types ────────────────────────────────────────────────────────────────────

export type FairStatus = 'draft' | 'upcoming' | 'active' | 'completed' | 'archived'

export interface Fair {
  id: string
  slug: string
  name: string
  tagline?: string
  location: {
    city: string
    state: string
    address: string
    coordinates: { lat: number; lng: number }
  }
  dates: {
    startDate: string // ISO date
    endDate: string
  }
  status: FairStatus
  operatingHours: {
    open: string  // "10:00"
    close: string // "22:00"
  }
  branding?: {
    bannerUrl?: string
    logoUrl?: string
    accentColor?: string
    gradientFrom?: string
    gradientTo?: string
  }
  vendorCount: number
  admissionFree: boolean
  description?: string
  website?: string
  contactEmail?: string
}

// ─── Mock data ────────────────────────────────────────────────────────────────

export const mockFairs: Fair[] = [
  {
    id: 'fair_001',
    slug: 'springfield-state-fair-2026',
    name: 'Springfield State Fair',
    tagline: 'Illinois\' biggest annual celebration',
    location: {
      city: 'Springfield',
      state: 'IL',
      address: '801 Sangamon Ave, Springfield, IL 62702',
      coordinates: { lat: 39.7817, lng: -89.6501 },
    },
    dates: { startDate: '2026-06-15', endDate: '2026-06-22' },
    status: 'active',
    operatingHours: { open: '10:00', close: '22:00' },
    branding: {
      accentColor: '#FF0077',
      gradientFrom: '#FF0077',
      gradientTo: '#7C3AED',
    },
    vendorCount: 12,
    admissionFree: false,
    description: 'The Springfield State Fair is Illinois\' premier annual event, featuring world-class food vendors, live entertainment, and family-friendly activities. Order ahead and skip the lines!',
    contactEmail: 'info@springfieldfair.com',
  },
  {
    id: 'fair_002',
    slug: 'stl-food-festival-2026',
    name: 'STL Street Food Festival',
    tagline: 'The best bites in St. Louis',
    location: {
      city: 'St. Louis',
      state: 'MO',
      address: 'Forest Park, St. Louis, MO 63112',
      coordinates: { lat: 38.6354, lng: -90.2853 },
    },
    dates: { startDate: '2026-07-04', endDate: '2026-07-06' },
    status: 'upcoming',
    operatingHours: { open: '11:00', close: '23:00' },
    branding: {
      accentColor: '#F97316',
      gradientFrom: '#F97316',
      gradientTo: '#EF4444',
    },
    vendorCount: 8,
    admissionFree: true,
    description: 'Celebrate the 4th of July with St. Louis\'s most diverse street food festival. 8 vendors, live music, and fireworks after dark.',
  },
  {
    id: 'fair_003',
    slug: 'columbus-taste-fest-2026',
    name: 'Columbus Taste Fest',
    tagline: 'Flavors from around the world',
    location: {
      city: 'Columbus',
      state: 'OH',
      address: '400 N High St, Columbus, OH 43215',
      coordinates: { lat: 39.9746, lng: -83.0007 },
    },
    dates: { startDate: '2026-05-20', endDate: '2026-05-25' },
    status: 'completed',
    operatingHours: { open: '10:00', close: '21:00' },
    branding: {
      accentColor: '#10B981',
      gradientFrom: '#10B981',
      gradientTo: '#0EA5E9',
    },
    vendorCount: 15,
    admissionFree: false,
    description: 'Columbus\'s annual multicultural food festival. This event has concluded — see you next year!',
  },
  {
    id: 'fair_004',
    slug: 'edwardsville-night-market-2026',
    name: 'Edwardsville Night Market',
    tagline: 'After-dark street eats',
    location: {
      city: 'Edwardsville',
      state: 'IL',
      address: 'Main Street, Edwardsville, IL 62025',
      coordinates: { lat: 38.8112, lng: -89.9532 },
    },
    dates: { startDate: '2026-08-01', endDate: '2026-08-03' },
    status: 'upcoming',
    operatingHours: { open: '17:00', close: '23:00' },
    branding: {
      accentColor: '#8B5CF6',
      gradientFrom: '#8B5CF6',
      gradientTo: '#EC4899',
    },
    vendorCount: 6,
    admissionFree: true,
    description: 'An intimate evening street food market on Edwardsville\'s historic Main Street. Perfect for a late summer night out.',
  },
]
