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
  hours?: Array<{ day: string; open: string; close: string }>
  admission?: { required: boolean; pricing: string }
  contact?: { email?: string; phone?: string; website?: string }
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
    name: 'Italian Fest 2026',
    tagline: 'Celebrating Italian heritage in southern Illinois',
    location: {
      city: 'Collinsville',
      state: 'IL',
      address: '200 W Main Street, Collinsville, IL 62234',
      coordinates: { lat: 38.6706, lng: -89.9845 },
    },
    dates: { startDate: '2026-09-25', endDate: '2026-09-27' },
    status: 'active',
    operatingHours: { open: '11:00', close: '23:00' },
    branding: {
      accentColor: '#FF0077',
      gradientFrom: '#FF0077',
      gradientTo: '#7C3AED',
    },
    vendorCount: 17,
    admissionFree: false,
    description: 'Italian Fest is the largest Italian heritage festival in southern Illinois, celebrating Italian culture, food, music, and family for over 35 years. Featuring authentic cuisine from local Italian-American organizations, live entertainment, bocce tournaments, and a children\'s area.',
    contactEmail: 'info@italianfestcollinsville.com',
    hours: [
      { day: 'Friday', open: '17:00', close: '23:00' },
      { day: 'Saturday', open: '11:00', close: '23:00' },
      { day: 'Sunday', open: '11:00', close: '21:00' },
    ],
    admission: { required: true, pricing: '$5 per person · Kids under 12 free' },
    contact: { email: 'info@italianfestcollinsville.com', phone: '(618) 344-2884', website: 'italianfestcollinsville.com' },
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
