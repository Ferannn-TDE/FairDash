# FairDash Design System — MASTER REFERENCE
> Generated: 2026-03-08 | Phase 1 extraction → Phase 2 guide

---

## 1. TECH STACK

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 18.2.0 |
| Build Tool | Vite | 5.0.8 |
| Routing | React Router DOM | 6.20.0 |
| Auth | Clerk (`@clerk/clerk-react`) | 5.60.1 |
| Styling | Tailwind CSS | 3.4.19 |
| Maps | @vis.gl/react-google-maps | 1.7.1 |
| Icons | @heroicons/react + react-icons | 2.2.0 / 5.5.0 |
| Toasts | react-hot-toast | 2.6.0 |
| State | React Context API + localStorage | — |

**Dev server:** `localhost:3000`
**Entry point:** `src/main.jsx` → wraps app in `<ClerkProvider>`
**Router:** `src/App.jsx` → `<AppLayout>` with `<ProtectedRoute>`

---

## 2. COLOR PALETTE

### Brand Colors
```
Neon Pink (Primary)    #FF0077     bg-neon-pink / text-neon-pink / border-neon-pink
Neon Pink Dark (CTA)   #e0006b     hover state for bg-neon-pink buttons
Neon Pink Deep         #cc0060     gradient end for avatar bg
```

### Background Colors
```
Dark BG (Page)         #0F0F0F     bg-bg-dark
Card BG                #1A1A1A     bg-bg-card
Card BG (nested)       #000000     Clerk card overlay
```

### Text Colors
```
Primary Text           #FFFFFF     text-white
Secondary Text         #A1A1A1     text-text-gray
Dimmed Text            #999999     text-[#999999] (pac-item, date fields)
Placeholder            rgba(161,161,161,0.4)   placeholder:text-text-gray/40
```

### Semantic Colors
```
Error / Destructive    #ef4444     red-500 (hover states, error borders)
Error Alt              #f15e6c     Clerk input error border
Success                #10b981     green (toast success implied)
Warning                #f59e0b     amber (used in toasts)
```

### Overlay / Border Colors
```
Border Default         rgba(255,255,255,0.10)   border-white/10
Border Subtle          rgba(255,255,255,0.05)   border-white/5
Border Hover (pink)    rgba(255,0,119,0.30)     border-neon-pink/30
Surface Light          rgba(255,255,255,0.05)   bg-white/5
Surface Medium         rgba(255,255,255,0.10)   bg-white/10
Surface Pink Tint      rgba(255,0,119,0.10)     bg-neon-pink/10
Gradient Overlay       radial-gradient(...)     used in hero sections
```

---

## 3. TYPOGRAPHY

### Font Families
```css
/* Google Fonts — loaded in index.css */
font-bebas: "Bebas Neue"    /* All-caps display font, headings */
font-inter: "Inter"          /* Body, UI, labels, buttons */
```

### Heading Usage (font-bebas — all h1-h6 by default)
| Element | Size | Tracking | Usage |
|---------|------|----------|-------|
| Hero H1 | `clamp(2.5rem, 6vw, 4.5rem)` | `tracking-[2px]` | Page heroes |
| Section H1 | `clamp(2rem, 5vw, 3.5rem)` | `tracking-wide` | Section titles |
| Card H2 | `text-2xl` (1.5rem) | `tracking-wide` | Step/card headings |
| Sub H3 | `text-xl` | `tracking-wide` | Subheadings |
| Small H4 | `text-[1rem]` | `tracking-wide` | Nav labels, footer sections |

### Body Usage (font-inter)
| Role | Classes | Size |
|------|---------|------|
| Large body | `text-xl leading-relaxed` | 1.25rem |
| Body | `text-base` | 1rem |
| Small body | `text-sm` | 0.875rem |
| Extra small | `text-xs` | 0.75rem |
| Micro | `text-[0.625rem]` | 0.625rem |
| Label | `text-[0.6875rem] uppercase tracking-wide font-semibold` | 0.6875rem |

### Font Weights
```
400 — normal  (body text)
500 — medium  (secondary labels)
600 — semibold (nav items, menu links, card labels)
700 — bold    (stats, primary CTAs, user name)
```

---

## 4. SPACING SYSTEM

FairDash uses Tailwind's default scale with these **common patterns**:

### Container / Page Layout
```
Max width:    max-w-[87.5rem]  (1400px)
Page padding: px-[6%] lg:px-8 md:px-5 sm:px-4
Centered:     mx-auto
```

