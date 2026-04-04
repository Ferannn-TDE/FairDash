# FairSynq — Master Execution Plan V4
**Supersedes:** PLAN_V3_MAR22.md (deleted)
**Sources:** Codebase audit (April 2026) + Operations Playbook V4.0 + Sales Guide
**Last Updated:** April 2026

---

## Overall Status

| Step | Status | Summary |
|---|---|---|
| 1 — Next.js Migration | ✅ Complete | Nothing outstanding |
| 2 — DB + Core Backend | ✅ Code complete ⚠️ Infra not configured | 8 env secrets empty — configure before anything else |
| 3 — Core Order Flow | 🟡 ~60% done | Fee wrong (7%→10%), checkout not wired, tracking page missing |
| 4 — Fulfillment + Runner App | 🔴 Not started | Entire system |
| 5 — Vendor System | 🟡 ~20% done | API wiring, menu manager, 10-step wizard, Stripe Connect, BecomeVendor bug |
| 6 — Admin Portal | 🔴 Not started | All 501 stubs |
| 7 — Customer Experience | 🔴 Not started | Landing rewrite, white-label routes, history/favorites |
| 8 — Multi-Vendor Assembly | 🔴 Not started | Schema rewrite, cart update, MasterOrder |
| 9 — Dispute & Refund | 🔴 Not started | Entire new system |
| 10 — Production Ready | 🔴 Not started | Auth model, security, testing, deploy |

**Completion:** ~30% code complete, ~15% functional with configured infrastructure.

---

## What the Playbook Changes vs. V3

Every item below is a new or corrected requirement from the Operations Playbook V4.0 and Sales Guide that overrides or supplements V3.

| Item | V3 Assumption | Playbook Truth | Impact |
|---|---|---|---|
| Vendor accept window | 10 min | **2 minutes** | BullMQ job delay = 120,000ms |
| Curbside no-show timeout | 15 min | **10 minutes** | BullMQ job delay = 600,000ms |
| Platform fee | 7% hardcoded constant | **10%, read from `vendor.commissionRate`** | Fix `app/api/orders/route.ts:14` |
| Vendor offline auto-hide | Manual toggle only | **5 min heartbeat → auto-hide from menu** | New heartbeat system + BullMQ job |
| Cancellation fee | None | **$5.00 after vendor taps Accept (Start Order)** | New Stripe partial refund logic |
| Admin heartbeat | Not designed | **Every 30 seconds, shows dropped devices** | Firebase presence system |
| Operator service charge | Not designed | **Operator sets per-order charge, 100% to operator** | New feature + Stripe transfer |
| Runner curbside photo | Not designed | **Mandatory photo before Delivered** | Photo upload in Runner app |
| GPS delivery confirmation | Not designed | **Must be within 100 meters of address** | Server-side haversine validation |
| Platform pause | Not designed | **One-button pause in admin portal** | `Event.isPaused` + order creation check |
| Customer auth | OTP every order (TBD in V3) | **Phone number + password (account-based)** | Clerk dashboard config, confirmed Option A |
| Post-event report | Manual | **Auto-generate + email within 48 hrs of close** | BullMQ job + email service |
| Offline-first | Flagged as TBD | **Confirmed required** — vendor dashboards survive connectivity loss | Service worker, Phase 4.2 |
| 2026 pricing | Unknown | **Free for operators, 10% vendor fee** | No licensing billing needed in 2026 |
| 2027 pricing | Unknown | **$750–$5,000/event + 10% vendor fee** | Billing system Phase 4.1 |
| Consulting | Not a platform feature | **$1,500/day, tracked and invoiced outside platform** | Manual — not software |

---

## Platform Constants

All operational numbers from the playbook live in one file. Reference this, never hardcode.

**Create `lib/constants.ts`:**

```typescript
export const PLATFORM_FEE_RATE            = 0.10         // 10% of subtotal
export const VENDOR_ACCEPT_TIMEOUT_MS     = 2 * 60 * 1000     // 2 minutes
export const VENDOR_OFFLINE_HEARTBEAT_MS  = 5 * 60 * 1000     // 5 min heartbeat stale = auto-hide
export const CURBSIDE_WAIT_TIMEOUT_MS     = 10 * 60 * 1000    // 10 min then forfeited
export const HOME_DELIVERY_GPS_RADIUS_M   = 100               // 100 meters
export const ORDER_CANCELLATION_FEE_USD   = 5.00              // $5 after Start Order
export const RUNNER_MIN_COMPLETION_RATE   = 0.90              // 90%
export const ADMIN_HEARTBEAT_INTERVAL_MS  = 30_000            // 30 seconds
export const INCIDENT_AUTO_REFUND_MS      = 5 * 60 * 1000     // 5 min if no operator response
export const DISPUTE_ESCALATION_MS        = 24 * 60 * 60 * 1000  // 24 hours
export const POST_EVENT_REPORT_HOURS      = 48                // hours after close
export const MAX_VENDORS_PER_ORDER        = 5
export const CONSULTING_RATE_USD          = 1_500             // per day, invoiced manually
```

---

## Section 1 — Complete Schema Migration (Run Once)

All schema changes across all phases in a single migration. All additive except `commissionRate` default correction.

