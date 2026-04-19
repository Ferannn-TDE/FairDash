// ─── Mock data for the Admin Portal (Phase 1.7) ───────────────────────────────

export const mockAdminProfile = {
  name: 'Alex Torres',
  initials: 'AT',
  email: 'alex@fairsynq.com',
  role: 'super_admin' as const,
}

export const mockAdminEvents = [
  {
    id: 'event_001',
    slug: 'springfield-state-fair-2026',
    name: 'Springfield State Fair',
    status: 'ACTIVE' as const,
    isPaused: false,
    startDate: '2026-06-15',
    endDate: '2026-06-22',
    eventLat: 39.7817,
    eventLng: -89.6501,
    primaryColor: '#FF0077',
  },
  {
    id: 'event_002',
    slug: 'stl-food-festival-2026',
    name: 'STL Street Food Festival',
    status: 'UPCOMING' as const,
    isPaused: false,
    startDate: '2026-07-04',
    endDate: '2026-07-06',
    eventLat: null,
    eventLng: null,
    primaryColor: '#F97316',
  },
]

export const mockAdminDashboard = {
  liveOrders: 23,
  ordersToday: 147,
  revenueToday: 2841.50,
  activeVendors: 3,
  totalVendors: 5,
  activeRunners: 2,
  avgPrepTime: 9,
  platformFeeToday: 284.15,
}

export type VendorConnectionStatus = 'CONNECTED' | 'DISCONNECTED'
export type VendorLiveStatus = 'ACTIVE' | 'BUSY' | 'OFFLINE' | 'PENDING'

export const mockAdminVendors = [
  {
    id: 'vendor_001',
    name: "Smoky Joe's BBQ",
    cuisineType: 'BBQ',
    boothNumber: 'B-12',
    status: 'ACTIVE' as const,
    isOffline: false,
    isBusy: false,
    stripeVerified: true,
    stripeAccountId: 'acct_abc123',
    foodHandlerPermitUrl: '/mock-permit.pdf',
    insuranceUrl: '/mock-insurance.pdf',
    lastHeartbeat: Date.now() - 15_000,
    connectionStatus: 'CONNECTED' as VendorConnectionStatus,
    ordersToday: 42,
    revenueToday: 812.30,
    avgPrepTime: 12,
  },
  {
    id: 'vendor_002',
    name: "Elena's Tacos",
    cuisineType: 'Mexican',
    boothNumber: 'C-04',
    status: 'ACTIVE' as const,
    isOffline: false,
    isBusy: true,
    stripeVerified: true,
    stripeAccountId: 'acct_def456',
    foodHandlerPermitUrl: '/mock-permit.pdf',
    insuranceUrl: null,
    lastHeartbeat: Date.now() - 40_000,
    connectionStatus: 'CONNECTED' as VendorConnectionStatus,
    ordersToday: 58,
    revenueToday: 1090.20,
    avgPrepTime: 8,
  },
  {
    id: 'vendor_003',
    name: 'Funnel Cake Factory',
    cuisineType: 'Desserts',
    boothNumber: 'A-01',
    status: 'ACTIVE' as const,
    isOffline: true,
    isBusy: false,
    stripeVerified: false,
    stripeAccountId: null,
    foodHandlerPermitUrl: '/mock-permit.pdf',
    insuranceUrl: '/mock-insurance.pdf',
    lastHeartbeat: Date.now() - 90_000,
    connectionStatus: 'DISCONNECTED' as VendorConnectionStatus,
    ordersToday: 21,
    revenueToday: 387.00,
    avgPrepTime: 6,
  },
  {
    id: 'vendor_004',
    name: 'Ramen House',
    cuisineType: 'Japanese',
    boothNumber: 'D-07',
    status: 'PENDING' as const,
    isOffline: false,
    isBusy: false,
    stripeVerified: false,
    stripeAccountId: null,
    foodHandlerPermitUrl: '/mock-permit.pdf',
    insuranceUrl: '/mock-insurance.pdf',
    lastHeartbeat: 0,
    connectionStatus: 'DISCONNECTED' as VendorConnectionStatus,
    ordersToday: 0,
    revenueToday: 0,
    avgPrepTime: 0,
  },
  {
    id: 'vendor_005',
    name: 'Corn Dog Shack',
    cuisineType: 'American',
    boothNumber: '',
    status: 'PENDING' as const,
    isOffline: false,
    isBusy: false,
    stripeVerified: false,
    stripeAccountId: null,
    foodHandlerPermitUrl: null,
    insuranceUrl: null,
    lastHeartbeat: 0,
    connectionStatus: 'DISCONNECTED' as VendorConnectionStatus,
    ordersToday: 0,
    revenueToday: 0,
    avgPrepTime: 0,
  },
]

export const mockFulfillmentConfig = {
  id: 'fc_001',
  eventId: 'event_001',
  boothPickupEnabled: true,
  curbsideEnabled: true,
  homeDeliveryEnabled: false,
  curbsideZoneLat: 39.7820,
  curbsideZoneLng: -89.6498,
  curbsideZoneDescription: 'North parking lot, Row A — look for the orange cone markers',
  curbsideMethod: 'RUNNER_DELIVERS' as const,
  homeDeliveryFee: 2.99,
  homeDeliveryRadiusKm: 5,
  runnerTransportDescription: 'Delivered by golf cart',
}

export const mockAdminRunners = [
  {
    id: 'runner_001',
    name: 'James Wilson',
    initials: 'JW',
    email: 'james@runner.com',
    status: 'ACTIVE' as const,
    completionRate: 0.97,
    totalDispatched: 34,
    totalCompleted: 33,
    currentLat: 39.7819,
    currentLng: -89.6503,
  },
  {
    id: 'runner_002',
    name: 'Maria Gonzalez',
    initials: 'MG',
    email: 'maria@runner.com',
    status: 'ACTIVE' as const,
    completionRate: 1.0,
    totalDispatched: 28,
    totalCompleted: 28,
    currentLat: 39.7815,
    currentLng: -89.6510,
  },
  {
    id: 'runner_003',
    name: 'Chris Park',
    initials: 'CP',
    email: 'chris@runner.com',
    status: 'OFFLINE' as const,
    completionRate: 0.88,
    totalDispatched: 25,
    totalCompleted: 22,
    currentLat: null,
    currentLng: null,
  },
]

// Go Live checklist — computed from event + vendors + fulfillment config
export function computeGoLiveChecklist(
  eventLat: number | null,
  eventLng: number | null,
  vendors: typeof mockAdminVendors,
  config: typeof mockFulfillmentConfig | null
) {
  const hasActiveVendor = vendors.some(v => v.status === 'ACTIVE')
  const hasStripeVendor = vendors.some(v => v.status === 'ACTIVE' && v.stripeVerified)
  const hasFulfillmentMode = config
    ? config.boothPickupEnabled || config.curbsideEnabled || config.homeDeliveryEnabled
    : false
  const hasCoords = eventLat !== null && eventLng !== null

  return {
    hasActiveVendor,
    hasStripeVendor,
    hasFulfillmentMode,
    hasCoords,
    canGoLive: hasActiveVendor && hasStripeVendor && hasFulfillmentMode && hasCoords,
  }
}
