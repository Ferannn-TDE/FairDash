# FairSynq — 10-Step Master Plan (V3)
**Revised: March 22, 2026 | Confirmed against live codebase**

> This document supersedes the original 7-Part Master Plan.
> It incorporates Addendum V3 requirements and reflects verified codebase state as of today.
> Status is based on actual code inspection — not the original plan's self-assessment.

---

## Actual Starting Point: ~30% Complete

The original plan claims ~14% complete and lists Part 3 as "not started." **This is wrong.**
A full codebase audit reveals the order creation API (438 lines) and state machine (292 lines) are
fully implemented and production-quality. The schema already has all V2 fields. The real completion
picture is closer to 30%, which changes what needs to be done next.

---

## STEP 1 ✅ COMPLETE — Next.js Migration

Next.js 14 App Router, SPA catch-all, ClerkProvider architecture, Tailwind design system, Vite fallback.
All confirmed working. Nothing outstanding.

---

## STEP 2 ✅ CODE COMPLETE ⚠️ INFRA NOT CONFIGURED — Database + Core Backend

### What is confirmed done (code):
| Item | Status |
|------|--------|
| PostgreSQL / Supabase connected | ✅ Live — test-db endpoint confirms |
| Prisma schema (12 models, 7 enums) | ✅ Confirmed in schema.prisma |
| Clerk webhook handler | ✅ Code done (requires CLERK_WEBHOOK_SECRET to run) |
| Stripe webhook handler | ✅ Code done (requires STRIPE_WEBHOOK_SECRET to run) |
| Core read APIs (events, vendors, menu) | ✅ Functional |
| Firebase Admin SDK initialized | ✅ Graceful fallback — credentials needed |
| BullMQ / Redis queue producer | ✅ Graceful fallback — REDIS_URL needed |
| lib/auth.ts, lib/api-response.ts, lib/api-error.ts | ✅ All functional |

### What is blocking production (environment only):
```
CLERK_WEBHOOK_SECRET     = (empty) → user signups not synced to DB
STRIPE_SECRET_KEY        = (empty) → no payment processing
STRIPE_WEBHOOK_SECRET    = (empty) → payout/refund webhooks fail
NEXT_PUBLIC_STRIPE_...   = (empty) → Stripe Elements can't load
FIREBASE_PROJECT_ID      = (empty) → realtime notifications disabled
FIREBASE_PRIVATE_KEY     = (empty)
FIREBASE_CLIENT_EMAIL    = (empty)
NEXT_PUBLIC_FIREBASE_*   = (empty)
REDIS_URL                = (empty) → BullMQ jobs not scheduled
```

**These are not code tasks. Configure all secrets in .env.local and Vercel before Step 3 work begins.**

---

## STEP 3 🟡 ~60% DONE — Schema V2 + Core Order Flow

> The original plan listed this as "not started." It is not. The heaviest engineering in the entire
> system is already here. What remains is corrections, wiring, and one new page.

### Confirmed Done — Do Not Rebuild