```prisma
// ── Fix: platform fee default ─────────────────────────────────────────────────
// Vendor.commissionRate
commissionRate Float @default(0.10)   // was 0.07

// ── Event: 7 new fields ───────────────────────────────────────────────────────
description             String?
timezone                String    @default("America/Chicago")
isPaused                Boolean   @default(false)       // one-button platform pause
serviceChargeEnabled    Boolean   @default(false)       // operator revenue stream
serviceChargeAmount     Float?                          // e.g., 1.50 per order
operatorStripeAccountId String?                         // service charge + delivery fee routing
organizerId             String?                         // FK to FairOrganizer

// ── FairOrganizer (new model) ─────────────────────────────────────────────────
model FairOrganizer {
  id               String   @id @default(cuid())
  name             String
  contactEmail     String
  contactPhone     String?
  website          String?
  stripeCustomerId String?   // for 2027 licensing billing
  createdAt        DateTime  @default(now())
  fairs            Event[]
  members          OrgMember[]
}

model OrgMember {
  id          String        @id @default(cuid())
  organizerId String
  organizer   FairOrganizer @relation(fields: [organizerId], references: [id])
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  role        String        @default("member")  // owner | member
  createdAt   DateTime      @default(now())
  @@unique([organizerId, userId])
}

// ── Order: 8 new fields ───────────────────────────────────────────────────────
serviceCharge    Float?     // operator's per-order fee
cancellationFee  Float?     // $5 if customer cancels after ACCEPTED
startedAt        DateTime?  // when vendor taps Accept
estimatedReadyAt DateTime?  // placedAt + max(item.prepTime)
runnerId         String?
dispatchedAt     DateTime?
curbsidePhotoUrl String?    // mandatory photo for curbside delivery
runnerConfirmedLat Float?   // GPS at delivery confirmation
runnerConfirmedLng Float?

// ── Vendor: 1 new field ───────────────────────────────────────────────────────
lastHeartbeatAt DateTime?   // for 5-min offline auto-hide

// ── User: 1 new field ─────────────────────────────────────────────────────────
fcmToken String?            // Firebase Cloud Messaging push token

// ── OrderStatus: 2 new values ─────────────────────────────────────────────────
// Add to enum OrderStatus:
RUNNER_COLLECTED   // Runner confirmed pickup from vendor booth
DELIVERED          // Runner confirmed delivery (HOME_DELIVERY terminal state)

// ── Runner (new model) ────────────────────────────────────────────────────────
model Runner {
  id                String       @id @default(cuid())
  userId            String       @unique
  user              User         @relation(fields: [userId], references: [id])
  eventId           String
  event             Event        @relation(fields: [eventId], references: [id])
  status            RunnerStatus @default(OFFLINE)
  completionRate    Float        @default(1.0)
  totalDispatched   Int          @default(0)
  totalCompleted    Int          @default(0)
  currentLat        Float?
  currentLng        Float?
  locationUpdatedAt DateTime?
  createdAt         DateTime     @default(now())
  @@index([eventId])
  @@index([status])
}

enum RunnerStatus { OFFLINE ACTIVE ON_DELIVERY }

// ── IncidentReport (new model) ────────────────────────────────────────────────
model IncidentReport {
  id            String       @id @default(cuid())
  orderId       String
  order         Order        @relation(fields: [orderId], references: [id])
  runnerId      String
  type          IncidentType
  affectedItems Json?        // array of orderItemIds; null = whole order
  notes         String?
  photoUrl      String?
  reportedAt    DateTime     @default(now())
  resolvedAt    DateTime?
  resolution    String?      // full_refund | partial_refund | replacement | none
  autoRefundTriggered Boolean @default(false)
  @@index([orderId])
}

enum IncidentType { DROPPED DAMAGED LOST MISSING_ITEMS }

// ── Dispute (new model) ───────────────────────────────────────────────────────
model Dispute {
  id          String        @id @default(cuid())
  orderId     String
  order       Order         @relation(fields: [orderId], references: [id])
  vendorId    String
  vendor      Vendor        @relation(fields: [vendorId], references: [id])
  reason      String
  evidence    Json?
  status      DisputeStatus @default(OPEN)
  submittedAt DateTime      @default(now())
  resolvedAt  DateTime?
  resolution  String?
  @@index([vendorId])
  @@index([status])
}

enum DisputeStatus { OPEN RESOLVED ESCALATED }

// ── OrderEvent audit log (new model) ─────────────────────────────────────────
model OrderEvent {
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  eventType String   // placed | accepted | preparing | ready | completed | cancelled | etc.
  actorId   String?
  actorRole String?  // customer | vendor | runner | system
  metadata  Json?
  timestamp DateTime @default(now())
  @@index([orderId])
}

// ── PostEventReport (new model) ───────────────────────────────────────────────
model PostEventReport {
  id                String   @id @default(cuid())
  eventId           String   @unique
  event             Event    @relation(fields: [eventId], references: [id])
  generatedAt       DateTime @default(now())
  emailedAt         DateTime?
  totalOrders       Int
  totalRevenue      Float
  revenueByType     Json     // { BOOTH_PICKUP: x, CURBSIDE: y, HOME_DELIVERY: z }
  vendorBreakdown   Json     // per-vendor: revenue, orderCount, avgFulfillmentTime, cancellationRate
  peakWindows       Json     // busiest 30-min periods
  runnerPerformance Json
  cancellationLog   Json
  platformIssues    Json?
  recommendations   String?
  pdfUrl            String?
}

// ── FavoriteItem (new model) ──────────────────────────────────────────────────
model FavoriteItem {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  menuItemId String
  menuItem   MenuItem @relation(fields: [menuItemId], references: [id])
  createdAt  DateTime @default(now())
  @@unique([userId, menuItemId])
}
```

**Run migration:**
```bash
npx prisma migrate dev --name "v4-playbook-requirements"
npx prisma generate
```

---

## Section 2 — BullMQ Jobs Registry

All jobs the platform runs. Single queue `fairsynq-orders`. Job metadata always includes `eventId`.

| Job Name | Constant | Delay | Trigger | Worker Action |
|---|---|---|---|---|
| `mark-unaccepted` | `JOB_UNACCEPTED` | **2 min** | Order PLACED | PLACED → CANCELLED + full refund |
| `mark-uncollected` | `JOB_UNCOLLECTED` | **10 min** | BOOTH_PICKUP/CURBSIDE → READY | READY → UNCOLLECTED, no refund |
| `mark-undeliverable` | `JOB_UNDELIVERABLE` | **10 min** | HOME_DELIVERY → READY | READY → UNDELIVERABLE, no refund |
| `auto-hide-vendor` | `JOB_HIDE_VENDOR` | **5 min** | Heartbeat stale in Firebase | `Vendor.isOffline = true` |
| `incident-auto-refund` | `JOB_INCIDENT_REFUND` | **5 min** | IncidentReport filed | Issue refund if no operator response |
| `escalate-dispute` | `JOB_ESCALATE_DISPUTE` | **24 hr** | Dispute OPEN filed | status → ESCALATED |
| `generate-post-event-report` | `JOB_POST_EVENT_REPORT` | 0 (async) | Close Event | Build report + email operator |
| `bulk-refund-event` | `JOB_BULK_REFUND` | 0 (async) | Emergency Cancel | Refund all open orders |

**Update `lib/queues.ts`:**
- Add all new job name constants
- Add `eventId: string` to `JobData` interface
- All existing handlers in `workers/order-worker.ts` need `eventId` added to their payload

---

## Section 3 — Firebase RTDB Structure (Post-Restructure)

All paths namespaced under `fairs/{eventId}/`. Update every Firebase read/write in the codebase.

```
fairs/
  {eventId}/
    orders/
      {vendorId}/
        {orderId}/          ← vendor dashboard listens here
    customerOrders/
      {customerId}/
        {orderId}/          ← customer tracking page listens here
    runnerLocation/
      {runnerId}/           ← { lat, lng, timestamp } written every 5s by runner app
    runnerDispatches/
      {runnerId}/           ← new dispatch pushed here for runner app
    heartbeats/
      {vendorId}            ← timestamp, updated every 30s by vendor dashboard
    adminHeartbeat          ← timestamp, updated every 30s by admin portal
```

**Files to update:**
- `app/api/orders/route.ts:393` — POST handler Firebase write
- `app/api/orders/[id]/status/route.ts` — all status transition Firebase writes
- `workers/order-worker.ts` — UNCOLLECTED/UNDELIVERABLE Firebase writes
- `src/views/vendor/VendorDashboard.jsx` — listener path
- `src/views/TrackOrder.jsx` — listener path (when built)

---

## Section 4 — Environment Variables

Configure ALL of these in `.env.local` AND Vercel dashboard before any build work.
Nothing below works until these are set.

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...         # CRITICAL — user sync broken without this

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...          # CRITICAL — all payments broken without this
STRIPE_WEBHOOK_SECRET=whsec_...        # CRITICAL — payout recording broken without this

# Firebase
FIREBASE_PROJECT_ID=...                # CRITICAL — real-time notifications broken
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://...-rtdb.firebaseio.com

# Redis (BullMQ)
REDIS_URL=rediss://...                 # CRITICAL — all job queues broken without this

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...   # address autocomplete, delivery radius

# Email (for post-event reports)
RESEND_API_KEY=re_...                  # or SENDGRID_API_KEY

# App
NEXT_PUBLIC_APP_URL=https://fair-synq.vercel.app
```

**Clerk dashboard configuration (phone auth — no code required):**
1. User & Authentication → Email, Phone, Username
2. Enable "Phone number" as primary identifier
3. Sign-in strategy: "Phone number + Password"
4. Disable email as primary (make optional or disable)

---

## TIER 0 — Immediate Fixes (Do Before Anything Else)

Bugs and misconfigurations in existing code. Fix today. Total time: ~2 hours.

### T0.1 — Fix Platform Fee 7% → 10% (15 min)

**`app/api/orders/route.ts:14`** — remove hardcoded constant:
```typescript
// DELETE: const PLATFORM_FEE_RATE = 0.07
// DELETE: const fairSynqFee = parseFloat((subtotal * PLATFORM_FEE_RATE)...

