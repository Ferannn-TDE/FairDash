# FairSynq — Platform Gap Report
**Generated:** March 22, 2026
**Analyst:** Claude (automated codebase scan)
**Sources:** Addendum V1 (FairDash, March 2026 Build Requirements) · Addendum V2 (FairSynq, March 2026)

---

## 1. Codebase Summary

### Tech Stack
| Layer | Technology | Status |
|---|---|---|
| Framework | Next.js 14 (App Router) + React 18 (SPA via catch-all) | ✅ Live |
| Routing | React Router DOM 6 inside Next.js catch-all | ✅ Live |
| Database | PostgreSQL via Supabase + Prisma ORM 5.22 | ✅ Connected |
| Auth | Clerk (@clerk/clerk-react v5 frontend, @clerk/nextjs v5 server) | ✅ Live |
| Payments | Stripe SDK v14 (initialized, no processing logic yet) | 🟡 Init only |
| Realtime | Firebase Admin SDK (initialized, no usage yet) | 🟡 Init only |
| Queue | BullMQ + ioredis (installed, zero implementation) | 🔴 Unused |
| Maps | @vis.gl/react-google-maps (address autocomplete only) | 🟡 Partial |
| Styling | Tailwind CSS 3 with custom design system | ✅ Live |
| State | React Context (Cart, MobileMenu) + localStorage | ✅ Live |

### File Structure (non-trivial files)
```
prisma/
  schema.prisma          12 models, full relational schema
  seed.ts                Springfield Fair 2026 + 3 vendors + 9 menu items

lib/
  db.ts                  Prisma singleton
  auth.ts                requireAuth / requireVendorAuth / requireAdminAuth
  stripe.ts              Stripe client (no payment logic)
  firebase-admin.ts      Firebase Admin (no realtime logic)
  api-response.ts        success() / apiError() / paginated()
  api-error.ts           ApiError class + handleApiError()
  clerk-appearance.ts    Dark theme config

app/api/
  health/route.ts        ✅ live
  test-db/route.ts       ✅ live (DB connectivity check)
  events/route.ts        ✅ GET list, POST create (admin auth)
  events/[slug]/         ✅ GET by slug
  vendors/route.ts       ✅ GET paginated, POST apply
  vendors/[id]/          ✅ GET + PATCH (busy/offline toggle)
  menu/route.ts          ✅ GET filtered, POST create
  menu/[id]/             ✅ GET + PATCH (sold-out toggle) + DELETE
  orders/route.ts        🔴 501 stub
  orders/[id]/           🔴 501 stub
  admin/route.ts         🔴 501 stub
  admin/dashboard/       🔴 501 stub
  drivers/route.ts       🔴 501 stub (legacy — conflicts with V2 Runner concept)
  drivers/[id]/location/ 🔴 501 stub (legacy)
  webhooks/clerk/        ✅ svix-verified user sync
  webhooks/stripe/       ✅ signature-verified, basic payment_intent + transfer handling

src/views/
  Landing.jsx            Public landing — static hero, NO event discovery
  Home.jsx               Protected 3-col home — search, categories, trending
  Menu.jsx               Menu browse with vendor filter
  Vendors.jsx            Vendor list with search
  VendorDetail.jsx       Single vendor menu
  Checkout.jsx           Hardcoded pickup checkout — NO fulfillment selection
  ManageAccount.jsx      Account settings
  BecomeVendor.jsx       4-step wizard (requirement: 10-step)
  BecomeDriver.jsx       3-step driver wizard
  Contact.jsx / RefundPolicy.jsx
  vendor/VendorDashboard.jsx  Full dashboard UI — mock data, no API connection

src/components/
  Navbar, MobileNavPanel, MobileAccountPanel, ManageAccountPanel
  Cart, FoodCard, SizeSelectionModal, AddressAutocomplete
  SignOutModal, SidePanel, LoadingAnimation, LoadingScreen, Toast, ScrollToTop
```

### Current State Summary
The project has a complete, polished **frontend SPA** running on Next.js with a solid design system. The **database schema and core read APIs** are production-ready. However, **all write operations** (order placement, payment processing, admin portal, fulfillment system, realtime features) are either stubs or entirely absent. The frontend is consuming 100% hardcoded static data — no view is connected to the live database yet.

---

## 2. Feature-by-Feature Gap Table

