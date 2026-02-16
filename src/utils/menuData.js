export const categories = [
  { id: 'fried', name: 'Fried Classics', icon: '🌭', emoji: '🌭' },
  { id: 'drinks', name: 'Lemonades', icon: '🥤', emoji: '🥤' },
  { id: 'dairy', name: 'Dairy Barn', icon: '🦴', emoji: '🦴' },
  { id: 'snacks', name: 'Snacks', icon: '🥨', emoji: '🥨' },
  { id: 'bbq', name: 'BBQ Area', icon: '🗡', emoji: '🗡' },
  { id: 'sweets', name: 'Sweet Treats', icon: '🍭', emoji: '🍭' }
];

export const menuItems = [
  // Drinks
  {
    id: 1,
    name: 'Lemon Shake-Up',
    price: 5.99,
    category: 'drinks',
    description: 'The legendary thirst quencher. Fresh squeezed, plenty of sugar.',
    emoji: '🍋',
    deliveryTime: '15 min',
    popular: true,
    tags: ['Refreshing', 'Classic', 'Citrus']
  },
  {
    id: 2,
    name: 'Strawberry Lemonade',
    price: 6.49,
    category: 'drinks',
    description: 'Sweet strawberries meet tangy lemonade. Summer in a cup.',
    emoji: '🍓',
    deliveryTime: '15 min',
    tags: ['Sweet', 'Fruity', 'Refreshing']
  },
  {
    id: 3,
    name: 'Sweet Tea',
    price: 4.99,
    category: 'drinks',
    description: 'Southern-style sweet tea brewed fresh daily.',
    emoji: '🧃',
    deliveryTime: '12 min',
    tags: ['Classic', 'Sweet']
  },

  // Fried Classics
  {
    id: 4,
    name: 'Footlong Corn Dog',
    price: 7.50,
    category: 'fried',
    description: 'Hand-dipped in secret batter and fried to golden perfection.',
    emoji: '🌭',
    deliveryTime: '22 min',
    popular: true,
    tags: ['Fried', 'Classic', 'Savory']
  },
  {
    id: 5,
    name: 'Funnel Cake Mtn',
    price: 12.00,
    category: 'fried',
    description: 'A mountain of fried dough, strawberries, and whipped cream.',
    emoji: '🎡',
    deliveryTime: '28 min',
    popular: true,
    tags: ['Sweet', 'Fried', 'Shareable']
  },
  {
    id: 6,
    name: 'Fried Oreos',
    price: 8.99,
    category: 'fried',
    description: 'America\'s favorite cookie, battered and deep fried. Dusted with powdered sugar.',
    emoji: '🍪',
    deliveryTime: '20 min',
    tags: ['Sweet', 'Fried', 'Indulgent']
  },
  {
    id: 7,
    name: 'Elephant Ear',
    price: 9.50,
    category: 'fried',
    description: 'Massive fried dough with cinnamon sugar. Bigger than your face.',
    emoji: '🐘',
    deliveryTime: '25 min',
    tags: ['Sweet', 'Large', 'Cinnamon']
  },
  {
    id: 8,
    name: 'Deep Fried Pickles',
    price: 7.99,
    category: 'fried',
    description: 'Tangy dill pickles in a crispy coating. Ranch on the side.',
    emoji: '🥒',
    deliveryTime: '18 min',
    tags: ['Savory', 'Tangy', 'Fried']
  },

  // BBQ
  {
    id: 9,
    name: 'Pulled Pork Sandwich',
    price: 11.99,
    category: 'bbq',
    description: 'Slow-smoked pulled pork with our signature BBQ sauce.',
    emoji: '🗡',
    deliveryTime: '20 min',
    tags: ['Smoky', 'Savory', 'BBQ']
  },
  {
    id: 10,
    name: 'BBQ Nachos',
    price: 13.50,
    category: 'bbq',
    description: 'Loaded nachos with pulled pork, cheese, jalapeños, and BBQ drizzle.',
    emoji: '🌮',
    deliveryTime: '22 min',
    popular: true,
    tags: ['Loaded', 'Spicy', 'Shareable']
  },
  {
    id: 11,
    name: 'Smoked Turkey Leg',
    price: 14.99,
    category: 'bbq',
    description: 'Giant turkey leg smoked for hours. Feels medieval.',
    emoji: '🍗',
    deliveryTime: '25 min',
    tags: ['Smoky', 'Large', 'Protein']
  },

  // Dairy Barn
  {
    id: 12,
    name: 'Chocolate Milk Shake',
    price: 6.99,
    category: 'dairy',
    description: 'Thick, creamy, and chocolatey. Made with real ice cream.',
    emoji: '🥛',
    deliveryTime: '15 min',
    tags: ['Creamy', 'Chocolate', 'Cold']
  },
  {
    id: 13,
    name: 'Soft Serve Cone',
    price: 4.50,
    category: 'dairy',
    description: 'Classic vanilla soft serve in a sugar cone.',
    emoji: '🍦',
    deliveryTime: '12 min',
    tags: ['Classic', 'Cold', 'Sweet']
  },
  {
    id: 14,
    name: 'Root Beer Float',
    price: 5.99,
    category: 'dairy',
    description: 'Frosty root beer with vanilla ice cream.',
    emoji: '🥤',
    deliveryTime: '15 min',
    tags: ['Classic', 'Fizzy', 'Creamy']
  },

  // Snacks
  {
    id: 15,
    name: 'Soft Pretzel',
    price: 5.50,
    category: 'snacks',
    description: 'Warm, salted pretzel with cheese sauce.',
    emoji: '🥨',
    deliveryTime: '15 min',
    tags: ['Warm', 'Salty', 'Classic']
  },
  {
    id: 16,
    name: 'Kettle Corn',
    price: 6.99,
    category: 'snacks',
    description: 'Sweet and salty popcorn made fresh. Large bag.',
    emoji: '🍿',
    deliveryTime: '10 min',
    tags: ['Sweet', 'Salty', 'Crunchy']
  },
  {
    id: 17,
    name: 'Loaded Fries',
    price: 9.99,
    category: 'snacks',
    description: 'Crispy fries loaded with cheese, bacon, and sour cream.',
    emoji: '🍟',
    deliveryTime: '18 min',
    popular: true,
    tags: ['Loaded', 'Savory', 'Shareable']
  },

  // Sweets
  {
    id: 18,
    name: 'Cotton Candy',
    price: 5.99,
    category: 'sweets',
    description: 'Fluffy spun sugar in pink and blue. Pure nostalgia.',
    emoji: '🍭',
    deliveryTime: '10 min',
    tags: ['Sweet', 'Light', 'Classic']
  },
  {
    id: 19,
    name: 'Caramel Apple',
    price: 7.99,
    category: 'sweets',
    description: 'Crisp apple covered in thick caramel and chopped peanuts.',
    emoji: '🍎',
    deliveryTime: '12 min',
    tags: ['Sweet', 'Crunchy', 'Nutty']
  },
  {
    id: 20,
    name: 'Fried Dough Bites',
    price: 8.50,
    category: 'sweets',
    description: 'Bite-sized fried dough balls dusted with powdered sugar.',
    emoji: '🍩',
    deliveryTime: '20 min',
    tags: ['Sweet', 'Fried', 'Bite-sized']
  }
];

export const getItemsByCategory = (categoryId) => {
  return menuItems.filter(item => item.category === categoryId);
};

export const getPopularItems = () => {
  return menuItems.filter(item => item.popular);
};

export const searchItems = (query) => {
  const lowerQuery = query.toLowerCase();
  return menuItems.filter(item =>
    item.name.toLowerCase().includes(lowerQuery) ||
    item.description.toLowerCase().includes(lowerQuery) ||
    item.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
};
