# FairDash — Stripe Integration & Data Fix Plan

Full audit completed 2026-04-26. Work through each priority block top to bottom.
Check off each item as you complete it.

---

## SESSION LOG

### 2026-04-26 — Session 1

**P1-A** ✅ PASS — Menu page now fetches `/api/menu?eventSlug=` on mount. 44 real items returned with CUID IDs. `v.menu` mock reference removed. Stale localStorage cart busted via `CART_VERSION` key.

**P1-B** ✅ PASS — Order detail page (`/fair/[slug]/order/[id]`) now fetches `/api/orders/[id]` on mount. Mock hardcoded order data removed. Cancel button wired to `POST /api/orders/[id]/cancel` (real API). Loading skeleton added. TypeScript clean.

**P1-C** ✅ PASS — Orders list page (`/fair/[slug]/orders`) now fetches `GET /api/orders?limit=50` on mount. Hardcoded empty state replaced. Loading state driven by real fetch. TypeScript clean.

**P1-D** ✅ PASS — FulfillmentConfig row created in DB for event `cmni6x63n000011znjwlln5k2` (Italian Fest 2026): `boothPickup=true`, `curbside=true`, `homeDelivery=false`. Verified returned by `/api/events/springfield-fair-2026`. `FairContext` now exposes `fulfillmentConfig` + `serviceChargeEnabled` + `serviceChargeAmount` on `FairData`. Checkout page now reads real config from context — fulfillment mode pills are filtered by what's actually enabled in the DB. Hardcoded `cfg` mock object removed from checkout.

**Verified clean:** All 4 changed pages pass `tsc --noEmit`. Pre-existing TS errors in `analytics/page.tsx` are unrelated to this session's work.

### 2026-04-26 — Session 2

**DB alignment** ✅ PASS — All 17 vendors already on `springfield-fair-2026` event. No migration needed.

**Browse page** ✅ PASS — Created `app/fair/[fairSlug]/browse/page.tsx`:
- Fetches `/api/vendors` + `/api/menu` in parallel on mount (17 vendors, 44 items — all real CUIDs)
- Groups items under vendor sections with sticky scrollable vendor pill strip
- Inline add-to-cart + qty controls using `useFairCart` (same CART_VERSION as menu page)
- Desktop: sticky cart sidebar with subtotal + checkout link
- Mobile: floating cart FAB that opens slide-in drawer
- IntersectionObserver highlights active vendor pill as user scrolls
- TypeScript clean

**Vendors page** ✅ PASS — Added "Browse All & Order" button (accent-colored pill) linking to `/fair/[slug]/browse`.

### 2026-04-26 — Session 3

**P2-C slug fix** ✅ PASS — `scripts/fix-event-slug.ts` created and executed. DB field is `urlSlug` (not `slug` — the provided script had the wrong field name; corrected before running). Updated `springfield-fair-2026` → `springfield-state-fair-2026`. Verified: `/api/events/springfield-state-fair-2026` returns event + fulfillmentConfig. `/api/vendors` returns 17. `/api/menu` returns 44. Old slug correctly 404s.

---

## PRIORITY 1 — Get Stripe Payments Working End-to-End

These items are blocking a real payment from completing successfully.

---

### P1-A — Wire Menu Page to Real API (MOST CRITICAL — DO THIS FIRST)

**Problem:**
The menu page (`/fair/[fairSlug]/menu/page.tsx`) uses hardcoded mock data from `lib/mock/`.
Mock menu items have IDs like `mi_001`. When added to cart and submitted at checkout,
`POST /api/orders` does `db.menuItem.findMany({ where: { id: { in: [...] } } })`,
finds nothing, and returns `"Menu item not found"` — the payment never starts.

**What to do:**
- In `app/fair/[fairSlug]/menu/page.tsx`, add a `useEffect` that calls:
  ```
  GET /api/menu?eventSlug=[fairSlug]&limit=100
  ```
- Replace the mock-derived `FlatMenuItem[]` state with the API response.
- The `/api/menu` route is fully implemented and returns real DB items with real CUIDs.
- Build the cart from those real items — then the IDs sent to `POST /api/orders` will match the DB.

**API response shape** (from `GET /api/menu`):
```json
{
  "success": true,
  "data": [
    {
      "id": "cmni6x6dg000411zn0dkahkma",
      "name": "Pulled Pork Sandwich",
      "price": 12.99,
      "category": "Sandwiches",
      "vendorId": "cmni6x68q000211znxtpw0076",
      "isAvailable": true,
      "imageUrl": null,
      "prepTime": 10
    }
  ],
  "pagination": { "total": 44, "page": 1, "limit": 100, "pages": 1 }
}
```

**Also clear stale localStorage carts** — any cart saved before this fix has mock IDs
that will never work. Add a cart version key to localStorage and clear on mismatch.