### 2A — Vendor Dashboard Updates (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Prep time as required field on every menu item (alongside name, photo, price) | V2 | 🔴 NOT STARTED | MenuItem schema has no `prepTime` field. VendorDashboard menu management is UI-only with mock data | Add `prepTime` (Int, minutes) to MenuItem schema. Add required field to menu item create/edit form. Enforce non-null before item goes live |
| Fulfillment type label on every order card (Booth Pickup / Curbside / Home Delivery) | V2 | 🔴 NOT STARTED | Order cards in VendorDashboard show status badges (mock data). No fulfillment type concept exists anywhere | Add `fulfillmentType` to Order model. Render label on each card in VendorDashboard order queue |
| Vendor Dashboard connected to live API data | Both | 🔴 NOT STARTED | VendorDashboard.jsx imports from `vendorPortalData.js` (100% mock) | Wire all stats, order queue, and revenue chart to real API endpoints |
| Store open/closed toggle persists to DB | V1 | 🟡 PARTIAL | Toggle UI exists in VendorDashboard. `isOffline` + `isBusy` fields exist in schema + PATCH API | Connect toggle UI to `PATCH /api/vendors/:id` — UI is currently decorative |
| Vendor menu manager (add/edit/delete items) | V1 | 🟡 PARTIAL | VendorDashboard has "Manage Menu" quick link. Menu CRUD API exists | Build actual menu management UI panel inside VendorDashboard that calls the menu API |

---

### 2B — Fulfillment System (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Replace two delivery models with three fulfillment types | V2 | 🔴 NOT STARTED | Schema has `DeliveryModel` enum (IN_HOUSE, PICKUP_ONLY) on Event model | New `FulfillmentConfig` model (or JSON field) per event storing which of the 3 types are enabled and their config. `FulfillmentType` enum on Order |
| **CURBSIDE — Vehicle description field at checkout** (make, color, license plate) | V2 | 🔴 NOT STARTED | Checkout.jsx has delivery info form with no vehicle fields | New optional OrderDetail fields: `vehicleMake`, `vehicleColor`, `vehiclePlate`. Checkout form conditional block |
| **CURBSIDE — Estimated ready time shown at checkout** | V2 | 🔴 NOT STARTED | No prep time or ETA logic anywhere | Derive from vendor's `avgPrepTime` (sum of item prep times). Show at checkout before confirmation |
| **CURBSIDE — Push notification when ready** | V2 | 🔴 NOT STARTED | Firebase Admin initialized but unused. No notification system | Firebase Cloud Messaging or Realtime DB listener. Trigger on order status → READY when fulfillment is CURBSIDE |
| **CURBSIDE — GPS pin in admin portal** | V2 | 🔴 NOT STARTED | Event schema has `stagingZoneLat/Lng` — intended for staging, not curbside specifically | Add `curbsideZoneLat/Lng` to Event (or FulfillmentConfig). Admin portal GPS pin drop UI using Google Maps |
| **CURBSIDE — Zone text description field** | V2 | 🔴 NOT STARTED | No text description field | Add `curbsideZoneDescription` (String) to event/fulfillment config. Admin portal text field |
| **CURBSIDE — Both GPS pin + text required before enabling** | V2 | 🔴 NOT STARTED | No validation layer | Enforce in admin portal API: cannot set curbside=enabled unless both fields populated |
| **CURBSIDE — Fulfillment method toggle** (Runner brings to car vs. customer walks to window) | V2 | 🔴 NOT STARTED | No concept | `curbsideMethod` enum field (RUNNER_DELIVERS, CUSTOMER_WALKS). Admin toggle |
| **CURBSIDE — Runner app shows curbside queue** | V2 | 🔴 NOT STARTED | No Runner app exists | Separate filtered order queue view in Runner app scoped to CURBSIDE type |
| **BOOTH PICKUP — Label at checkout + on order card** | V2 | 🔴 NOT STARTED | Checkout exists but has no fulfillment type label. No "Booth Pickup" text anywhere | `fulfillmentType` on Order. Conditional render at checkout. Badge on VendorDashboard order cards |
| **HOME DELIVERY — Delivery address at checkout** (street, city, zip) | V2 | 🟡 PARTIAL | Checkout.jsx has an address field — but it's labeled for delivery instructions, not structured | Separate `deliveryStreet`, `deliveryCity`, `deliveryZip` fields. Google Maps autocomplete for home delivery. Add to Order schema |
| **HOME DELIVERY — Delivery fee as separate line item** | V2 | 🔴 NOT STARTED | Checkout shows subtotal, no delivery fee concept | `deliveryFee` field on Order (set from event config). Render as distinct line item in checkout summary |
| **HOME DELIVERY — Delivery radius enforcement** | V2 | 🔴 NOT STARTED | No radius logic | `homeDeliveryRadiusKm` in event fulfillment config. Geofence check at checkout against event lat/long |
| **HOME DELIVERY — Runner transport method text field** (admin) | V2 | 🔴 NOT STARTED | Nothing | `runnerTransportDescription` text field in admin fulfillment config |
| **HOME DELIVERY — Runner app home delivery queue** | V2 | 🔴 NOT STARTED | No Runner app | Filtered queue for HOME_DELIVERY type in Runner app |
| **HOME DELIVERY — Two-leg navigation** (vendor booth → customer home) | V2 | 🔴 NOT STARTED | No navigation feature | Google Maps Directions API integration in Runner app. Leg 1: current location → booth. Leg 2: booth → delivery address |
| **HOME DELIVERY — Real-time Runner location tracking** | V2 | 🔴 NOT STARTED | Firebase Admin initialized only | Firebase Realtime DB: Runner writes GPS coords every N seconds. Customer screen reads live position |
| **HOME DELIVERY — Push notifications** (accepted, picked up, on the way, delivered) | V2 | 🔴 NOT STARTED | No push notification system | FCM or Firebase Realtime DB listeners. 4 trigger points in order lifecycle |