| Sub-task | Status | Evidence |
|----------|--------|---------|
| **3.2 Schema V2 fields** | ✅ DONE | Confirmed in prisma/schema.prisma |
| — MenuItem.prepTime | ✅ | `prepTime Int @default(15)` |
| — Order.fulfillmentType | ✅ | FulfillmentType enum, `@default(BOOTH_PICKUP)` |
| — Order.vehicleMake/Color/Plate | ✅ | Nullable String fields present |
| — Order.deliveryFee, deliveryStreet/City/Zip | ✅ | Present in schema |
| — OrderStatus.UNDELIVERABLE | ✅ | In enum |
| — EventStatus enum (ACTIVE/UPCOMING/INACTIVE) | ✅ | Present |
| — Event.eventLat/Lng | ✅ | Float? fields present |
| — FulfillmentConfig model (all fields) | ✅ | Full model including curbsideZone + homeDelivery fields |
| **3.3 Order Creation API** | ✅ DONE | POST /api/orders — 438 lines |
| — DB validation (event active, vendor online, items available) | ✅ | Full guards implemented |
| — Re-price from DB (never trust frontend) | ✅ | Server-side price verification |
| — Stripe PaymentIntent creation | ✅ | With application_fee_amount |
| — Fee calc: subtotal × PLATFORM_FEE_RATE | ✅ | Constant defined, **currently 0.07 — needs fix** |
| — Write Order + OrderItems atomically | ✅ | Prisma transaction |
| — Firebase RTDB write on new order | ✅ | Written to orders/{vendorId}/{orderId} |
| — Return clientSecret to frontend | ✅ | |
| **3.4 Order State Machine** | ✅ DONE | PATCH /api/orders/[id]/status — 292 lines |
| — Valid transitions enforced | ✅ | Transition table implemented |
| — On READY → schedule BullMQ UNCOLLECTED job | ✅ | `mark-uncollected` + `mark-undeliverable` |
| — On COMPLETED → Stripe transfer + Payout record | ✅ | stripe.transfers.create |
| — On CANCELLED → Stripe refund + Cancellation record | ✅ | |
| — All transitions write to Firebase RTDB | ✅ | vendor + customer paths |
| **3.7 BullMQ Workers** | ✅ DONE | workers/order-worker.ts |
| — mark-uncollected (15-min after READY) | ✅ | Job + worker defined |
| — mark-undeliverable (15-min, HOME_DELIVERY) | ✅ | Job + worker defined |

### What Still Needs to Be Done in Step 3

**3.1 — Platform Rename** *(~1 hour)*
Remaining "FairDash" references confirmed in: src/context/CartContext.jsx, src/App.jsx,
src/views/RefundPolicy.jsx, src/views/Landing.jsx, src/views/Contact.jsx, src/views/Home.jsx.
- Global find-replace FairDash → FairSynq across all JSX/TSX/metadata
- Update app/layout.tsx title and description
- localStorage key already migrated ('fairdash-cart' → 'fairsynq-cart' with auto-migration) ✅

**3.3-fix — Correct Platform Fee to 10%** *(15 minutes)* **[V3 CORRECTION]**
Two places to change:
- `app/api/orders/route.ts` line 14: `const PLATFORM_FEE_RATE = 0.07` → `0.10`
- `prisma/schema.prisma` line 158: `commissionRate Float @default(0.07)` → `@default(0.10)`
- Also update order creation to read `vendor.commissionRate` from DB rather than the hardcoded constant
  (makes per-vendor rates possible later)
- Run `npx prisma migrate dev` after schema change

**3.5 — Complete Checkout Flow** *(medium effort)*
Checkout.jsx currently: has fulfillment type selector UI + vehicle/address fields — but:
- Does NOT read fulfillmentConfig from API (shows all 3 types regardless of event config)
- Does NOT use Stripe Elements (mock payment fields)
- Does NOT call POST /api/orders
Wire up:
- On load: fetch event's FulfillmentConfig to show only enabled types
- If only one type enabled: auto-select, skip selector
- Connect to POST /api/orders on submit
- Replace mock payment with Stripe Elements (useStripe + useElements)
- Order confirmation screen with orderId + status

**3.6 — Customer Order Tracking Page** *(medium effort)*
`/track` route currently shows "Coming Soon" stub.
- Real-time status via Firebase RTDB listener (`customerOrders/{userId}/{orderId}`)
- Status timeline: Placed → Accepted → Preparing → Ready → Collected/Delivered
- Show vendor booth number for booth pickup
- Show estimated ready time (from MenuItem prepTime sum on order items)

**3.7-fix — Add Vendor Accept-Timeout Job** *(small effort)* **[V3 CORRECTION]**
V3 requires: if vendor does not accept within 10 minutes of PLACED → auto-cancel + refund.
- Add `mark-unaccepted` job to queues.ts
- Schedule on order PLACED (same pattern as mark-uncollected)
- Worker: if order still PLACED at +10 min → CANCELLED + Stripe refund

**Step 3 Deliverable:** First real end-to-end order: placed → paid via Stripe → vendor accepts →
vendor completes → Stripe transfer fires. Customer can track status live.

---