- [x] Fetch real menu items from `/api/menu?eventSlug=[slug]`
- [x] Replace mock FlatMenuItem state with API data
- [x] Handle loading + empty states
- [x] Clear/invalidate stale localStorage carts with mock IDs

---

### P1-B — Wire Order Detail Page to Real API

**Problem:**
After payment succeeds, Stripe redirects to `/fair/[slug]/order/[orderId]`.
That page renders an empty shell — it has no `useEffect` fetching the order.
The route `GET /api/orders/[id]` is fully implemented and returns everything needed.

**What to do:**
- In `app/fair/[fairSlug]/order/[orderId]/page.tsx`, add:
  ```
  GET /api/orders/[orderId]
  ```
- Map the response to whatever fields the page renders (status, items, total, fulfillmentType, etc.)
- Show a loading skeleton while fetching.
- Handle the case where the order doesn't belong to the current user (API returns 403).

**API response shape** (from `GET /api/orders/[id]`):
```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "PLACED",
    "fulfillmentType": "BOOTH_PICKUP",
    "subtotal": 31.97,
    "total": 31.97,
    "fairSynqFee": 2.24,
    "customerName": "John Doe",
    "customerPhone": "555-1234",
    "vendor": { "name": "RANDY'S HOUSE OF BBQ", "boothNumber": "B12" },
    "orderItems": [
      { "quantity": 2, "unitPrice": 12.99, "menuItem": { "name": "Pulled Pork Sandwich" } }
    ],
    "placedAt": "2026-04-26T..."
  }
}
```

- [x] Add `useEffect` fetch to order detail page
- [x] Map response fields to page UI
- [x] Loading + error states

---

### P1-C — Wire Orders List Page to Real API

**Problem:**
`/fair/[fairSlug]/orders/page.tsx` has:
```typescript
const [orders] = useState<OrderSummary[]>([])
```
Hardcoded empty — the user sees no orders even after a successful payment.
`GET /api/orders` is fully implemented (cursor-paginated).

**What to do:**
- In `app/fair/[fairSlug]/orders/page.tsx`, add:
  ```
  GET /api/orders
  ```
- Map response to the UI's `OrderSummary` type.
- Show real orders with status, vendor name, total, and date.