---

### 2C — Checkout Flow (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Customer selects fulfillment type before checkout | V2 | 🔴 NOT STARTED | Checkout.jsx has static form — no fulfillment selection step | Fulfillment type selector component at top of checkout. Reads enabled types from event config |
| Only show fulfillment types enabled by operator | V2 | 🔴 NOT STARTED | No operator config system | Fetch event fulfillment config before rendering checkout. Filter display list accordingly |
| Skip selection if only one type enabled | V2 | 🔴 NOT STARTED | No conditional logic | `if (enabledTypes.length === 1)` → set automatically, skip step |
| Show vehicle fields for Curbside | V2 | 🔴 NOT STARTED | No vehicle fields | Conditional form section rendered when `fulfillmentType === CURBSIDE` |
| Show curbside zone description at checkout | V2 | 🔴 NOT STARTED | No curbside zone | Fetch + render `curbsideZoneDescription` when type is CURBSIDE |
| Show delivery address + delivery fee for Home Delivery | V2 | 🟡 PARTIAL | Address input exists but is generic. No delivery fee display | Conditional structured address section + fee line item for HOME_DELIVERY type |
| Checkout connected to actual order creation API | Both | 🔴 NOT STARTED | Checkout.jsx has a "Place Order" button with no API call | Orders API is a 501 stub. Need full `POST /api/orders` implementation + Stripe PaymentIntent creation |

---

### 2D — Admin Portal (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Admin portal exists | Both | 🔴 NOT STARTED | `GET /api/admin` and `GET /api/admin/dashboard` are 501 stubs. No admin UI | Full admin portal build: event management, vendor approval, fulfillment config |
| Curbside config: on/off toggle | V2 | 🔴 NOT STARTED | — | Admin fulfillment config UI + API endpoint |
| Curbside config: GPS pin drop on map | V2 | 🔴 NOT STARTED | — | Google Maps interactive pin drop in admin portal |
| Curbside config: zone text description field | V2 | 🔴 NOT STARTED | — | Text input + save in admin |
| Curbside config: fulfillment method toggle (Runner/Window) | V2 | 🔴 NOT STARTED | — | Toggle + store in DB |
| Booth Pickup: on/off toggle | V2 | 🔴 NOT STARTED | — | Admin toggle |
| Home Delivery: on/off toggle | V2 | 🔴 NOT STARTED | — | Admin toggle |
| Home Delivery: delivery radius input | V2 | 🔴 NOT STARTED | — | Radius field + save |
| Home Delivery: delivery fee input | V2 | 🔴 NOT STARTED | — | Fee field + save |
| Home Delivery: Runner transport method text | V2 | 🔴 NOT STARTED | — | Text field + save |
| Event status control (Active / Upcoming / Inactive) | V2 | 🟡 PARTIAL | `isActive` (Boolean) on Event model | Replace with 3-state `EventStatus` enum. Admin toggle UI |
| Vendor approval workflow | V1 | 🔴 NOT STARTED | `VendorStatus` enum has PENDING/ACTIVE/PAUSED/SUSPENDED/REJECTED in schema | No admin UI or API for reviewing and approving/rejecting applications |

