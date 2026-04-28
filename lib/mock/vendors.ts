// ─── Types ────────────────────────────────────────────────────────────────────

export interface MenuItemVariant {
  id: string
  label: string
  price: number
}

export interface MenuItemSize {
  name: string
  price: number
}

export interface MenuItem {
  id: string
  name: string
  description?: string
  price: number       // USD (base price; use variants[0].price when variants present)
  category: string
  imageUrl?: string
  prepTime?: number   // minutes
  popular?: boolean
  available: boolean
  variants?: MenuItemVariant[]  // when present, user picks a size before adding
  sizes?: MenuItemSize[]
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
  featured?: boolean
  featuredReason?: string
  menu: MenuItem[]
}

// ─── Italian Fest 2026 vendors (Collinsville, IL) ────────────────────────────

const italianFestVendors: MockVendor[] = [
  {
    id: 'v_if_001',
    slug: 'lomonaco-italian-food',
    fairId: 'fair_001',
    name: 'Lomonaco Italian Food',
    boothNumber: 'A-1',
    cuisineType: 'Italian',
    description: 'Family recipes from the Hill. Authentic Italian food made with love since 1972.',
    rating: 4.9,
    reviewCount: 542,
    prepTimeMin: 10,
    featured: true,
    featuredReason: "Today's Hot Pick",
    menu: [
      {
        id: 'mi_if_001', name: 'Bagna Cauda',
        description: 'Served with cabbage and fresh bread from the Hill.',
        price: 10.00, category: 'Specialties', prepTime: 8, popular: true, available: true,
        variants: [
          { id: 'small', label: 'Small', price: 10.00 },
          { id: 'medium', label: 'Medium', price: 25.00 },
        ],
      },
      {
        id: 'mi_if_002', name: 'Toasted Ravioli',
        description: 'St. Louis–style deep-fried meat ravioli with marinara dipping sauce.',
        price: 8.00, category: 'Specialties', prepTime: 6, popular: true, available: true,
        variants: [
          { id: 'half', label: 'Half Dozen', price: 8.00 },
          { id: 'full', label: 'Full Dozen', price: 14.00 },
        ],
      },
      { id: 'mi_if_003', name: 'Cavatelli', description: 'Hand-rolled pasta with red sauce and Italian sausage.', price: 12.00, category: 'Pasta', prepTime: 10, available: true },
      { id: 'mi_if_004', name: 'Italian Beef Sandwich', description: 'Slow-roasted beef on a French roll with giardiniera.', price: 10.00, category: 'Sandwiches', prepTime: 8, popular: true, available: true },
      { id: 'mi_if_005', name: 'Meatball Sub', description: 'Housemade meatballs in marinara on a toasted hoagie roll.', price: 9.00, category: 'Sandwiches', prepTime: 7, available: true },
      { id: 'mi_if_006', name: 'Cannoli', description: 'Crispy shell filled with sweet ricotta and mini chocolate chips.', price: 5.00, category: 'Desserts', prepTime: 2, available: true },
    ],
  },
  {
    id: 'v_if_002',
    slug: 'randys-house-of-bbq',
    fairId: 'fair_001',
    name: "Randy's House of BBQ",
    boothNumber: 'B-3',
    cuisineType: 'BBQ',
    description: 'Low and slow BBQ, right here at Italian Fest. A crowd favorite for 20 years.',
    rating: 4.8,
    reviewCount: 389,
    prepTimeMin: 12,
    featured: true,
    featuredReason: 'Crowd Favorite',
    menu: [
      { id: 'mi_if_010', name: 'Pulled Pork Sandwich', description: 'Slow-smoked pulled pork on a brioche bun with coleslaw.', price: 11.00, category: 'Sandwiches', prepTime: 8, popular: true, available: true },
      {
        id: 'mi_if_011', name: 'Smoked Ribs',
        description: 'St. Louis–style ribs, dry rubbed and smoked 6 hours.',
        price: 22.00, category: 'Plates', prepTime: 10, popular: true, available: true,
        variants: [
          { id: 'half', label: 'Half Rack', price: 22.00 },
          { id: 'full', label: 'Full Rack', price: 38.00 },
        ],
      },
      { id: 'mi_if_012', name: 'Brisket Plate', description: 'Half-pound sliced brisket with two sides of your choice.', price: 18.00, category: 'Plates', prepTime: 12, available: true },
      { id: 'mi_if_013', name: 'Mac & Cheese', description: 'Creamy four-cheese mac, side or add-on.', price: 5.00, category: 'Sides', prepTime: 4, available: true },
      { id: 'mi_if_014', name: 'Sweet Tea', description: 'Fresh-brewed Southern-style sweet tea.', price: 3.00, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_if_003',
    slug: 'mommas-house',
    fairId: 'fair_001',
    name: "Momma's House",
    boothNumber: 'C-2',
    cuisineType: 'Italian',
    description: 'Old-world Italian comfort food just like Momma made it.',
    rating: 4.7,
    reviewCount: 275,
    prepTimeMin: 10,
    featured: true,
    featuredReason: 'Trending',
    menu: [
      {
        id: 'mi_if_020', name: 'Pasta e Fagioli',
        description: 'Hearty bean and pasta soup with Italian seasoning.',
        price: 7.00, category: 'Soups', prepTime: 5, popular: true, available: true,
        variants: [
          { id: 'sm', label: 'Small', price: 7.00 },
          { id: 'lg', label: 'Large', price: 12.00 },
        ],
      },
      { id: 'mi_if_021', name: 'Lasagna', description: 'Layered meat lasagna with béchamel and marinara.', price: 13.00, category: 'Pasta', prepTime: 10, popular: true, available: true },
      { id: 'mi_if_022', name: 'Chicken Piccata', description: 'Pan-seared chicken with lemon-caper butter sauce over pasta.', price: 15.00, category: 'Entrees', prepTime: 12, available: true },
      { id: 'mi_if_023', name: 'Bruschetta', description: 'Toasted bread with tomato, basil, and garlic.', price: 6.00, category: 'Appetizers', prepTime: 4, available: true },
      { id: 'mi_if_024', name: 'Tiramisu', description: 'Classic espresso-soaked ladyfingers with mascarpone cream.', price: 6.00, category: 'Desserts', prepTime: 2, available: true },
    ],
  },
  {
    id: 'v_if_004',
    slug: 'olivias-olive-oil',
    fairId: 'fair_001',
    name: "Olivia's Olive Oil",
    boothNumber: 'D-1',
    cuisineType: 'Specialty',
    description: 'Extra-virgin olive oils, artisan vinegars, and Italian specialty goods. New at Italian Fest this year.',
    rating: 4.6,
    reviewCount: 88,
    prepTimeMin: 5,
    featured: true,
    featuredReason: 'New This Year',
    menu: [
      { id: 'mi_if_030', name: 'Bruschetta Tasting Board', description: 'Four bruschetta varieties with EVOO, tomato, and pesto toppings.', price: 10.00, category: 'Tasting', prepTime: 4, popular: true, available: true },
      { id: 'mi_if_031', name: 'Antipasto Plate', description: 'Cured meats, olives, marinated vegetables, and artisan crackers.', price: 14.00, category: 'Tasting', prepTime: 5, available: true },
      { id: 'mi_if_032', name: 'Focaccia with EVOO', description: 'House-baked focaccia with rosemary and a seasonal olive oil dip.', price: 7.00, category: 'Bread', prepTime: 3, available: true },
      { id: 'mi_if_033', name: 'Sparkling Lemonade', description: 'Italian-style sparkling lemonade with fresh mint.', price: 4.00, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_if_005',
    slug: 'st-anthonys-society',
    fairId: 'fair_001',
    name: "St. Anthony's Society",
    boothNumber: 'E-1',
    cuisineType: 'Italian',
    description: 'Parish booth serving classic Italian festival staples for over 40 years.',
    rating: 4.5,
    reviewCount: 410,
    prepTimeMin: 8,
    menu: [
      { id: 'mi_if_040', name: 'Spaghetti & Meatballs', description: 'Classic red sauce spaghetti with two housemade meatballs.', price: 10.00, category: 'Pasta', prepTime: 8, popular: true, available: true },
      { id: 'mi_if_041', name: 'Sausage & Peppers', description: 'Italian sausage with roasted peppers and onions on a hoagie roll.', price: 9.00, category: 'Sandwiches', prepTime: 6, popular: true, available: true },
      { id: 'mi_if_042', name: 'Stuffed Mushrooms', description: 'Baked mushroom caps stuffed with sausage and breadcrumbs.', price: 7.00, category: 'Appetizers', prepTime: 6, available: true },
      { id: 'mi_if_043', name: 'Italian Soda', description: 'Cream soda with your choice of flavored syrup.', price: 3.50, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_if_006',
    slug: 'il-forno-pizza',
    fairId: 'fair_001',
    name: 'Il Forno Pizza',
    boothNumber: 'F-2',
    cuisineType: 'Pizza',
    description: 'Wood-fired Neapolitan-style pizza made fresh to order.',
    rating: 4.7,
    reviewCount: 198,
    prepTimeMin: 10,
    menu: [
      { id: 'mi_if_050', name: 'Margherita', description: 'San Marzano tomato, fresh mozzarella, basil, olive oil.', price: 14.00, category: 'Pizza', prepTime: 10, popular: true, available: true },
      { id: 'mi_if_051', name: 'Salsiccia', description: 'Tomato base, fresh mozzarella, Italian sausage, roasted peppers.', price: 16.00, category: 'Pizza', prepTime: 10, popular: true, available: true },
      { id: 'mi_if_052', name: 'Funghi', description: 'White base, wild mushrooms, truffle oil, parmesan, arugula.', price: 16.00, category: 'Pizza', prepTime: 12, available: true },
      { id: 'mi_if_053', name: 'San Pellegrino', description: 'Sparkling water or blood orange.', price: 3.50, category: 'Drinks', prepTime: 1, available: true },
    ],
  },
  {
    id: 'v_if_007',
    slug: 'cannoli-bar',
    fairId: 'fair_001',
    name: 'The Cannoli Bar',
    boothNumber: 'G-1',
    cuisineType: 'Desserts',
    description: 'Handmade cannoli and Italian desserts — filled fresh to order.',
    rating: 4.8,
    reviewCount: 321,
    prepTimeMin: 5,
    menu: [
      {
        id: 'mi_if_060', name: 'Cannoli',
        description: 'Crispy pastry shell filled with sweet ricotta and your choice of toppings.',
        price: 5.00, category: 'Cannoli', prepTime: 3, popular: true, available: true,
        variants: [
          { id: 'single', label: '1 Cannoli', price: 5.00 },
          { id: 'three', label: '3 Cannoli', price: 13.00 },
        ],
      },
      { id: 'mi_if_061', name: 'Sfogliatelle', description: 'Flaky shell pastry filled with ricotta and citrus.', price: 4.50, category: 'Pastries', prepTime: 2, available: true },
      { id: 'mi_if_062', name: 'Zeppole', description: 'Italian fried dough tossed in powdered sugar.', price: 6.00, category: 'Fried Treats', prepTime: 5, popular: true, available: true },
      { id: 'mi_if_063', name: 'Espresso', description: 'Single or double shot of fresh-pulled espresso.', price: 3.00, category: 'Drinks', prepTime: 2, available: true },
    ],
  },
  {
    id: 'v_if_008',
    slug: 'gelato-ditalia',
    fairId: 'fair_001',
    name: "Gelato d'Italia",
    boothNumber: 'H-1',
    cuisineType: 'Desserts',
    description: 'Authentic Italian gelato churned daily in 12 rotating flavors.',
    rating: 4.9,
    reviewCount: 467,
    prepTimeMin: 4,
    menu: [
      {
        id: 'mi_if_070', name: 'Gelato',
        description: 'Ask about today\'s flavors — Stracciatella, Pistachio, Limone, and more.',
        price: 5.00, category: 'Gelato', prepTime: 3, popular: true, available: true,
        variants: [
          { id: 'sm', label: 'Small', price: 5.00 },
          { id: 'md', label: 'Medium', price: 7.00 },
          { id: 'lg', label: 'Large', price: 9.00 },
        ],
      },
      { id: 'mi_if_071', name: 'Affogato', description: 'A scoop of vanilla gelato drowned in hot espresso.', price: 7.00, category: 'Gelato', prepTime: 3, popular: true, available: true },
      { id: 'mi_if_072', name: 'Granita al Limone', description: 'Refreshing Sicilian lemon ice.', price: 5.00, category: 'Gelato', prepTime: 2, available: true },
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
  ...italianFestVendors,
  ...stlVendors,
  ...edwardsvilleVendors,
  ...columbusVendors,
]
