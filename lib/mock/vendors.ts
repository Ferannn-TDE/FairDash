// ─── Types ────────────────────────────────────────────────────────────────────

export interface MenuItemSize {
  name: string
  price: number
}

export interface MenuItem {
  id: string
  name: string
  description?: string
  price: number       // USD
  category: string
  imageUrl?: string
  prepTime?: number   // minutes
  popular?: boolean
  available: boolean
  sizes?: MenuItemSize[]  // optional — when present, user must choose a size
}

export interface MockVendor {
  id: string
  slug: string
  fairId: string
  name: string
  boothNumber?: string
  cuisineType: string
  description?: string
  imageUrl?: string
  logoUrl?: string
  rating?: number
  reviewCount?: number
  prepTimeMin?: number  // average prep time in minutes
  isBusy?: boolean
  menu: MenuItem[]
}

// ─── Springfield State Fair vendors ──────────────────────────────────────────

const springfieldVendors: MockVendor[] = [
  {
    id: 'v_ssf_001',
    slug: 'smoky-joes-bbq',
    fairId: 'fair_001',
    name: "Smoky Joe's BBQ",
    boothNumber: 'B-12',
    cuisineType: 'BBQ',
    description: 'Slow-smoked meats and classic sides. A fair favorite since 1998.',
    rating: 4.8,
    reviewCount: 312,
    prepTimeMin: 12,
    menu: [
      { id: 'mi_001', name: 'Pulled Pork Sandwich', description: 'Slow-smoked pulled pork on a brioche bun with house slaw', price: 12.99, category: 'Sandwiches', prepTime: 10, popular: true, available: true },
      { id: 'mi_002', name: 'Brisket Plate', description: 'Half-pound of sliced brisket with two sides', price: 18.99, category: 'Plates', prepTime: 15, popular: true, available: true },
      { id: 'mi_003', name: 'Smoked Ribs (Half Rack)', description: '6 St. Louis-style ribs, dry rubbed and smoked 6 hours', price: 22.99, category: 'Plates', prepTime: 10, available: true },
      { id: 'mi_004', name: 'Mac & Cheese', description: 'Creamy four-cheese mac', price: 5.99, category: 'Sides', prepTime: 5, available: true },
      { id: 'mi_005', name: 'Baked Beans', description: 'Slow-cooked with smoked pork', price: 4.99, category: 'Sides', prepTime: 3, available: true },
      { id: 'mi_006', name: 'Sweet Tea', description: 'Fresh-brewed Southern-style', price: 3.00, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_ssf_002',
    slug: 'elenas-tacos',
    fairId: 'fair_001',
    name: "Elena's Tacos",
    boothNumber: 'C-04',
    cuisineType: 'Mexican',
    description: 'Authentic family recipes from Oaxaca. Best tacos at the fair!',
    rating: 4.9,
    reviewCount: 480,
    prepTimeMin: 8,
    menu: [
      { id: 'mi_010', name: 'Street Tacos (3)', description: 'Choice of carne asada, al pastor, or pollo. Topped with onion & cilantro.', price: 11.99, category: 'Tacos', prepTime: 8, popular: true, available: true },
      { id: 'mi_011', name: 'Birria Quesataco', description: 'Consommé-dipped tortilla with melted cheese and braised birria beef', price: 9.99, category: 'Tacos', prepTime: 10, popular: true, available: true },
      { id: 'mi_012', name: 'Elote (Corn on the Cob)', description: 'Mexican street corn with crema, cotija, and chili powder', price: 6.99, category: 'Snacks', prepTime: 5, available: true },
      { id: 'mi_013', name: 'Loaded Nachos', description: 'Tortilla chips with beans, cheese, jalapeños, sour cream, and guac', price: 10.99, category: 'Snacks', prepTime: 7, available: true },
      { id: 'mi_014', name: 'Horchata', description: 'House-made rice milk with cinnamon', price: 4.00, category: 'Drinks', prepTime: 1, available: true },
      { id: 'mi_015', name: 'Agua Fresca', description: 'Seasonal fruit water — ask about today\'s flavor', price: 3.50, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_ssf_003',
    slug: 'funnel-cake-factory',
    fairId: 'fair_001',
    name: 'Funnel Cake Factory',
    boothNumber: 'A-01',
    cuisineType: 'Desserts',
    description: 'Classic fair desserts with a modern twist. 15+ toppings!',
    rating: 4.7,
    reviewCount: 256,
    prepTimeMin: 6,
    menu: [
      { id: 'mi_020', name: 'Classic Funnel Cake', description: 'Golden fried dough with powdered sugar', price: 7.99, category: 'Funnel Cakes', prepTime: 6, popular: true, available: true },
      { id: 'mi_021', name: 'Strawberry Dream', description: 'Funnel cake with fresh strawberries and whipped cream', price: 9.99, category: 'Funnel Cakes', prepTime: 7, popular: true, available: true },
      { id: 'mi_022', name: 'S\'mores Funnel Cake', description: 'Funnel cake with Nutella, toasted marshmallow, and graham cracker crumbs', price: 10.99, category: 'Funnel Cakes', prepTime: 7, available: true },
      { id: 'mi_023', name: 'Fried Oreos (6)', description: 'Battered and deep-fried Oreo cookies with powdered sugar', price: 8.99, category: 'Fried Treats', prepTime: 6, available: true },
      { id: 'mi_024', name: 'Lemonade Shake-Up', description: 'Hand-squeezed fresh lemonade with your choice of flavor', price: 5.99, category: 'Drinks', prepTime: 3, available: true },
    ],
  },
]

// ─── STL Street Food Festival vendors ────────────────────────────────────────

const stlVendors: MockVendor[] = [
  {
    id: 'v_stl_001',
    slug: 'ramen-underground',
    fairId: 'fair_002',
    name: 'Ramen Underground',
    boothNumber: '1',
    cuisineType: 'Japanese',
    description: 'Tokyo-style tonkotsu ramen and Japanese street snacks.',
    rating: 4.9,
    reviewCount: 198,
    prepTimeMin: 10,
    menu: [
      { id: 'mi_030', name: 'Tonkotsu Ramen', description: 'Rich pork bone broth, chashu pork, soft egg, nori, green onion', price: 15.99, category: 'Ramen', prepTime: 12, popular: true, available: true },
      { id: 'mi_031', name: 'Spicy Miso Ramen', description: 'Fermented miso broth with ground pork, corn, and butter', price: 14.99, category: 'Ramen', prepTime: 12, available: true },
      { id: 'mi_032', name: 'Takoyaki (6 pcs)', description: 'Octopus balls with bonito flakes, mayo, and okonomiyaki sauce', price: 9.99, category: 'Snacks', prepTime: 8, popular: true, available: true },
      { id: 'mi_033', name: 'Gyoza (6 pcs)', description: 'Pan-fried pork and cabbage dumplings', price: 8.99, category: 'Snacks', prepTime: 8, available: true },
      { id: 'mi_034', name: 'Ramune Soda', description: 'Japanese marble soda — Lychee, Melon, or Original', price: 4.99, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_stl_002',
    slug: 'cajun-queen',
    fairId: 'fair_002',
    name: 'Cajun Queen',
    boothNumber: '2',
    cuisineType: 'Cajun / Creole',
    description: 'Straight from the bayou to St. Louis. Authentic Louisiana cooking.',
    rating: 4.7,
    reviewCount: 143,
    prepTimeMin: 12,
    menu: [
      { id: 'mi_040', name: 'Crawfish Étouffée', description: 'Cajun-spiced crawfish tails in a rich butter sauce over rice', price: 16.99, category: 'Mains', prepTime: 10, popular: true, available: true },
      { id: 'mi_041', name: 'Shrimp Po\'Boy', description: 'Crispy fried shrimp on French bread with remoulade and lettuce', price: 13.99, category: 'Sandwiches', prepTime: 10, popular: true, available: true },
      { id: 'mi_042', name: 'Gumbo (Bowl)', description: 'Dark roux gumbo with chicken, andouille, and okra', price: 11.99, category: 'Mains', prepTime: 5, available: true },
      { id: 'mi_043', name: 'Beignets (4 pcs)', description: 'New Orleans-style fried dough with powdered sugar', price: 7.99, category: 'Desserts', prepTime: 8, available: true },
      { id: 'mi_044', name: 'Sweet Tea', description: 'Southern sweet tea', price: 3.00, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
]

// ─── Edwardsville Night Market vendors ───────────────────────────────────────

const edwardsvilleVendors: MockVendor[] = [
  {
    id: 'v_enm_001',
    slug: 'bao-haus',
    fairId: 'fair_004',
    name: 'Bao Haus',
    boothNumber: '3',
    cuisineType: 'Asian Fusion',
    description: 'Taiwanese steamed buns and bubble tea with a modern spin.',
    rating: 4.8,
    reviewCount: 89,
    prepTimeMin: 9,
    menu: [
      { id: 'mi_050', name: 'Pork Belly Bao (2)', description: 'Fluffy steamed buns with braised pork belly, pickled daikon, and hoisin', price: 10.99, category: 'Bao Buns', prepTime: 8, popular: true, available: true },
      { id: 'mi_051', name: 'Crispy Chicken Bao (2)', description: 'Fried chicken thigh with spicy aioli and cucumber', price: 10.99, category: 'Bao Buns', prepTime: 9, available: true },
      { id: 'mi_052', name: 'Mushroom & Tofu Bao (2)', description: 'Shiitake mushroom and fried tofu with scallion oil — vegan', price: 9.99, category: 'Bao Buns', prepTime: 8, available: true },
      { id: 'mi_053', name: 'Brown Sugar Bubble Tea', description: 'Tiger milk tea with tapioca pearls and brown sugar syrup', price: 6.99, category: 'Drinks', prepTime: 4, popular: true, available: true },
      { id: 'mi_054', name: 'Taro Milk Tea', description: 'Creamy purple taro with oat milk and pearls', price: 6.99, category: 'Drinks', prepTime: 4, available: true },
    ],
  },
  {
    id: 'v_enm_002',
    slug: 'woodfire-pizza-co',
    fairId: 'fair_004',
    name: 'Woodfire Pizza Co.',
    boothNumber: '5',
    cuisineType: 'Pizza',
    description: 'Neapolitan-style pizzas baked in a portable wood-fired oven.',
    rating: 4.6,
    reviewCount: 74,
    prepTimeMin: 10,
    menu: [
      { id: 'mi_060', name: 'Margherita', description: 'San Marzano tomato, fresh mozzarella, basil, olive oil', price: 13.99, category: 'Pizzas', prepTime: 10, popular: true, available: true },
      { id: 'mi_061', name: 'Spicy Calabrese', description: 'Tomato, fior di latte, spicy salami, chili oil', price: 15.99, category: 'Pizzas', prepTime: 10, popular: true, available: true },
      { id: 'mi_062', name: 'Truffle Mushroom', description: 'White base, mixed mushrooms, truffle oil, and parmesan', price: 16.99, category: 'Pizzas', prepTime: 12, available: true },
      { id: 'mi_063', name: 'Tiramisu Cup', description: 'Individual tiramisu with espresso-soaked ladyfingers', price: 6.99, category: 'Desserts', prepTime: 2, available: true },
      { id: 'mi_064', name: 'San Pellegrino', description: 'Sparkling water or blood orange', price: 3.50, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
]

// ─── Columbus Taste Fest vendors (completed fair — included for completeness) ─

const columbusVendors: MockVendor[] = [
  {
    id: 'v_ctf_001',
    slug: 'spice-route',
    fairId: 'fair_003',
    name: 'Spice Route',
    boothNumber: '7',
    cuisineType: 'Indian',
    description: 'Northern and Southern Indian street food.',
    rating: 4.7,
    reviewCount: 201,
    prepTimeMin: 10,
    menu: [
      { id: 'mi_070', name: 'Butter Chicken Bowl', description: 'Creamy tomato-based butter chicken over basmati rice', price: 13.99, category: 'Mains', prepTime: 10, popular: true, available: false },
      { id: 'mi_071', name: 'Samosa Chat (3)', description: 'Crispy samosas with tamarind chutney, yogurt, and sev', price: 9.99, category: 'Snacks', prepTime: 8, available: false },
      { id: 'mi_072', name: 'Mango Lassi', description: 'Chilled yogurt drink with Alphonso mango', price: 5.99, category: 'Drinks', prepTime: 2, available: false },
    ],
  },
]

// ─── Aggregated export ────────────────────────────────────────────────────────

export const mockVendors: MockVendor[] = [
  ...springfieldVendors,
  ...stlVendors,
  ...edwardsvilleVendors,
  ...columbusVendors,
]