---

### 2E — Stripe Connect & Payouts

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Stripe client initialized | Both | ✅ DONE | `lib/stripe.ts` with graceful no-key fallback | — |
| Per-transaction payout schema | V1 | ✅ DONE | `Payout` model with `stripeTransferId @unique`, grossAmount, fairDashFee, netAmount | — |
| 7% fee fields on Order | V1 | ✅ DONE | Order schema: `subtotal`, `total`, `fairDashFee`, `vendorPayout` | — |
| Stripe webhook handler (signature verified) | V1 | ✅ DONE | `app/api/webhooks/stripe/route.ts` handles payment_intent.succeeded/failed + transfer.created | — |
| Vendor `stripeAccountId` field | V1 | ✅ DONE | `stripeAccountId` + `stripeVerified` on Vendor model | — |
| Stripe Connect onboarding flow for vendors | V1 | 🔴 NOT STARTED | Fields exist in schema. No onboarding flow, no Connect account creation API | `POST /api/stripe/connect/onboard` — create Connect account, return onboarding URL. UI step in vendor onboarding wizard |
| Create PaymentIntent at checkout | Both | 🔴 NOT STARTED | No order creation logic. Orders API is a 501 stub | `POST /api/orders` must create Stripe PaymentIntent, set `application_fee_amount` = 7% of subtotal |
| 7% fee applies to subtotal ONLY, not delivery fee | V2 | 🔴 NOT STARTED | Schema has separate fields, but no calculation logic exists | Enforce in `POST /api/orders`: `fairDashFee = subtotal * 0.07`. Delivery fee excluded |
| Home delivery fee → event operator via Stripe Connect | V2 | 🔴 NOT STARTED | No delivery fee in schema or checkout | Add delivery fee as separate transfer to event operator's Stripe account (not vendor's) |
| Per-transaction transfer to vendor on order completion | V1 | 🔴 NOT STARTED | Webhook handler records transfer.created events. No transfer initiation | Trigger `stripe.transfers.create()` when order → COMPLETED, with vendor's `stripeAccountId` as destination |

---

### 2F — Customer Landing Page (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Scenario 1: QR scan → direct event page (bypass discovery) | V2 | 🟡 PARTIAL | Events have `urlSlug`. API serves event by slug. No event-specific frontend page yet | Build `/[eventSlug]` route that renders white-label event page |
| Scenario 2: Direct event URL load | V2 | 🟡 PARTIAL | Same as above — routing works in theory but no event page exists | Same as Scenario 1 — same page, same route |
| Scenario 3: Root URL → location detection → nearby events | V2 | 🔴 NOT STARTED | Landing.jsx has static hero content. No location detection, no events list | Geolocation API on mount. Fetch events within radius. Render event cards |
| Event cards (name, location, distance, status badge) | V2 | 🔴 NOT STARTED | No event card component | Build `EventCard` component. Status badge: Active Now / This Weekend / Coming Soon |
| Search bar (find event by name or city) | V2 | 🔴 NOT STARTED | No event search | Search input → `GET /api/events?q=...` (endpoint needs search param added) |
| Scenario 4: No events nearby → message + search + map | V2 | 🔴 NOT STARTED | No empty state for this | Conditional render when geolocation returns no nearby results |
| Event lat/long coordinates in schema | V2 | ✅ DONE | `stagingZoneLat` + `stagingZoneLng` on Event model | Confirm these are used as event location coordinates (naming implies staging zone, not event center — may need `eventLat/Lng` separate fields) |
| Event status field (Active / Upcoming / Inactive) | V2 | 🟡 PARTIAL | `isActive` (Boolean) on Event model | Replace with `EventStatus` enum (ACTIVE, UPCOMING, INACTIVE) for the three-state badge logic |
| QR codes link directly to event URL | V2 | 🔴 NOT STARTED | No QR code generation | Generate QR on event creation (e.g., `qrcode` npm package). Store URL in `qrCodeUrl` field (already in schema) |
| White-label event page (branding per event) | V2 | 🔴 NOT STARTED | Events have `primaryColor` and `logoUrl` in schema | Build event page that reads these and applies as CSS custom properties |

