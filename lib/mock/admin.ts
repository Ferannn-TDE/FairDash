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

export type AdminOrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED'
export type AdminFulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

export interface MockAdminOrder {
  id: string
  status: AdminOrderStatus
  fulfillmentType: AdminFulfillmentType
  customerName: string
  vendorName: string
  total: number
  placedAt: string
  items: { name: string; quantity: number }[]
  cancellationReason?: string
}

const now = Date.now()
const mins = (m: number) => new Date(now - m * 60_000).toISOString()

export const mockAdminOrders: MockAdminOrder[] = [
  { id: 'ord_4a7f3c1e', status: 'PREPARING',  fulfillmentType: 'BOOTH_PICKUP',  customerName: 'James O.',   vendorName: "Smoky Joe's BBQ",   total: 42.96, placedAt: mins(7),  items: [{ name: 'Brisket Plate', quantity: 1 }, { name: 'Ribs Half Rack', quantity: 2 }] },
  { id: 'ord_9d3e8a2f', status: 'READY',       fulfillmentType: 'CURBSIDE',      customerName: 'Tomas H.',   vendorName: "Elena's Tacos",     total: 28.97, placedAt: mins(14), items: [{ name: 'BBQ Combo Platter', quantity: 2 }] },
  { id: 'ord_7b2c9f1a', status: 'PLACED',      fulfillmentType: 'BOOTH_PICKUP',  customerName: 'Marcus L.',  vendorName: "Smoky Joe's BBQ",   total: 31.97, placedAt: mins(1),  items: [{ name: 'Pulled Pork Sandwich', quantity: 2 }, { name: 'Mac & Cheese', quantity: 1 }] },
  { id: 'ord_a3d8e2b7', status: 'PLACED',      fulfillmentType: 'CURBSIDE',      customerName: 'Sofia R.',   vendorName: "Smoky Joe's BBQ",   total: 18.99, placedAt: mins(1),  items: [{ name: 'Brisket Plate', quantity: 1 }] },
  { id: 'ord_c9e1f5d3', status: 'ACCEPTED',    fulfillmentType: 'HOME_DELIVERY', customerName: 'Aisha M.',   vendorName: "Smoky Joe's BBQ",   total: 24.98, placedAt: mins(4),  items: [{ name: 'Pulled Pork Sandwich', quantity: 1 }, { name: 'Lemonade', quantity: 1 }] },
  { id: 'ord_1e2a3b4c', status: 'COMPLETED',   fulfillmentType: 'BOOTH_PICKUP',  customerName: 'Riley K.',   vendorName: "Elena's Tacos",     total: 12.99, placedAt: mins(45), items: [{ name: 'Jerk Chicken Tacos', quantity: 1 }] },
  { id: 'ord_5f6g7h8i', status: 'COMPLETED',   fulfillmentType: 'CURBSIDE',      customerName: 'Devon A.',   vendorName: 'Ramen House',       total: 22.98, placedAt: mins(52), items: [{ name: 'Tonkotsu Ramen', quantity: 1 }] },
  { id: 'ord_9j0k1l2m', status: 'COMPLETED',   fulfillmentType: 'BOOTH_PICKUP',  customerName: 'Priya S.',   vendorName: "Smoky Joe's BBQ",   total: 18.99, placedAt: mins(61), items: [{ name: 'Ribs Half Rack', quantity: 1 }] },
  { id: 'ord_3n4o5p6q', status: 'COMPLETED',   fulfillmentType: 'HOME_DELIVERY', customerName: 'Carlos M.',  vendorName: "Elena's Tacos",     total: 31.97, placedAt: mins(78), items: [{ name: 'BBQ Combo Platter', quantity: 2 }] },
  { id: 'ord_2f1a8c9d', status: 'CANCELLED',   fulfillmentType: 'BOOTH_PICKUP',  customerName: 'Sam T.',     vendorName: 'Funnel Cake Factory', total: 12.99, placedAt: mins(30), items: [{ name: 'Funnel Cake', quantity: 1 }], cancellationReason: 'Vendor timeout (2 min)' },
  { id: 'ord_8c4b2e1f', status: 'CANCELLED',   fulfillmentType: 'CURBSIDE',      customerName: 'Jordan P.', vendorName: 'Ramen House',        total: 8.99,  placedAt: mins(25), items: [{ name: 'Gyoza (6pc)', quantity: 1 }], cancellationReason: 'Customer cancelled' },
  { id: 'ord_1e7d3a2b', status: 'REFUNDED',    fulfillmentType: 'HOME_DELIVERY', customerName: 'Taylor W.', vendorName: "Smoky Joe's BBQ",   total: 22.50, placedAt: mins(90), items: [{ name: 'Brisket Sandwich', quantity: 1 }], cancellationReason: 'Runner no-show' },
]

export const mockAdminReportSummary = {
  totalRevenue: 2841.50,
  platformFee: 284.15,
  vendorPayouts: 2557.35,
  totalOrders: 147,
  completedOrders: 138,
  cancelledOrders: 6,
  refundedOrders: 3,
  avgOrderValue: 19.33,
}

export const mockAdminVendorBreakdown = [
  { vendorName: "Smoky Joe's BBQ", orders: 42, revenue: 812.30, payout: 731.07, avgPrepTime: 12, cancellations: 2 },
  { vendorName: "Elena's Tacos",   orders: 58, revenue: 1090.20, payout: 981.18, avgPrepTime: 8, cancellations: 1 },
  { vendorName: 'Funnel Cake Factory', orders: 21, revenue: 387.00, payout: 348.30, avgPrepTime: 6, cancellations: 2 },
  { vendorName: 'Ramen House',     orders: 26, revenue: 552.00, payout: 496.80, avgPrepTime: 14, cancellations: 1 },
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