### Common Vertical Spacing
```
Section gap:    py-12 md:py-8
Card padding:   p-6 / p-7 / p-5
Item padding:   p-3.5 / p-4
Tight gap:      gap-1.5 / space-y-1.5
Normal gap:     gap-4 / space-y-4
Large gap:      gap-6 / mb-6
Section bottom: mb-8 md:mb-6 / mb-10
```

### Responsive Padding Pattern
```
Desktop → Tablet → Mobile
p-6     → p-4    → p-3
px-8    → px-5   → px-4
gap-8   → gap-6  → gap-4
```

---

## 5. BORDER RADIUS

```
Pill / rounded-full     — avatars, social icons, category chips
rounded-2xl (1rem)      — cards, main panels, step containers
rounded-xl (0.75rem)    — inputs, buttons, inner cards, dropdowns
rounded-lg (0.5rem)     — icon wrappers, small badges
rounded-full            — progress indicators, spinners
```

---

## 6. SHADOWS & EFFECTS

### Box Shadows
```css
shadow-glow:         0 0 20px rgba(255, 0, 119, 0.4)   /* Neon card hover */
shadow-glow-intense: 0 0 30px rgba(255, 0, 119, 0.6)   /* Button hover */
shadow-[0_4px_12px_rgba(255,0,119,0.3)]                 /* Button pressed */
shadow-[0_4px_12px_rgba(255,0,119,0.3)]                 /* Avatar glow */
```

### Text Shadows
```css
[text-shadow:0_0_20px_rgba(255,0,119,0.4)]   /* Logo / hero text */
animate-neonGlow                              /* Pulsing text glow */
```

### Blur Effects
```
backdrop-blur-xs (2px)   — subtle glass
backdrop-blur-md         — modal overlays
```

---

## 7. ANIMATIONS

| Name | Duration | Description |
|------|----------|-------------|
| `animate-fadeIn` | 0.6s ease-out | Fade up from 20px below |
| `animate-slideInLeft` | 0.6s ease-out | Slide in from -50px left |
| `animate-slideInRight` | 0.6s ease-out | Slide in from +50px right |
| `animate-neonGlow` | 3s infinite | Pulsing text shadow |
| `animate-float` | 3s infinite | Gentle ±10px vertical bob |
| `animate-float-slow` | 8s infinite | Slow ±10px vertical bob |
| `animate-skeleton` | 1.5s infinite | Shimmer loading effect |
| `animate-spin-slow` | 2s linear | Slow rotation |
| `animate-spin` | default | Standard rotation (loaders) |
| `animate-pulse-custom` | 2s infinite | Breathing pulse |

### Transition Standards
```
Duration:  transition-all duration-200 (interactive elements)
           transition-all duration-300 (cards, panels)
Timing:    ease-out (entrances), ease-in-out (loops)
```

---

## 8. COMPONENT PATTERNS

### Buttons

**Primary CTA**
```jsx
className="px-8 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm
           hover:bg-[#e0006b] transition-colors shadow-[0_4px_12px_rgba(255,0,119,0.3)]
           disabled:opacity-40 disabled:cursor-not-allowed"
```

**Secondary / Ghost**
```jsx
className="px-6 py-3 bg-white/5 border border-white/10 text-white rounded-xl
           font-semibold text-sm hover:bg-white/10 transition-all"
```

**Destructive**
```jsx
className="... hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
```

**Pill / Tag (toggleable)**
```jsx
// Active:
className="px-4 py-2 rounded-full text-sm font-medium border bg-neon-pink border-neon-pink text-white"
// Inactive:
className="px-4 py-2 rounded-full text-sm font-medium border bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white"
```

**Icon Button (social link)**
```jsx
className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center
           justify-center text-neon-pink transition-all duration-300
           hover:bg-neon-pink hover:text-white hover:scale-110"
```

---

### Form Fields

**Input / Textarea / Select**
```jsx
className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3
           text-white text-sm outline-none focus:border-neon-pink
           transition-colors placeholder:text-text-gray/40"
```

**Label**
```jsx
className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5"
// Required asterisk:
<span className="text-neon-pink">*</span>
```

**File Upload Zone**
```jsx
className="flex flex-col items-center justify-center w-full h-28 bg-bg-card
           border-2 border-dashed border-white/10 rounded-xl cursor-pointer
           hover:border-neon-pink/30 hover:bg-white/[0.02] transition-all group"
```

