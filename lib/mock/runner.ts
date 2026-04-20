// Mock data for the Runner experience — mirrors real API response shapes.

export type RunnerStatus = 'OFFLINE' | 'ACTIVE' | 'ON_DELIVERY'
export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

export interface MockRunnerVendorStop {
  vendorId: string
  vendorName: string
  boothNumber: string
  items: { name: string; quantity: number }[]
  collected: boolean
}

export interface MockDeliveryOrder {
  id: string
  fulfillmentType: FulfillmentType
  customerName: string
  customerPhone: string
  total: number
  deliveryFee: number
  // curbside
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  curbsideZone?: string
  // home delivery
  deliveryStreet?: string
  deliveryCity?: string
  deliveryZip?: string
  // multi-vendor stops
  vendorStops: MockRunnerVendorStop[]
}

export interface MockEarningEntry {
  orderId: string
  completedAt: string
  fulfillmentType: FulfillmentType
  vendorName: string
  basePay: number
  tip: number
  distanceMi: number
}

// Active delivery request shown on runner dashboard
export const mockDeliveryRequest: MockDeliveryOrder = {
  id: 'ord_4a7f3c1e',
  fulfillmentType: 'CURBSIDE',
  customerName: 'Tomas H.',
  customerPhone: '+1 618-555-0165',
  total: 46.96,
  deliveryFee: 4.00,
  vehicleMake: 'Toyota',
  vehicleColor: 'White',
  vehiclePlate: 'XYZ 5678',
  curbsideZone: 'Lot B, Row 3',
  vendorStops: [
    {
      vendorId: 'vendor_001',
      vendorName: "Smoky Joe's BBQ",
      boothNumber: 'B-12',
      items: [
        { name: 'Pulled Pork Sandwich', quantity: 2 },
        { name: 'Mac & Cheese', quantity: 1 },
      ],
      collected: false,
    },
    {
      vendorId: 'vendor_002',
      vendorName: "Elena's Tacos",
      boothNumber: 'C-04',
      items: [
        { name: 'Jerk Chicken Tacos', quantity: 1 },
      ],
      collected: false,
    },
  ],
}

// Active home delivery (alternate scenario)
export const mockHomeDelivery: MockDeliveryOrder = {
  id: 'ord_h9d3c7b1',
  fulfillmentType: 'HOME_DELIVERY',
  customerName: 'Priya S.',
  customerPhone: '+1 217-555-0207',
  total: 38.98,
  deliveryFee: 5.99,
  deliveryStreet: '404 Elm St',
  deliveryCity: 'Springfield',
  deliveryZip: '62701',
  vendorStops: [
    {
      vendorId: 'vendor_003',
      vendorName: 'Ramen House',
      boothNumber: 'D-07',
      items: [
        { name: 'Tonkotsu Ramen', quantity: 2 },
        { name: 'Gyoza (6pc)', quantity: 1 },
      ],
      collected: false,
    },
  ],
}

// Runner stats shown on dashboard
export const mockRunnerStats = {
  deliveriesToday: 7,
  earningsToday: 42.50,
  completionRate: 0.97,
  status: 'ACTIVE' as RunnerStatus,
  eventName: 'Springfield State Fair',
  fairSlug: 'springfield-state-fair-2026',
}

// Recent deliveries shown on dashboard
export const mockRecentDeliveries: MockEarningEntry[] = [
  { orderId: 'ord_9d3e8a2f', completedAt: '2:15 PM', fulfillmentType: 'CURBSIDE',      vendorName: "Smoky Joe's BBQ", basePay: 4.00, tip: 2.50, distanceMi: 0.3 },
  { orderId: 'ord_1e2a3b4c', completedAt: '1:48 PM', fulfillmentType: 'HOME_DELIVERY', vendorName: "Elena's Tacos",   basePay: 5.99, tip: 0,    distanceMi: 1.2 },
  { orderId: 'ord_5f6g7h8i', completedAt: '1:22 PM', fulfillmentType: 'CURBSIDE',      vendorName: 'Ramen House',     basePay: 4.00, tip: 1.50, distanceMi: 0.2 },
  { orderId: 'ord_9j0k1l2m', completedAt: '12:58 PM',fulfillmentType: 'HOME_DELIVERY', vendorName: "Smoky Joe's BBQ", basePay: 5.99, tip: 3.00, distanceMi: 0.9 },
  { orderId: 'ord_3n4o5p6q', completedAt: '12:33 PM',fulfillmentType: 'CURBSIDE',      vendorName: "Elena's Tacos",   basePay: 4.00, tip: 1.00, distanceMi: 0.4 },
  { orderId: 'ord_7b2c9f1a', completedAt: '12:11 PM',fulfillmentType: 'HOME_DELIVERY', vendorName: 'Ramen House',     basePay: 5.99, tip: 2.00, distanceMi: 1.5 },
  { orderId: 'ord_c9e1f5d3', completedAt: '11:45 AM',fulfillmentType: 'CURBSIDE',      vendorName: "Smoky Joe's BBQ", basePay: 4.00, tip: 0,    distanceMi: 0.3 },
]

// Weekly earnings for the bar chart
export const mockWeeklyEarnings = [
  { day: 'Mon', deliveries: 4,  earnings: 24.50 },
  { day: 'Tue', deliveries: 6,  earnings: 38.00 },
  { day: 'Wed', deliveries: 5,  earnings: 31.25 },
  { day: 'Thu', deliveries: 8,  earnings: 52.00 },
  { day: 'Fri', deliveries: 11, earnings: 71.50 },
  { day: 'Sat', deliveries: 9,  earnings: 58.75 },
  { day: 'Sun', deliveries: 7,  earnings: 42.50 },
]
