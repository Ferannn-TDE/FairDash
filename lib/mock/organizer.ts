export const mockOrganizerProfile = {
  id: 'org_001',
  name: 'Metro Events LLC',
  contactName: 'Sarah Johnson',
  initials: 'SJ',
  email: 'sarah@metroevents.com',
  phone: '+13145551234',
}

export const mockOrganizerFairs = [
  {
    id: 'fair_001',
    slug: 'springfield-state-fair-2026',
    name: 'Springfield State Fair',
    status: 'active' as const,
    dates: { start: '2026-06-15', end: '2026-06-22' },
    vendorCount: 12,
    maxVendors: 50,
    ordersToday: 147,
    revenueToday: 2841.50,
    accentColor: '#FF0077',
  },
  {
    id: 'fair_002',
    slug: 'stl-food-festival-2026',
    name: 'STL Street Food Festival',
    status: 'upcoming' as const,
    dates: { start: '2026-07-04', end: '2026-07-06' },
    vendorCount: 8,
    maxVendors: 30,
    ordersToday: 0,
    revenueToday: 0,
    accentColor: '#F97316',
  },
]

export const mockVendorsForFair = [
  { id: 'vendor_001', name: "Smoky Joe's BBQ", cuisine: 'BBQ', booth: 'B-12', status: 'active' as const, joinedAt: '2026-05-01', ordersTotal: 234, revenueTotal: 4120, avgPrepTime: 12 },
  { id: 'vendor_002', name: "Elena's Tacos", cuisine: 'Mexican', booth: 'C-04', status: 'active' as const, joinedAt: '2026-05-03', ordersTotal: 312, revenueTotal: 5890, avgPrepTime: 8 },
  { id: 'vendor_003', name: 'Funnel Cake Factory', cuisine: 'Desserts', booth: 'A-01', status: 'active' as const, joinedAt: '2026-05-05', ordersTotal: 189, revenueTotal: 2340, avgPrepTime: 6 },
  { id: 'vendor_004', name: 'Ramen House', cuisine: 'Japanese', booth: 'D-07', status: 'pending' as const, joinedAt: '2026-05-20', ordersTotal: 0, revenueTotal: 0, avgPrepTime: 0 },
  { id: 'vendor_005', name: 'Corn Dog Shack', cuisine: 'American', booth: '', status: 'invited' as const, joinedAt: '', ordersTotal: 0, revenueTotal: 0, avgPrepTime: 0 },
]

export const mockOrdersForFair = [
  {
    id: 'order_001', shortId: '4A7F', customerName: 'Mike R.', status: 'preparing' as const,
    items: [{ id: 'i1', name: 'Pulled Pork Sandwich', quantity: 2 }, { id: 'i2', name: 'Mac & Cheese', quantity: 1 }],
    vendorName: "Smoky Joe's BBQ", booth: 'B-12', total: 31.97, timeAgo: '3 min ago',
  },
  {
    id: 'order_002', shortId: 'B3C1', customerName: 'Jessica L.', status: 'pending' as const,
    items: [{ id: 'i3', name: 'Street Tacos (3)', quantity: 1 }, { id: 'i4', name: 'Horchata', quantity: 2 }],
    vendorName: "Elena's Tacos", booth: 'C-04', total: 19.99, timeAgo: '5 min ago',
  },
  {
    id: 'order_003', shortId: 'D9E2', customerName: 'Tom S.', status: 'ready' as const,
    items: [{ id: 'i5', name: 'S\'mores Funnel Cake', quantity: 1 }],
    vendorName: 'Funnel Cake Factory', booth: 'A-01', total: 10.99, timeAgo: '8 min ago',
  },
  {
    id: 'order_004', shortId: 'F5A8', customerName: 'Amy K.', status: 'completed' as const,
    items: [{ id: 'i6', name: 'Brisket Plate', quantity: 1 }, { id: 'i7', name: 'Sweet Tea', quantity: 1 }],
    vendorName: "Smoky Joe's BBQ", booth: 'B-12', total: 21.99, timeAgo: '15 min ago',
  },
]

export const mockChartData = {
  ordersOverTime: [
    { date: 'Jun 15', orders: 45, revenue: 782 },
    { date: 'Jun 16', orders: 78, revenue: 1340 },
    { date: 'Jun 17', orders: 92, revenue: 1580 },
    { date: 'Jun 18', orders: 67, revenue: 1150 },
    { date: 'Jun 19', orders: 110, revenue: 1890 },
    { date: 'Jun 20', orders: 143, revenue: 2450 },
    { date: 'Jun 21', orders: 147, revenue: 2841 },
  ],
  revenueByVendor: [
    { name: "Smoky Joe's", revenue: 4120 },
    { name: "Elena's Tacos", revenue: 5890 },
    { name: 'Funnel Cake', revenue: 2340 },
  ],
  topItems: [
    { id: '1', name: 'Street Tacos (3)', vendorName: "Elena's Tacos", orderCount: 98 },
    { id: '2', name: 'Brisket Plate', vendorName: "Smoky Joe's BBQ", orderCount: 76 },
    { id: '3', name: 'Birria Quesataco', vendorName: "Elena's Tacos", orderCount: 64 },
    { id: '4', name: 'Pulled Pork Sandwich', vendorName: "Smoky Joe's BBQ", orderCount: 58 },
    { id: '5', name: 'S\'mores Funnel Cake', vendorName: 'Funnel Cake Factory', orderCount: 45 },
  ],
}