**Add More Button (dashed)**
```jsx
className="w-full py-3 bg-white/[0.03] border-2 border-dashed border-white/10
           rounded-xl text-white font-semibold text-sm
           hover:border-neon-pink/30 hover:bg-white/[0.06] transition-all"
```

---

### Cards

**Base Card**
```jsx
className="bg-bg-card border border-white/10 rounded-2xl p-6
           transition-all duration-300"
```

**Hoverable Card**
```jsx
className="... hover:border-neon-pink/30 hover:scale-[1.02] hover:shadow-glow"
```

**Inner Nested Card (darker)**
```jsx
className="bg-bg-dark border border-white/10 rounded-xl p-5"
```

**Stat Widget**
```jsx
className="bg-white/5 rounded-xl p-2.5 text-center"
// Value: text-neon-pink font-bold text-lg
// Label: text-text-gray text-[0.625rem]
```

---

### Icon Wrapper
```jsx
// Small (nav items)
className="w-9 h-9 bg-neon-pink/10 rounded-lg flex items-center justify-center"
// Icon: w-4 h-4 text-neon-pink

// Medium (page headers)
className="w-16 h-16 bg-neon-pink/10 border border-neon-pink/20 rounded-2xl
           flex items-center justify-center"
// Icon: w-8 h-8 text-neon-pink

// Large (confirmation)
className="w-20 h-20 bg-neon-pink/10 border border-neon-pink/30 rounded-full
           flex items-center justify-center"
// Icon: w-10 h-10 text-neon-pink
```

---

### Progress Stepper
```jsx
// Step circle — completed:
className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
           bg-neon-pink border-2 border-neon-pink text-white"
// Active:
className="... border-neon-pink text-neon-pink bg-neon-pink/10"
// Inactive:
className="... border-white/20 text-text-gray bg-white/5"

// Connector line — completed:
className="flex-1 h-0.5 mx-2 bg-neon-pink"
// Incomplete:
className="... bg-white/10"

// Label:
className="text-[0.625rem] uppercase tracking-wide mt-1 font-semibold"
```

---

### Spinner / Loading
```jsx
// Standard inline spinner:
className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin"
```

---

### Avatar / User Badge
```jsx
className="w-12 h-12 rounded-full bg-gradient-to-br from-neon-pink to-[#cc0060]
           flex items-center justify-center shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
// Initial: text-white font-bold text-lg
```

---

### Panel / Side Drawer
```jsx
// Overlay
className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
// Drawer
className="fixed top-0 right-0 h-full w-80 bg-bg-card border-l border-white/10
           z-[95] flex flex-col shadow-[-20px_0_60px_rgba(0,0,0,0.5)]"
```

---

### Modal
```jsx
// Backdrop
className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center"
// Card
className="bg-bg-card border border-white/10 rounded-2xl p-8 max-w-md w-[90%] animate-fadeIn"
```

---

## 9. RESPONSIVE BREAKPOINTS

```javascript
// tailwind.config.js custom screens
xs:      480px    // Extra small mobile
sm:      640px    // Small mobile / landscape
md:      768px    // Tablet portrait
lg:      968px    // Large tablet / small desktop
tablet:  1000px   // 62.5rem — main desktop/mobile split point
desktop: 1250px   // 78.125rem — sidebar layout threshold
xl:      1400px   // Extra large displays
```

### Responsive Strategy
- `hidden tablet:flex` — Show on desktop, hide on mobile
- `tablet:hidden` — Show on mobile, hide on desktop
- `flex-col md:flex-row` — Stack on mobile, row on desktop
- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — Progressive grid
- Mobile-first approach (base = mobile)

---

## 10. GRID LAYOUTS

```
Food / Item Grid:   grid-cols-2 xs:grid-cols-[repeat(auto-fill,minmax(16.25rem,1fr))]
Vendor Grid:        grid-cols-4 → 3 → 2 → 1
Footer Columns:     grid-cols-3 md:grid-cols-1
Form Fields:        grid-cols-1 sm:grid-cols-2
Stats Row:          grid-cols-3 gap-2
```

---

## 11. EXISTING ROUTES