**API response shape** (from `GET /api/orders`):
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "...",
        "status": "PLACED",
        "total": 31.97,
        "placedAt": "...",
        "vendor": { "name": "RANDY'S HOUSE OF BBQ" },
        "orderItems": [
          { "quantity": 2, "menuItem": { "name": "Pulled Pork Sandwich", "imageUrl": null } }
        ]
      }
    ],
    "nextCursor": null
  }
}
```

- [x] Replace hardcoded empty state with real fetch
- [x] Map response to UI
- [x] Handle empty state (no orders yet) vs loading state

---

### P1-D — Fix FulfillmentConfig (Missing DB Row)

**Problem:**
The real event (`springfield-fair-2026`) has NO `FulfillmentConfig` row in the DB.
The order API skips mode validation when config is null (accepts any mode), so orders
go through, but the checkout UI cannot know which modes are actually enabled.
The hardcoded mock `cfg` object in `checkout/page.tsx` always shows all three modes.

**What to do:**
Option A (quick — just seed the DB):
Run this SQL or a Prisma script to create the config:
```sql
INSERT INTO "FulfillmentConfig" (
  "id", "eventId", "boothPickupEnabled", "curbsideEnabled", "homeDeliveryEnabled",
  "homeDeliveryFee", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'cmni6x63n000011znjwlln5k2',  -- Italian Fest 2026 event ID
  true, true, false,             -- enable booth + curbside; disable home delivery for now
  2.99,
  now(), now()
);
```

Option B (proper — read config from the event API):
`GET /api/events/[slug]` already returns `fulfillmentConfig` in the response.
Replace the hardcoded `cfg` object in `checkout/page.tsx` with:
```typescript
const cfg = fair.fulfillmentConfig  // needs to be added to FairData type + context
```
Then only show fulfillment options that are enabled in the config.

- [x] Create FulfillmentConfig row in DB (Option A + B both done)
- [x] Expose fulfillmentConfig through FairContext and use it in checkout
- [x] Remove hardcoded `cfg` mock object from checkout page

---

### P1-E — Vendor Stripe Connect (Non-Blocking for Testing)

**Problem:**
All 17 vendors have `stripeVerified: false` and `stripeAccountId: null`.
When `POST /api/orders` creates a Stripe PaymentIntent, it checks:
```typescript
if (vendor.stripeAccountId && vendor.stripeVerified) {
  piParams.application_fee_amount = ...
  piParams.transfer_data = { destination: vendor.stripeAccountId }
}
```
Since both are false, it creates a plain PI with no transfer. Money goes to your
platform Stripe account. The Stripe webhook handler waits for `transfer.created`
events that never come.

**Impact during testing:** Payments succeed and complete. You can test the full
card flow. You just cannot pay vendors out yet.

**What to do (for production):**
- Implement a vendor Stripe Connect onboarding flow (OAuth or account link)
- Set `stripeAccountId` and `stripeVerified = true` per vendor after onboarding
- After `payment_intent.succeeded` webhook fires, create the transfer:
  ```typescript
  await stripe.transfers.create({
    amount: Math.round(vendorPayout * 100),
    currency: 'usd',
    destination: vendor.stripeAccountId,
    transfer_group: orderId,
    metadata: { orderId, vendorId, eventId }
  })
  ```

- [ ] (When ready for production) Build vendor Stripe Connect onboarding
- [ ] Add transfer creation in webhook handler after payment_intent.succeeded
- [ ] Set stripeVerified + stripeAccountId on vendors

---

## PRIORITY 2 — Replace All Other Mock Data

Do these after P1 is working.

---

### P2-A — Vendor Dashboard → Real Orders

**Problem:**
`/vendor/[fairSlug]/dashboard` imports from `lib/mock/vendor-dashboard.ts`.
Hardcoded mock orders for all columns (incoming, active, ready, completed).
No real data fetch. Vendor never sees actual orders.

**What to do:**
- Fetch vendor's orders from `GET /api/vendors/[id]/orders` (verify this route is implemented)
- OR subscribe to Firebase RTDB path `fairs/{eventId}/orders/{vendorId}/*` for
  live incoming orders (this is already written to by `POST /api/orders`)
- Map status values to dashboard columns:
  - `PLACED` → Incoming
  - `ACCEPTED` / `PREPARING` → Active
  - `READY` → Ready
  - `COMPLETED` / `COLLECTED` → Completed

**Firebase RTDB path written by backend:**
```
fairs/{eventId}/orders/{vendorId}/{orderId}
{
  orderId, status, fulfillmentType, customerName, customerPhone,
  subtotal, deliveryFee, total, itemCount, itemSummary, placedAt
}
```

- [ ] Verify `GET /api/vendors/[id]/orders` exists and is implemented
- [ ] Add Firebase RTDB listener for live incoming orders (or poll the API)
- [ ] Replace all mock order state with real data
- [ ] Wire "Accept / Decline" buttons to `PATCH /api/orders/[id]/status`

---

### P2-B — Vendor Analytics → Real Revenue Data

**Problem:**
`/vendor/[fairSlug]/analytics` uses hardcoded `MOCK_STATS` and synthetic
`buildChartData()`. Charts are fake.

**What to do:**
- Call `GET /api/vendors/[id]/revenue` (verify this route exists and is implemented)
- If the route doesn't exist, create it — it should query `Order` + `Payout` tables
  grouped by date to return:
  - Total revenue
  - Order counts by status
  - Revenue over time (for chart)
  - Top items by quantity sold

- [ ] Verify `/api/vendors/[id]/revenue` route exists and returns real data
- [ ] Replace MOCK_STATS with API response
- [ ] Replace buildChartData() with real time-series data from API

---

### P2-C — Fair Slug Consistency

**Problem:**
Mock fairs use slug `springfield-state-fair-2026`.
Real DB event uses slug `springfield-fair-2026`.
If users navigate to `/fair/springfield-state-fair-2026`, FairContext fetches
`/api/events/springfield-state-fair-2026` which returns 404. The vendor list
falls back to mock data with mock IDs → payments break.

**What to do:**
- Either update the mock data slug to match the DB slug, or
- Seed the DB with the mock fair data (all 4 fairs, their vendors, and menu items)
- Recommended: Create a Prisma seed script (`prisma/seed.ts`) that seeds the DB
  with a consistent set of test fairs, vendors, and menu items matching the mock data's IDs/slugs

- [ ] Align mock slugs with DB slugs OR seed DB with mock data
- [ ] Confirm navigating to a fair URL shows real vendor names + real menu items

---

## PRIORITY 3 — Bugs Likely to Surface Once Real Data Flows

These are not blockers today but will bite you once P1 and P2 are done.

---

### P3-1 — Stale localStorage Cart

Cart is persisted in localStorage under key `fairsynq-cart-[fairSlug]`.
If a user has an old cart saved with mock menu IDs (e.g. `mi_001`), those IDs
will permanently fail `POST /api/orders` validation even after the menu page is
fixed. You need a cache-busting strategy.

**Fix:** Add a `cartVersion` key to localStorage. On app load, if
`cartVersion !== CURRENT_VERSION`, clear the cart and update the version.

---

### P3-2 — Service Charge Mismatch (UI Shows Charge DB Doesn't Apply)

The checkout page has a hardcoded `cfg` object with `serviceChargeEnabled: true`
and `serviceChargeAmount: $2.50`. The real event in DB has `serviceChargeEnabled: false`.

When the backend re-prices the order, `serviceCharge = 0`. But the checkout UI
displays `$2.50`. The order total shown to the user before payment will be higher
than the actual charge.

**Fix:** Use the real event's serviceCharge config (from FairContext/API) instead
of the hardcoded cfg object.

---

### P3-3 — Commission Rate Displayed vs Applied

UI mock config shows 10% platform fee. Real DB vendors have `commissionRate: 0.07` (7%).
The order summary in the checkout shows an estimated fee based on the mock rate.
The actual PI amount uses the DB rate.

**Fix:** After P1-D (FulfillmentConfig), also read commission rate from the API
response and display it in the checkout summary.

---

### P3-4 — Order Status Transition Buttons Not Wired

The vendor dashboard has "Accept / Decline" buttons (and presumably Prepare/Ready/Complete).
These likely should call `PATCH /api/orders/[id]/status`.
If they are wired to nothing, orders stay in `PLACED` status indefinitely.
The BullMQ job queued by `POST /api/orders` auto-cancels after 2 minutes if not accepted.

**Fix:** 
- Verify `/api/orders/[id]/status` route exists and handles status transitions
- Wire vendor dashboard buttons to that endpoint
- On success, update local order state to reflect new status

---

### P3-5 — No Transfer to Vendor (Money Stays in Platform Account)

After `payment_intent.succeeded`, the webhook updates `Order.stripeChargeId` but
does NOT initiate a transfer to the vendor. The `Payout` table stays empty.
Vendors cannot receive funds.

This is fine for testing (no real money). Must be fixed before any vendor goes live.

**Fix:** See P1-E above.

---

### P3-6 — `operatorStripeAccountId` is Null on Event

The real event has `operatorStripeAccountId: null`. Any route that tries to
transfer the service charge or delivery fee to the event operator will fail.
Not an immediate crash risk since no transfer logic is currently wired, but needs
to be set before settlement logic is implemented.

---

## DB REFERENCE

### Real Event in DB
```
id:      cmni6x63n000011znjwlln5k2
name:    Italian Fest 2026
slug:    springfield-fair-2026
status:  ACTIVE
dates:   2026-06-01 to 2026-06-07
serviceChargeEnabled: false
operatorStripeAccountId: null
```

### Current Row Counts
```
Event:             1
Vendor:           17  (all ACTIVE, all stripeVerified: false)
MenuItem:         44
Order:             2  (both PLACED, from test runs)
User:              3
FulfillmentConfig: 0  ← missing
Payout:            0
OrderItem:         ?
```

### Key API Endpoints
```
GET  /api/events/[slug]              → event + fulfillmentConfig + vendor count
GET  /api/vendors?eventSlug=[slug]   → paginated active vendors
GET  /api/menu?eventSlug=[slug]      → paginated menu items (real IDs)
POST /api/orders                     → create order + Stripe PI
GET  /api/orders                     → list user's orders
GET  /api/orders/[id]                → single order detail
POST /api/webhooks/stripe            → Stripe event handler
```

### Stripe Test Cards
```
4242 4242 4242 4242  → Success
4000 0000 0000 9995  → Declined (insufficient funds)
4000 0000 0000 0002  → Generic decline
4000 0025 0000 3155  → Requires 3D Secure (popup appears)
Expiry: any future date  CVC: any 3 digits  ZIP: any 5 digits
```

---

## WORK ORDER (Recommended Sequence)

```
[x] P1-A  Menu page fetches real API → real menu IDs in cart          ✅ 2026-04-26
[x] P1-B  Order detail page fetches /api/orders/[id]                   ✅ 2026-04-26
[x] P1-C  Orders list page fetches /api/orders                         ✅ 2026-04-26
[x] P1-D  Create FulfillmentConfig row in DB                           ✅ 2026-04-26
[x] P3-1  Add cart version / stale cart invalidation                   ✅ 2026-04-26
[x] P3-2  Use real serviceCharge from event API in checkout UI         ✅ 2026-04-26
[x] P2-C  Align fair slugs (mock vs DB)                                ✅ 2026-04-26
[ ] P2-A  Vendor dashboard → real order data
[ ] P2-B  Vendor analytics → real revenue data
[ ] P3-4  Wire vendor order status buttons to API
[ ] P1-E  Vendor Stripe Connect onboarding (when ready for production)
[ ] P3-5  Transfer creation in webhook after payment_intent.succeeded
[ ] P3-6  Set operatorStripeAccountId on event
```