## STEP 4 🔴 NOT STARTED — Fulfillment System (Curbside + Home Delivery)

*Depends on Step 3 complete. Booth pickup must work first.*

**4.1 — Fulfillment Configuration API**
- `GET /api/events/[slug]/fulfillment` → returns FulfillmentConfig for event (public)
- `PATCH /api/events/[slug]/fulfillment` → admin auth, updates config
- Validation: cannot enable Curbside without curbsideZoneLat + curbsideZoneLng + curbsideZoneDescription all set
- Cannot enable Home Delivery without homeDeliveryRadiusKm + homeDeliveryFee set

**4.2 — Checkout Fulfillment Selector** *(builds on 3.5 wiring)*
- Fetch fulfillmentConfig on checkout load
- Conditional form sections:
  - Curbside: vehicle make, color, plate + zone description display
  - Home Delivery: Google Maps autocomplete (already installed: @vis.gl/react-google-maps) + delivery fee line item
- All fields passed to POST /api/orders

**4.3 — Curbside Fulfillment**
- Delivery fee: N/A (no delivery fee for curbside)
- Curbside no-show BullMQ job: 10 min after READY → UNCOLLECTED
- Checkout: show curbsideZoneDescription text + estimated ready time
- Push notification when READY (Step 4.6)

**4.4 — Home Delivery**
- Delivery radius enforcement server-side in POST /api/orders:
  Haversine distance(eventLat/Lng → customer address) > homeDeliveryRadiusKm → reject with error
- Customer address geocoding: Google Maps Geocoding API (key already configured)
- Delivery fee: separate line item, NOT subject to platform fee; passed through to event operator Stripe account
- Stripe transfers on COMPLETED: two transfers → vendor (vendorPayout) + operator (deliveryFee)
- UNDELIVERABLE job: 10 min after READY for HOME_DELIVERY (already in workers, needs BullMQ job scheduled on READY)
- Full notification set: ACCEPTED → PREPARING → READY (picked up) → out for delivery → COMPLETED

**4.5 — Runner App (new protected route `/runner`)**
Authentication: Clerk publicMetadata.role = 'runner'
Add `requireRunnerAuth()` to lib/auth.ts (mirrors requireVendorAuth pattern)

Curbside queue:
- Orders with fulfillmentType = CURBSIDE for this event, status = READY, ordered by readyAt
- Shows: vendor booth number, vehicle make/color/plate, customer name
- "Delivered to Car" action → PATCH status to COMPLETED

Home delivery queue:
- Orders with fulfillmentType = HOME_DELIVERY for this event
- Two-leg flow: Pick Up from Booth (status → PREPARING or intermediate) → Deliver to Address (status → COMPLETED)
- Contact customer button (customerPhone)
- GPS navigation links (Google Maps deep link with coordinates)
- Real-time location broadcast: write runner GPS to Firebase RTDB every 5 seconds during active delivery
  Path: `runnerLocation/{runnerId}` → customer tracking page reads this

**4.6 — Push Notifications (FCM)**
- Request permission on first order
- FCM token stored on User record (add fcmToken String? to User model)
- Triggers: order accepted, order ready, curbside ready, delivery on the way, delivered
- Vendor: new order received notification

**Step 4 Deliverable:** All 3 fulfillment types work end-to-end. Runners have their own app
view. Customers get push notifications at every stage.

---

## STEP 5 🔴 NOT STARTED — Vendor System

*Depends on Step 3 for live order data. Step 4 fulfillment labels needed for order cards.*