// REPLACE WITH (line ~257):
import { PLATFORM_FEE_RATE } from '@/lib/constants'
const fairSynqFee = parseFloat((subtotal * vendor.commissionRate).toFixed(2))
```

**`prisma/schema.prisma`** Vendor model:
```prisma
commissionRate Float @default(0.10)   // was 0.07
```

### T0.2 — Fix BecomeVendor Critical Bug (1 hour)

**`src/views/BecomeVendor.jsx`** — final step submit handler. Currently only sets Clerk metadata and stops. Vendors have auth but no DB record, making every vendor API call fail silently.

Add after Clerk metadata update:
```javascript
const response = await fetch('/api/vendors', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventSlug: new URLSearchParams(window.location.search).get('event'),
    name: formData.businessName,
    description: formData.description,
    cuisineType: formData.cuisineType,
    boothNumber: formData.boothNumber,
  })
})
if (!response.ok) throw new Error('Vendor registration failed')
```

Also update `POST /api/vendors` to set `publicMetadata.role = 'vendor'` via Clerk Backend API (not `unsafeMetadata.isVendor`).

### T0.3 — Configure All Env Secrets (30 min)

Not a code task. See Section 4. Nothing works until these are set.

### T0.4 — FairDash → FairSynq Rename (30 min)

Files still containing "FairDash" confirmed:
- `src/context/CartContext.jsx`
- `src/App.jsx`
- `src/views/RefundPolicy.jsx`
- `src/views/Landing.jsx`
- `src/views/Contact.jsx`
- `src/views/Home.jsx`

Global find-replace. Update `app/layout.tsx` title and meta description.

### T0.5 — Un-Hardcode EVENT_SLUG (2 hours)

**`src/views/Menu.jsx`** and **`src/views/Vendors.jsx`**:
```javascript
// DELETE: const EVENT_SLUG = 'springfield-fair-2026'
// REPLACE WITH:
const { eventSlug } = useParams()
// or: const { event } = useFair()  (after FairContext is built in Phase 2.2)
```

Update `src/App.jsx` route definitions to accept `/:eventSlug/menu` and `/:eventSlug/vendors`. Add redirect: `/menu` → `/${defaultEventSlug}/menu` for backward compatibility.

---

## TIER 1 — First Live Event (Critical Path to Revenue)

Everything in this tier is required before a single real event can go live. Ordered by dependency.

---

### Phase 1.1 — Clerk Phone Auth Configuration
**Time:** 1 day | **Complexity:** S

**Clerk dashboard only** (see Section 4). No code changes to API routes — `requireAuth()` in `lib/auth.ts` works the same regardless of identifier type.

**Code changes:**
- `lib/clerk-appearance.ts` — update placeholder text to reference phone number
- Any sign-in UI prompts in `Landing.jsx` — update copy: "Sign in with your phone number"
- `app/api/webhooks/clerk/route.ts` — already syncs `phoneNumbers[0]` to `User.phone` ✅

---

### Phase 1.2 — Checkout Wiring + Stripe Elements
**Time:** 3 days | **Complexity:** L | **Blocks:** All revenue

**`src/views/Checkout.jsx`** — currently a UI shell with no API calls.

**Step 1 — Load fulfillment config on mount:**
```javascript
const [config, setConfig] = useState(null)
useEffect(() => {
  fetch(`/api/events/${eventSlug}`)
    .then(r => r.json())
    .then(data => setConfig(data.data.fulfillmentConfig))
}, [eventSlug])
```

**Step 2 — Fulfillment selector:** Show only enabled types. If only one enabled, auto-select and skip the selector UI entirely.

**Step 3 — Conditional form sections:**
- CURBSIDE: vehicle make (required), color (required), plate (optional)
- HOME_DELIVERY: `AddressAutocomplete` component (already exists), delivery fee line item from config

**Step 4 — Order summary panel:**
- Items (grouped by vendor for multi-vendor prep)
- Subtotal
- Delivery fee (HOME_DELIVERY only)
- Service charge: if `event.serviceChargeEnabled` → show as "Event service charge: $X.XX"
- **Total**
- Estimated ready time: `max(item.prepTime)` from all cart items — display as "Ready in ~X min"

**Step 5 — Payment flow:**
1. On submit: `POST /api/orders` with full body → get `{ orderId, clientSecret }`
2. Mount Stripe `<Elements>` with `clientSecret`
3. Customer fills `<PaymentElement>`
4. `stripe.confirmPayment({ redirect: 'if_required' })` on confirm
5. On success: navigate to `/track?orderId={id}`

**Step 6 — Service charge in `POST /api/orders`:**

Add to `app/api/orders/route.ts` pricing section:
```typescript
const serviceCharge = event.serviceChargeEnabled && event.serviceChargeAmount
  ? parseFloat(event.serviceChargeAmount.toFixed(2))
  : 0

const total = parseFloat((subtotal + (deliveryFee ?? 0) + serviceCharge).toFixed(2))
```

Include `serviceCharge` in `Order` record write and in `piParams.amount`.

---

### Phase 1.3 — Order Timing: 2-Minute Accept Timeout + Curbside 10-Min Forfeiture
**Time:** 2 hours | **Complexity:** S

**`app/api/orders/route.ts`** — after Firebase write (step 8), schedule accept timeout:
```typescript
if (ordersQueue) {
  await ordersQueue.add(
    JOB_UNACCEPTED,
    { orderId: order.id, vendorId, eventId },
    { delay: VENDOR_ACCEPT_TIMEOUT_MS }   // 2 min from lib/constants.ts
  )
}
```

**`app/api/orders/[id]/status/route.ts`** — on transition to READY:
```typescript
// BOOTH_PICKUP or CURBSIDE → forfeiture after 10 min
if ([FulfillmentType.BOOTH_PICKUP, FulfillmentType.CURBSIDE].includes(order.fulfillmentType)) {
  await ordersQueue.add(JOB_UNCOLLECTED, { orderId, vendorId, eventId }, { delay: CURBSIDE_WAIT_TIMEOUT_MS })
}
// HOME_DELIVERY → undeliverable after 10 min
if (order.fulfillmentType === FulfillmentType.HOME_DELIVERY) {
  await ordersQueue.add(JOB_UNDELIVERABLE, { orderId, vendorId, eventId }, { delay: CURBSIDE_WAIT_TIMEOUT_MS })
}
```

No refund for curbside forfeiture (per playbook: "order forfeited, no refund"). Update `workers/order-worker.ts` `handleMarkUncollected`: skip Stripe refund when `fulfillmentType === CURBSIDE`.

---

### Phase 1.4 — $5 Cancellation Fee After Start Order
**Time:** 4 hours | **Complexity:** S

**`app/api/orders/[id]/status/route.ts`** — on PLACED → ACCEPTED transition:
```typescript
await db.order.update({
  where: { id: orderId },
  data: {
    status: OrderStatus.ACCEPTED,
    acceptedAt: new Date(),
    startedAt: new Date(),           // marks "Start Order" moment
    cancellationFee: ORDER_CANCELLATION_FEE_USD,
  }
})
```

**`app/api/orders/[id]/cancel/route.ts`** — update cancellation logic:
```typescript
const order = await db.order.findUnique({ where: { id: params.id } })

