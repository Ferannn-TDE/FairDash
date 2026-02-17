/**
 * Vendor and menu item data extracted from Italian Fest screenshots.
 *
 * Data structure is designed for easy migration to a database:
 *   - All IDs are stable kebab-case strings
 *   - Items reference their vendor via vendorId
 *   - Prices support both single values and ranges (priceMin/priceMax)
 *   - Each item has a unique numeric id for cart compatibility
 */

// ─── Vendor Categories ───
export const vendorCategories = [
  { id: 'all', name: 'All Vendors', emoji: '🏪' },
  { id: 'italian', name: 'Italian', emoji: '🍝' },
  { id: 'bbq', name: 'BBQ & Grilled', emoji: '🍖' },
  { id: 'desserts', name: 'Desserts & Sweets', emoji: '🍰' },
  { id: 'drinks', name: 'Drinks & Ice', emoji: '🧊' },
  { id: 'fair-food', name: 'Fair Food', emoji: '🎪' },
  { id: 'specialty', name: 'Specialty', emoji: '✨' },
  { id: 'merchandise', name: 'Merchandise', emoji: '👕' },
  { id: 'community', name: 'Community', emoji: '🤝' },
];

// ─── Vendors ───
export const vendors = [
  {
    id: 'all-pro-tees',
    name: 'ALL PRO TEES',
    category: 'merchandise',
    description: 'Official Italian Fest merchandise and custom apparel.',
    rating: 4.8,
    deliveryTime: '10-15 min',
    priceRange: '$',
    emoji: '👕',
  },
  {
    id: 'randys-bbq',
    name: "RANDY'S HOUSE OF BBQ",
    category: 'bbq',
    description: 'Authentic smoked BBQ and bold flavors from the pit.',
    rating: 4.9,
    deliveryTime: '20-30 min',
    priceRange: '$$',
    emoji: '🍖',
  },
  {
    id: 'ss-peter-paul',
    name: 'SS. PETER & PAUL',
    category: 'italian',
    description: 'Traditional Italian recipes from the Hill. Bagna Cauda, sausage, spiedini, and more.',
    rating: 4.9,
    deliveryTime: '20-30 min',
    priceRange: '$$',
    emoji: '🇮🇹',
  },
  {
    id: 'gelu',
    name: 'GELU',
    category: 'drinks',
    description: 'Refreshing Italian ice in a rainbow of flavors.',
    rating: 4.7,
    deliveryTime: '5-10 min',
    priceRange: '$',
    emoji: '🍧',
  },
  {
    id: 'mommas-house',
    name: "MOMMA'S HOUSE",
    category: 'italian',
    description: "Home-style Italian cooking — sandwiches, pasta, and Momma's specials.",
    rating: 4.8,
    deliveryTime: '15-25 min',
    priceRange: '$$',
    emoji: '🏠',
  },
  {
    id: 'heritage-sports',
    name: 'HERITAGE SPORTS BAR & GRILL',
    category: 'bbq',
    description: 'Loaded quesadillas, lobster mac, and grill favorites.',
    rating: 4.7,
    deliveryTime: '20-30 min',
    priceRange: '$$',
    emoji: '🏈',
  },
  {
    id: 'collinsville-wrestling',
    name: 'COLLINSVILLE WRESTLING CLUB',
    category: 'fair-food',
    description: 'Deep-fried fair food classics — funnel cakes, fried pickles, and more.',
    rating: 4.6,
    deliveryTime: '15-20 min',
    priceRange: '$',
    emoji: '🤼',
  },
  {
    id: 'cmc-rotary',
    name: 'CMC ROTARY',
    category: 'community',
    description: 'Community booth supporting local Rotary initiatives.',
    rating: 4.5,
    deliveryTime: '5 min',
    priceRange: '$',
    emoji: '⚙️',
  },
  {
    id: 'lomonaco-italian',
    name: 'LOMONACO ITALIAN FOOD',
    category: 'italian',
    description: 'Classic Italian desserts and comfort food from the Lomonaco family.',
    rating: 4.8,
    deliveryTime: '15-20 min',
    priceRange: '$',
    emoji: '🍝',
  },
  {
    id: 'collinsville-junior-service',
    name: 'COLLINSVILLE JUNIOR SERVICE CLUB',
    category: 'community',
    description: 'Supporting youth programs in the Collinsville community.',
    rating: 4.5,
    deliveryTime: '10-15 min',
    priceRange: '$',
    emoji: '🌟',
  },
  {
    id: 'olivias-olive-oil',
    name: "OLIVIA'S OLIVE OIL",
    category: 'specialty',
    description: 'Premium extra virgin olive oil — take a bottle home from the fest.',
    rating: 4.9,
    deliveryTime: '5 min',
    priceRange: '$$$',
    emoji: '🫒',
  },
  {
    id: 'renas-dance',
    name: "RENA'S DANCE UNLIMITED",
    category: 'community',
    description: 'Dance studio booth supporting performing arts in the community.',
    rating: 4.5,
    deliveryTime: '10 min',
    priceRange: '$',
    emoji: '💃',
  },
  {
    id: 'knights-of-columbus',
    name: 'KNIGHTS OF COLUMBUS LADIES AUX',
    category: 'italian',
    description: 'Home-baked Italian treats from the Knights of Columbus Ladies Auxiliary.',
    rating: 4.7,
    deliveryTime: '10-15 min',
    priceRange: '$',
    emoji: '⚜️',
  },
  {
    id: 'collinsville-shrine',
    name: 'COLLINSVILLE SHRINE CLUB',
    category: 'community',
    description: 'Shrine Club booth supporting charitable causes.',
    rating: 4.5,
    deliveryTime: '10-15 min',
    priceRange: '$',
    emoji: '🏛️',
  },
  {
    id: 'collinsville-charities',
    name: 'COLLINSVILLE CHARITIES FOR CHILDREN',
    category: 'community',
    description: "Raising funds for children's programs in the Collinsville area.",
    rating: 4.6,
    deliveryTime: '10 min',
    priceRange: '$',
    emoji: '🧒',
  },
  {
    id: 'nothing-bundt-cakes',
    name: 'NOTHING BUNDT CAKES',
    category: 'desserts',
    description: 'Individually sized Bundtlet cakes — moist, delicious, and beautifully decorated.',
    rating: 4.8,
    deliveryTime: '5-10 min',
    priceRange: '$',
    emoji: '🎂',
  },
  {
    id: 'tivanov-catering',
    name: 'TIVANOV CATERING CO',
    category: 'italian',
    description: 'Catered Italian dishes with a modern twist.',
    rating: 4.7,
    deliveryTime: '15-25 min',
    priceRange: '$$',
    emoji: '👨‍🍳',
  },
];