| Route | Protection | Component | Notes |
|-------|-----------|-----------|-------|
| `/` | Public | `Landing` | No Navbar/Footer |
| `/home` | Protected | `Home` | No Navbar/Footer |
| `/menu` | Public | `Menu` | |
| `/vendors` | Public | `Vendors` | |
| `/vendors/:vendorId` | Public | `VendorDetail` | |
| `/contact` | Public | `Contact` | |
| `/refund-policy` | Public | `RefundPolicy` | |
| `/account` | Protected | `ManageAccount` | |
| `/become-vendor` | Public | `BecomeVendor` | 4-step wizard |
| `/become-driver` | Public | `BecomeDriver` | |
| `/checkout` | Protected | `Checkout` | |
| `/track` | Protected | ComingSoon | Placeholder |
| `/location` | Protected | ComingSoon | Placeholder |
| `/favorites` | Protected | ComingSoon | Placeholder |
| `/history` | Protected | ComingSoon | Placeholder |

---

## 12. EXISTING COMPONENTS INVENTORY

### Layout & Global
| File | Description |
|------|-------------|
| `src/App.jsx` | Router, AppLayout, Footer, ComingSoon, ProtectedRoute |
| `src/components/Navbar.jsx` | Fixed desktop/tablet nav with cart + menu |
| `src/components/LandingNavbar.jsx` | Public landing nav with Sign In/Up |
| `src/components/ScrollToTop.jsx` | Route-change scroll utility |

### Panels & Drawers
| File | Description |
|------|-------------|
| `src/components/SidePanel.jsx` | Reusable slide-out panel wrapper |
| `src/components/Cart.jsx` | Cart side panel (swipe-to-delete mobile) |
| `src/components/MobileNavPanel.jsx` | Mobile hamburger nav drawer |
| `src/components/MobileAccountPanel.jsx` | Mobile account panel wrapper |
| `src/components/ManageAccountPanel.jsx` | Shared account settings panel content |

### UI Components
| File | Description |
|------|-------------|
| `src/components/FoodCard.jsx` | Product card with price, tags, size selection |
| `src/components/SizeSelectionModal.jsx` | Item size picker modal |
| `src/components/SignOutModal.jsx` | Sign out confirmation modal |
| `src/components/Toast.jsx` | react-hot-toast dark theme config |
| `src/components/AddressAutocomplete.jsx` | Google Places address input |

### Loading
| File | Description |
|------|-------------|
| `src/components/LoadingAnimation.jsx` | 2s splash screen on app init |
| `src/components/LoadingScreen.jsx` | Nav-transition loading with fun messages |

### State
| File | Description |
|------|-------------|
| `src/context/CartContext.jsx` | Cart state + localStorage persistence |
| `src/context/MobileMenuContext.jsx` | Mobile menu open/close state |
| `src/hooks/useMediaQuery.js` | Responsive breakpoint hook |

### Data
| File | Description |
|------|-------------|
| `src/utils/vendorData.js` | Hardcoded vendor + menu item data |
| `src/utils/menuData.js` | Re-exports + search/filter helpers |

---

## 13. PAGE STRUCTURE PATTERN

Every interior page follows this shell:
```jsx
<div className="pt-20 min-h-screen pb-16">
  <div className="max-w-[87.5rem] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
    {/* Page Header */}
    {/* Content */}
  </div>
</div>
```

Form/Onboarding pages use narrower container:
```jsx
<div className="pt-20 min-h-screen pb-16">
  <div className="max-w-[700px] mx-auto px-[6%] md:px-5 py-10">
```

---

## 14. CLERK AUTH PATTERNS

```jsx
import { useAuth, useUser, useClerk } from "@clerk/clerk-react"

// Auth guard
const { isSignedIn, isLoaded } = useAuth()

// User data
const { user } = useUser()
user.firstName, user.lastName
user.emailAddresses[0].emailAddress

// Sign out
const { signOut } = useClerk()
signOut(() => navigate("/"))
```

Appearance config: Dark theme + neon-pink primary (in `src/main.jsx`)

---

## 15. PHASE 2 — COMPONENT BUILD PLAN

### REUSE FROM PHASE 1 (no changes needed)
- `SidePanel` — wrap any new drawer content
- `ManageAccountPanel` — pattern for list-based settings panels
- `BecomeVendor` multi-step wizard — pattern for driver onboarding
- Form field classes — all input/label/select/textarea patterns
- Progress stepper component pattern
- `FoodCard` — reuse for vendor product management cards
- `LoadingScreen` + `LoadingAnimation` — no changes
- `Toast` config — no changes
- `useMediaQuery` hook — no changes
- All button, card, modal patterns from this doc

### NEW COMPONENTS FOR PHASE 2

