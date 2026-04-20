// Mock data for the Vendor Dashboard — mirrors real API response shapes.
// Field names match the Prisma schema so swapping to real data is a one-line import change.

export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'
export type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'

export interface MockOrderItem {
  menuItem: { name: string }
  quantity: number
  unitPrice: number
}

export interface MockVendorOrder {
  id: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  customerName: string
  customerPhone: string
  total: number
  subtotal: number
  orderItems: MockOrderItem[]
  placedAt: string       // ISO string
  estimatedReadyAt: string
  // curbside
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  // delivery
  deliveryStreet?: string
  deliveryCity?: string
}

const now = Date.now()
const mins = (m: number) => new Date(now - m * 60_000).toISOString()

export const mockIncomingOrders: MockVendorOrder[] = [
  {
    id: 'ord_7b2c9f1a',
    status: 'PLACED',
    fulfillmentType: 'BOOTH_PICKUP',
    customerName: 'Marcus L.',
    customerPhone: '+1 312-555-0142',
    total: 31.97,
    subtotal: 31.97,
    placedAt: mins(1),          // placed 1 minute ago → ~60s left in 2-min window
    estimatedReadyAt: mins(-10),
    orderItems: [
      { menuItem: { name: 'Pulled Pork Sandwich' }, quantity: 2, unitPrice: 12.99 },
      { menuItem: { name: 'Mac & Cheese' },         quantity: 1, unitPrice: 5.99  },
    ],
  },
  {
    id: 'ord_a3d8e2b7',
    status: 'PLACED',
    fulfillmentType: 'CURBSIDE',
    customerName: 'Sofia R.',
    customerPhone: '+1 217-555-0188',
    total: 18.99,
    subtotal: 18.99,
    placedAt: mins(0.5),
    estimatedReadyAt: mins(-12),
    vehicleMake: 'Honda',
    vehicleColor: 'Silver',
    vehiclePlate: 'ABC 1234',
    orderItems: [
      { menuItem: { name: 'Brisket Plate' }, quantity: 1, unitPrice: 18.99 },
    ],
  },
]

export const mockActiveOrders: MockVendorOrder[] = [
  {
    id: 'ord_4a7f3c1e',
    status: 'PREPARING',
    fulfillmentType: 'BOOTH_PICKUP',
    customerName: 'James O.',
    customerPhone: '+1 312-555-0199',
    total: 42.96,
    subtotal: 42.96,
    placedAt: mins(7),
    estimatedReadyAt: mins(-8),
    orderItems: [
      { menuItem: { name: 'Brisket Plate' }, quantity: 1, unitPrice: 22.99 },
      { menuItem: { name: 'Ribs Half Rack' }, quantity: 2, unitPrice: 9.99  },
    ],
  },
  {
    id: 'ord_c9e1f5d3',
    status: 'ACCEPTED',
    fulfillmentType: 'HOME_DELIVERY',
    customerName: 'Aisha M.',
    customerPhone: '+1 217-555-0207',
    total: 24.98,
    subtotal: 22.99,
    placedAt: mins(4),
    estimatedReadyAt: mins(-11),
    deliveryStreet: '404 Elm St',
    deliveryCity: 'Springfield, IL',
    orderItems: [
      { menuItem: { name: 'Pulled Pork Sandwich' }, quantity: 1, unitPrice: 12.99 },
      { menuItem: { name: 'Sweet Potato Fries' },   quantity: 1, unitPrice: 6.99  },
      { menuItem: { name: 'Lemonade' },             quantity: 1, unitPrice: 3.00  },
    ],
  },
]

export const mockReadyOrders: MockVendorOrder[] = [
  {
    id: 'ord_9d3e8a2f',
    status: 'READY',
    fulfillmentType: 'CURBSIDE',
    customerName: 'Tomas H.',
    customerPhone: '+1 618-555-0165',
    total: 28.97,
    subtotal: 28.97,
    placedAt: mins(14),
    estimatedReadyAt: mins(2),
    vehicleMake: 'Toyota',
    vehicleColor: 'White',
    vehiclePlate: 'XYZ 5678',
    orderItems: [
      { menuItem: { name: 'BBQ Combo Platter' }, quantity: 2, unitPrice: 14.49 },
    ],
  },
]