---

### 2G — Vendor Onboarding (10-Step) (Addendum V1)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| 10-step vendor onboarding wizard | V1 | 🟡 PARTIAL | `BecomeVendor.jsx` is a polished 4-step wizard (Business Info → Menu → Terms → Confirm) | Expand to 10 steps. Steps 5–10 are new: document upload, Stripe Connect setup, booth photos, schedule, review/submit |
| Document upload — food handler permit | V1 | 🔴 NOT STARTED | `foodHandlerPermitUrl` field exists in Vendor schema. No upload UI | File upload component. Presigned URL from Supabase Storage or S3. Save URL to vendor record |
| Document upload — insurance certificate | V1 | 🔴 NOT STARTED | `insuranceUrl`, `insuranceExpiryDate`, `insuranceExpired` in schema. No upload UI | Same upload pattern. Date picker for expiry |
| Booth photos upload | V1 | 🔴 NOT STARTED | `boothPhotoUrls` (Json array) in schema. No upload UI | Multi-file upload. Array of URLs stored in JSON field |
| Stripe Connect account creation step | V1 | 🔴 NOT STARTED | `stripeAccountId` + `stripeVerified` in schema. No flow | API call to create Stripe Connect account. Redirect to Stripe hosted onboarding. Webhook confirms verification |
| Vendor application → DB on submit | V1 | 🟡 PARTIAL | `POST /api/vendors` exists and creates a Vendor record in PENDING status | BecomeVendor.jsx currently sets Clerk `unsafeMetadata.isVendor = true` but does NOT call the API. Wire form to API |

---

### 2H — Platform Open & Close (Event Day Lifecycle) (Addendum V1)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Vendor marks themselves offline (entirely) | V1 | ✅ DONE | `isOffline` Boolean on Vendor. `PATCH /api/vendors/:id` with `isOffline` param. API returns 503 when vendor is offline | Connect VendorDashboard toggle to the API |
| Vendor busy/temporarily paused | V1 | ✅ DONE | `isBusy` + `busyUntil` (15-min auto-clear) in schema. PATCH API handles it | Same — connect toggle UI |
| Event-level open/close (operator controls) | V1 | 🔴 NOT STARTED | `isActive` on Event. No operator UI or API to toggle it | Admin portal toggle. Possibly scheduled open/close times |
| Automatic menu item availability (sold-out toggle) | V1 | ✅ DONE | `isAvailable` on MenuItem. `PATCH /api/menu/:id` supports toggle | Connect VendorDashboard menu manager UI to API |
| Order acceptance flow | V1 | 🔴 NOT STARTED | OrderStatus enum has PLACED → ACCEPTED → PREPARING → READY → COMPLETED path | Orders API is a 501 stub. Full order state machine needed |

---

### 2I — Offline Buffering & Connectivity (Addendum V1)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Offline-first architecture mandatory | V1 | 🔴 NOT STARTED | Firebase Admin SDK initialized. BullMQ + ioredis installed | No service worker, no offline queue, no retry logic implemented |
| Orders buffered locally when offline | V1 | 🔴 NOT STARTED | CartContext persists to localStorage | Orders placed offline must be queued and replayed when connectivity restores |
| BullMQ job queue for order retry | V1 | 🔴 NOT STARTED | BullMQ + ioredis in package.json. No queue workers defined | Define queues: order-submission, payout-trigger. Worker processes on reconnect |
| Firebase Realtime DB for <1s order notifications | V1 | 🔴 NOT STARTED | Firebase Admin initialized (`getRealtimeDb()` helper). No reads/writes | Write order events to Realtime DB. Vendor dashboard listens for new orders |
| Service worker / PWA manifest | V1 | 🔴 NOT STARTED | No manifest.json, no sw.js | next-pwa or custom service worker for caching and background sync |

---