#### Vendor Portal
| Priority | Component | Description |
|----------|-----------|-------------|
| P0 | `VendorDashboard` page | Main vendor hub with stats cards + recent orders |
| P0 | `VendorStatsCard` | KPI card (revenue, orders, rating) |
| P0 | `VendorOrdersTable` | Order management list/table |
| P0 | `VendorOrderCard` | Single order with status + actions |
| P1 | `VendorMenuManager` | CRUD for menu items (extend BecomeVendor step 2 pattern) |
| P1 | `VendorMenuItemRow` | Editable row for menu management table |
| P1 | `VendorAnalyticsChart` | Revenue/order trend chart (consider recharts) |
| P1 | `VendorEarningsSummary` | Payout summary panel |
| P2 | `VendorProfileSettings` | Business profile edit form |
| P2 | `VendorAvailabilityToggle` | Open/closed status + hours |

#### Driver Onboarding
| Priority | Component | Description |
|----------|-----------|-------------|
| P0 | `BecomeDriver` | 5-step registration wizard (extend BecomeVendor pattern) |
| P0 | `DocumentUpload` | Reusable file upload with preview (extend existing upload pattern) |
| P1 | `DriverProfileSetup` | Personal info + photo form |
| P1 | `VehicleInfoForm` | Car details, plate, color, year |
| P1 | `AvailabilitySchedule` | Weekly availability grid/calendar |
| P2 | `BackgroundCheckStatus` | Status card (pending/approved/failed) |
| P2 | `DriverDashboard` | Driver hub with earnings + delivery queue |

### RECOMMENDED BUILD ORDER

```
SPRINT 1 — Foundation
1. Define vendor/driver data schema in utils/
2. Add new routes: /vendor-portal, /vendor/dashboard, /driver-dashboard
3. Build BecomeDriver wizard (mirror BecomeVendor, 5 steps)
4. Build DocumentUpload component (reusable for both flows)

SPRINT 2 — Vendor Core
5. VendorDashboard page layout + VendorStatsCard
6. VendorOrdersTable + VendorOrderCard
7. VendorMenuManager (reuse BecomeVendor step 2 pattern)

SPRINT 3 — Vendor Analytics
8. VendorAnalyticsChart (add recharts dependency)
9. VendorEarningsSummary
10. VendorAvailabilityToggle

SPRINT 4 — Driver Experience
11. DriverDashboard
12. AvailabilitySchedule component
13. BackgroundCheckStatus

SPRINT 5 — Polish
14. VendorProfileSettings
15. Mobile responsiveness pass
16. Loading states for all async sections
17. Error states and empty states
```

### DEPENDENCIES TO ADD
```json
"recharts": "^2.x"       // Charts for vendor analytics dashboard
```
No other new dependencies required — everything else uses existing stack.

---

## 16. DESIGN DECISIONS FOR PHASE 2

### Dashboard Layout Pattern
- Left sidebar (desktop): vendor/driver navigation links
- Main area: content with stat cards at top, table/list below
- Mobile: sidebar collapses to bottom nav or drawer
- Use `desktop:grid-cols-[240px_1fr]` for sidebar + content split

### Table / Order List Pattern
- Mobile: card-based list (not table) — each order as a card
- Desktop: table with columns — order ID, items, total, status, time, actions
- Status badges: use colored pill chips (neon-pink=new, amber=preparing, green=delivered, red=cancelled)

### Status Badge Pattern
```jsx
// New / Pending
className="px-2.5 py-1 rounded-full text-xs font-semibold bg-neon-pink/10 text-neon-pink border border-neon-pink/20"
// Preparing
className="... bg-amber-500/10 text-amber-400 border-amber-500/20"
// Delivered
className="... bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
// Cancelled
className="... bg-red-500/10 text-red-400 border-red-500/20"
```

### KPI Stat Card Pattern
```jsx
className="bg-bg-card border border-white/10 rounded-2xl p-6 hover:border-neon-pink/20 transition-all"
// Icon: large (w-12 h-12), tinted wrapper
// Value: font-bebas text-4xl text-white
// Label: text-text-gray text-sm
// Trend: text-emerald-400 text-xs (positive) / text-red-400 (negative)
```

### Multi-step Wizard (Driver Onboarding)
Steps:
1. Personal Information
2. Driver's License (upload + manual fields)
3. Vehicle Information
4. Insurance & Registration (upload)
5. Availability & Schedule
6. Confirmation

Use exact same stepper UI as BecomeVendor.

---

*This document is the single source of truth for FairDash design decisions.*
*Always consult before building new components to maintain consistency.*
