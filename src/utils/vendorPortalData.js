// ─────────────────────────────────────────
//  FairSynq — Vendor Portal Mock Data
//  Replace with real API calls in production
// ─────────────────────────────────────────

export const mockOrders = [
  {
    id: "FD-2847",
    customer: "Sarah M.",
    items: "Corn Dog x2, Lemonade",
    itemCount: 3,
    total: 18.50,
    status: "new",
    time: "2 min ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2846",
    customer: "Jake R.",
    items: "BBQ Pulled Pork, Fries x2",
    itemCount: 3,
    total: 24.00,
    status: "preparing",
    time: "8 min ago",
    payment: "cash",
    note: "Extra sauce please",
  },
  {
    id: "FD-2845",
    customer: "Emily T.",
    items: "Turkey Leg",
    itemCount: 1,
    total: 22.00,
    status: "ready",
    time: "12 min ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2844",
    customer: "Marcus B.",
    items: "Corn Dog x3, Drink x2",
    itemCount: 5,
    total: 41.50,
    status: "delivered",
    time: "25 min ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2843",
    customer: "Lisa K.",
    items: "BBQ Brisket Platter",
    itemCount: 1,
    total: 32.00,
    status: "delivered",
    time: "34 min ago",
    payment: "card",
    note: "No onions",
  },
  {
    id: "FD-2842",
    customer: "David W.",
    items: "Chicken Tenders x2, Fries",
    itemCount: 3,
    total: 29.00,
    status: "delivered",
    time: "47 min ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2841",
    customer: "Nina P.",
    items: "Corn Dog, Funnel Cake",
    itemCount: 2,
    total: 19.50,
    status: "delivered",
    time: "1 hr ago",
    payment: "cash",
    note: "",
  },
  {
    id: "FD-2840",
    customer: "Carlos M.",
    items: "Brisket Sandwich x2",
    itemCount: 2,
    total: 36.00,
    status: "cancelled",
    time: "1.2 hr ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2839",
    customer: "Amy R.",
    items: "Turkey Leg, Drink x2",
    itemCount: 3,
    total: 28.50,
    status: "delivered",
    time: "1.5 hr ago",
    payment: "card",
    note: "",
  },
  {
    id: "FD-2838",
    customer: "Tom H.",
    items: "Corn Dog x4, Large Drink",
    itemCount: 5,
    total: 45.00,
    status: "delivered",
    time: "2 hr ago",
    payment: "card",
    note: "",
  },
];

export const weeklyRevenue = [
  { day: "Mon", revenue: 124.50 },
  { day: "Tue", revenue: 198.00 },
  { day: "Wed", revenue: 87.25 },
  { day: "Thu", revenue: 312.75 },
  { day: "Fri", revenue: 425.00 },
  { day: "Sat", revenue: 847.50 },
  { day: "Sun", revenue: 148.00 },
];

export const vendorStats = {
  todayRevenue: 148.00,
  weekRevenue: 2143.00,
  todayOrders: 4,
  avgOrderValue: 37.00,
  rating: 4.8,
  reviewCount: 126,
  revenueChangePct: 12.4,
  ordersChangeCount: 2,
  pendingOrders: 2,
};

// Status transition map
export const ORDER_NEXT_STATUS = {
  new: "preparing",
  preparing: "ready",
  ready: "delivered",
};

export const ORDER_ACTION_LABEL = {
  new: "Accept",
  preparing: "Mark Ready",
  ready: "Complete",
};