### 2J — Edge Cases & Defined Behaviors

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| UNCOLLECTED order status (15-min timeout after READY) | V1 | ✅ DONE | `UNCOLLECTED` in OrderStatus enum. `uncollectedAt` timestamp on Order | Logic to trigger: BullMQ delayed job scheduled when status → READY |
| Cancellation record on every cancellation | V1 | ✅ DONE | `Cancellation` model in schema | Wire to order cancellation API endpoint (which doesn't exist yet) |
| Refund on cancellation | V1 | 🟡 PARTIAL | `refundIssued` + `refundAmount` on Cancellation model | Stripe refund call not implemented |
| Vendor offline returns 503 | V1 | ✅ DONE | `GET /api/vendors/:id` returns 503 with VENDOR_OFFLINE code when `isOffline = true` | — |
| Payment failure → order cancelled automatically | V1 | 🟡 PARTIAL | Stripe webhook handler sets status → CANCELLED on payment_intent.payment_failed | Orders API (source of truth) doesn't exist yet — webhook handler can't update what isn't created |
| **CURBSIDE — Customer no-show: 10-min wait, order forfeited, no refund** | V2 | 🔴 NOT STARTED | UNCOLLECTED status exists but only for 15-min booth pickup | Separate curbside no-show timer. Mark UNCOLLECTED. No refund logic. Runner app action |
| **HOME DELIVERY — Unreachable after 10 min: mark undeliverable, no refund** | V2 | 🔴 NOT STARTED | No UNDELIVERABLE status | Add UNDELIVERABLE to OrderStatus enum. 10-min timer in Runner app. Mark + no-refund flow |
| Insurance expiry tracking | V1 | ✅ DONE | `insuranceExpiryDate` + `insuranceExpired` Boolean on Vendor | Cron job to flip `insuranceExpired = true` when date passes (no cron implemented) |

---

### 2K — Runner App (Addendum V2)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Runner app exists | V2 | 🔴 NOT STARTED | `app/api/drivers/` stubs exist (legacy V1 naming). No Runner UI | Entire Runner app: separate protected view, auth, order queue |
| Curbside order queue (separate from booth) | V2 | 🔴 NOT STARTED | — | Filtered order list in Runner app scoped to CURBSIDE type |
| Home delivery order queue (separate) | V2 | 🔴 NOT STARTED | — | Filtered order list scoped to HOME_DELIVERY type |
| Curbside GPS navigation (to curbside zone) | V2 | 🔴 NOT STARTED | — | Google Maps link/embed. Destination = `curbsideZoneLat/Lng` |
| Home delivery two-leg navigation | V2 | 🔴 NOT STARTED | — | Leg 1: current → vendor booth. Leg 2: booth → customer address |
| Real-time Runner location → customer screen | V2 | 🔴 NOT STARTED | Firebase initialized | Firebase Realtime DB write from Runner. Read + map render on customer order status page |
| Runner contact customer via app | V2 | 🔴 NOT STARTED | — | In-app messaging or phone reveal on undeliverable attempt |

---

### 2L — Platform Rename (FairDash → FairSynq)

| Requirement | Source | Status | What Exists | What's Missing |
|---|---|---|---|---|
| Rename frontend branding | V2 | 🔴 NOT STARTED | "FAIRDASH" hardcoded in Navbar, Landing, Home, Footer, VendorDashboard, ManageAccount, emails, metadata | Global find-replace across all JSX/TSX. Update metadata in app/layout.tsx |
| Rename domain references | V2 | 🔴 NOT STARTED | — | Update NEXT_PUBLIC_APP_URL, any hardcoded fairsynq.com / fairdash.com references |
| Update page title and meta | V2 | 🔴 NOT STARTED | `app/layout.tsx` has title "FairDash" | Update to "FairSynq" |

---

## 3. Conflict Report (V1 vs V2)

### ⚠️ CONFLICT 1 — Delivery Model Architecture (Critical)

| | Addendum V1 | Addendum V2 |
|---|---|---|
| **What it says** | "Delivery model: PICKUP_ONLY or IN_HOUSE (event operator's own staff)" — two options, event-level setting | "Replace the current two delivery model options with three: Booth Pickup, Curbside Pickup, Home Delivery" — per-order customer selection |
| **Current schema** | `DeliveryModel` enum (IN_HOUSE, PICKUP_ONLY) on `Event` model | Incompatible — V2 needs `FulfillmentType` per order |
| **Resolution** | **V2 supersedes V1.** The Event-level `DeliveryModel` enum must be replaced or supplemented with a `FulfillmentConfig` model that stores which of the three types are enabled (as booleans) plus their configuration. The Order model needs a `fulfillmentType` field (BOOTH_PICKUP, CURBSIDE, HOME_DELIVERY). The existing schema `DeliveryModel` enum can remain as a legacy flag but should not drive order behavior. |

---

### ⚠️ CONFLICT 2 — Driver / Runner System (Critical)

| | Addendum V1 | Addendum V2 |
|---|---|---|
| **What it says** | "NO driver dispatch system — pickup-only or in-house delivery only. NO DoorDash Drive integration." Explicitly removed | Introduces "Runner" for Curbside (brings order to car) and Home Delivery (delivers to customer's door). Runner has dedicated app queue, navigation, location tracking |
| **Stub files** | `app/api/drivers/` stubs exist from V1 scaffolding | V2 uses the word "Runner" not "Driver" |
| **Resolution** | **V2 supersedes V1 on this point.** The "Runner" role is NOT the same as V1's "driver dispatch." V1 rejected a DoorDash-style third-party driver marketplace. V2's Runner is an event-staff role (in-house) — more like a coordinator than a driver. The existing `/api/drivers/` routes should be renamed to `/api/runners/`. Build the Runner app as a restricted-access internal tool for event staff, not an open marketplace. |

---

### ⚠️ CONFLICT 3 — Stripe 7% Fee Basis (Minor, Clarification)

| | Addendum V1 | Addendum V2 |
|---|---|---|
| **What it says** | "7% FairDash infrastructure fee auto-deducted" — basis not specified | "FairSynq 7% fee applies to order subtotal only — not the delivery fee. Home delivery fee collected at checkout passed through to event operator via Stripe Connect" |
| **Current schema** | Order has both `subtotal` and `total` fields. No fee calculation logic exists | Incompatible if V1 was implicitly charging 7% of total |
| **Resolution** | **V2 clarifies V1** — apply 7% to `subtotal` only. The schema already separates `subtotal` (items only) from `total` (would include delivery fee once implemented). Fee calculation in `POST /api/orders`: `fairDashFee = subtotal * 0.07`. Delivery fee is a separate pass-through. No code conflict since no calculation logic exists yet. |

---

### ⚠️ CONFLICT 4 — Platform Name

| | Addendum V1 | Addendum V2 |
|---|---|---|
| **What it says** | FairDash throughout | FairSynq throughout |
| **Resolution** | V2 supersedes. Rename everything. |

---

### ⚠️ CONFLICT 5 — Event Location Coordinates (Minor)

| | Addendum V1 | Addendum V2 |
|---|---|---|
| **What it says** | Schema has `stagingZoneLat/Lng` — described as the staging/pickup zone coordinates | "Every event needs lat/long coordinates stored at setup" — for distance calculation in event discovery |
| **Resolution** | The staging zone coordinates serve a different purpose than the event's general location. Add `eventLat` and `eventLng` fields to the Event model for discovery/distance purposes. Keep `stagingZoneLat/Lng` for operational use. Curbside zone will need its own `curbsideZoneLat/Lng` fields separately. |

---

## 4. Completion Percentage Estimates

| Category | % Complete | Notes |
|---|---|---|
| Vendor Dashboard | 20% | UI built with mock data; API exists; not connected; prep time and fulfillment labels missing |
| Fulfillment System | 0% | Schema doesn't support three types yet; no logic built |
| Checkout Flow | 15% | UI shell exists; no fulfillment selection; not connected to any API |
| Admin Portal | 0% | 501 stubs only; no UI |
| Stripe Connect & Payouts | 25% | SDK + schema + webhook handler done; no payment processing or Connect onboarding |
| Customer Landing Page | 10% | Landing page exists but is static; no event discovery; routing partially ready |
| Vendor Onboarding (10-step) | 25% | 4 of 10 steps built; no document upload; not wired to API |
| Platform Open & Close | 30% | Vendor-level controls in schema + API; not connected to UI; event-level missing |
| Offline Buffering | 5% | Firebase + BullMQ installed; zero implementation |
| Edge Cases | 40% | Schema covers most cases; no execution logic |
| Runner App | 0% | Not started |
| Platform Rename | 0% | All branding still says FairDash |
| **OVERALL** | **~14%** | Foundation is solid; execution layer is almost entirely absent |

---

## 5. Recommended Build Priority Order

Dependencies drive this order — each tier must be substantially complete before the next tier can function.

### Tier 1 — Foundation (Blocks everything)
1. **Platform rename** — FairDash → FairSynq in all files. Quick, unblocks client demos.
2. **Schema v2** — Add `fulfillmentType` to Order, `FulfillmentConfig` model, `prepTime` to MenuItem, `EventStatus` enum, `eventLat/Lng`, `curbsideZoneLat/Lng`, `deliveryFee`, `vehicleMake/Color/Plate`, `UNDELIVERABLE` to OrderStatus. Run `prisma db push`.
3. **Order creation API** (`POST /api/orders`) — Creates Stripe PaymentIntent, enforces 7% fee on subtotal, writes order + items to DB. Everything downstream depends on this.

### Tier 2 — Core Transaction Flow (Blocks revenue)
4. **Stripe PaymentIntent + Connect onboarding** — Vendor Stripe Connect account creation flow + per-transaction transfer on completion.
5. **Checkout flow rewrite** — Connect to Order API. Add fulfillment type selection, conditional fields (vehicle details / delivery address), delivery fee line item.
6. **Fulfillment config API** — `GET/PATCH /api/events/:slug/fulfillment` — stores which types are enabled + their settings.

### Tier 3 — Operator Tools (Blocks going live)
7. **Admin portal** — Event management, vendor approval, fulfillment configuration UI (curbside GPS pin, delivery radius/fee, etc.).
8. **Vendor Dashboard → API connection** — Replace all mock data with live API calls. Wire open/close toggles. Add fulfillment type labels.
9. **Vendor menu manager UI** — Built within VendorDashboard. Add `prepTime` field.

### Tier 4 — Fulfillment Execution (Blocks order completion)
10. **Order state machine** — Status transitions: PLACED → ACCEPTED → PREPARING → READY → COMPLETED. `PATCH /api/orders/:id/status`. BullMQ delayed jobs for UNCOLLECTED (15-min) and no-show timeouts.
11. **Vendor order queue (live)** — Firebase Realtime DB: write new orders on creation, vendor dashboard subscribes. Real-time order cards update without refresh.
12. **Runner app** — Separate protected view. Curbside queue + home delivery queue. Status actions.

### Tier 5 — Fulfillment Types 2 & 3 (After Tier 4 is stable)
13. **Curbside fulfillment** — Vehicle fields at checkout, curbside zone display, Runner app curbside queue, GPS navigation to zone.
14. **Home delivery fulfillment** — Delivery address + fee at checkout, radius enforcement, Runner two-leg navigation, real-time Runner location on customer screen.
15. **Push notifications** — Firebase Cloud Messaging for order lifecycle events.

### Tier 6 — Discovery & Growth
16. **Smart customer landing page** — Location detection, event cards, search, white-label event page per slug.
17. **Vendor onboarding 10-step expansion** — Document upload (permit + insurance), booth photos, Stripe Connect step.
18. **QR code generation** — On event creation, store in `qrCodeUrl`.

### Tier 7 — Resilience
19. **Offline buffering** — BullMQ workers, service worker, order replay queue.
20. **SMS/OTP verification** — Pending client confirmation (currently flagged as QUESTION in V2).

---

## Appendix — Files With No API Connection (Hardcoded Data)

Every one of these files currently reads from static utility files and must be migrated to API calls:

| File | Currently Reads From | Must Read From |
|---|---|---|
| `src/views/Home.jsx` | `utils/menuData.js`, `utils/vendorData.js` | `/api/menu`, `/api/vendors` |
| `src/views/Menu.jsx` | `utils/menuData.js` | `/api/menu?eventSlug=...` |
| `src/views/Vendors.jsx` | `utils/vendorData.js` | `/api/vendors?eventSlug=...` |
| `src/views/VendorDetail.jsx` | `utils/vendorData.js` | `/api/vendors/:id` |
| `src/views/Checkout.jsx` | Cart context only | `/api/orders` (POST) |
| `src/views/vendor/VendorDashboard.jsx` | `utils/vendorPortalData.js` | `/api/vendors/:id`, `/api/orders?vendorId=...` |
| `src/views/BecomeVendor.jsx` | Clerk metadata only | `/api/vendors` (POST) |

---

*End of Gap Report — FairSynq Platform v1.5 → V2 | March 22, 2026*
