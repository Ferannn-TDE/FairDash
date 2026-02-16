# 🎡 FairDash - React Application

A modern, full-featured food delivery app for fair foods with a striking neon-themed design following the FairDash brand guidelines.

## 🌟 Features

### Core Features
- **🏠 Dynamic Home Page** - Hero section with search, categories, trending items, and how-it-works section
- **📱 Full Menu System** - Browse all fair foods with category filtering and search
- **🛒 Shopping Cart** - Add items, adjust quantities, view totals with persistent storage
- **🎨 Brand-Compliant Design** - Follows FairDash guidelines (Bebas Neue font, #FF0077 pink, dark theme)
- **📱 Fully Responsive** - Mobile-first design that works on all devices

### Technical Features
- React 18 with Hooks
- React Router for navigation
- Context API for state management
- Local storage for cart persistence
- Modern CSS with animations
- Lucide React icons
- Vite for fast development

## 🎨 Design System

Following the FairDash Brand Guidelines:

### Colors
- **Neon Pink**: #FF0077 (primary accent)
- **Dark Background**: #0F0F0F
- **Card Background**: #1A1A1A
- **Text White**: #FFFFFF
- **Text Gray**: #A1A1A1

### Typography
- **Headers**: Bebas Neue (display font)
- **Body**: Inter (400, 500, 600, 700)

### Key Design Elements
- Neon glow effects on interactive elements
- Glassmorphism on navigation
- Smooth animations and transitions
- Category cards with hover effects
- Floating search bar
- Gradient backgrounds with pink accents

## 📁 Project Structure

```
fairdash-app/
├── src/
│   ├── components/
│   │   ├── Navbar.jsx          # Main navigation
│   │   ├── Navbar.css
│   │   ├── Cart.jsx            # Shopping cart sidebar
│   │   ├── Cart.css
│   │   ├── FoodCard.jsx        # Menu item card
│   │   └── FoodCard.css
│   ├── pages/
│   │   ├── Home.jsx            # Home page
│   │   ├── Home.css
│   │   ├── Menu.jsx            # Menu page with filters
│   │   └── Menu.css
│   ├── context/
│   │   └── CartContext.jsx     # Cart state management
│   ├── utils/
│   │   └── menuData.js         # Menu items & categories
│   ├── App.jsx                 # Main app component
│   ├── App.css
│   ├── main.jsx               # Entry point
│   └── index.css              # Global styles
├── index.html
├── package.json
└── vite.config.js
```

## 🚀 Getting Started

### Installation

```bash
# Navigate to project directory
cd fairdash-app

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will open at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## 📦 Components

### Navbar
- Fixed navigation with glassmorphism
- Logo with brand colors
- Navigation links
- Location selector
- Cart button with item count badge
- Mobile responsive menu

### Cart
- Slide-in sidebar
- Add/remove items
- Quantity controls
- Price calculations
- Local storage persistence
- Empty state

### FoodCard
- Item image (emoji)
- Delivery time badge
- Popular badge
- Tags
- Add to cart button
- Hover effects

## 🎯 Pages

### Home (`/`)
- Hero section with search
- Category carousel
- Trending items
- How it works section
- Call-to-action

### Menu (`/menu`)
- Full menu display
- Search functionality
- Category filtering
- URL parameters for filters
- Results count

### Coming Soon Pages
- Vendors (`/vendors`)
- Track Order (`/track`)

## 🛠️ State Management

### CartContext
Provides global cart state:
- `cart` - Array of cart items
- `addToCart(item)` - Add item to cart
- `removeFromCart(itemId)` - Remove item
- `updateQuantity(itemId, quantity)` - Update quantity
- `clearCart()` - Clear all items
- `getCartTotal()` - Calculate total price
- `getCartCount()` - Get total item count
- `isCartOpen` - Cart sidebar visibility
- `setIsCartOpen(boolean)` - Toggle cart

## 📊 Data Structure

### Menu Item
```javascript
{
  id: 1,
  name: 'Lemon Shake-Up',
  price: 5.99,
  category: 'drinks',
  description: 'The legendary thirst quencher...',
  emoji: '🍋',
  deliveryTime: '15 min',
  popular: true,
  tags: ['Refreshing', 'Classic', 'Citrus']
}
```

### Categories
- Fried Classics 🌭
- Lemonades 🥤
- Dairy Barn 🦴
- Snacks 🥨
- BBQ Area 🗡
- Sweet Treats 🍭

## 🎨 Customization

### Adding New Menu Items
Edit `src/utils/menuData.js`:

```javascript
export const menuItems = [
  {
    id: 21,
    name: 'Your Item',
    price: 9.99,
    category: 'fried',
    description: 'Description here',
    emoji: '🍕',
    deliveryTime: '20 min',
    popular: false,
    tags: ['Tag1', 'Tag2']
  },
  // ... more items
];
```

### Adding New Categories
Edit `src/utils/menuData.js`:

```javascript
export const categories = [
  { id: 'newcat', name: 'New Category', icon: '🎪', emoji: '🎪' },
  // ... more categories
];
```

### Styling
All styles follow the brand guidelines:
- Colors in `:root` CSS variables
- Bebas Neue for headers
- Inter for body text
- Consistent spacing and animations

## 🔧 Future Enhancements

Potential features to add:
- [ ] User authentication
- [ ] Order tracking system
- [ ] Vendor management
- [ ] Payment integration
- [ ] Order history
- [ ] Favorites/wishlist
- [ ] Real-time delivery tracking
- [ ] Reviews and ratings
- [ ] Promotional codes
- [ ] Multi-location support
- [ ] Backend API integration
- [ ] Progressive Web App (PWA)

## 📱 Responsive Breakpoints

- Desktop: 968px+
- Tablet: 640px - 968px
- Mobile: < 640px

## ⚡ Performance

- Vite for fast HMR
- CSS animations with GPU acceleration
- Lazy loading images (can be added)
- Local storage for cart persistence
- Optimized bundle size

## 🤝 Contributing

To add features or fix bugs:
1. Create a new branch
2. Make your changes
3. Test thoroughly
4. Follow the brand guidelines
5. Submit for review

## 📄 License

All rights reserved - FairDash 2025

## 🎡 Brand Guidelines

This app strictly follows the FairDash Brand Guidelines:
- Bebas Neue Cyrillic font for all display text
- #FF0077 neon pink as primary color
- Black (#00000) and white (#FFFFF) as supporting colors
- Night market / neon aesthetic
- Speed lines and motion in iconography
- "Fresh. Fast. Fair." tagline

---

Built with ❤️ for FairDash - The Fair Comes To Your Door
# FairDash