if (order.status === OrderStatus.PLACED) {
  // Full refund — vendor hasn't started yet
  await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId })
} else if (order.status === OrderStatus.ACCEPTED) {
  // $5 cancellation fee retained
  const refundAmount = Math.max(0, order.total - ORDER_CANCELLATION_FEE_USD)
  await stripe.refunds.create({
    payment_intent: order.stripePaymentIntentId,
    amount: Math.round(refundAmount * 100),
  })
} else {
  // PREPARING or later: cannot cancel
  throw new ApiError('Order cannot be cancelled at this stage', 409, 'CANCEL_NOT_ALLOWED')
}
```

Customer-facing message in `TrackOrder.jsx`: *"Cancellations after a vendor has started your order incur a $5.00 fee."*

---

### Phase 1.5 — Customer Order Tracking Page
**Time:** 2 days | **Complexity:** M

**`src/views/TrackOrder.jsx`** — currently "Coming Soon".

```javascript
// Read orderId from URL params
const { search } = useLocation()
const orderId = new URLSearchParams(search).get('orderId')

// Fetch initial order state
const [order, setOrder] = useState(null)
useEffect(() => {
  fetch(`/api/orders/${orderId}`)
    .then(r => r.json())
    .then(data => setOrder(data.data))
}, [orderId])

// Real-time status via Firebase
useEffect(() => {
  if (!order || !user) return
  const ref = rtdb.ref(`fairs/${order.eventId}/customerOrders/${user.id}/${orderId}`)
  ref.on('value', snap => {
    if (snap.val()) setOrder(prev => ({ ...prev, status: snap.val().status }))
  })
  return () => ref.off()
}, [order?.eventId, user?.id, orderId])
```

**Status timeline UI:** PLACED → ACCEPTED → PREPARING → READY → COMPLETED  
Each step shows timestamp and relevant info:
- PLACED: "Waiting for vendor to accept (up to 2 minutes)"
- ACCEPTED: "Vendor is preparing your order. Estimated ready: {estimatedReadyAt}"
- READY (BOOTH_PICKUP): "Order ready at Booth #{boothNumber}. Walk to the express lane."
- READY (CURBSIDE): "Your order is ready. A Runner is bringing it to your {vehicleMake} {vehicleColor}"
- READY (HOME_DELIVERY): Show live runner map (reads `fairs/{eventId}/runnerLocation/{runnerId}`)
- COMPLETED: "Delivered! Rate your experience."

**Cancel button:** Visible only when status = PLACED or ACCEPTED. Shows modal:
- PLACED: "Cancel for a full refund?"
- ACCEPTED: "Cancel now? A $5.00 cancellation fee applies."

---

### Phase 1.6 — Vendor Dashboard: Live API + Real-Time Orders
**Time:** 3-4 days | **Complexity:** L

**`src/views/vendor/VendorDashboard.jsx`** — replace all `utils/vendorPortalData.js` imports with real API calls.

**New API endpoints to build:**

`app/api/vendors/[id]/stats/route.ts` — GET, vendor auth:
```typescript
// Returns:
{
  todayRevenue: number,      // sum of completed order subtotals today
  todayOrders: number,
  avgOrderValue: number,
  cancellationRate: number,  // cancelled / total this event
  acceptanceRate: number,    // accepted within 2 min / total placed
  pendingOrders: number,     // currently in PLACED/ACCEPTED/PREPARING
}
```

`app/api/vendors/[id]/revenue/route.ts` — GET `?period=7d|30d`, vendor auth:
```typescript
// Returns daily revenue for Recharts bar chart
{ data: [{ date: '2026-05-01', revenue: 342.50 }, ...] }
```

**Firebase real-time order listener:**
```javascript
// Mount on vendor dashboard load
const ordersRef = rtdb.ref(`fairs/${eventId}/orders/${vendorId}`)
ordersRef.on('child_added', snap => {
  playOrderAlert()          // new Audio('/sounds/order-alert.mp3').play()
  addOrderToQueue(snap.val())
})
```

**Action buttons (all call existing PATCH endpoints):**

| Button | API Call |
|---|---|
| Accept (within 2-min countdown) | `PATCH /api/orders/[id]/status` `{ status: 'ACCEPTED' }` |
| Decline | `PATCH /api/orders/[id]/status` `{ status: 'CANCELLED', reason: '...' }` |
| Start Preparing | `PATCH /api/orders/[id]/status` `{ status: 'PREPARING' }` |
| Order Ready | `PATCH /api/orders/[id]/status` `{ status: 'READY' }` |
| Open / Closed toggle | `PATCH /api/vendors/[id]` `{ isOffline: false/true }` |
| Busy 15 min | `PATCH /api/vendors/[id]` `{ isBusy: true }` |
| Item sold out | `PATCH /api/menu/[id]` `{ isAvailable: false }` |

**Heartbeat (required for 5-min auto-hide):**
```javascript
useEffect(() => {
  const ping = () => rtdb.ref(`fairs/${eventId}/heartbeats/${vendorId}`).set(Date.now())
  ping()
  const interval = setInterval(ping, ADMIN_HEARTBEAT_INTERVAL_MS)  // every 30 seconds
  return () => clearInterval(interval)
}, [])
```

**Vendor Menu Manager (new tab within VendorDashboard):**
- Item list: name, price, prepTime badge, availability toggle
- Add item form: name (required), price (required), prepTime in minutes (required), category, photo, description
- Photo upload: `POST /api/storage/upload` → Supabase Storage presigned URL
- Edit in-place, delete with confirmation
- All calls to existing `GET/POST/PATCH/DELETE /api/menu` endpoints

**New endpoint: `app/api/storage/upload/route.ts`** — vendor auth, returns Supabase Storage presigned upload URL.

---

### Phase 1.7 — Admin Portal MVP
**Time:** 4-5 days | **Complexity:** L | **Blocks:** Event operators going live

**New route tree:**
```
app/admin/
├── layout.tsx                    — admin auth gate (role: event_operator | super_admin)
├── page.tsx                      — redirect to /admin/events
└── [eventSlug]/
    ├── dashboard/page.tsx        — live stats + vendor grid + platform controls
    ├── vendors/page.tsx          — pending approvals + active vendor list
    ├── fulfillment/page.tsx      — FulfillmentConfig editor
    ├── runners/page.tsx          — runner roster + completion rates
    └── settings/page.tsx        — event details + service charge + QR code