export const mockCompletedOrders: MockVendorOrder[] = [
  { id: 'ord_1e2a3b4c', status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP', customerName: 'Riley K.',    customerPhone: '', total: 12.99, subtotal: 12.99, placedAt: mins(45), estimatedReadyAt: mins(30), orderItems: [{ menuItem: { name: 'Pulled Pork Sandwich' }, quantity: 1, unitPrice: 12.99 }] },
  { id: 'ord_5f6g7h8i', status: 'COMPLETED', fulfillmentType: 'CURBSIDE',     customerName: 'Devon A.',   customerPhone: '', total: 22.98, subtotal: 22.98, placedAt: mins(52), estimatedReadyAt: mins(38), orderItems: [{ menuItem: { name: 'Brisket Plate' }, quantity: 1, unitPrice: 22.99 }] },
  { id: 'ord_9j0k1l2m', status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP', customerName: 'Priya S.',   customerPhone: '', total: 18.97, subtotal: 18.97, placedAt: mins(61), estimatedReadyAt: mins(47), orderItems: [{ menuItem: { name: 'Ribs Half Rack' }, quantity: 1, unitPrice: 18.99 }] },
  { id: 'ord_3n4o5p6q', status: 'COMPLETED', fulfillmentType: 'HOME_DELIVERY',customerName: 'Carlos M.',  customerPhone: '', total: 31.97, subtotal: 31.97, placedAt: mins(78), estimatedReadyAt: mins(62), orderItems: [{ menuItem: { name: 'BBQ Combo Platter' }, quantity: 2, unitPrice: 14.49 }] },
]

export const mockVendorStats = {
  todayOrders: 23,
  todayRevenue: 487.50,
  avgPrepTime: 8,        // minutes
  completionRate: 0.96,
  pendingCount: mockIncomingOrders.length,
}

// For the menu manager — categories + items
export const mockMenuCategories = ['Sandwiches', 'Plates', 'Sides', 'Drinks']

export const mockMenuItems = [
  { id: 'item_001', name: 'Pulled Pork Sandwich', description: 'Slow-smoked pulled pork, house slaw, pickles on a brioche bun.', price: 12.99, prepTime: 10, category: 'Sandwiches', imageUrl: '', isAvailable: true,  popular: true },
  { id: 'item_002', name: 'Brisket Sandwich',     description: '12-hour smoked brisket with au jus dipping sauce.',             price: 14.99, prepTime: 12, category: 'Sandwiches', imageUrl: '', isAvailable: true,  popular: false },
  { id: 'item_003', name: 'Brisket Plate',        description: 'Half lb brisket with two sides of your choice.',                price: 22.99, prepTime: 10, category: 'Plates',    imageUrl: '', isAvailable: true,  popular: true },
  { id: 'item_004', name: 'Ribs Half Rack',       description: 'St. Louis-style pork ribs, dry-rubbed and smoked.',             price: 18.99, prepTime: 15, category: 'Plates',    imageUrl: '', isAvailable: true,  popular: false },
  { id: 'item_005', name: 'BBQ Combo Platter',    description: 'Choose any two meats + two sides.',                             price: 28.99, prepTime: 15, category: 'Plates',    imageUrl: '', isAvailable: true,  popular: true },
  { id: 'item_006', name: 'Mac & Cheese',         description: 'House-made four-cheese mac.',                                   price: 5.99,  prepTime: 5,  category: 'Sides',     imageUrl: '', isAvailable: true,  popular: false },
  { id: 'item_007', name: 'Sweet Potato Fries',   description: 'Crispy sweet potato fries with chipotle dipping sauce.',        price: 6.99,  prepTime: 6,  category: 'Sides',     imageUrl: '', isAvailable: true,  popular: false },
  { id: 'item_008', name: 'Coleslaw',             description: 'Classic creamy coleslaw.',                                      price: 3.99,  prepTime: 2,  category: 'Sides',     imageUrl: '', isAvailable: false, popular: false },
  { id: 'item_009', name: 'Lemonade',             description: 'Fresh-squeezed lemonade.',                                      price: 3.00,  prepTime: 2,  category: 'Drinks',    imageUrl: '', isAvailable: true,  popular: false },
  { id: 'item_010', name: 'Sweet Tea',            description: 'Southern-style sweet iced tea.',                                 price: 2.50,  prepTime: 1,  category: 'Drinks',    imageUrl: '', isAvailable: true,  popular: false },
]