// ─── Menu Items ───
// Each item has a globally unique numeric id for cart compatibility.
// Items with a price range use priceMin + priceMax; single-price items use price.
export const vendorItems = [
  // ── ALL PRO TEES ──
  {
    id: 101,
    vendorId: 'all-pro-tees',
    name: 'T Shirts',
    description: 'Price is for one shirt.',
    price: 20.00,
    emoji: '👕',
    category: 'merchandise',
    tags: ['Apparel', 'Merch'],
  },

  // ── RANDY'S HOUSE OF BBQ ──
  {
    id: 201,
    vendorId: 'randys-bbq',
    name: 'Nachos',
    description: 'Loaded BBQ nachos piled high.',
    price: 14.00,
    emoji: '🌮',
    category: 'bbq',
    popular: true,
    tags: ['Loaded', 'Shareable'],
  },
  {
    id: 202,
    vendorId: 'randys-bbq',
    name: 'Jerk Chicken Tacos',
    description: 'Tacos with bold jerk-seasoned chicken.',
    price: 15.00,
    emoji: '🌮',
    category: 'bbq',
    popular: true,
    tags: ['Spicy', 'Chicken'],
  },
  {
    id: 203,
    vendorId: 'randys-bbq',
    name: 'Fries',
    description: 'Classic golden fries.',
    price: 8.00,
    emoji: '🍟',
    image: '/images/French fries.jpg',
    category: 'bbq',
    tags: ['Side', 'Classic'],
  },
  {
    id: 204,
    vendorId: 'randys-bbq',
    name: 'Bloomin Onions',
    description: 'Served with dip.',
    price: 12.00,
    emoji: '🧅',
    category: 'bbq',
    tags: ['Fried', 'Shareable'],
  },

  // ── SS. PETER & PAUL ──
  {
    id: 301,
    vendorId: 'ss-peter-paul',
    name: 'Bagna Cauda',
    description: 'Served with Cabbage and Fresh Bread from the Hill.',
    priceMin: 10.00,
    priceMax: 50.00,
    price: 10.00,
    emoji: '🫕',
    category: 'italian',
    popular: true,
    tags: ['Traditional', 'Shareable'],
  },
  {
    id: 302,
    vendorId: 'ss-peter-paul',
    name: 'Original Recipe Bagna Cauda',
    description: 'The original family recipe.',
    price: 6.00,
    emoji: '🫕',
    category: 'italian',
    tags: ['Traditional', 'Classic'],
  },
  {
    id: 303,
    vendorId: 'ss-peter-paul',
    name: 'Spaghetti',
    description: 'Classic Italian spaghetti with red sauce.',
    price: 10.00,
    emoji: '🍝',
    category: 'italian',
    tags: ['Pasta', 'Classic'],
  },
  {
    id: 304,
    vendorId: 'ss-peter-paul',
    name: 'Italian Beef Sandwich',
    description: 'Slow-roasted Italian beef on a fresh roll.',
    price: 10.00,
    emoji: '🥖',
    image: '/images/beef.jpeg',
    category: 'italian',
    popular: true,
    tags: ['Sandwich', 'Beef'],
  },
  {
    id: 305,
    vendorId: 'ss-peter-paul',
    name: 'Mini Meatball Sub',
    description: 'Mini sub loaded with meatballs and sauce.',
    price: 8.00,
    emoji: '🥪',
    category: 'italian',
    tags: ['Sandwich', 'Meatball'],
  },
  {
    id: 306,
    vendorId: 'ss-peter-paul',
    name: 'Authentic Italian Sausage',
    description: 'Sausage on an Italian roll with peppers, onions and house made giardiniera (fully optional).',
    price: 8.00,
    emoji: '🌭',
    category: 'italian',
    popular: true,
    tags: ['Sausage', 'Traditional'],
  },
  {
    id: 307,
    vendorId: 'ss-peter-paul',
    name: 'Chicken Spiedini',
    description: 'Served with an Italian crested white bread. Bread comes from the bakeries on the Hill.',
    price: 10.00,
    emoji: '🍢',
    category: 'italian',
    tags: ['Chicken', 'Traditional'],
  },
  {
    id: 308,
    vendorId: 'ss-peter-paul',
    name: 'Italian Beef Sub',
    description: 'Hearty Italian beef sub on fresh bread.',
    price: 10.00,
    emoji: '🥖',
    image: '/images/l-intro-1611429687.jpg',
    category: 'italian',
    tags: ['Sandwich', 'Beef'],
  },
  {
    id: 309,
    vendorId: 'ss-peter-paul',
    name: 'Garlic Bread',
    description: 'Buttery garlic bread, toasted to perfection.',
    price: 2.00,
    emoji: '🍞',
    image: '/images/IMG_9409.jpg',
    category: 'italian',
    tags: ['Side', 'Bread'],
  },

  // ── GELU ──
  {
    id: 401,
    vendorId: 'gelu',
    name: 'Italian Ice',
    description: 'Refreshing Italian ice in assorted flavors.',
    priceMin: 4.00,
    priceMax: 8.00,
    price: 4.00,
    emoji: '🍧',
    category: 'drinks',
    popular: true,
    tags: ['Cold', 'Refreshing'],
  },

  // ── MOMMA'S HOUSE ──
  {
    id: 501,
    vendorId: 'mommas-house',
    name: 'Caprese Chicken Sandwich',
    description: 'Marinated Grilled Chicken breast on Ciabatta Roll, Fresh Mozzarella, Tomato, and more.',
    priceMin: 9.00,
    priceMax: 13.00,
    price: 9.00,
    emoji: '🥪',
    category: 'italian',
    popular: true,
    tags: ['Sandwich', 'Chicken', 'Caprese'],
  },
  {
    id: 502,
    vendorId: 'mommas-house',
    name: 'Bowl Of Pesto Pasta Salad',
    description: 'Rotini pasta tossed in basil pesto with cherry tomatoes and fresh Mozzarella.',
    price: 5.00,
    emoji: '🥗',
    category: 'italian',
    tags: ['Pasta', 'Pesto', 'Fresh'],
  },
  {
    id: 503,
    vendorId: 'mommas-house',
    name: 'Vegan Spaghetti',
    description: 'Plant-based spaghetti with marinara sauce.',
    price: 10.00,
    emoji: '🍝',
    category: 'italian',
    tags: ['Vegan', 'Pasta'],
  },

  // ── HERITAGE SPORTS BAR & GRILL ──
  {
    id: 601,
    vendorId: 'heritage-sports',
    name: 'Lobster Mac & Cheese',
    description: 'Creamy mac and cheese loaded with lobster.',
    price: 12.00,
    emoji: '🦞',
    image: '/images/504938790_1142349184601081_8111003270971009958_n.jpg',
    category: 'bbq',
    popular: true,
    tags: ['Seafood', 'Mac & Cheese'],
  },
  {
    id: 602,
    vendorId: 'heritage-sports',
    name: 'Italian Sausage Quesadilla',
    description: 'Crispy quesadilla stuffed with Italian sausage and cheese.',
    price: 16.00,
    emoji: '🫓',
    category: 'bbq',
    tags: ['Quesadilla', 'Sausage'],
  },
  {
    id: 603,
    vendorId: 'heritage-sports',
    name: 'Grilled Eggplant Quesadilla',
    description: 'Grilled eggplant and melted cheese in a crispy tortilla.',
    price: 16.00,
    emoji: '🍆',
    category: 'bbq',
    tags: ['Quesadilla', 'Vegetarian'],
  },
  {
    id: 604,
    vendorId: 'heritage-sports',
    name: 'BBQ Chicken Quesadilla',
    description: 'BBQ chicken with cheese in a grilled tortilla.',
    price: 16.00,
    emoji: '🍗',
    category: 'bbq',
    tags: ['Quesadilla', 'BBQ', 'Chicken'],
  },
  {
    id: 605,
    vendorId: 'heritage-sports',
    name: 'Cheeseburger Quesadilla',
    description: 'All the flavors of a cheeseburger in a crispy quesadilla.',
    price: 16.00,
    emoji: '🍔',
    category: 'bbq',
    popular: true,
    tags: ['Quesadilla', 'Burger'],
  },

  // ── COLLINSVILLE WRESTLING CLUB ──
  {
    id: 701,
    vendorId: 'collinsville-wrestling',
    name: 'Funnel Cake',
    description: 'With Powdered Sugar.',
    price: 6.00,
    emoji: '🎡',
    image: '/images/IMG_3271.jpg',
    category: 'fair-food',
    popular: true,
    tags: ['Sweet', 'Fried', 'Classic'],
  },
  {
    id: 702,
    vendorId: 'collinsville-wrestling',
    name: 'Fried Pickles',
    description: 'Served with a cup of Ranch.',
    price: 6.00,
    emoji: '🥒',
    category: 'fair-food',
    tags: ['Fried', 'Tangy'],
  },
  {
    id: 703,
    vendorId: 'collinsville-wrestling',
    name: 'Fried Jalapeno Slices',
    description: 'Served with a Cup of Ranch.',
    price: 6.00,
    emoji: '🌶️',
    category: 'fair-food',
    tags: ['Fried', 'Spicy'],
  },
  {
    id: 704,
    vendorId: 'collinsville-wrestling',
    name: 'Deep Fried PB&J',
    description: 'The classic sandwich, battered and deep fried.',
    price: 6.00,
    emoji: '🥜',
    category: 'fair-food',
    tags: ['Fried', 'Sweet', 'Savory'],
  },

  // ── CMC ROTARY ──
  {
    id: 801,
    vendorId: 'cmc-rotary',
    name: 'Bottled Water',
    description: 'Ice cold bottled water.',
    price: 2.00,
    emoji: '💧',
    category: 'drinks',
    tags: ['Water', 'Cold'],
  },

  // ── LOMONACO ITALIAN FOOD ──
  {
    id: 901,
    vendorId: 'lomonaco-italian',
    name: 'Gooey Butter Cakes',
    description: 'A St. Louis classic — rich, buttery, and gooey.',
    price: 6.00,
    emoji: '🧈',
    category: 'desserts',
    popular: true,
    tags: ['Sweet', 'St. Louis'],
  },
  {
    id: 902,
    vendorId: 'lomonaco-italian',
    name: 'Cannoli',
    description: 'Cannoli with Mini Chocolate Chips.',
    price: 5.00,
    emoji: '🥐',
    category: 'desserts',
    popular: true,
    tags: ['Italian', 'Pastry'],
  },
  {
    id: 903,
    vendorId: 'lomonaco-italian',
    name: 'Cheese Cake',
    description: 'Per Slice.',
    price: 7.00,
    emoji: '🍰',
    category: 'desserts',
    tags: ['Cake', 'Slice'],
  },

  // ── OLIVIA'S OLIVE OIL ──
  {
    id: 1001,
    vendorId: 'olivias-olive-oil',
    name: 'Extra Virgin Olive Oil',
    description: 'Sold per Bottle. Premium quality.',
    price: 25.00,
    emoji: '🫒',
    category: 'specialty',
    tags: ['Premium', 'Take Home'],
  },

  // ── NOTHING BUNDT CAKES ──
  {
    id: 1101,
    vendorId: 'nothing-bundt-cakes',
    name: 'Bundtlet Cakes',
    description: 'Individual Bundtlet — moist and beautifully decorated.',
    price: 6.00,
    emoji: '🎂',
    category: 'desserts',
    popular: true,
    tags: ['Cake', 'Individual'],
  },
];

// ─── Helper Functions ───

export const getVendorById = (vendorId) => {
  return vendors.find((v) => v.id === vendorId);
};

export const getVendorsByCategory = (categoryId) => {
  if (categoryId === 'all') return vendors;
  return vendors.filter((v) => v.category === categoryId);
};

export const getItemsByVendor = (vendorId) => {
  return vendorItems.filter((item) => item.vendorId === vendorId);
};

export const getItemCountByVendor = (vendorId) => {
  return vendorItems.filter((item) => item.vendorId === vendorId).length;
};

export const getAllItems = () => vendorItems;

export const getPopularItems = () => {
  return vendorItems.filter((item) => item.popular);
};

export const searchVendorItems = (query) => {
  const q = query.toLowerCase();
  return vendorItems.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.tags && item.tags.some((tag) => tag.toLowerCase().includes(q)))
  );
};

export const searchVendors = (query) => {
  const q = query.toLowerCase();
  return vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q)
  );
};

export const formatPrice = (item) => {
  if (item.priceMin != null && item.priceMax != null) {
    return `$${item.priceMin.toFixed(2)} - $${item.priceMax.toFixed(2)}`;
  }
  return `$${item.price.toFixed(2)}`;
};