```

**Replace 501 stubs — new API endpoints:**

```
GET  /api/admin/events/[id]/dashboard          — live stats for admin portal
GET  /api/admin/vendors?status=PENDING&eventId — vendor applications queue
PATCH /api/admin/vendors/[id]/approve          — set ACTIVE, notify vendor
PATCH /api/admin/vendors/[id]/reject           — set REJECTED + reason
GET  /api/admin/events/[id]/fulfillment        — read FulfillmentConfig
PATCH /api/admin/events/[id]/fulfillment       — update FulfillmentConfig
PATCH /api/admin/events/[id]/status            — UPCOMING→ACTIVE (Go Live), ACTIVE→INACTIVE (Close)
PATCH /api/admin/events/[id]/pause             — toggle isPaused (one-button pause)
GET  /api/admin/events/[id]/runners            — runner roster
PATCH /api/admin/runners/[id]                  — activate/deactivate runner
```

**Key UI components:**

**Go Live button** — enabled only after checklist passes:
- ✅ At least 1 vendor with status = ACTIVE
- ✅ At least 1 vendor with stripeVerified = true
- ✅ FulfillmentConfig exists with at least one mode enabled
- ✅ Event has eventLat/eventLng set
- Shows blocking checklist if any condition fails — no "close your eyes and go live"

**Platform Pause button** — always visible, one-tap:
- Confirmation modal: "Pause will block all new orders. Orders in progress continue to completion."
- Sets `Event.isPaused = true` → order creation returns 503 `PLATFORM_PAUSED`
- Red banner on all customer-facing pages when `isPaused = true`
- Same button becomes "Resume Orders" when already paused

**Enforce pause in `app/api/orders/route.ts`:**
```typescript
// Add after event status check:
if (event.isPaused) {
  throw new ApiError('Ordering is temporarily paused — please try again shortly', 503, 'PLATFORM_PAUSED')
}
```

**Vendor status grid** — reads from DB + Firebase heartbeats:
```typescript
// For each vendor:
{
  name: vendor.name,
  status: vendor.isOffline ? 'OFFLINE' : vendor.isBusy ? 'BUSY' : 'ACTIVE',
  lastHeartbeat: heartbeats[vendor.id],  // from Firebase
  connectionStatus: Date.now() - heartbeats[vendor.id] < 60_000 ? 'CONNECTED' : 'DISCONNECTED',
  ordersToday: stats.todayOrders,
}
```

**Fulfillment config editor** — admin-only:
- Curbside: toggle + Google Maps pin drop for zone coordinates + text description (both required before toggle can be enabled)
- Home Delivery: toggle + radius slider (km) + flat fee input
- Validation mirrors API: cannot enable curbside without `curbsideZoneLat`, `curbsideZoneLng`, AND `curbsideZoneDescription` all set

---

### Phase 1.8 — Runner App
**Time:** 4-5 days | **Complexity:** L

**Auth:** Add `requireRunnerAuth()` to `lib/auth.ts` — checks `publicMetadata.role = 'runner'`.  
**Route:** `/runner/dashboard` — `RunnerRoute` wrapper in `src/App.jsx`.  
**New API routes:** `app/api/runners/` (replace all `/api/drivers/` 501 stubs, rename).

**Screen 1 — Status / Home**
- Go Active / Go Offline toggle → `PATCH /api/runners/[id]` `{ isActive }`
- Completion rate badge: "94.2% completion rate" (green if ≥ 90%, red if < 90%)
- Current assignment card (if dispatched)
- Return-to-staging reminder when idle

**Screen 2 — Active Order (dispatched via Firebase)**

Firebase listener on `fairs/{eventId}/runnerDispatches/{runnerId}` fires when admin/system dispatches.

**BOOTH_PICKUP flow:**
1. Show order: vendor name, booth number, items list, customer name
2. "Navigate to Booth" → Google Maps deep link: `https://maps.google.com/maps?q=...`
3. Confirm Pickup button → `PATCH /api/orders/[id]/status` `{ status: 'RUNNER_COLLECTED' }`
4. Deliver to customer inside fair → Confirm Delivered `{ status: 'COMPLETED' }`

**CURBSIDE flow:**
1. Leg 1: Go to vendor booth, collect items, confirm each pickup individually
2. Leg 2: Navigate to curbside zone. Show customer vehicle: make, color, license plate
3. Locate vehicle. **Mandatory photo:** `<input type="file" accept="image/*" capture="environment">`
4. Upload photo to Supabase Storage → `order.curbsidePhotoUrl`
5. "Delivered" button only enabled after photo taken → `PATCH /api/orders/[id]/status` `{ status: 'COMPLETED', curbsidePhotoUrl }`

**HOME_DELIVERY flow:**
1. Leg 1: Navigate to vendor booth
   - Google Maps deep link to event address + booth number
   - Confirm pickup per vendor (multi-vendor: must confirm ALL before proceeding)
2. Live location broadcast (every 5 seconds while on delivery):
   ```javascript
   const interval = setInterval(() => {
     navigator.geolocation.getCurrentPosition(pos => {
       rtdb.ref(`fairs/${eventId}/runnerLocation/${runnerId}`).set({
         lat: pos.coords.latitude,
         lng: pos.coords.longitude,
         timestamp: Date.now(),
       })
     })
   }, 5000)
   ```
3. Leg 2: Navigate to customer home address
   - Google Maps deep link: `https://maps.google.com/maps?daddr={deliveryStreet}+{deliveryCity}+{deliveryZip}`
4. On arrival: GPS check before Delivered button is enabled
   - `PATCH /api/orders/[id]/delivered` with `{ runnerLat, runnerLng }`
   - Server validates haversine distance < 100 meters — rejects if too far

**New endpoint `app/api/orders/[id]/delivered/route.ts`:**
```typescript
// Haversine distance runner GPS vs. geocoded delivery address
// If > HOME_DELIVERY_GPS_RADIUS_M: return 409 { error: 'GPS_TOO_FAR', distanceMeters: X }
// If ≤ 100m: mark COMPLETED, fire Stripe transfers, update Firebase, update runner stats
```

**Screen 3 — Incident Report**
- Accessible from any active order via persistent "Report Problem" button
- Type: DROPPED / DAMAGED / LOST / MISSING_ITEMS
- Scope: Entire order or select specific items (checkbox list)
- Notes + photo capture
- Submit → `POST /api/incidents`
- BullMQ `incident-auto-refund` job scheduled (5 min)
- Admin portal receives Firebase push immediately

**Runner completion rate tracking** — update on each COMPLETED or failed delivery:
```typescript
// In order worker / delivered handler:
const runner = await db.runner.findUnique({ where: { id: runnerId } })
const newTotal = runner.totalDispatched + 1
const newCompleted = isSuccess ? runner.totalCompleted + 1 : runner.totalCompleted
await db.runner.update({
  where: { id: runnerId },
  data: {
    totalDispatched: newTotal,
    totalCompleted: newCompleted,
    completionRate: newCompleted / newTotal,
  }
})
```

**New API routes (replace `/api/drivers/` stubs):**
```
POST  /api/runners            — register runner for event
GET   /api/runners?eventId=   — list runners (admin only)
PATCH /api/runners/[id]       — toggle isActive, update location
GET   /api/runners/[id]/stats — completion rate, order history
POST  /api/incidents          — file incident report (runner auth)
PATCH /api/admin/incidents/[id]/resolve — operator resolves incident (admin auth)
```

---

### Phase 1.9 — Firebase Restructure
**Time:** 4 hours | **Complexity:** M | **Breaking if data exists in old paths**

Update all Firebase read/write paths from flat to `fairs/{eventId}/...` (see Section 3).

Files to change:
- `app/api/orders/route.ts:393` — change `orders/${vendorId}/${order.id}` → `fairs/${eventId}/orders/${vendorId}/${order.id}`
- `app/api/orders/[id]/status/route.ts` — all Firebase writes (vendor path + customer path)
- `workers/order-worker.ts` — UNCOLLECTED/UNDELIVERABLE writes
- `src/views/vendor/VendorDashboard.jsx` — listener path
- `src/views/TrackOrder.jsx` — listener path

Deploy updated Firebase security rules (see Section 3 above).

---

### Phase 1.10 — Post-Event Report Auto-Generation
**Time:** 2 days | **Complexity:** M

**Triggered when:** Admin clicks Close Event → `PATCH /api/admin/events/[id]/status` → INACTIVE.

**New file: `lib/reports/post-event-report.ts`**
```typescript
export async function buildPostEventReport(eventId: string): Promise<PostEventReportData> {
  const [orders, vendors, runners, cancellations, incidents] = await Promise.all([
    db.order.findMany({ where: { eventId }, include: { orderItems: true, vendor: true } }),
    db.vendor.findMany({ where: { eventId } }),
    db.runner.findMany({ where: { eventId } }),
    db.cancellation.findMany({ where: { order: { eventId } }, include: { order: true } }),
    db.incidentReport.findMany({ where: { order: { eventId } } }),
  ])

  const completed = orders.filter(o => o.status === 'COMPLETED')

  return {
    totalOrders: completed.length,
    totalRevenue: completed.reduce((s, o) => s + o.subtotal, 0),
    revenueByType: groupByFulfillmentType(completed),
    vendorBreakdown: buildVendorBreakdown(vendors, orders),
    peakWindows: computePeakWindows(completed),        // group placedAt into 30-min buckets
    runnerPerformance: runners.map(r => ({ name: r.user?.name, completionRate: r.completionRate, totalDispatched: r.totalDispatched })),
    cancellationLog: cancellations.map(c => ({ reason: c.reason, refundIssued: c.refundIssued, amount: c.refundAmount })),
    platformIssues: incidents,
  }
}
```

