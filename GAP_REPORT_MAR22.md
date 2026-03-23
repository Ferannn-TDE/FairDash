# FairSynq — Gap Report (March 22, 2026)
### Master Plan (7 Parts) + Addendum V3 vs. Codebase Reality

---

## Table of Contents
1. [Codebase Summary](#1-codebase-summary)
2. [Part 1–2 Verification](#2-part-12-verification)
3. [Feature-by-Feature Gap Table](#3-feature-by-feature-gap-table)
   - [3A — Master Plan Features](#3a-master-plan-features)
   - [3B — V3 Corrections (Category 1)](#3b-v3-corrections-category-1)
   - [3C — V3 New Features (Category 2)](#3c-v3-new-features-category-2)
   - [3D — V3 Aligned Features (Category 3)](#3d-v3-aligned-features-category-3)
   - [3E — V3 Question-Status Features (Category 4)](#3e-v3-question-status-features-category-4)
4. [V3 Conflict Flags](#4-v3-conflict-flags)
5. [Scope Estimate](#5-scope-estimate)
6. [Updated Dependency Chain](#6-updated-dependency-chain)
7. [Risk Flags](#7-risk-flags)

---

## 1. Codebase Summary

### Tech Stack (Confirmed)
| Layer | Technology | Status |
|-------|-----------|--------|
| Framework | Next.js 14 (App Router) + React Router DOM 6 (SPA catch-all) | ✅ Live |
| Styling | Tailwind CSS 3 + custom design system | ✅ Live |
| Database | PostgreSQL via Supabase + Prisma 5 | ✅ Connected |
| Auth | Clerk (@clerk/clerk-react v5 client, @clerk/nextjs v5 server) | ✅ Connected |
| Payments | Stripe SDK + Stripe Connect + Stripe Webhooks | 🟡 Initialized, keys empty |
| Realtime | Firebase Realtime DB (Admin + Client SDKs) | 🟡 Initialized, keys empty |
| Job Queue | BullMQ + IORedis | 🟡 Installed, REDIS_URL unset |
| Maps | @vis.gl/react-google-maps | ✅ Connected |
| State | React Context (CartContext, MobileMenuContext) + localStorage | ✅ Live |
| Validation | Zod | 🔴 Installed, not used anywhere |

### What Is Actually Functional Today
| System | Status | Detail |
|--------|--------|--------|
| Frontend SPA | ✅ Functional | All pages render; 100% hardcoded data, zero API connections |
| Database (reads) | ✅ Functional | Prisma queries confirmed working via /api/test-db |
| Clerk auth | ✅ Functional | Sign in/out, webhook sync, ProtectedRoute |
| Order creation API | ✅ Functional | Full POST /api/orders with Stripe PI, fee calc, DB write, Firebase, BullMQ |
| Order status API | ✅ Functional | Full state machine with Stripe transfer, refund, Firebase, BullMQ |
| UNCOLLECTED/UNDELIVERABLE timeouts | ✅ Functional | BullMQ worker defined; won't run without REDIS_URL |
| Stripe webhook handler | ✅ Functional | payment_intent events → DB updates; requires STRIPE_WEBHOOK_SECRET |
| Clerk webhook handler | ✅ Functional | user.created/updated/deleted → User table sync; requires CLERK_WEBHOOK_SECRET |
| All other features | 🔴 Not functional | Stubs, hardcoded data, or not started |

### Structure
```
app/           Next.js App Router (API routes + SPA catch-all)
src/views/     12 page-level components — ALL read from hardcoded utils/
src/components/ 15 UI components
lib/           7 server utilities (auth, db, stripe, firebase, queues, responses, errors)
prisma/        schema.prisma (12 models, 7 enums) + seed.ts
workers/       order-worker.ts (UNCOLLECTED + UNDELIVERABLE jobs)
design-system/ MASTER.md (7-part plan, 650+ lines)
```

### Environment Variables
| Service | Status |
|---------|--------|
| PostgreSQL (Supabase) | ✅ Keys configured |
| Clerk | ✅ Keys configured; CLERK_WEBHOOK_SECRET empty |
| Google Maps | ✅ Key configured |
| Stripe | 🔴 All keys empty |
| Firebase | 🔴 All keys empty |
| Redis | 🔴 REDIS_URL empty |

---

## 2. Part 1–2 Verification

### Part 1 — Next.js Migration (Claimed: COMPLETE)

| Claim | Verified? | Notes |
|-------|-----------|-------|
| Next.js App Router active | ✅ | next.config.mjs confirmed; `next dev` is primary script |
| SPA catch-all renders React app | ✅ | app/[[...slug]]/page.tsx with dynamic import (ssr: false) |
| ClerkProvider in SPA context | ✅ | app/[[...slug]]/page.tsx wraps App with ClerkProvider from @clerk/clerk-react (v3 context); app/layout.tsx has NO ClerkProvider — correct architecture |
| React Router DOM routing works | ✅ | All routes in App.jsx confirmed; ProtectedRoute + VendorRoute guards in place |
| Vite fallback available | ✅ | `npm run dev:vite` still functional |
| Design system locked | ✅ | tailwind.config.js + src/index.css confirmed; MASTER.md documented |

**Verdict: Part 1 CONFIRMED COMPLETE. ✅**

---

### Part 2 — DB + Backend Infrastructure (Claimed: COMPLETE)

| Claim | Verified? | Notes |
|-------|-----------|-------|
| PostgreSQL / Supabase connected | ✅ | /api/test-db returns live counts |
| Prisma schema live | ✅ | 12 models, 7 enums; schema confirmed |
| Clerk webhook syncing Users table | 🟡 PARTIAL | Handler is functional but CLERK_WEBHOOK_SECRET is empty — webhooks cannot be verified and will fail with 400 in production |
| Stripe SDK initialized | 🟡 PARTIAL | Graceful fallback in place but all Stripe keys empty — no payment processing possible |
| Firebase Admin initialized | 🟡 PARTIAL | Graceful fallback in place but all Firebase credentials empty — realtime notifications disabled |
| BullMQ / Redis initialized | 🟡 PARTIAL | Gracefully falls back when REDIS_URL unset — delayed job scheduling disabled |
| Core read APIs functional | ✅ | GET /api/vendors, /api/menu, /api/events, /api/orders all confirmed functional |
| Core write APIs (orders) | ✅ | POST /api/orders: full implementation (438 lines) — Stripe PI creation, 7% fee, DB write, Firebase, BullMQ |
| Order state machine | ✅ | PATCH /api/orders/[id]/status: full state transitions, Stripe transfer, refund, Firebase sync |
| Admin portal APIs | 🔴 NOT DONE | /api/admin and /api/admin/dashboard are 501 stubs |
| Driver/Runner APIs | 🔴 NOT DONE | /api/drivers/* are 501 stubs |

**Verdict: Part 2 PARTIALLY COMPLETE. ✅ for schema + read APIs + order APIs. 🔴 for webhooks in production (missing secrets), admin portal, and runner APIs. The "COMPLETE" claim is generous — the backend cannot process real payments or send real-time notifications without environment setup.**

---

## 3. Feature-by-Feature Gap Table

### 3A. Master Plan Features

#### Part 3 — Order System

| Feature | Source | Status | What Exists | What's Missing |
|---------|--------|--------|-------------|----------------|
| Order creation with Stripe PaymentIntent | Plan Part 3.3 | ✅ DONE | POST /api/orders — full implementation; re-prices from DB, 7% fairSynqFee, Stripe PI, Firebase write, BullMQ job | Fee needs updating to 10% (V3) |
| Per-order fulfillment type (BOOTH_PICKUP, CURBSIDE, HOME_DELIVERY) | Plan Part 3.3 | ✅ DONE | FulfillmentType enum + Order.fulfillmentType field + validation in order creation | Checkout UI not fully wired to fulfillmentConfig |
| Validate event active, vendor online, items available | Plan Part 3.3 | ✅ DONE | Full guards in POST /api/orders | — |
| Order state machine (PLACED → ACCEPTED → PREPARING → READY → COMPLETED) | Plan Part 3.4 | ✅ DONE | PATCH /api/orders/[id]/status with valid transitions table | — |
| Stripe transfer on COMPLETED | Plan Part 3.5 | ✅ DONE | Implemented in status endpoint | — |
| Stripe refund on CANCELLED | Plan Part 3.5 | ✅ DONE | Implemented in status endpoint | — |
| UNCOLLECTED timeout (15 min after READY) | Plan Part 3.6 | ✅ DONE | BullMQ `mark-uncollected` job; worker implemented | Requires REDIS_URL to run |
| UNDELIVERABLE timeout (15 min after READY, home delivery) | Plan Part 3.6 | ✅ DONE | BullMQ `mark-undeliverable` job; worker implemented | Requires REDIS_URL to run |
| Order history for customer | Plan Part 3.3 | ✅ DONE | GET /api/orders with cursor pagination | Frontend not connected to API |
| Fetch single order | Plan Part 3.3 | ✅ DONE | GET /api/orders/[id] with auth guard (customer OR vendor) | Frontend not connected to API |
| Checkout UI — fulfillment type selector | Plan Part 3.3 | 🟡 PARTIAL | src/views/Checkout.jsx has BOOTH/CURBSIDE/HOME selector + vehicle fields + address fields | Not reading fulfillmentConfig from API; shows all types regardless of event config |
| Checkout UI — show only enabled fulfillment types | Plan Part 3.3 | 🔴 NOT STARTED | — | Must fetch event's FulfillmentConfig; conditionally render options |
| Checkout UI — skip selection if one type enabled | Plan Part 3.3 | 🔴 NOT STARTED | — | Single-type fast path |
| Checkout UI — prep time / estimated ready time | Plan Part 3.3 | 🔴 NOT STARTED | — | Must calculate from MenuItem.prepTime; display at checkout |
| Order tracking page (/track) | Plan Part 3.7 | 🔴 NOT STARTED | Route exists; "Coming Soon" placeholder | Real-time status via Firebase |
| Cart — single vendor enforcement | Plan Part 3.2 | ✅ DONE | CartContext.addToCart clears cart on vendor conflict | — |

#### Part 4 — Runner App

| Feature | Source | Status | What Exists | What's Missing |
|---------|--------|--------|-------------|----------------|
| Runner app (protected view) | Plan Part 4.1 | 🔴 NOT STARTED | /api/drivers/* are 501 stubs; no frontend view | Entire system |
| Runner sees assigned orders | Plan Part 4.2 | 🔴 NOT STARTED | — | API + frontend |
| Runner GPS tracking | Plan Part 4.3 | 🔴 NOT STARTED | — | Location update endpoint; Firebase write |
| Runner picks up + marks collected | Plan Part 4.4 | 🔴 NOT STARTED | — | Status transition + API |
| Runner confirms delivery | Plan Part 4.5 | 🔴 NOT STARTED | — | Delivery confirmation + GPS check |
| Home delivery fee calculation | Plan Part 4.4 | 🟡 PARTIAL | Order.deliveryFee field exists in schema; FulfillmentConfig.homeDeliveryFee field exists | Not wired into checkout or order creation |
| Curbside vehicle fields | Plan Part 4.4 | 🟡 PARTIAL | Checkout.jsx has vehicle make/color/plate fields; Order schema has vehicleMake/vehicleColor/vehiclePlate | Not validated server-side for CURBSIDE fulfillment type |

#### Part 5 — Vendor Dashboard

| Feature | Source | Status | What Exists | What's Missing |
|---------|--------|--------|-------------|----------------|
| Vendor dashboard UI | Plan Part 5.1 | 🟡 PARTIAL | VendorDashboard.jsx — full polished UI with stats, order queue, menu manager, revenue chart | 100% mock data (utils/vendorPortalData.js); no API connection |
| Live order queue (real-time) | Plan Part 5.2 | 🔴 NOT STARTED | UI stub exists | Firebase RTDB listener; subscribe to orders/{vendorId} |
| Accept/reject/status-advance orders | Plan Part 5.3 | 🔴 NOT STARTED | Status endpoint exists | Vendor dashboard not wired to PATCH /api/orders/[id]/status |
| Menu manager (CRUD) | Plan Part 5.4 | 🟡 PARTIAL | All menu CRUD API endpoints functional (POST/PATCH/DELETE /api/menu) | No UI implementation; VendorDashboard menu tab is stub |
| Vendor open/closed toggle | Plan Part 5.5 | 🟡 PARTIAL | PATCH /api/vendors/[id] supports isOffline/isBusy; sets busyUntil 15 min | UI toggle in VendorDashboard not wired to API |
| Vendor stats (revenue, order counts) | Plan Part 5.6 | 🔴 NOT STARTED | VendorDashboard renders stat cards with mock data | No API endpoint for vendor analytics |
| Vendor onboarding wizard | Plan Part 5.4 | 🟡 PARTIAL | BecomeVendor.jsx: 4-step wizard (Business Info → Menu → Terms → Confirm) | Missing 6 steps: document upload, Stripe Connect, booth photos, schedule, review, call POST /api/vendors |
| Document upload (food handler permit, insurance) | Plan Part 5.4 | 🔴 NOT STARTED | Schema fields exist (foodHandlerPermitUrl, insuranceUrl, insuranceExpiryDate) | UI + file storage (Firebase Storage or S3) |
| Stripe Connect onboarding step | Plan Part 5.4 | 🔴 NOT STARTED | Vendor.stripeAccountId + stripeVerified in schema | OAuth redirect flow; onboarding link endpoint |
| Insurance expiry tracking / alert | Plan Part 5.7 | 🟡 PARTIAL | Schema: insuranceExpired (Boolean); insuranceExpiryDate | No cron job; no alert mechanism |
| Vendor notifications | Plan Part 5.8 | 🟡 PARTIAL | VendorNotification model in schema | No API for creating/reading notifications; no UI |

#### Part 6 — Admin Portal

| Feature | Source | Status | What Exists | What's Missing |
|---------|--------|--------|-------------|----------------|
| Admin portal (entire system) | Plan Part 6 | 🔴 NOT STARTED | /api/admin = 501 stub; /api/admin/dashboard = 501 stub | Everything — event management, vendor approval, fulfillment config, GPS staging zone, analytics |
| Event creation / management | Plan Part 6.1 | 🟡 PARTIAL | GET/POST /api/events functional; GET /api/events/[slug] functional | No admin frontend; no update/delete endpoints |
| Vendor approval / status management | Plan Part 6.2 | 🔴 NOT STARTED | Vendor.status field exists; PATCH /api/vendors/[id] handles limited fields | No approval flow; no admin endpoint to set ACTIVE/REJECTED |
| FulfillmentConfig management | Plan Part 6.3 | 🔴 NOT STARTED | FulfillmentConfig model in schema (full fields) | No CRUD API; no admin UI |
| GPS staging zone / boundary setup | Plan Part 6.4 | 🔴 NOT STARTED | Event.gpsBoundaries (JSON) + stagingZoneLat/Lng in schema | No API; no admin map UI |
| Event open/close controls | Plan Part 6.5 | 🔴 NOT STARTED | EventStatus enum (ACTIVE/UPCOMING/INACTIVE) | No PATCH /api/events/[id]/status endpoint; no admin UI |
| Payout report generation | Plan Part 6.6 | 🔴 NOT STARTED | Payout model in schema; Stripe transfer on COMPLETED | No reconciliation engine; no report API |
| Admin user management | Plan Part 6.7 | 🟡 PARTIAL | AdminUser model (SUPER_ADMIN / EVENT_OPERATOR) | No seeding; no management UI; requireAdminAuth() works but can't grant admin role from UI |

#### Part 7 — Customer-Facing Enhancements

| Feature | Source | Status | What Exists | What's Missing |
|---------|--------|--------|-------------|----------------|
| Smart customer landing (event discovery) | Plan Part 7.1 | 🔴 NOT STARTED | Landing.jsx — static marketing page | Location detection; event search; event cards; QR scan routing |
| White-label event page | Plan Part 7.2 | 🔴 NOT STARTED | Event.primaryColor + logoUrl + urlSlug in schema | No /event/[slug] page; no theming |
| Guest checkout (OTP) | Plan Part 7.3 | ⚠️ PLAN CONFLICT | Plan says "Guest checkout available, no OTP" | **V3 eliminates this entirely — see Section 4** |
| Order favorites / history pages | Plan Part 7.4 | 🔴 NOT STARTED | Routes exist (/favorites, /history); "Coming Soon" placeholders | GET /api/orders exists; UI not connected |
| Push notifications (customer) | Plan Part 7.5 | 🔴 NOT STARTED | Firebase client SDK installed | Service worker; Firebase Cloud Messaging setup; permission request UI |
| QR code generation (per event) | Plan Part 7.6 | 🔴 NOT STARTED | Event.qrCodeUrl field in schema | QR generation library; admin trigger; storage |
| PWA manifest / service worker | Plan Part 7.7 | 🔴 NOT STARTED | — | manifest.json; service-worker.js; offline caching |

---

### 3B. V3 Corrections (Category 1)

| Requirement | Status | What Exists | What's Missing |
|-------------|--------|-------------|----------------|
| **Platform fee: 10% of subtotal** (was 7%) | ⚠️ PLAN CONFLICT | `fairSynqFee = subtotal * 0.07` hardcoded in POST /api/orders (line ~220); Vendor.commissionRate default 0.07 in schema | Update POST /api/orders fee calc; update Vendor.commissionRate default; update any frontend copy showing "7%" |
| **No guest checkout** — phone is customer identifier | ⚠️ PLAN CONFLICT | Clerk auth used for all orders; no guest path exists yet | Plan Part 7.3 explicitly planned guest checkout — V3 kills it; no action needed until Part 7.3 scope begins, but that scope is now voided |
| **Phone number as customer identifier** | ⚠️ PLAN CONFLICT | User.phone field in schema; Clerk stores phone; Order.customerPhone field | V3 implies phone+OTP as the *only* auth for customers — no account/password. Clerk currently handles auth. If customers must use phone+OTP with no Clerk account, entire customer auth model must be re-evaluated. See Section 4. |
| **SMS OTP every order** | 🔴 NOT STARTED | — | Twilio (or alternative SMS) integration; OTP generation/verification; session management for phone-authed customers |
| **Remove any guest checkout references** | ✅ N/A | No guest checkout UI has been built | Nothing to remove yet |

---

### 3C. V3 New Features (Category 2)

#### Multi-Vendor Cart Controls

| Requirement | Status | What Exists | What's Missing |
|-------------|--------|-------------|----------------|
| 5-vendor cap per cart | 🔴 NOT STARTED | CartContext enforces single-vendor cart (auto-clears on vendor change) | Multi-vendor cart support first; then 5-vendor cap validation; cart-level error UI |
| Cart-level UI error message when cap exceeded | 🔴 NOT STARTED | — | Toast or inline error in Cart.jsx |

#### Multi-Vendor Order Assembly

| Requirement | Status | What Exists | What's Missing |
|-------------|--------|-------------|----------------|
| Sub-orders per vendor within one cart submit | 🔴 NOT STARTED | Order model has one vendorId — single-vendor per order | New data model: MasterOrder (1) → SubOrders (N, one per vendor); or batch POST |
| Master order assigned to Runner for pickup | 🔴 NOT STARTED | — | MasterOrder → Runner assignment; Runner sees all sub-orders grouped |
| Per-vendor pickup confirmation by Runner | 🔴 NOT STARTED | — | Sub-order status: RUNNER_COLLECTED per vendor; hard lock on delivery |
| Hard lock on delivery until all sub-orders collected | 🔴 NOT STARTED | — | State machine: MasterOrder.status = DELIVERING only when all sub-orders = RUNNER_COLLECTED |
| Vendor decline or offline mid-order routing to event operator | 🔴 NOT STARTED | — | Alert system; operator console to reassign or cancel sub-order; partial refund path |

#### Dispute & Refund System (Full Breakdown)

| Requirement | Status | What Exists | What's Missing |
|-------------|--------|-------------|----------------|
| Order state tracking with timestamps for every transition | 🟡 PARTIAL | Order model has placedAt, acceptedAt, readyAt, completedAt, cancelledAt, uncollectedAt | Missing: preparingAt, runnerAssignedAt, runnerCollectedAt, deliveredAt; no OrderEvent log table for arbitrary state transitions |
| Runner GPS logging every 30 seconds during home delivery | 🔴 NOT STARTED | Order schema has no GPS log; workers/ has no GPS consumer | GPS log model (RunnerLocation table); Firebase RTDB path for live position; 30s client-side push; server consumer |
| GPS delivery verification — 100m radius check | 🔴 NOT STARTED | Event.stagingZoneLat/Lng exist in schema (staging, not delivery) | Delivery address geocoding; haversine distance check on Runner COMPLETED action; reject if >100m |
| **Auto-refund trigger 1:** Vendor timeout (no Accept in X min) | 🔴 NOT STARTED | No auto-cancel on vendor inaction | BullMQ delayed job on PLACED → auto-CANCELLED if not ACCEPTED in N min; Stripe refund |
| **Auto-refund trigger 2:** Vendor cancel after Start | 🔴 NOT STARTED | CANCELLED state + refund implemented | Trigger: vendor cancels after ACCEPTED/PREPARING; Stripe refund; log cancellationReason |
| **Auto-refund trigger 3:** Stripe failure | 🟡 PARTIAL | Stripe webhook handles payment_intent.payment_failed → CANCELLED | No auto-refund issued (payment never captured on failure); logic is correct but needs verification |
| **Auto-refund trigger 4:** GPS non-delivery (Runner reports non-delivery) | 🔴 NOT STARTED | — | Runner "unable to deliver" action; GPS verification failed path; auto-refund |
| **Auto-refund trigger 5:** Duplicate charge | 🔴 NOT STARTED | — | Stripe idempotency keys on PI creation (partially mitigated); duplicate detection logic |
| **Auto-refund trigger 6:** No Start Order in 10 min (vendor timeout) | 🔴 NOT STARTED | — | BullMQ delayed job on PLACED at +10 min; auto-cancel if still PLACED; Stripe refund |
| **Auto-refund trigger 7:** Platform outage | 🔴 NOT STARTED | — | Outage detection; timestamp logging of outage start/end; auto-refund all orders that were PLACED/ACCEPTED during outage on restore |
| Vendor dispute tool (dispute form) | 🔴 NOT STARTED | — | Dispute model; POST /api/disputes; vendor form UI |
| Vendor dispute — auto cross-reference order data | 🔴 NOT STARTED | — | Business logic: match dispute to order, compare timestamps, determine validity |
| Vendor dispute — 24hr resolution SLA | 🔴 NOT STARTED | — | BullMQ delayed job at +24hr; auto-close or escalate |
| Vendor dispute — 7-day submission window | 🔴 NOT STARTED | — | Validation: dispute.createdAt <= order.completedAt + 7 days |
| Payout reconciliation engine — runs on Close Event | 🔴 NOT STARTED | Payout model exists; Stripe transfer written on COMPLETED | No reconciliation logic; no 4-check cross-validation; no block-on-fail |
| Payout reconciliation — 4 cross-checks | 🔴 NOT STARTED | — | (1) completed orders vs Stripe payouts; (2) transfer amounts match vendorPayout; (3) all refunds reconciled; (4) no pending orders |
| Payout reconciliation — block report if any check fails | 🔴 NOT STARTED | — | Admin UI: reconciliation status gate before Close Event |
| Partial refund for multi-vendor orders | 🔴 NOT STARTED | Cancellation.refundAmount field exists | Multi-vendor order model doesn't exist yet; partial refund per sub-order |
| Event cancellation — Emergency Cancel + auto-refund all | 🔴 NOT STARTED | — | Admin action; bulk Stripe refund all open orders; $200 operator fee charge |
| Curbside photo verification — mandatory vehicle photo | 🔴 NOT STARTED | Order has vehicleMake/vehicleColor/vehiclePlate fields | Photo capture in Runner app; upload to storage; URL stored on order |
| Chargeback responsibility matrix (platform vs vendor error) | 🔴 NOT STARTED | — | Categorization logic; internal ops documentation; potentially a dispute.chargebackResponsibility field |
| Runner incident reports (dropped/damaged order) | 🔴 NOT STARTED | — | Incident report model; Runner form UI; 5-min operator response BullMQ job; auto-refund on no response |
| Order timeout — vendor never tapped Start (10-min auto-cancel) | 🔴 NOT STARTED | — | BullMQ delayed job on PLACED; auto-cancel + refund if still PLACED at +10 min |
| Platform outage — timestamp logging | 🔴 NOT STARTED | — | Outage event model or log; admin manual trigger or auto-detect |
| Platform outage — auto-refund unfulfilled orders on restore | 🔴 NOT STARTED | — | On-restore sweep: find all orders PLACED/ACCEPTED during outage; bulk refund |
| Runner app offline mid-delivery — 30-min reconnection window | 🔴 NOT STARTED | — | BullMQ delayed job at +30 min; operator fallback flow if Runner doesn't reconnect |
| Food safety complaint — route to event operator, log against vendor | 🔴 NOT STARTED | — | Complaint model; logging on Vendor record; operator alert |

---

### 3D. V3 Aligned Features (Category 3)

| Feature | Plan Version | V3 Addition | Status | Notes |
|---------|-------------|-------------|--------|-------|
| Vendor onboarding — prep time in step 4 | Plan has prep time | V3 confirms it's required | 🟡 PARTIAL | MenuItem.prepTime field in schema (Int); not surfaced in vendor onboarding wizard yet |
| Platform Open/Close — Runners active check | Plan has open/close | V3 adds: must confirm Runners are active before Open | 🔴 NOT STARTED | Event status toggle not built; Runners not built; pre-event checklist not built |
| Platform Close — fires payout reconciliation engine | Plan has close | V3 adds: reconciliation must run on close | 🔴 NOT STARTED | Both close event action and reconciliation engine missing |

---

### 3E. V3 Question-Status Features (Category 4)

| Feature | Plan Status | V3 Status | Current Build | Recommendation |
|---------|------------|-----------|---------------|----------------|
| Offline buffering & connectivity (PWA/service worker) | Definite scope in Plan Part 7.1 | ❓ V3 asks "what have you built before committing" | 🔴 Nothing built | Do not invest until client confirms scope. Dependencies (BullMQ, Firebase) already installed. Flag as deferred. |

---

## 4. V3 Conflict Flags

### Conflict 1 — Platform Fee: 7% → 10% ⚠️

| Aspect | Master Plan | V3 |
|--------|------------|-----|
| Fee rate | 7% of subtotal | 10% of subtotal |
| Scope of conflict | POST /api/orders (hardcoded `subtotal * 0.07`); Vendor.commissionRate default 0.07; any frontend copy | Entire order creation path |

**Resolution required:**
- `app/api/orders/route.ts` ~line 220: change `subtotal * 0.07` → `subtotal * 0.10`
- `prisma/schema.prisma` Vendor model: change `commissionRate Float @default(0.07)` → `@default(0.10)`
- Search codebase for any frontend copy showing "7%" fee references
- Update unit test fixtures (Part 7.6 when built)

**Impact:** Low effort, high financial correctness. Fix immediately.

---

### Conflict 2 — Guest Checkout: Allowed → Eliminated ⚠️

| Aspect | Master Plan (Part 7.3) | V3 |
|--------|----------------------|-----|
| Guest access | "Guest checkout available, no OTP" | Eliminated entirely |
| Customer identity | Optional Clerk account | Phone number is the customer identifier |
| Authentication | Clerk session or guest | SMS OTP every order, no account/password |

**Resolution required:**
- Do NOT build guest checkout — mark Part 7.3 scope as voided
- The key question for the client (see Risk Flag #1 below): **Does Clerk stay for vendor/admin auth only, or is it removed entirely?**
  - **Option A (Recommended):** Clerk stays for vendors + admins. Customers authenticate via phone+OTP (Clerk supports phone-code as a sign-in strategy — this may be achievable within Clerk without a full auth rewrite).
  - **Option B (Major Rewrite):** Remove Clerk for customers entirely. Build custom phone+OTP with Twilio. Significant architectural change.

---

### Conflict 3 — Customer Auth Model ⚠️

| Aspect | Master Plan | V3 |
|--------|------------|-----|
| Customer auth | Clerk (email/password or social) | Phone number + OTP only; no account/password |
| Current implementation | POST /api/orders requires `requireAuth()` → Clerk userId | If customers use phone-only and Clerk is removed for customers, `requireAuth()` breaks |

**Resolution options:**
1. **Clerk Phone Sign-In (preferred):** Configure Clerk to accept phone number as identifier with SMS OTP. No SDK changes needed — `requireAuth()` still works. Customer "account" is their phone-linked Clerk record. This aligns with V3 intent without an architectural rewrite.
2. **Custom SMS OTP:** Build phone+OTP outside Clerk. Requires new token model, Twilio integration, session management. `requireAuth()` must be rearchitected.

**Recommendation:** Clarify with client whether customers should have a persistent identity (order history, favorites) or be fully anonymous per-transaction. If persistent identity is desired, Clerk phone sign-in is the path. If fully anonymous per-transaction, custom OTP is required but order history features (Part 7.4) become non-trivial.

---

### Conflict 4 — Offline Buffering: Definite Scope → Question ⚠️

| Aspect | Master Plan (Part 7.1) | V3 |
|--------|----------------------|-----|
| PWA / offline support | Definite build requirement | "What have you already built? We'll commit scope based on that." |
| Current state | Nothing built | Nothing built |

**Resolution:** Respond to client that nothing is built. Wait for their scope decision before investing. All dependencies (BullMQ, Firebase) are already installed if they confirm scope.

---

## 5. Scope Estimate

### What Percentage of the Total Build Is Complete?

**Methodology:** The total build is defined as all Master Plan features (Parts 1–7) PLUS all net-new V3 additions. Each feature is weighted by relative complexity.

| Category | Total Features | Done | Partial | Not Started | % Complete |
|----------|---------------|------|---------|-------------|------------|
| Part 1 — Next.js Migration | 6 | 6 | 0 | 0 | 100% |
| Part 2 — DB + Backend Infra | 12 | 8 | 4 | 0 | ~70% (webhooks can't run without secrets) |
| Part 3 — Order System | 16 | 8 | 4 | 4 | ~50% |
| Part 4 — Runner App | 7 | 0 | 2 | 5 | ~5% |
| Part 5 — Vendor Dashboard | 12 | 0 | 7 | 5 | ~20% |
| Part 6 — Admin Portal | 8 | 0 | 1 | 7 | ~5% |
| Part 7 — Customer Enhancements | 8 | 0 | 0 | 8 | 0% |
| **V3 Cat 1 — Corrections** | 4 | 0 | 0 | 4 | 0% |
| **V3 Cat 2 — Dispute & Refund System** | 24 | 0 | 1 | 23 | ~2% |
| **V3 Cat 2 — Multi-Vendor Assembly** | 5 | 0 | 0 | 5 | 0% |
| **V3 Cat 2 — Multi-Vendor Cart** | 2 | 0 | 0 | 2 | 0% |
| **V3 Cat 3 — Aligned Features** | 3 | 0 | 0 | 3 | 0% |
| **TOTAL** | **107** | **22** | **19** | **66** | **~26% complete** |

> The 26% figure reflects that Part 1 is done and the order creation + state machine (the core of Part 3) are fully implemented. Everything else is either partial UI, schema-only, or not started. The dispute/refund system alone adds ~22% to total scope.

---

## 6. Updated Dependency Chain

V3's additions (dispute system, multi-vendor assembly, phone auth) create new dependencies that alter the original build order.

### Tier 0 — Immediate Fixes (no dependencies, should be done now)
1. **Fix platform fee 7% → 10%** — one-line change in POST /api/orders + schema default
2. **Configure missing environment secrets** — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIREBASE credentials, REDIS_URL, CLERK_WEBHOOK_SECRET
3. **Rename /api/drivers → /api/runners** — align with V3 terminology before building

### Tier 1 — Core Infrastructure (blocks everything)
4. **Resolve customer auth model** — Confirm Clerk phone sign-in OR custom SMS OTP. All customer-facing features depend on this.
5. **Add OrderEvent log table to schema** — Timestamp every state transition. Required for dispute system, refund triggers, and reconciliation engine.
6. **Admin portal — event management** — PATCH /api/events/[id]/status (open/close); FulfillmentConfig CRUD. Blocks Tier 2+.
7. **Vendor approval flow** — Admin endpoint to set Vendor.status = ACTIVE/REJECTED. Blocks vendor onboarding completion.

### Tier 2 — Vendor & Operations (depends on Tier 1)
8. **Wire vendor dashboard to live API** — Replace utils/vendorPortalData.js with API calls; Firebase RTDB listener for order queue
9. **Vendor menu manager UI** — Connect to existing /api/menu CRUD endpoints
10. **Vendor open/closed toggle** — Wire UI to PATCH /api/vendors/[id]
11. **Complete vendor onboarding (10 steps)** — Add document upload, Stripe Connect, booth photos, prep time
12. **Add vendor auto-timeout job** — BullMQ: PLACED + 10 min → auto-cancel if not ACCEPTED (V3 trigger #6)

### Tier 3 — Runner System (depends on Tier 1 + 2)
13. **Runner app (frontend + API)** — Protected view; order pickup flow; GPS tracking endpoint
14. **Runner GPS logging** — Firebase RTDB writes every 30 seconds; RunnerLocation model
15. **GPS delivery verification** — 100m radius check on COMPLETED
16. **Curbside photo verification** — Mandatory vehicle photo capture in Runner app

### Tier 4 — Multi-Vendor (depends on Tier 2 + 3)
17. **Multi-vendor cart** — Update CartContext to allow multiple vendors; enforce 5-vendor cap
18. **MasterOrder + SubOrder data model** — Schema migration; update order creation API
19. **Multi-vendor order assembly** — Sub-order routing; Runner pickup confirmation per vendor; hard delivery lock

### Tier 5 — Dispute & Refund System (depends on Tier 1 + 4)
20. **Vendor dispute tool** — Dispute model; POST /api/disputes; vendor form; 7-day window validation
21. **Remaining auto-refund triggers** (#1, #4, #5, #7) — BullMQ jobs + Stripe refund helpers
22. **Incident report system** — Runner incident form; 5-min operator response job; auto-refund
23. **Payout reconciliation engine** — 4-check validation; runs on Close Event; blocks report on failure
24. **Event Emergency Cancel** — Bulk refund endpoint; $200 operator fee

### Tier 6 — Customer Experience (depends on Tier 1)
25. **Smart customer landing** — Event discovery, location detection, QR routing
26. **White-label event page** — /event/[slug] with event branding
27. **Order tracking page** — Firebase RTDB listener for real-time status
28. **Favorites + history pages** — Connect to GET /api/orders
29. **Push notifications (FCM)** — Service worker + permission UI + Firebase Cloud Messaging

### Tier 7 — Closing Features (depends on all above)
30. **QR code generation** — Admin trigger; storage; Event.qrCodeUrl write
31. **Offline buffering** — DEFERRED pending client confirmation
32. **Insurance expiry cron** — Scheduled job to flag expired documents

---

## 7. Risk Flags

### 🔴 CRITICAL — Customer Auth Model Ambiguity
**Risk:** V3 says "phone number is the customer identifier, SMS OTP every order, no account/password." This directly conflicts with the current Clerk-based auth model. If the client means customers should not have a Clerk account at all, the entire `requireAuth()` pattern in order creation breaks, and building Tier 6+ features is blocked.
**Recommendation:** Clarify with client before starting any new customer-facing development. The decision: (A) Clerk phone sign-in = minimal change; (B) custom SMS OTP = major rewrite.
**Deadline impact:** If Option B, adds 2–3 weeks to timeline.

---

### 🔴 CRITICAL — Stripe + Firebase Not Configured
**Risk:** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, all Firebase credentials, and REDIS_URL are all empty. The order creation API will not process real payments. Stripe webhooks will fail. BullMQ jobs will not be scheduled. Real-time order notifications will not fire.
**Recommendation:** Configure all environment secrets in Vercel (or your deployment environment) immediately. This is a one-time setup task, not a code task — but it blocks demo and production readiness.

---

### 🔴 CRITICAL — Dispute & Refund System Scope
**Risk:** The V3 dispute and refund system contains ~24 discrete buildable requirements. This is equivalent in scope to an entire Part of the master plan. It was not in the original 7-part plan at all. The June 1 deadline was set before this scope existed.
**Recommendation:** Treat V3 dispute/refund as **Part 5.5** or restructure the plan:
- Parts 1–3 (infrastructure + core order flow) = done/near-done
- Parts 4–5 (Runner + Vendor portal) = Tier 2–3 above
- **Part 5.5 (Dispute & Refund)** = Tier 5 — this is the new scope bomb
- Parts 6–7 (Admin + Customer) = Tier 4 + 6
- Negotiate which dispute features are MVP vs. post-launch with client.

---

### 🟡 HIGH — Multi-Vendor Order Assembly Requires Schema Migration
**Risk:** The current Order model has `vendorId` as a single FK — it's fundamentally a single-vendor model. Multi-vendor assembly requires a new MasterOrder entity and SubOrder entities, or a parent_order_id self-reference. This is a breaking schema change that affects order creation, status transitions, the vendor dashboard, and the Runner app.
**Recommendation:** Design the MasterOrder/SubOrder schema before building Runner app or multi-vendor checkout. A migration error here cascades through most of the system.

---

### 🟡 HIGH — Frontend Entirely Disconnected from Backend
**Risk:** Every view (Home, Menu, Vendors, VendorDetail, VendorDashboard) reads 100% hardcoded data. The backend APIs are functional and the database is live, but zero UI components call the API. This means the product cannot be demonstrated end-to-end in its current state.
**Recommendation:** Wire views to APIs as the first visible milestone. Home.jsx, Menu.jsx, Vendors.jsx, and VendorDashboard.jsx should call their respective endpoints. This unlocks demo capability quickly.

---

### 🟡 HIGH — BecomeVendor Wizard Does Not Call POST /api/vendors
**Risk:** Completing the 4-step vendor onboarding wizard sets Clerk `unsafeMetadata.isVendor = true` but does NOT create a Vendor record in the database. requireVendorAuth() checks this metadata flag, so vendors "exist" in auth but not in the DB. PATCH /api/vendors/[id] and other vendor endpoints will fail silently.
**Recommendation:** Step 4 of BecomeVendor should call POST /api/vendors before setting Clerk metadata. Fix this in conjunction with the onboarding wizard expansion (Tier 2).

---

### 🟡 MEDIUM — CLERK_WEBHOOK_SECRET Is Empty
**Risk:** The Clerk webhook handler validates request signatures using this secret. With it empty, ALL Clerk webhook events (user.created, user.updated, user.deleted) will fail signature verification and return 400. Users who sign up will not be synced to the User table.
**Recommendation:** Configure CLERK_WEBHOOK_SECRET immediately in both local and production environments. This requires setting the webhook endpoint in the Clerk dashboard.

---

### 🟡 MEDIUM — commissionRate Is Per-Vendor But Fee Calc Uses Hardcoded 7%
**Risk:** The Vendor model has a `commissionRate` field but POST /api/orders hardcodes `subtotal * 0.07` and ignores the per-vendor field. When the fee changes to 10% (V3), and if different vendors ever have different rates, this calculation will be wrong.
**Recommendation:** When fixing the 7% → 10% change, also update the order creation logic to read `vendor.commissionRate` from the DB instead of hardcoding the percentage. Future-proof in one pass.

---

### 🟢 LOW — Zod Installed But Not Used
**Risk:** Zod is in package.json but no API route uses it for input validation. All validation is currently done with manual `if (!field)` checks.
**Recommendation:** Not blocking anything, but as new API routes are built (dispute system, Runner endpoints, admin portal), adopt Zod schemas for request validation. Reduces error-handling boilerplate.

---

*Report generated: March 22, 2026*
*Codebase state as of: git commit 69e97db (latest on main)*
*Analyst: Claude Code (claude-sonnet-4-6)*