**5.1 — Wire VendorDashboard to Live API**
VendorDashboard.jsx currently reads 100% from utils/vendorPortalData.js. Replace with real API calls:
- KPI stats → new endpoint: `GET /api/vendors/[id]/stats` (today's revenue, order count, avg value, cancellation rate)
- Order queue → `GET /api/orders?vendorId=&status=PLACED,ACCEPTED,PREPARING,READY` + Firebase RTDB listener
  for real-time new order cards without page refresh
- Revenue chart → new endpoint: `GET /api/vendors/[id]/revenue?period=7d|30d|90d`
- All orders table → `GET /api/orders?vendorId=&page=&limit=`

**5.2 — Vendor Dashboard UI Wiring**
- Add fulfillment type badge to every order card (BOOTH / CURBSIDE / HOME)
- Wire "Open / Closed" toggle → `PATCH /api/vendors/[id]` with `{ isOffline: true/false }`
- Wire "Busy (15 min)" toggle → `PATCH /api/vendors/[id]` with `{ isBusy: true }` (API sets busyUntil automatically)
- New order audio/visual alert when Firebase listener fires
- Accept / Preparing / Ready action buttons → `PATCH /api/orders/[id]/status`

**5.3 — Vendor Menu Manager UI**
Full CRUD inside VendorDashboard (menu tab). All API endpoints already exist:
- Item list with available/sold-out toggle → `PATCH /api/menu/[id]` with `{ isAvailable }`
- Add item form: name (required), photo, price (required), **prepTime in minutes (required)**, category
- Edit item in-place → `PATCH /api/menu/[id]`
- Delete with confirmation → `DELETE /api/menu/[id]`
- Photo upload: presigned URL from Supabase Storage

**5.4 — 10-Step Vendor Onboarding Wizard**
Expand BecomeVendor.jsx from 4 steps to 10. Wire final step to `POST /api/vendors`:

| Step | Content | API / Notes |
|------|---------|-------------|
| 1 | Business info (name, cuisine, description, booth number) | Local state |
| 2 | Contact info (owner name, email, phone, website) | Local state |
| 3 | Initial menu items (name, price, prepTime, photo) | Local state, written in step 10 |
| 4 | Food handler permit upload (required) | Supabase Storage → URL stored |
| 5 | Insurance certificate upload (required) + expiry date | Supabase Storage → URL + date stored |
| 6 | Booth photos (up to 5) | Supabase Storage → URLs array |
| 7 | Stripe Connect — "Connect Your Bank Account" | POST /api/stripe/connect/onboard → redirect |
| 8 | Availability & schedule (which event days) | Local state |
| 9 | Terms & conditions agreement | Local state |
| 10 | Review & submit → POST /api/vendors (status = PENDING) | Creates DB record |

> **Critical Bug Fix Also Needed Here:** Current BecomeVendor final step sets Clerk `unsafeMetadata.isVendor = true`
> but does NOT call POST /api/vendors. This means vendors have Clerk auth but no DB record.
> requireVendorAuth() works but all vendor API calls fail silently. Fix this as the first change in Step 5.

**5.5 — Stripe Connect Onboarding API**
- `POST /api/stripe/connect/onboard` → create Express account, return hosted onboarding URL
- `GET /api/stripe/connect/return` → called after Stripe redirect, verify account status, set `stripeVerified = true`

**Step 5 Deliverable:** Vendors can self-onboard completely. Dashboard shows live orders
with real-time push. Menu manager is fully functional.

---

## STEP 6 🔴 NOT STARTED — Admin Portal

*Depends on Step 4 fulfillment config schema. Largely independent of Step 5.*

**6.1 — Admin Portal Frontend (new protected section /admin)**
Role-gated: `Clerk publicMetadata.role = 'event_operator' | 'super_admin'`
Add `requireAdminAuth()` already exists in lib/auth.ts ✅

Event Operator tools (scoped to their event):
- Event dashboard: live order count, revenue today, vendor status grid (open/busy/offline/pending)
- Vendor applications queue: PENDING list → approve (→ ACTIVE) / reject (→ REJECTED + reason)
- Fulfillment configuration UI:
  - Booth Pickup: on/off toggle
  - Curbside: on/off, Google Maps GPS pin drop for zone coordinates, text description field, Runner/Window method toggle.
    Cannot enable without both coordinates + description set (mirrors API validation)
  - Home Delivery: on/off, delivery radius (km), delivery fee ($), runner transport description
- **Go Live** button → `PATCH /api/admin/events/[id]/status` → EventStatus.ACTIVE
- **Close Event** button → EventStatus.INACTIVE, blocks new orders, triggers payout reconciliation (Step 9)
- Runner account management: invite staff, assign runner role via Clerk publicMetadata update

Super Admin tools (platform-wide):
- All events list with status
- Event creation wizard
- Operator account assignment

**6.2 — Admin APIs**
- `PATCH /api/admin/events/[id]/status` → go live / close (replaces 501 stub)
- `GET /api/admin/vendors?status=PENDING&eventId=` → applications queue (replaces 501 stub)
- `PATCH /api/admin/vendors/[id]/approve` → set ACTIVE, trigger Clerk notification
- `PATCH /api/admin/vendors/[id]/reject` → set REJECTED + store reason
- `GET /api/admin/dashboard` → platform-wide stats (replaces 501 stub)
- `GET /api/admin/events/[id]/fulfillment` → read config (delegates to 4.1 endpoint)
- `PATCH /api/admin/events/[id]/fulfillment` → update config (delegates to 4.1 endpoint)

**6.3 — Rename /api/drivers → /api/runners**
Replace the 501-stub /api/drivers/* routes with functional /api/runners/* routes.
The runner is an internal event staff member, not a marketplace driver.

**Step 6 Deliverable:** Event operators can configure and launch their event end-to-end from
the admin portal. Vendor applications can be approved. Runners can be managed.

---

## STEP 7 🔴 NOT STARTED — Customer Experience

*Depends on Step 3 (order tracking). Steps 4–6 add features but don't block Step 7.*

**7.1 — Smart Customer Landing Page**
Rewrite Landing.jsx with 4 scenario-based behaviors:

| Scenario | Trigger | Behavior |
|----------|---------|----------|
| QR scan | URL param contains event slug | Skip discovery, load event page directly |
| Direct event URL | fairsynq.com/[slug] | Load white-label event page |
| Root URL + geolocation granted | User allows location | Show nearby active events as cards |
| Root URL + no nearby events | Nothing within radius | "No events near you" + search bar + upcoming events |

Event discovery cards: name, location, distance (haversine from user coords to eventLat/Lng),
status badge (Active Now / This Weekend / Coming Soon).
New search endpoint: `GET /api/events?q=&lat=&lng=&radius=`

**7.2 — White-Label Event Pages**
New dynamic route: `app/[eventSlug]/page.tsx`
- Fetch event by slug on load
- Apply `primaryColor` as CSS custom property (`--brand-primary`)
- Render event `logoUrl`
- Show only that event's vendors + menu (scoped via eventId in all existing API calls)
- Same Menu/Vendor browse UX but branded per event

**7.3 — QR Code Generation**
- `npm install qrcode` (or equivalent)
- On event creation or admin trigger → generate QR pointing to `fairsynq.com/[slug]`
- Store data URL in `Event.qrCodeUrl`
- Admin portal: display QR with download button (PNG export)

**7.4 — Order History + Favorites Pages**
`/history` and `/favorites` routes currently show "Coming Soon" stubs.
- `GET /api/orders` already exists with cursor pagination ✅
- Wire /history to fetch and render customer's order history
- Favorites: add FavoriteItem model to schema; toggle heart on FoodCard; persist per user

**Step 7 Deliverable:** Customers can find events via QR, direct URL, or location.
Order history and favorites work. Event pages are white-labeled.

---

## STEP 8 🔴 NOT STARTED — Multi-Vendor Order Assembly **[V3 NEW]**

*This step is V3-only scope. Not in original plan. Depends on Steps 3–5.*

> ⚠️ **Architectural note:** The current Order model has `vendorId` as a single FK — fundamentally
> a single-vendor model. Multi-vendor requires a breaking schema change. Design this carefully
> before writing any code.

**8.1 — Multi-Vendor Cart**
Update CartContext.jsx:
- Remove single-vendor enforcement (currently auto-clears cart on vendor conflict)
- Allow items from multiple vendors in one cart
- Enforce 5-vendor cap: if user tries to add from a 6th vendor, show error: "Cart is limited to 5 vendors per order"
- Show vendor group headers in Cart.jsx
- `cartVendorIds` array (replaces single `cartVendorId`)

**8.2 — Schema: MasterOrder + SubOrder**
New Prisma models:
```
MasterOrder — id, eventId, customerId, status (MasterOrderStatus enum), runnerId (nullable),
              totalAmount, createdAt
SubOrder    — id, masterOrderId, vendorId, status (SubOrderStatus), subtotal, fairSynqFee,
              vendorPayout, stripeTransferId, items []
```
`MasterOrderStatus`: PLACED, RUNNER_ASSIGNED, COLLECTING, DELIVERING, COMPLETED, CANCELLED
`SubOrderStatus`: PLACED, ACCEPTED, PREPARING, READY, RUNNER_COLLECTED, DELIVERED, CANCELLED

Migration: existing `Order` model becomes `SubOrder`. The `MasterOrder` is the new parent.
Runner is assigned to the MasterOrder (not individual sub-orders).

**8.3 — Multi-Vendor Order Creation API**
Rewrite `POST /api/orders` to:
- Accept items from multiple vendors grouped by vendorId
- Create one MasterOrder + one SubOrder per vendor, atomically
- One Stripe PaymentIntent for the full total (sum of all sub-orders)
- Individual Firebase RTDB writes per vendor

**8.4 — Multi-Vendor State Machine**
- Vendors advance their own SubOrder independently
- Runner confirms pickup per vendor (`PATCH /api/sub-orders/[id]/collected`)
- MasterOrder.status → DELIVERING only when ALL SubOrders = RUNNER_COLLECTED (hard lock)
- If a vendor declines or goes offline mid-order: alert event operator; operator can cancel that sub-order
  with partial refund for that vendor's items only

**8.5 — Partial Refund Logic**
- Cancellation.refundAmount already in schema ✅
- Implement partial Stripe refund for individual SubOrder cancellation
- Customer sees per-vendor breakdown in order confirmation + tracking

**Step 8 Deliverable:** Customers can order from up to 5 vendors in one transaction.
Runners collect from each booth in sequence. Delivery is locked until all items collected.

---

## STEP 9 🔴 NOT STARTED — Dispute, Refund & Payout Reconciliation **[V3 NEW]**

*This is new Part 5.5 scope from V3. Treat it as a full Part in its own right.*
*Depends on Steps 3, 6, and 8.*

**9.1 — Order State Audit Log**
Add `OrderEvent` table to schema: `id, orderId, subOrderId (nullable), eventType (string),
actorId, actorRole, metadata (JSON), timestamp`
Write an event on every status transition (replaces scattered console.log calls in state machine).
Required for all dispute cross-referencing below.

**9.2 — Auto-Refund Triggers (BullMQ + Stripe)**

| Trigger | Mechanism | Status |
|---------|-----------|--------|
| Vendor no Accept in 10 min | BullMQ `mark-unaccepted` job (already designed in Step 3) | Partially scoped |
| Vendor cancels after ACCEPTED/PREPARING | Existing CANCELLED path + refund | ✅ Logic exists |
| Stripe payment failure | Stripe webhook → CANCELLED | ✅ Exists |
| GPS non-delivery (Runner reports) | Runner app "Can't Deliver" action → UNDELIVERABLE + refund | Needs Runner app |
| Duplicate charge detection | Stripe idempotency keys on PI creation | Partially mitigated |
| Platform outage — unfulfilled orders | Outage timestamp log; on-restore sweep + bulk refund | New build |

**9.3 — Vendor Dispute Tool**
New schema model: `Dispute { id, orderId, vendorId, reason, evidence (JSON), status
(OPEN/RESOLVED/ESCALATED), submittedAt, resolvedAt, resolution (string) }`
- `POST /api/disputes` — vendor auth; validates order is within 7-day window from completedAt
- `GET /api/disputes?vendorId=` — vendor dispute history
- Admin: `GET /api/admin/disputes` + `PATCH /api/admin/disputes/[id]/resolve`
- Dispute form UI in VendorDashboard
- BullMQ job: 24hr SLA → auto-escalate if no admin action
- Auto cross-reference: compare dispute reason against OrderEvents log, flag matches

**9.4 — Runner Incident Reports**
New schema model: `IncidentReport { id, orderId, runnerId, type (DROPPED/DAMAGED/LOST), notes,
photoUrl, reportedAt, operatorResponseAt, resolution }`
- Runner app: "Report Incident" action during active delivery
- `POST /api/incidents` — runner auth
- 5-min BullMQ job: if no operator response → auto-refund customer
- Incident logged against vendor's record for food safety tracking

**9.5 — Payout Reconciliation Engine**
Triggered when admin clicks "Close Event":
```
Check 1: All SubOrders are in terminal state (COMPLETED or CANCELLED) — no pending orders
Check 2: Sum of Payout.netAmount per vendor = sum of SubOrder.vendorPayout for COMPLETED orders
Check 3: All Stripe transfers have stripeStatus = 'paid' (no stuck 'pending' transfers)
Check 4: All refunds issued (Cancellation.refundIssued = true for all CANCELLED orders)
```
If any check fails → block Close Event → show operator which check failed + affected order IDs.
If all pass → generate payout report (PDF/CSV with per-vendor breakdown) → set EventStatus = INACTIVE.

**9.6 — Event Emergency Cancel**
Admin action: "Emergency Cancel Event"
- Confirmation modal with typed confirmation ("CANCEL [event name]")
- Bulk Stripe refund all orders in PLACED/ACCEPTED/PREPARING/READY state
- Charge $200 operator fee (Stripe charge to operator's payment method on file)
- Set EventStatus = INACTIVE
- Send notification to all affected customers

**Step 9 Deliverable:** Platform has full financial accountability. Every refund scenario is handled
automatically. Vendors can dispute. Operators have audit trail for every transaction. Event close
is gated behind reconciliation.

---

## STEP 10 🔴 NOT STARTED — Production Ready

*Depends on all prior steps. Final hardening pass before go-live.*

**10.1 — Customer Auth Model [V3 CORRECTION — CLARIFY WITH CLIENT FIRST]**
V3 requires: phone number = customer identifier, SMS OTP every order, no account/password.
Current: Clerk auth (email or social login).

Two options — get client decision before building:
- **Option A (Preferred, minimal change):** Configure Clerk to use phone number as the sign-in strategy
  with SMS OTP. Clerk natively supports this. No SDK changes to API routes. requireAuth() continues to work.
  Customer "account" is their phone-linked Clerk record (enables order history, favorites).
- **Option B (Major rewrite):** Remove Clerk for customers entirely. Build custom phone+OTP with Twilio.
  Requires new session model, Twilio integration, rewrite of requireAuth() for customer paths.
  Breaks order history / favorites unless you store phone as persistent identity.

Note: Part 7.3 of the original plan ("Guest checkout available, no OTP") is **voided by V3**.
Do not build guest checkout.

**10.2 — PWA + Offline Buffering [Pending client scope confirmation]**
V3 asked "what have you already built?" before committing scope. Answer: nothing. Wait for confirmation.
If confirmed:
- next-pwa or custom service worker
- Cache strategy: static assets (stale-while-revalidate), menu/vendor data (network-first with fallback)
- Offline order queue: BullMQ + localStorage replay on reconnect
- Offline vendor dashboard: show cached state, queue status updates for sync

**10.3 — Security Hardening**
- Rate limiting on order creation + OTP endpoints (Redis sliding window via ioredis — already installed)
- Input validation with Zod on all POST/PATCH bodies (Zod installed but unused across all routes)
- Stripe idempotency keys on PaymentIntent creation
- Delivery radius enforcement is already server-side in order creation ✅
- Webhook signature verification already done (Clerk + Stripe) ✅
- Firebase Realtime DB security rules (restrict read/write by auth role)

**10.4 — Performance**
- Image optimization (Supabase CDN for vendor/menu photos)
- Redis response caching for event config + menu data (ioredis already installed)
- Confirm all Prisma indexes are being hit (schema already has comprehensive indexes) ✅
- Lighthouse audit → target 90+ on mobile

**10.5 — Testing**
- Unit tests: fee calculation (subtotal × 0.10, delivery fee pass-through, partial refunds)
- Integration tests: order state machine (all valid + invalid transitions)
- E2E tests (Playwright): place multi-vendor order → vendors accept → runner collects → deliver → payouts recorded
- Load test: order creation endpoint under concurrent load (BullMQ behavior)

**10.6 — Deployment + Monitoring**
- Vercel production deployment (environment variables configured)
- Supabase production project (separate from dev)
- Sentry error monitoring (frontend + API routes)
- Uptime monitoring on /api/health
- Stripe + Clerk webhook endpoints registered in production dashboards
- BullMQ worker process deployed (separate Heroku dyno, Railway service, or similar — not Vercel)
- Post-deploy smoke test checklist

**10.7 — Documentation**
- Vendor onboarding guide (PDF for event operators to distribute)
- Admin portal user guide
- Runner app quick-start card
- API documentation (Postman collection or auto-generated)

---

## Summary: Verified State on March 22, 2026

```
┌──────────────────────────────────────┬──────────────┬──────────────────────────────────────────┐
│ Step                                 │ Status       │ Key Gap                                  │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 1 — Next.js Migration                │ ✅ Done      │ Nothing                                  │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 2 — DB + Core Backend                │ ✅ Code done │ Configure 8 empty env secrets            │
│                                      │ ⚠️ No infra  │                                          │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 3 — Schema V2 + Core Order Flow      │ 🟡 ~60% done │ Fee fix (7→10%), rename, checkout wiring,│
│                                      │              │ order tracking page, accept-timeout job  │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 4 — Fulfillment + Runner App         │ 🔴 Not started│ Entire system                            │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 5 — Vendor System                    │ 🟡 ~20% done │ API wiring, menu manager UI, 10-step     │
│                                      │              │ wizard, Stripe Connect, fix POST bug     │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 6 — Admin Portal                     │ 🔴 Not started│ Entire system (501 stubs only)           │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 7 — Customer Experience              │ 🔴 Not started│ Landing rewrite, white-label, history    │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 8 — Multi-Vendor Assembly [V3]       │ 🔴 Not started│ Schema rewrite, cart update, MasterOrder │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 9 — Dispute & Refund [V3]            │ 🔴 Not started│ Entire new system (~24 features)         │
├──────────────────────────────────────┼──────────────┼──────────────────────────────────────────┤
│ 10 — Production Ready                │ 🔴 Not started│ Auth model TBD, security, testing, deploy│
└──────────────────────────────────────┴──────────────┴──────────────────────────────────────────┘

Overall: ~30% complete (code). ~15% complete (functional with configured infra).
```

## Immediate Next Actions (Before Starting Step 3 Remaining Work)

1. **Configure all empty env secrets** — Stripe, Firebase, Redis, CLERK_WEBHOOK_SECRET
   (Zero code — just env setup. Everything blocks on this.)
2. **Fix fee 7% → 10%** — 15-minute change in 2 files
3. **Fix BecomeVendor to call POST /api/vendors** — Critical data integrity bug
4. **Clarify phone-only auth model with client** — Unblocks Step 10.1 design decisions

## Dependency Chain

```
STEP 1 ✅ ──► STEP 2 ✅ ──► STEP 3 (finish)
                                    │
                     ┌──────────────┼──────────────────┐
                     ▼              ▼                   ▼
                  STEP 4         STEP 5              STEP 7
                  (Fulfillment   (Vendor             (Customer
                  + Runner)      System)             Experience)
                     │              │
                     └──────┬───────┘
                            ▼
                         STEP 6
                      (Admin Portal)
                            │
                     ┌──────┴───────┐
                     ▼              ▼
                  STEP 8         STEP 9
                  (Multi-Vendor) (Dispute
                                 & Refund)
                     └──────┬───────┘
                            ▼
                         STEP 10
                      (Production)
```

Step 3 is still the only active dependency blocker. Steps 4, 5, and 7 can begin in parallel
once Step 3 is complete. Step 6 needs Step 4. Steps 8 and 9 need Steps 3–6.