**BullMQ job `generate-post-event-report`** in `workers/order-worker.ts`:
```typescript
const report = await buildPostEventReport(eventId)
await db.postEventReport.create({ data: { eventId, ...report, generatedAt: new Date() } })
await sendReportEmail(event.organizer.contactEmail, report)  // via Resend/SendGrid
// Also email: fairsynq-reports@fairsynq.com
```

**Email:** Add `resend` package: `npm install resend`  
Set `RESEND_API_KEY` in env.

---

### ✅ FIRST LIVE EVENT GATE

After Phase 1.10, you can run a real paying event. Before going live, verify this checklist:

**Platform:**
- [ ] All env secrets configured in Vercel (Stripe live keys, not test)
- [ ] `npx prisma migrate deploy` run against production Supabase
- [ ] BullMQ worker process deployed on Render/Railway with `DIRECT_URL`
- [ ] Firebase security rules deployed
- [ ] Clerk phone+password auth configured

**Event Setup:**
- [ ] Event created in DB with correct name, dates, slug, timezone, GPS coords
- [ ] FulfillmentConfig created and configured
- [ ] Service charge configured (if applicable)
- [ ] QR codes generated and printed
- [ ] Event operator has admin portal access (AdminUser record, Clerk role set)

**Vendors:**
- [ ] All vendors: status = ACTIVE, stripeVerified = true, menu items have prepTime set
- [ ] All vendor applications reviewed and approved in admin portal

**Runners (if Curbside or Home Delivery enabled):**
- [ ] All runners: Runner record in DB, isActive toggled on event day

**Day of:**
- [ ] Test order placed and fulfilled end-to-end before Go Live
- [ ] All vendor heartbeats green in admin portal
- [ ] Admin taps Go Live → EventStatus.ACTIVE

---

## TIER 2 — Multi-Fair Public Experience

Transforms the single-fair SPA into the full marketplace. Can be built in parallel with Tier 1 by a second developer.

---

### Phase 2.1 — FairContext Provider
**Time:** 1 day | **Files:** New `src/context/FairContext.jsx`

```javascript
export function FairProvider({ eventSlug, children }) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventSlug) return
    fetch(`/api/events/${eventSlug}`)
      .then(r => r.json())
      .then(data => { setEvent(data.data); setLoading(false) })
  }, [eventSlug])

  // Apply event branding as CSS custom property
  useEffect(() => {
    if (event?.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', event.primaryColor)
    }
  }, [event])

  return <FairContext.Provider value={{ event, eventSlug, loading }}>{children}</FairContext.Provider>
}

export const useFair = () => useContext(FairContext)
```

---

### Phase 2.2 — App Router Event Routes
**Time:** 2-3 days | **Files:** New `app/[eventSlug]/` tree

```
app/[eventSlug]/
├── layout.tsx           — loads event, sets branding, wraps in FairProvider
├── page.tsx             — vendor grid (Server Component, SEO-friendly)
├── menu/page.tsx        — full menu browse
├── vendors/
│   └── [vendorId]/
│       └── page.tsx    — vendor detail
└── checkout/
    └── page.tsx        — checkout scoped to eventSlug
```

`app/[eventSlug]/layout.tsx`:
```typescript
export default async function EventLayout({ params, children }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/events/${params.eventSlug}`)
  const { data: event } = await res.json()
  if (!event) notFound()

  return (
    <div style={{ '--brand-primary': event.primaryColor } as React.CSSProperties}>
      <EventNavbar event={event} />
      {children}
    </div>
  )
}
```

---

### Phase 2.3 — Fair Discovery Landing Page
**Time:** 2 days | **Files:** New `app/page.tsx`, new `src/components/FairCard.jsx`

**`app/page.tsx`** — Next.js Server Component:
```typescript
// Fetches ACTIVE + UPCOMING events server-side (SEO-friendly)
// Client-side: geolocation API to get user coords → re-fetch with lat/lng for distance sorting
```

**Add to `GET /api/events/route.ts`:**
- `?q=` — text search on event name
- `?lat=&lng=&radius=` — haversine distance filter, return `distanceKm` field
- `?status=ACTIVE,UPCOMING` — comma-separated status filter

**`FairCard` component:**
- Event name + logo
- Location + distance ("3.2 miles away" or city/state if no geo)
- Status badge: **ACTIVE NOW** (green) / **THIS WEEKEND** (blue) / **COMING SOON** (gray)
- Date range: "May 17–19, 2026"
- Vendor count + fulfillment type chips (Booth / Curbside / Delivery)
- Links to `/${event.urlSlug}`

---

### Phase 2.4 — QR Code Generation
**Time:** 2 hours | **Files:** `lib/qr.ts`, `app/api/admin/events/[id]/qr/route.ts`

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

```typescript
// lib/qr.ts
import QRCode from 'qrcode'
export async function generateEventQR(slug: string): Promise<string> {
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/${slug}`
  return QRCode.toDataURL(url, { width: 512, errorCorrectionLevel: 'H' })
}
```

Admin portal: QR displayed with download button (PNG export via `<a download href={qrDataUrl}>`).

---

### Phase 2.5 — 10-Step Vendor Onboarding Wizard
**Time:** 3 days | **Files:** `src/views/BecomeVendor.jsx` expansion, new Stripe Connect routes

Event slug from URL param `?event=springfield-fair-2026` (set in organizer-generated invite link).

| Step | Content | Technical Notes |
|---|---|---|
| 1 | Business info (name, cuisine, description) | Local state |
| 2 | Contact info (owner name, email, phone) | Local state |
| 3 | Booth details (number, size, utility needs) | Local state |
| 4 | Initial menu (name, price, prepTime per item — all required) | Local state, written at step 10 |
| 5 | Food handler permit upload (required, hard stop) | Supabase presigned URL → `foodHandlerPermitUrl` |
| 6 | Insurance certificate + expiry date (required) | Supabase presigned URL → `insuranceUrl` + `insuranceExpiryDate` |
| 7 | Booth photos (up to 5) | Supabase presigned URLs → `boothPhotoUrls` JSON array |
| 8 | Stripe Connect — "Connect Your Bank Account" | `POST /api/stripe/connect/onboard` → Stripe hosted redirect |
| 9 | Digital agreement (pre-populated, typed name to sign) | Timestamp + IP logged server-side |
| 10 | Review & submit | `POST /api/vendors` → write all form data including menu items |

**New Stripe Connect API routes:**

```typescript
// POST /api/stripe/connect/onboard — vendor auth
const account = await stripe.accounts.create({ type: 'express' })
const accountLink = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: `${APP_URL}/become-vendor?event=${eventSlug}&step=8&refresh=true`,
  return_url: `${APP_URL}/become-vendor?event=${eventSlug}&step=9`,
  type: 'account_onboarding',
})
// Store account.id on pending vendor record
return { url: accountLink.url }

// GET /api/stripe/connect/return?vendorId= — called after Stripe redirect
// Retrieve account, check charges_enabled, set stripeVerified = true
const account = await stripe.accounts.retrieve(vendor.stripeAccountId)
if (account.charges_enabled) {
  await db.vendor.update({ where: { id: vendorId }, data: { stripeVerified: true } })
}
```

---

### Phase 2.6 — Fair Organizer Dashboard
**Time:** 3-4 days | **Files:** New `app/organizer/[eventSlug]/` route tree

For event operators who manage an event from setup through close, separate from the super-admin portal.

```
app/organizer/
├── layout.tsx                   — requires role: event_operator
└── [eventSlug]/
    ├── dashboard/page.tsx       — same as admin portal but organizer-scoped
    ├── vendors/page.tsx
    ├── fulfillment/page.tsx
    ├── runners/page.tsx
    └── reports/page.tsx         — post-event reports history
```

**Organizer provisioning flow:**
1. Super-admin creates `FairOrganizer` record
2. Super-admin creates `OrgMember` linking organizer's User to the org
3. Super-admin sets Clerk `publicMetadata.role = 'event_operator'`
4. Organizer can now access `/organizer/[their-event-slug]/dashboard`

---

## TIER 3 — Multi-Vendor Orders + Financial Accountability

Build after Tier 1 is proven stable with at least one live event.

---

### Phase 3.1 — Multi-Vendor Cart (5-Vendor Cap)
**Time:** 2 days | **Files:** `src/context/CartContext.jsx`, `src/components/Cart.jsx`

```javascript
// CartContext.jsx — replace cartVendorId (single FK) with:
const [cartItems, setCartItems] = useState([])
// Each item: { menuItemId, vendorId, vendorName, eventSlug, quantity, price, prepTime }

const cartVendorIds = [...new Set(cartItems.map(i => i.vendorId))]

const addToCart = (item) => {
  const uniqueVendors = new Set(cartItems.map(i => i.vendorId))
  if (!uniqueVendors.has(item.vendorId) && uniqueVendors.size >= MAX_VENDORS_PER_ORDER) {
    toast.error(`Cart limited to ${MAX_VENDORS_PER_ORDER} vendors per order`)
    return
  }
  setCartItems(prev => {
    const existing = prev.find(i => i.menuItemId === item.menuItemId)
    if (existing) return prev.map(i => i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i)
    return [...prev, { ...item, quantity: 1 }]
  })
}
```

`Cart.jsx` — group items by vendor. Show per-vendor subtotals. Show vendor count: "3 of 5 vendors".

---

### Phase 3.2 — MasterOrder / SubOrder Schema
**Time:** 1 day schema + 3 days implementation | **Complexity:** XL | **Breaking change**

⚠️ **Do not deploy until zero active orders exist on affected events.**

```prisma
model MasterOrder {
  id                    String            @id @default(cuid())
  eventId               String
  customerId            String
  runnerId              String?
  status                MasterOrderStatus @default(PLACED)
  totalAmount           Float
  serviceCharge         Float?
  stripePaymentIntentId String?
  stripeChargeId        String?
  fulfillmentType       FulfillmentType   @default(BOOTH_PICKUP)
  // customer fields
  customerName          String
  customerPhone         String
  vehicleMake           String?
  vehicleColor          String?
  vehiclePlate          String?
  deliveryStreet        String?
  deliveryCity          String?
  deliveryZip           String?
  placedAt              DateTime          @default(now())
  completedAt           DateTime?
  subOrders             SubOrder[]
  @@index([eventId])
  @@index([customerId])
}

model SubOrder {
  id            String         @id @default(cuid())
  masterOrderId String
  masterOrder   MasterOrder    @relation(fields: [masterOrderId], references: [id])
  vendorId      String
  eventId       String
  status        SubOrderStatus @default(PLACED)
  subtotal      Float
  fairSynqFee   Float
  vendorPayout  Float
  stripeTransferId String?
  acceptedAt    DateTime?
  readyAt       DateTime?
  collectedAt   DateTime?
  cancelledAt   DateTime?
  cancellationReason String?
  items         SubOrderItem[]
  @@index([masterOrderId])
  @@index([vendorId])
}

model SubOrderItem {
  id          String   @id @default(cuid())
  subOrderId  String
  subOrder    SubOrder @relation(fields: [subOrderId], references: [id])
  menuItemId  String
  quantity    Int
  unitPrice   Float
  subtotal    Float
  specialInstructions String?
}

enum MasterOrderStatus { PLACED RUNNER_ASSIGNED COLLECTING DELIVERING COMPLETED CANCELLED }
enum SubOrderStatus    { PLACED ACCEPTED PREPARING READY RUNNER_COLLECTED DELIVERED CANCELLED }
```

**Migration strategy:** Create a `MasterOrder` for each existing `Order`. Wrap existing `Order` as a `SubOrder`. Archive original `Order` table (do not drop immediately — keep for 30 days as fallback).

---

### Phase 3.3 — Multi-Vendor Order Creation API
**Time:** 2 days | **Files:** `app/api/orders/route.ts` — full rewrite of POST handler

New request body:
```typescript
interface CreateMasterOrderBody {
  eventId: string
  fulfillmentType: FulfillmentType
  vendorOrders: { vendorId: string; items: CartItem[] }[]   // grouped by vendor
  customerName: string
  customerPhone: string
  vehicleMake?: string
  vehicleColor?: string
  vehiclePlate?: string
  deliveryStreet?: string
  deliveryCity?: string
  deliveryZip?: string
}
```

Flow:
1. Validate all vendors: max 5, all ACTIVE, all belong to same event
2. Re-price all items from DB per vendor
3. Calculate per-SubOrder fees using `vendor.commissionRate`
4. Calculate full total + service charge
5. Create single Stripe PaymentIntent for full total with `application_fee_amount` = sum of all `fairSynqFee` values + deliveryFee
6. Atomically create `MasterOrder` + one `SubOrder` per vendor + all `SubOrderItem` records
7. Firebase write per vendor: `fairs/{eventId}/orders/{vendorId}/{subOrderId}`
8. Schedule `mark-unaccepted` job per SubOrder (2-min delay each)

---

### Phase 3.4 — Multi-Vendor State Machine
**Time:** 2-3 days | **Files:** New `app/api/sub-orders/[id]/status/route.ts`

- Each vendor advances their own SubOrder independently
- `MasterOrder.status` is derived:
  - Any SubOrder PLACED/ACCEPTED/PREPARING → COLLECTING
  - All SubOrders READY → trigger Runner dispatch
  - All SubOrders RUNNER_COLLECTED → DELIVERING
  - All SubOrders DELIVERED → COMPLETED
- Runner confirms pickup per vendor individually (per playbook: "confirming each pickup individually for multi-vendor orders")
- If a vendor cancels mid-order: partial Stripe refund for that SubOrder only. Customer notified. Other SubOrders continue.

---

### Phase 3.5 — Payout Reconciliation Engine
**Time:** 3 days | **Files:** New `lib/reconciliation.ts`, `app/api/admin/events/[id]/close/route.ts`

Five checks before Close Event is allowed. All must pass:

```typescript
export async function runReconciliation(eventId: string): Promise<ReconciliationResult> {
  const [check1, check2, check3, check4, check5] = await Promise.all([
    // Check 1: No pending orders (all in terminal state)
    checkNoPendingOrders(eventId),
    // Check 2: Payout sums match completed order vendor payouts
    checkPayoutSumBalance(eventId),
    // Check 3: All Stripe transfers have stripeStatus = 'paid'
    checkStripeTransferStatus(eventId),
    // Check 4: All cancellations have refundIssued = true
    checkRefundsComplete(eventId),
    // Check 5: All incident reports resolved
    checkIncidentsResolved(eventId),
  ])

  return {
    passed: [check1, check2, check3, check4, check5].every(c => c.passed),
    failures: [check1, check2, check3, check4, check5].filter(c => !c.passed),
  }
}
```

If any check fails: return error with failing check name + list of affected order IDs.  
If all pass: `generate-post-event-report` job queued → `EventStatus.INACTIVE` set.

**Emergency Cancel** (`PATCH /api/admin/events/[id]/emergency-cancel`):
- Confirmation modal requires typing "CANCEL [event name]"
- Bulk Stripe refund all orders in PLACED/ACCEPTED/PREPARING/READY state
- Set `EventStatus.INACTIVE`
- Queue customer notification job

---

### Phase 3.6 — Dispute System
**Time:** 2-3 days | **Files:** `app/api/disputes/`, `app/api/admin/disputes/`

```
POST /api/disputes                — vendor auth, submit dispute within 7-day window
GET  /api/disputes?vendorId=     — vendor dispute history
GET  /api/admin/disputes?eventId= — admin view all disputes
PATCH /api/admin/disputes/[id]/resolve — admin resolve + enter resolution text
```

`VendorDashboard.jsx` — add "Disputes" tab:
- List of submitted disputes with status badges
- "File Dispute" button: available for any COMPLETED order within 7 days of `completedAt`
- Form: reason, evidence (optional file upload)

BullMQ `escalate-dispute` job (24-hour delay) queued on dispute creation. If no admin action → status → ESCALATED.

---

## TIER 4 — 2027 Readiness

Build after the platform is proven at multiple live events in 2026.

### Phase 4.1 — Licensing Fee Billing System

```prisma
// Add to Event:
licensingFee       Float?
licensingFeePaid   Boolean @default(false)
licensingStripePaymentId String?
```

- Super-admin sets `licensingFee` when creating an event for 2027+
- Stripe payment link generated for organizer to pay licensing fee
- "Go Live" button blocked if `licensingFee > 0 && !licensingFeePaid`
- 2026 events: `licensingFee = null` (bypass enforced in Go Live check)

### Phase 4.2 — PWA + Offline Buffering

Per playbook: *"Vendor dashboards keep working when connectivity drops. Orders queue locally and sync when connection returns."*

```bash
npm install next-pwa
```

- Service worker for offline caching
- Firebase offline persistence: `firebase.database().setPersistenceEnabled(true)` — vendor dashboard RTDB listener works offline, syncs on reconnect
- localStorage order queue replay for cases where BullMQ is unreachable
- PWA manifest for "Add to Home Screen" on vendor tablets

### Phase 4.3 — Advanced Analytics

- Recharts already installed
- Peak order window chart (30-min buckets)
- Year-over-year comparison across events (PostEventReport data)
- Vendor performance leaderboard
- Real-time GMV counter on super-admin dashboard

### Phase 4.4 — Ratings + Favorites

- `FavoriteItem` model already in schema (Phase 1 migration)
- Heart toggle on `FoodCard.jsx` → `POST /api/favorites` with `{ menuItemId }`
- `/favorites` route — currently "Coming Soon" stub
- `/history` route — `GET /api/orders` already exists with cursor pagination; wire it up

---

## Revenue Model: Technical Implementation

| Revenue Source | 2026 | 2027+ | Implementation |
|---|---|---|---|
| Platform fee (10% of subtotal) | ✅ Active | ✅ Active | `vendor.commissionRate` × subtotal, via Stripe `application_fee_amount` |
| Operator service charge | ✅ Active | ✅ Active | `event.serviceChargeAmount`, Stripe transfer to `event.operatorStripeAccountId` |
| Home delivery fee | ✅ Active | ✅ Active | `config.homeDeliveryFee`, Stripe transfer to operator (separate from vendor payout) |
| Consulting ($1,500/day) | ✅ Active | ✅ Active | Manual invoice — not a platform feature |
| Event licensing fee | ❌ Free in 2026 | ✅ Phase 4.1 | `event.licensingFee`, Stripe payment link to organizer |

**Service charge Stripe flow** — add to `app/api/orders/[id]/status/route.ts` → COMPLETED:
```typescript
if (event.serviceChargeEnabled && event.serviceChargeAmount && event.operatorStripeAccountId) {
  await stripe.transfers.create(
    {
      amount: Math.round(event.serviceChargeAmount * 100),
      currency: 'usd',
      destination: event.operatorStripeAccountId,
      source_transaction: order.stripeChargeId,
      metadata: { orderId: order.id, type: 'service_charge', eventId: order.eventId },
    },
    { idempotencyKey: `service-charge-${order.id}` }
  )
}
```

**Complete per-order money flow:**
```
Customer pays:        subtotal + deliveryFee + serviceCharge = total

Stripe distributes:
  → Vendor:           subtotal × (1 - commissionRate)        [transfer on COMPLETED]
  → Platform:         subtotal × commissionRate + deliveryFee [via application_fee]
  → Operator:         serviceCharge                           [separate transfer]
  → Platform pool:    deliveryFee                             [held for runner pay)
```

---

## Master Build Sequence

```
TODAY (no code):
  T0.3  Configure all env secrets in .env.local + Vercel

WEEK 1:
  T0.1  Fix fee 7%→10% (15 min)
  T0.2  Fix BecomeVendor API call (1 hr)
  T0.4  FairDash→FairSynq rename (30 min)
  T0.5  Un-hardcode EVENT_SLUG (2 hrs)
        Schema migration: npx prisma migrate dev

WEEK 2:
  1.1   Clerk phone+password config (1 day)
  1.3   2-min accept timeout + 10-min curbside forfeiture (2 hrs, parallel)
  1.4   $5 cancellation fee logic (4 hrs, parallel)
  1.2   Checkout wiring + Stripe Elements (3 days)

WEEK 3:
  1.5   Customer order tracking page (2 days)
  1.9   Firebase restructure (4 hrs, do first in week)

WEEK 4:
  1.6   Vendor dashboard: live API + real-time orders + heartbeat (3-4 days)

WEEK 5:
  1.7   Admin portal MVP (4-5 days)

WEEK 6:
  1.8   Runner app (4-5 days)
  1.10  Post-event report (2 days, parallel with runner app)

── FIRST EVENT CAN GO LIVE AFTER WEEK 6 ──────────────────────

WEEKS 7–9 (multi-fair public experience — can overlap with Tier 1):
  2.1   FairContext provider (1 day)
  2.2   App Router [eventSlug] routes (2-3 days)
  2.3   Fair discovery landing page (2 days)
  2.4   QR code generation (2 hrs)
  2.5   10-step vendor onboarding (3 days)
  2.6   Fair organizer dashboard (3-4 days)

WEEKS 10–14 (multi-vendor + financial accountability):
  3.1   Multi-vendor cart (2 days)
  3.2   MasterOrder/SubOrder schema (1 day schema + 3 days wiring)
  3.3   Multi-vendor order creation API (2 days)
  3.4   Multi-vendor state machine (2-3 days)
  3.5   Payout reconciliation engine (3 days)
  3.6   Dispute system (2-3 days)

WEEKS 15+ (2027 readiness):
  4.1   Licensing billing system
  4.2   PWA + offline buffering
  4.3   Advanced analytics
  4.4   Ratings + favorites
```

---

## Dependency Chain

```
T0 (fixes) ──► Schema migration
                    │
              ┌─────┴────────┐
              ▼              ▼
           1.1–1.4         2.1–2.4
         (order flow)    (multi-fair UI)
              │
         ┌────┴────┐
         ▼         ▼
       1.5–1.6   1.7–1.8
     (tracking)  (admin + runner)
         │
         └──► 1.9–1.10
              (Firebase + reports)
                    │
              ──LIVE EVENT──
                    │
              ┌─────┴─────┐
              ▼           ▼
           3.1–3.4      3.5–3.6
         (multi-vendor)  (reconciliation)
                    │
               ──STABLE──
                    │
               4.1–4.4
            (2027 readiness)
```

---

*FairSynq LLC | Swansea, Illinois | FairSynq.com*
*Fresh. Fast. Fair. | Plan V4.0 | Confidential — Do Not Distribute*
