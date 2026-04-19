# FairSynq — Master Execution Plan V4
**Supersedes:** PLAN_V3_MAR22.md (deleted)
**Sources:** Codebase audit (April 2026) + Operations Playbook V4.0 + Sales Guide
**Last Updated:** April 2026 *(audit updated April 13 2026)*

---

## Codebase Reconciliation — Multi-Fair Architecture

**Goal:** Merge the single-fair SPA (`src/`) into the multi-fair App Router (`app/`). The App Router is the architectural source of truth. The SPA is the feature-completeness source. Every feature gets ported to `app/fair/[fairSlug]/` and the SPA is deleted on completion.

### Architectural Decisions (Confirmed)

| # | Decision | Answer |
|---|---|---|
| 1 | How to handle Clerk in ported App Router pages? | **a** — `@clerk/nextjs` server components for App Router pages; SPA keeps `@clerk/clerk-react` until fully replaced |
| 2 | Cart state during transition? | **b** — `FairCartContext` stays as the cart authority; remove `syncToSpaCart()` bridge only after native checkout is live |
| 3 | Vendor portal routing? | **b** — `/vendor/[fairSlug]/dashboard` (per-fair scoped, matches multi-fair model) |
| 4 | Size filter scope? | Available on drink items; also surfaced during vendor onboarding menu-builder when creating drink items |

### Execution Phases

| Phase | Name | Status |
|---|---|---|
| A | Foundations — shared utils, global providers, loading skeletons, delete stale routes | ✅ Complete |
| B | Checkout — port `Checkout.jsx` → `app/fair/[fairSlug]/checkout/page.tsx` | ✅ Complete |
| C | Order Tracking — port `TrackOrder.jsx` → `app/fair/[fairSlug]/order/[orderId]/page.tsx` | ✅ Complete |
| D | Vendor Discovery — port `Vendors.jsx` + `VendorDetail.jsx` → `app/fair/[fairSlug]/vendors/` | ✅ Complete |
| E | Vendor Portal — port `VendorDashboard.jsx` + orders/menu/earnings → `app/vendor/[fairSlug]/` | ✅ Complete |
| F | Menu & Cart — native menu browsing with real DB, remove SPA cart bridge | ✅ Complete |
| G | Auth & Account — port account, history, favorites pages to App Router | ✅ Complete |
| H | Driver / Runner App — BecomeDriver wizard + runner order flow | ✅ Complete |
| I | Analytics — EarningsChart, vendor stats, admin analytics wired to real data | 🔴 Not started |
| J | Cleanup — delete `src/views/`, `src/App.jsx`; update catch-all to 404 | 🔴 Not started |

### Phase A — Foundations (Detail)

1. Add `<Toaster />` from react-hot-toast to `app/layout.tsx`
2. Create `lib/firebase-client.ts` (port of `src/lib/firebase.js` — singleton with graceful no-config fallback)
3. Create `lib/stripe-client.ts` (port of `src/lib/stripe.js` — singleton `getStripe()`)
4. Port `AddressAutocomplete` → `app/_components/AddressAutocomplete.tsx`
5. Port `SignOutModal` → `app/_components/SignOutModal.tsx`
6. Create `app/fair/[fairSlug]/vendors/loading.tsx` (from `VendorCardSkeleton.jsx`)
7. Create `app/fair/[fairSlug]/vendor/[vendorSlug]/loading.tsx` (from `VendorDetailSkeleton.jsx`)
8. Delete `app/(event)/[eventSlug]/` — stale route group with wrong naming convention

### Phase B — Checkout (Detail)

Current state: `app/fair/[fairSlug]/checkout/page.tsx` is a one-liner shim that calls `syncToSpaCart()` then `window.location.replace('/checkout')`. Source of truth is `src/views/Checkout.jsx`.

1. Read `src/views/Checkout.jsx` in full before writing — note the three fulfillment-type branches (BOOTH_PICKUP, CURBSIDE, HOME_DELIVERY), the Stripe `<Elements>` wrapper configuration, and the two-step API flow (`GET /api/events/{eventId}` → `POST /api/orders`).
2. Replace `app/fair/[fairSlug]/checkout/page.tsx` shim with a full implementation. The page is `'use client'`. Read cart items from `useFairCart()` (not localStorage directly — `FairCartContext` is the authority per decision 2). Read `fairSlug` from `useParams()`.
3. Fetch event config on mount: call `GET /api/events/{fairSlug}` (slug-based lookup) to read `serviceChargeEnabled`, `serviceChargeAmount`, `fulfillmentConfig`. Re-scope from `Checkout.jsx`'s `cartEventId` (global SPA state) to `fairSlug` from route params.
4. Wrap the payment form in `<Elements>` from `@stripe/react-stripe-js` using `getStripe()` from `lib/stripe-client.ts`. Use the same dark-theme Stripe appearance from `Checkout.jsx` (`theme: 'night'`, `variables.colorPrimary: '#FF0077'`).
5. Port `AddressAutocomplete` usage for HOME_DELIVERY — use `app/_components/AddressAutocomplete.tsx` (Phase A), not `src/components/AddressAutocomplete.jsx`. Wrap the page in `<APIProvider apiKey={...}>` from `@vis.gl/react-google-maps` so the Places library loads; confirm the fair layout (`app/fair/[fairSlug]/layout.tsx`) doesn't already provide one.
6. Port the vehicle info fields for CURBSIDE (make, color, plate) exactly as in `Checkout.jsx` step 2.
7. Create `app/fair/[fairSlug]/checkout/loading.tsx` — skeleton: a form-width column of shimmering blocks matching the two-column form layout (customer info left, order summary right).
8. Update `app/fair/[fairSlug]/cart/page.tsx`: change the `handleCheckout` button to `router.push('/fair/${fairSlug}/checkout')` — remove the `syncToSpaCart()` call and `window.location.href` from this button. (Keep `syncToSpaCart()` in the context itself until Phase F when the bridge is fully removed.)
9. After the new checkout page is confirmed working, delete the old shim content. Do not delete `syncToSpaCart()` from `FairCartContext.tsx` yet — that is Phase F.

### Phase C — Order Tracking (Detail)

Current state: `app/fair/[fairSlug]/order/[orderId]/page.tsx` is a stub card with a link to `/track?orderId=...`. Source of truth is `src/views/TrackOrder.jsx`.

1. Read `src/views/TrackOrder.jsx` in full — note the `STEPS` array, `STATUS_TO_STEP` mapping, the `onValue()` Firebase RTDB listener path, the map embed URL builder, and `TrackOrderSkeleton` import.
2. Replace the stub `app/fair/[fairSlug]/order/[orderId]/page.tsx` with a full implementation. Mark `'use client'`. Read `orderId` from `useParams()`, read `fairSlug` for back-navigation.
3. Fetch initial order state from `GET /api/orders/{orderId}` on mount. Re-scope from the SPA's `?orderId=` query string to the App Router `[orderId]` param.
4. Wire real-time Firebase listener using `getFirebaseApp()` from `lib/firebase-client.ts` (Phase A). The RTDB path in the SPA is under a flat `/orders/{orderId}` key — confirm this matches the Firebase write in `app/api/orders/route.ts`; update the listener path if the actual write key differs.
5. Port the `STEPS` stepper array and `STATUS_TO_STEP` map as module-level constants in the same file.
6. Port the Google Maps embed URL builder from `TrackOrder.jsx`. The embed needs the delivery address (HOME_DELIVERY) or fair lat/lng (BOOTH_PICKUP/CURBSIDE) — pass the fair's coordinates via `useFair()` context or include them in the initial order fetch response.
7. Create `app/fair/[fairSlug]/order/[orderId]/loading.tsx` — port `src/components/skeletons/TrackOrderSkeleton.jsx` verbatim, converting JSX to TSX (no prop changes needed).
8. Update `app/fair/[fairSlug]/orders/page.tsx` (currently empty-state): fetch `GET /api/orders?fairId={fair.id}&userId={userId}` using `currentUser()` from `@clerk/nextjs/server` and render a list of orders, each linking to `/fair/${fairSlug}/order/${orderId}`. Show the `TrackOrderSkeleton` while loading.
9. Remove the `/track?orderId=...` fallback link from the old stub once the new page is confirmed working. The SPA `/track` route can remain until Phase J cleanup.

### Phase D — Vendor Discovery (Detail)

Current state: `app/fair/[fairSlug]/vendors/page.tsx` and `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx` both exist but use mock data from `useFair()` / `getVendorBySlug()`. They lack the search bar, cuisine filter, image card layout, and reviews section present in the SPA. No `menu/page.tsx` exists yet.

1. Add client-side search to `app/fair/[fairSlug]/vendors/page.tsx`: port the search input and `useMemo` filter logic from `src/views/Vendors.jsx`. The search should match vendor name, cuisine type, and item names (same fields as the SPA).
2. Add cuisine filter pills below the search bar: port the filter chip row from `src/views/Vendors.jsx`. Extract available cuisine types from the vendors array. Keep the "All" default.
3. Enhance `VendorCard` in the vendors page to match the SPA's card layout: add the vendor logo/image (`vendor.logoUrl ?? null`), rating stars, prep-time badge, and popular-items preview row. The current App Router card is a compact info card; the SPA card is image-first.
4. Create `app/fair/[fairSlug]/menu/page.tsx` — port `src/views/Menu.jsx`. This is the cross-vendor menu browse (`/:eventSlug/menu` in the SPA). Wire to `GET /api/menu?eventId={fair.id}`. Add category tabs and search input. Link each item's "Add" button through `useFairCart().addItem()`.
5. Port `SizeSelectionModal` from `src/components/SizeSelectionModal.jsx` → `app/_components/SizeSelectionModal.tsx`. Convert to TypeScript. Per decision 4, this modal is shown when the user taps "Add" on a drink-category item. Export a `useSizeSelection` hook or an inline `<SizeSelectionModal>` that `MenuItemCard` can mount.
6. Integrate `SizeSelectionModal` into `MenuItemCard` in `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx`: check `item.category === 'Drinks & Beverages'` (or a `hasSizes` flag on the item) before calling `addItem()`; if true, open the modal first.
7. Enhance `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx` header: port the ratings row (star count, review count) and the description block from `src/views/VendorDetail.jsx`. The current App Router page already renders these fields if present in mock data — confirm the DB schema includes `rating`, `reviewCount`, `description` on `Vendor`.
8. Add a reviews section to `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx` if `src/views/VendorDetail.jsx` renders one. ⚠️ Check whether VendorDetail.jsx actually renders user-submitted reviews or just the aggregate rating — if it's only aggregate, step 7 already covers it.
9. Add `app/fair/[fairSlug]/menu/loading.tsx` — port `src/components/skeletons/FoodCardSkeleton.jsx` into a grid skeleton matching the menu page layout (category tabs + 8-item grid).

### Phase E — Vendor Portal (Detail)

Current state: No `app/vendor/` directory exists. The vendor portal lives entirely in the SPA at `/vendor/dashboard` (implemented in `src/views/vendor/VendorDashboard.jsx`). All other SPA vendor routes (`/vendor/orders`, `/vendor/menu`, etc.) render `<ComingSoon />`. Per decision 3, the App Router vendor portal is scoped per-fair at `/vendor/[fairSlug]/`.

1. Create `app/vendor/[fairSlug]/layout.tsx` — server component that calls `requireVendorAuth()` from `lib/auth.ts` and wraps children in a vendor shell (sidebar: Dashboard, Orders, Menu, Analytics, Settings; mobile bottom nav). Vendor auth: current user must have a `Vendor` record in DB with `status = ACTIVE` for this fair's `eventId`.
2. Create `app/vendor/[fairSlug]/dashboard/page.tsx` — `'use client'` page. Port the overall structure from `src/views/vendor/VendorDashboard.jsx`: stat cards row at top, earnings chart below, live order queue at bottom.
3. Port `StatCard` from `VendorDashboard.jsx` → local component (or `app/_components/VendorStatCard.tsx` if reused across portal). Fields: orders today, revenue today, completion rate, avg rating. Each card has a trend indicator (up/down arrow + delta %).
4. Port `EarningsChart` from `VendorDashboard.jsx` → `app/_components/EarningsChart.tsx`. The chart uses `recharts` (already in `package.json`). Keep the 7d/30d/90d period toggle. Wire to `GET /api/vendors/{id}/stats?period=7d` from the dashboard page.
5. Port the live order queue: use `getFirebaseApp()` from `lib/firebase-client.ts` (Phase A) to attach `onChildAdded` and `onChildChanged` RTDB listeners on the vendor's order path. The SPA listens at a path under the vendor's ID — confirm the exact RTDB path from `app/api/orders/route.ts`'s Firebase write.
6. Port `ORDER_NEXT_STATUS` state machine: `PLACED → ACCEPTED → PREPARING → READY → COMPLETED`. Each order card shows a single action button ("Accept", "Start Order", "Ready", "Complete") that calls `PATCH /api/orders/{id}/status`. Import `VENDOR_ACCEPT_TIMEOUT_MS` from `lib/constants.ts` for the 2-minute accept countdown display.
7. Create `app/vendor/[fairSlug]/orders/page.tsx` — full order history table (was `<ComingSoon />` in SPA). Fetch from `GET /api/vendors/{id}/orders?fairId={fairId}`. Columns: order ID, customer, items, total, status, timestamp. Include status filter tabs.
8. Create `app/vendor/[fairSlug]/menu/page.tsx` — menu management (was `<ComingSoon />` in SPA). Display vendor's menu items from `GET /api/menu?vendorId={vendorId}`. Allow toggling item availability (`PATCH /api/menu/{id}`). Add/edit items via a slide-out form panel. Per decision 4, drink-category items must expose a size-options array in their edit form.
9. Port vendor heartbeat writer: `setInterval(() => writeToFirebase(heartbeatPath, { ts: Date.now() }), ADMIN_HEARTBEAT_INTERVAL_MS)` using `lib/constants.ts` (not `src/utils/constants.js`). Add this to the dashboard page `useEffect` and clear it on unmount.
10. Create `app/vendor/[fairSlug]/settings/page.tsx` — vendor profile editor: business name, cuisine type, description, booth number (read-only), Stripe Connect status/link. Was `<ComingSoon />` in SPA.

### Phase F — Menu & Cart (Detail)

Current state: All fair data flows through `FairContext` and `FairCartContext`, both of which currently read from `lib/mock/fairs.ts`. The SPA cart bridge (`syncToSpaCart()`) is still in place. Menu items are served by `GET /api/menu` but the fair pages don't call it yet.

1. Update `app/_contexts/FairContext.tsx`: replace the `getFairBySlug()` mock call with a client-side `fetch('/api/events/${fairSlug}')` on mount. Loading state should set `fair` to `null` and render a skeleton (the `layout.tsx` already shows `notFound()` on miss — adjust to allow a loading state).
2. Update `app/fair/[fairSlug]/layout.tsx`: it currently calls `getFairBySlug()` server-side (synchronous mock). Change to `await db.event.findUnique({ where: { slug: fairSlug } })` via Prisma directly in the server layout (no intermediate API call needed for the layout — it's a server component). Keep using `notFound()` on miss.
3. Update `app/_contexts/FairCartContext.tsx`: the `CartItem` type uses `menuItemId` and `vendorId` as strings. These are already DB-compatible — no type change needed, but confirm the mock IDs used during Phase D development match real DB `cuid()` IDs once real data flows. Add a `clearCart()` action to the context (missing from current implementation, needed after successful order creation in Phase B).
4. Replace `getVendorBySlug()` mock call in `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx`: fetch `GET /api/vendors/{vendorSlug}?fairId={fair.id}` (or change the route to accept slug). Update `app/api/vendors/[id]/route.ts` to also support slug-based lookup via a `?slug=` query param if it doesn't already.
5. Replace mock `vendors` array in `FairContext` with the result of `GET /api/vendors?eventId={fair.id}&status=ACTIVE`. The context should expose a `vendorsLoading` boolean.
6. Remove `syncToSpaCart()` from `app/fair/[fairSlug]/cart/page.tsx` — this was already updated in Phase B step 8 to not call it on checkout nav, but ensure it's fully removed from the cart page's imports and JSX.
7. Remove `syncToSpaCart()` from `app/fair/[fairSlug]/vendor/[vendorSlug]/page.tsx` — it's currently called on the desktop sidebar "View Cart" button (`handleCheckout`). Remove it; navigate to `/fair/${fairSlug}/cart` directly.
8. Remove `syncToSpaCart()` and the related `fairsynq-cart` localStorage write from `app/_contexts/FairCartContext.tsx`. Delete the function entirely. This is the last SPA cart bridge removal.
9. Verify `GET /api/menu?eventId=...` returns items in the shape expected by `MenuItemCard` in the vendor menu page (Phase D). Specifically: `id`, `name`, `price`, `description`, `imageUrl`, `category`, `available`, `popular`, `prepTime`, `sizes` (for drink items per decision 4).
10. Add `sizes` field support: update `lib/mock/fairs.ts` item shape to include `sizes?: { label: string; priceDelta: number }[]` for drink items, so Phase D's `SizeSelectionModal` has test data before real DB is wired. Then add the `sizes` column to the `MenuItem` Prisma model in a new migration.

### Phase G — Auth & Account (Detail)

Current state: `app/account/page.tsx` exists as a minimal link hub (Order History, Past Fairs, Favorites). `app/account/orders/page.tsx` exists but shows an empty state. `src/views/ManageAccount.jsx` is the feature-complete account settings page in the SPA. `src/views/Favorites.jsx` and `src/views/History.jsx` do not exist in the SPA — those SPA routes render `<ComingSoon />`.

1. Create `app/account/layout.tsx` — server component that calls `requireAuth()` from `lib/auth.ts`. Redirect unauthenticated users to the sign-in page. This protects all `/account/*` routes uniformly without repeating auth checks in each page.
2. Port `src/views/ManageAccount.jsx` → `app/account/settings/page.tsx`. The SPA component manages: display name, email, phone number, notification preferences. It uses Clerk's `useUser()` hook to read and update profile. Mark the page `'use client'`. Import `useUser` from `@clerk/clerk-react` (consistent with the SPA's package — see Clerk dual-package note in memory).
3. Add a "Settings" link card to `app/account/page.tsx` pointing to `/account/settings`, alongside the existing Order History and Favorites cards.
4. Wire `app/account/orders/page.tsx` to real data: fetch `GET /api/orders?userId={userId}` using `currentUser()` from `@clerk/nextjs/server` (this is a server component). Render a table of orders grouped by fair, each linking to `/fair/${fairSlug}/order/${orderId}`. Show fair name, date, item count, total, status.
5. Create `app/account/favorites/page.tsx` — the SPA route is `<ComingSoon />` so there is no source to port. Implement from scratch: favorites stored in a new `Favorite` table (userId + menuItemId) or as a `favorites` JSON column on `User`. ⚠️ Decision needed: DB-backed favorites (persistent across devices, requires migration) vs localStorage-backed (fast to ship, no migration). Pick one before implementing.
6. Create `app/account/orders/[orderId]/page.tsx` — order detail view. Fetch `GET /api/orders/{orderId}`. Show itemized receipt (name, qty, price), fulfillment type, status timeline, and a "Track Order" button linking to `/fair/${fairSlug}/order/${orderId}` if the order is active.
7. Port `SignOutModal` usage into `app/_components/MarketplaceNavbar.tsx` and `app/_components/FairNavbar.tsx` — replace any current inline sign-out logic with the ported `app/_components/SignOutModal.tsx` (Phase A). Use `useClerk().signOut()` from `@clerk/clerk-react` as the `onConfirm` callback.
8. Remove `src/views/ManageAccount.jsx` and `src/components/ManageAccountPanel.jsx` after `app/account/settings/page.tsx` is confirmed working. Remove `src/components/MobileAccountPanel.jsx` if its functionality is covered by the new account layout.

### Phase H — Driver / Runner App (Detail)

Current state: `src/views/BecomeDriver.jsx` is a complete 3-step wizard (Personal Info, Vehicle Info, Terms + background-check consent). `app/api/drivers/route.ts` exists (GET list endpoint). No runner dashboard exists anywhere. No `app/runner/` or `app/become-driver/` directory exists.

1. Create `app/become-driver/page.tsx` — port `src/views/BecomeDriver.jsx` as a `'use client'` component. This is a global route (not per-fair) because driver applications are not event-scoped. Keep all three steps identical: Personal Info (firstName, lastName, email, phone, dob, city), Vehicle Info (make, model, year, color, plate, type), Terms (full `DRIVER_TERMS` text + `agreed` + `bgConsent` checkboxes).
2. Add `POST` handler to `app/api/drivers/route.ts` — receive the application payload, create a `Runner` record in DB with `status = OFFLINE`, send confirmation email via a BullMQ job or direct email call. The current file only has `GET`.
3. ⚠️ Decision needed: Should the runner dashboard be per-fair (`/runner/[fairSlug]/dashboard`) or global (`/runner/dashboard` with a fair-selector)? Runners are assigned per event (per admin portal's runner roster), which favors per-fair scoping. However a runner may work multiple events in a season, suggesting a global view with fair context. Resolve before creating the layout.
4. Create `app/runner/[fairSlug]/layout.tsx` (or `app/runner/layout.tsx` if global) — server component that calls `requireAuth()` and checks `runner.status !== null` (user has a Runner record). Wrap children in a runner shell: minimal nav (Dashboard, Active Delivery).
5. Create `app/runner/[fairSlug]/dashboard/page.tsx` — `'use client'`. Show: current status toggle (ACTIVE / OFFLINE), inbound delivery assignments from Firebase (same RTDB path as admin runner roster), and a list of today's completed deliveries from `GET /api/admin/events/{id}/runners`.
6. Create `app/runner/[fairSlug]/delivery/[orderId]/page.tsx` — per-delivery view. Show: vendor name + booth number, order items, customer fulfillment info (curbside: vehicle description; delivery: address + map link). Action button: "Mark Picked Up" → `PATCH /api/orders/{id}/status` to `READY`; "Mark Delivered" → requires photo upload first (per Playbook).
7. Implement mandatory photo upload before Delivered: create a file input that calls `POST /api/storage/upload` (`app/api/storage/upload/route.ts` already exists). Only enable the "Mark Delivered" button after a photo URL is returned.
8. Implement GPS delivery confirmation in `PATCH /api/orders/{id}/status` route when transitioning to `COMPLETED`: read runner's coordinates from request body, run server-side haversine check against the order's delivery address lat/lng. Reject with `400 DELIVERY_TOO_FAR` if distance > `HOME_DELIVERY_GPS_RADIUS_M` (100m) from `lib/constants.ts`. This is backend-only work, no new pages.
9. Delete `src/views/BecomeDriver.jsx` after `app/become-driver/page.tsx` is confirmed working end-to-end.

### Phase I — Analytics (Detail)

Current state: `EarningsChart` lives inside `src/views/vendor/VendorDashboard.jsx` and is not extracted. `app/api/vendors/[id]/stats/route.ts` and `app/api/vendors/[id]/revenue/route.ts` exist as new stub files (created alongside the vendor API routes). `app/admin/[eventSlug]/dashboard/page.tsx` and `app/organizer/fair/[fairId]/analytics/page.tsx` both use mock data from `lib/mock/admin.ts`.

1. Extract `EarningsChart` from `src/views/vendor/VendorDashboard.jsx` → `app/_components/EarningsChart.tsx`. Props: `data: { date: string; revenue: number }[]`, `period: '7d' | '30d' | '90d'`, `onPeriodChange: (p) => void`. Use `recharts` `BarChart` + `ResponsiveContainer` (already installed). Apply the design system: `#FF0077` bars, `#111` background, `#555` grid lines, `font-inter` tick labels.
2. Implement `app/api/vendors/[id]/stats/route.ts` — `GET` with `?period=7d|30d|90d`. Query Prisma: aggregate `Order` records for this vendor in the period, group by date, return `{ date, revenue, orderCount }[]`. Require vendor auth (`requireVendorAuth()`) or admin auth.
3. Implement `app/api/vendors/[id]/revenue/route.ts` — `GET`. Return lifetime totals: `{ totalRevenue, totalOrders, avgOrderValue, completionRate }`. These feed the stat cards in the vendor dashboard.
4. Create `app/vendor/[fairSlug]/analytics/page.tsx` — full analytics page (was `<ComingSoon />` in SPA). Use `EarningsChart` (step 1) with the period toggle. Below the chart: a stats summary row (total revenue, total orders, avg order value, completion rate) using `VendorStatCard` from Phase E. Wire to `GET /api/vendors/{id}/stats` and `GET /api/vendors/{id}/revenue`.
5. Wire `app/admin/[eventSlug]/dashboard/page.tsx` stats cards to real data: replace `mockAdminDashboard` with a call to `GET /api/admin/events/{id}/dashboard` (the route already exists — it was created in Phase 1.7 but the UI still reads from mock). The API returns: `todayOrders`, `liveOrders`, `todayRevenue`, `vendorHeartbeats`.
6. Wire `app/organizer/fair/[fairId]/analytics/page.tsx` to real data: call `GET /api/admin/events/{id}/dashboard` (organizers share the same aggregate stats endpoint as admins for now). Replace mock charts with `EarningsChart` component using a `period` toggle.
7. ⚠️ Decision needed: Should vendor analytics aggregate across all fairs a vendor has participated in (global `/vendor/analytics`) or remain per-fair (`/vendor/[fairSlug]/analytics`)? Per-fair is consistent with the portal's scope but loses cross-event comparison. Resolve before implementing step 4.

### Phase J — Cleanup (Detail)

Prerequisite: All phases B–I must be complete and confirmed working before any deletions. Delete in dependency order — UI components before contexts, contexts before utilities.

1. Delete `src/views/` — remove all ported files in reverse dependency order: first `VendorDashboard.jsx`, `Checkout.jsx`, `TrackOrder.jsx`, `Vendors.jsx`, `VendorDetail.jsx`, `Menu.jsx`, `ManageAccount.jsx`, `BecomeVendor.jsx`, `BecomeDriver.jsx`, then `Home.jsx`, `Landing.jsx`, `Location.jsx`, `Contact.jsx`, `RefundPolicy.jsx`. Do not delete `Home.jsx` until a replacement landing/home page under `app/` is built (it is not covered by any phase B–I). ⚠️ Flag: `src/views/Home.jsx` is the authenticated home dashboard — no App Router equivalent has been planned yet.
2. Delete `src/components/` — remove ported components after their App Router equivalents are confirmed: `AddressAutocomplete.jsx` (Phase A done), `SignOutModal.jsx` (Phase A done), `SizeSelectionModal.jsx` (Phase D), `FoodCard.jsx` (Phase D), `Cart.jsx` (Phase F). Delete `src/components/skeletons/` after all loading.tsx files are created. Delete `src/components/ui/skeleton.tsx` last (check it has no remaining importers).
3. Remove `src/context/CartContext.jsx` (or wherever the SPA's global cart context lives) after confirming `FairCartContext` is the only cart in use and `syncToSpaCart()` has been deleted (Phase F step 8).
4. Delete `src/utils/constants.js` — replaced by `lib/constants.ts`. First grep all importers: `grep -r "src/utils/constants" src/` — confirm zero results after other src/ deletions.
5. Delete `src/utils/vendorData.js`, `src/utils/menuData.js`, `src/utils/vendorPortalData.js`, and `src/lib/firebase.js`, `src/lib/stripe.js` — all replaced by real API calls or `lib/` equivalents (Phase A, F).
6. Delete `lib/mock/fairs.ts` and `lib/mock/admin.ts` — replace all remaining importers first. Search: `grep -r "lib/mock" app/` before deleting. These mocks feed `FairContext`, `app/admin/` pages, `app/organizer/` pages — all must be wired to real data before deletion.
7. Update `app/[[...slug]]/page.tsx`: once all SPA views are deleted, remove the dynamic `import('../src/App')` and replace with a server-side redirect to `/fairs` (the fair discovery page). This kills the SPA catch-all entirely.
8. Remove backward-compat redirect routes from `src/App.jsx` (`/menu` → `/{DEFAULT_EVENT_SLUG}/menu`, `/vendors` → etc.) — these are no longer needed once the SPA is gone. Then delete `src/App.jsx` itself.
9. Remove `NEXT_PUBLIC_DEFAULT_EVENT_SLUG` from `.env.local` and any references to `DEFAULT_EVENT_SLUG` in the codebase after step 8.
10. Run `npx tsc --noEmit` and `next build` after each deletion batch to catch broken imports early. Do not batch all deletions into one commit — delete one phase's files, verify build, commit, then continue.

---

## Overall Status

| Step | Status | Summary |
|---|---|---|
| 1 — Next.js Migration | ✅ Complete | Nothing outstanding |
| 2 — DB + Core Backend | ✅ Schema complete ⚠️ Infra bugs | REDIS_URL double-prefix breaks BullMQ; all keys are test/dev mode |
| 3 — Core Order Flow | 🟡 ~65% done | Checkout wired, tracking built, 2-min accept timeout missing |
| 4 — Fulfillment + Runner App | 🔴 Not started | Entire system |
| 5 — Vendor System | 🟡 ~25% done | BecomeVendor API call added; dashboard still on mock data; 10-step wizard not started |
| 6 — Admin Portal | 🔴 Not started | Static placeholder page; all API routes 501 |
| 7 — Customer Experience | 🟡 ~30% done | App Router fair routes built with mock data; discovery page built with mock data |
| 8 — Multi-Vendor Assembly | 🔴 Not started | Schema rewrite, cart update, MasterOrder |
| 9 — Dispute & Refund | 🔴 Not started | Job constants + worker shells exist; no API routes |
| 10 — Production Ready | 🔴 Not started | Auth model, security, testing, deploy |

**Completion:** ~35% code written, ~15% fully functional.

---

## ⚠️ Critical Bugs — Fix Before Any Testing

Three bugs that silently break core platform behaviour. None require more than 30 minutes combined.

| # | Bug | File | Fix | Time |
|---|---|---|---|---|
| 1 | ~~**REDIS_URL double prefix**~~ ✅ FIXED | `.env.local` | Removed duplicate `REDIS_URL=` prefix. | 2 min |
| 2 | ~~**JOB_UNACCEPTED never scheduled**~~ ✅ FIXED | `app/api/orders/route.ts` | Added `ordersQueue.add(JOB_UNACCEPTED, ...)` after Firebase write (step 9). Imports added. | 30 min |
| 3 | ~~**isPaused not enforced**~~ ✅ FIXED | `app/api/orders/route.ts` | Added `isPaused` check (503 `PLATFORM_PAUSED`) after event status check (line 172). | 15 min |

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

**Status:** ✅ DONE — Migration `20260403005337_v4_playbook_requirements` has been run. All V4 models are in the schema.

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

**Status:** 🟡 PARTIAL — All 8 job name constants defined. `eventId` in `JobData`. All 7 active handlers fully implemented. `handleBulkRefundEvent` implemented. `handleGeneratePostEventReport` remains a stub pending Phase 1.10 (`lib/reports/post-event-report.ts`). `JOB_UNACCEPTED` scheduling fixed (see Critical Bugs).

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

**`lib/queues.ts`:** ✅ Complete — all job constants, `JobData` interface with `eventId`, queue singleton.

**`workers/order-worker.ts`:** ✅ All active handlers implemented. `handleGeneratePostEventReport` remains a stub — depends on `lib/reports/post-event-report.ts` (Phase 1.10).

---

## Section 3 — Firebase RTDB Structure (Post-Restructure)

**Status:** ✅ DONE — All paths use `fairs/{eventId}/...` namespace in `app/api/orders/route.ts`, `app/api/orders/[id]/status/route.ts`, and `src/views/TrackOrder.jsx`. Note: `TrackOrder.jsx` line 627 has a TODO about fully replacing the initial REST fetch with the Firebase subscription — verify end-to-end.

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

**Status:** 🟡 PARTIAL — `REDIS_URL` double-prefix fixed. Firebase, Google Maps, Supabase DB all configured. Remaining: (1) Stripe test keys → swap for live keys before any real event; (2) `RESEND_API_KEY` missing — add before Phase 1.10; (3) Clerk phone auth deferred — requires Clerk Pro plan, will be configured last.

Configure ALL of these in `.env.local` AND Vercel dashboard before any build work.
Nothing below works until these are set.

```bash
# Clerk — currently test keys; phone auth config deferred until Clerk Pro plan activated
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

**Clerk dashboard configuration (phone auth — deferred, requires Clerk Pro plan):**
1. User & Authentication → Email, Phone, Username
2. Enable "Phone number" as primary identifier
3. Sign-in strategy: "Phone number + Password"
4. Disable email as primary (make optional or disable)

> Do this last. Everything else can be built and tested with current email-based Clerk auth.

---

## TIER 0 — Immediate Fixes (Do Before Anything Else)

Bugs and misconfigurations in existing code. Fix today. Total time: ~2 hours.

### T0.1 — Fix Platform Fee 7% → 10% (15 min)

**Status:** ✅ DONE — `vendor.commissionRate` used in fee calculation. Schema default is `0.10`. `lib/constants.ts` defines `PLATFORM_FEE_RATE = 0.10`.

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

**Status:** ✅ DONE — `POST /api/vendors` called on submit. API creates DB vendor record, sets `publicMetadata.role = 'vendor'` via Clerk Backend API, and creates the `VendorMember` owner record. Description field added to Step 1 form and sent in request body.

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

**Status:** 🟡 PARTIAL — `REDIS_URL` fixed. Remaining: add `RESEND_API_KEY` before Phase 1.10; swap Stripe test keys for live keys before first real event; Clerk phone auth deferred (see Section 4).

Not a code task. See Section 4.

### T0.4 — FairDash → FairSynq Rename (30 min)

**Status:** ✅ DONE — No `FairDash` occurrences found in `src/`. `app/layout.tsx` uses FairSynq branding.

Files still containing "FairDash" confirmed:
- `src/context/CartContext.jsx`
- `src/App.jsx`
- `src/views/RefundPolicy.jsx`
- `src/views/Landing.jsx`
- `src/views/Contact.jsx`
- `src/views/Home.jsx`

Global find-replace. Update `app/layout.tsx` title and meta description.

### T0.5 — Un-Hardcode EVENT_SLUG (2 hours)

**Status:** ✅ DONE — Both views use `useParams()` for `eventSlug` and call `/api/menu?eventSlug=...` and `/api/vendors?eventSlug=...` respectively.

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
**Time:** 1 day | **Complexity:** S | **Status:** ⏸️ DEFERRED — requires Clerk Pro plan

**Clerk dashboard only** (see Section 4). No code changes to API routes — `requireAuth()` in `lib/auth.ts` works the same regardless of identifier type. The entire platform can be built and tested with the current email-based auth. Do this last.

**Code changes:**
- `lib/clerk-appearance.ts` — update placeholder text to reference phone number
- Any sign-in UI prompts in `Landing.jsx` — update copy: "Sign in with your phone number"
- `app/api/webhooks/clerk/route.ts` — already syncs `phoneNumbers[0]` to `User.phone` ✅

---

### Phase 1.2 — Checkout Wiring + Stripe Elements
**Time:** 3 days | **Complexity:** L | **Blocks:** All revenue | **Status:** ✅ DONE

**What's done:** Stripe `<Elements>` + `<PaymentElement>` integrated. `POST /api/orders` called on submit. `clientSecret` received and used. Fulfillment config loaded from `/api/events/${eventSlug}`. Delivery fee and service charge line items present. Fulfillment auto-select, curbside vehicle fields, home delivery address form, estimated ready time display, navigate to `/track?orderId=` on success. `return_url` fallback fixed to `/track?orderId=` (was `/home`).  
**What's missing:** Nothing.

**`src/views/Checkout.jsx`** — fully wired.

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
**Time:** 2 hours | **Complexity:** S | **Status:** 🟡 PARTIAL

**What's done:** Curbside 10-min forfeiture (`JOB_UNCOLLECTED`) and home delivery 10-min timeout (`JOB_UNDELIVERABLE`) are both scheduled correctly on the → READY transition in `app/api/orders/[id]/status/route.ts:125-134`.  
**What's missing (CRITICAL):** `JOB_UNACCEPTED` is never scheduled after order creation. Add the `ordersQueue.add(JOB_UNACCEPTED, ...)` call shown below to `app/api/orders/route.ts` after the Firebase write. This is Bug #2 in the Critical Bugs table above.

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
**Time:** 4 hours | **Complexity:** S | **Status:** ✅ DONE

`startedAt` and `cancellationFee` set on PLACED → ACCEPTED in `app/api/orders/[id]/status/route.ts:110-111`. Cancel route charges $5 if `ACCEPTED`, full refund if `PLACED`, blocks if `PREPARING+`.

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
**Time:** 2 days | **Complexity:** M | **Status:** ✅ DONE

**What's done:** Full UI built. Firebase real-time listener on `fairs/{eventId}/customerOrders/{customerId}/{orderId}` subscribes after initial REST fetch supplies `eventId`/`customerId`. Polling every 15 s is a fallback when Firebase unavailable. Cancel button with modal (correct messaging for PLACED vs ACCEPTED). Status timeline. Runner location map for HOME_DELIVERY. Recent orders list when no orderId in URL. Stale TODO comment removed.  
**What's missing:** Nothing.

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
**Time:** 3-4 days | **Complexity:** L | **Status:** ✅ DONE

All `vendorPortalData` mock imports removed. Full live wiring implemented:

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
**Time:** 4-5 days | **Complexity:** L | **Blocks:** Event operators going live | **Status:** 🔴 NOT STARTED

`app/admin/page.tsx` is a static "Restricted" placeholder. All admin API routes (`/api/admin/route.ts`, `/api/admin/dashboard/route.ts`) return 501. `isPaused` is not enforced in `POST /api/orders` (see Critical Bugs #3 above).

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
**Time:** 4-5 days | **Complexity:** L | **Status:** 🔴 NOT STARTED

Only `src/views/BecomeDriver.jsx` (the signup form) and the old `/api/drivers/` stubs exist. No runner dashboard, no `requireRunnerAuth()`, no `/api/runners/` routes, no incident report routes, no GPS delivery endpoint.

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
**Time:** 4 hours | **Complexity:** M | **Breaking if data exists in old paths** | **Status:** ✅ DONE

All Firebase paths already use `fairs/{eventId}/...` namespace. See Section 3 status note.

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
**Time:** 2 days | **Complexity:** M | **Status:** 🔴 NOT STARTED

`handleGeneratePostEventReport` in `workers/order-worker.ts` is a stub with a TODO comment. `lib/reports/post-event-report.ts` does not exist. `resend` package not installed. `RESEND_API_KEY` not in `.env.local`.

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
**Time:** 1 day | **Files:** New `src/context/FairContext.jsx` | **Status:** ✅ DONE

`app/_contexts/FairContext.tsx` exists and is used throughout `app/fair/[fairSlug]/`. Currently backed by `lib/mock/` data — wire to live `GET /api/events/${fairSlug}` when mock data is swapped out.

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
**Time:** 2-3 days | **Files:** `app/fair/[fairSlug]/` tree | **Status:** 🟡 PARTIAL

**What's done:** Full route tree built at `app/fair/[fairSlug]/` — `page.tsx` (vendor grid), `vendors/`, `vendor/[vendorSlug]/`, `cart/`, `checkout/`, `orders/`, `order/[orderId]/`, `info/`, `layout.tsx`. FairContext wired. Branding applied.  
**What's missing:** All pages use `lib/mock/` data instead of live API calls. `checkout/page.tsx` is a redirect shim to the legacy SPA checkout — not a real checkout page. `orders/page.tsx` shows an empty-state placeholder. Swap mock data for real `GET /api/events/${fairSlug}`, `GET /api/vendors`, `GET /api/menu` calls.

> **Route path note:** This project uses `app/fair/[fairSlug]/` (not `app/[eventSlug]/`) to avoid top-level route conflicts. All references below use the actual path.

```
app/fair/[fairSlug]/
├── layout.tsx           — loads event, sets branding, wraps in FairProvider
├── page.tsx             — vendor grid
├── info/page.tsx        — event info
├── vendors/
│   └── [vendorSlug]/
│       └── page.tsx    — vendor detail
├── cart/page.tsx
├── checkout/page.tsx    — currently a redirect shim to SPA checkout
├── orders/page.tsx      — placeholder, requires auth + live API
└── order/[orderId]/page.tsx
```

`app/fair/[fairSlug]/layout.tsx`:
```typescript
export default async function EventLayout({ params, children }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/events/${params.fairSlug}`)
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
**Time:** 2 days | **Files:** `app/fairs/page.tsx`, `app/_components/FairCard.tsx` | **Status:** 🟡 PARTIAL

**What's done:** `/fairs` page renders a FairCard grid grouped by status. `FairCard` component built with status badge, date range, vendor count. Route exists at `app/fairs/page.tsx`.  
**What's missing:** Uses `mockFairs` from `lib/mock/` — not wired to `GET /api/events`. No geo-filtering, no text search. Root `app/page.tsx` still serves the old SPA (SPA catch-all) — it is not the discovery landing page.

**`app/fairs/page.tsx`** — currently uses mock data, needs to become a Next.js Server Component:
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
**Time:** 2 hours | **Files:** `lib/qr.ts`, `app/api/admin/events/[id]/qr/route.ts` | **Status:** 🔴 NOT STARTED

`lib/qr.ts` does not exist. `qrcode` package not installed. No QR API route.

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
**Time:** 3 days | **Files:** `src/views/BecomeVendor.jsx` expansion, new Stripe Connect routes | **Status:** 🔴 NOT STARTED

Current wizard is 4 steps. Steps 5–10 (document uploads, Stripe Connect, digital agreement) not built. No Stripe Connect API routes (`/api/stripe/connect/onboard`, `/api/stripe/connect/return`). No Supabase Storage presigned upload route (`/api/storage/upload`).

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
**Time:** 3-4 days | **Files:** `app/organizer/fair/[fairId]/` route tree | **Status:** 🟡 PARTIAL

**What's done:** Full portal shell built at `app/organizer/` — layout with auth check, analytics, orders, vendors, disputes, settings pages all exist. Analytics page has mock Recharts charts. Vendors page has tab/filter UI. Orders page has filter UI. Create fair form UI exists at `app/organizer/fairs/new/`.  
**What's missing:** All pages import from `lib/mock/organizer` — none wired to real API. Disputes page is a blank placeholder ("No disputes to review"). Create fair form wiring to `POST /api/events` unverified. No `reports/page.tsx` for post-event report history. `FairOrganizer`/`OrgMember` provisioning flow not built.

> **Route path note:** This project uses `app/organizer/fair/[fairId]/` (not `app/organizer/[eventSlug]/`). Update all references accordingly.

For event operators who manage an event from setup through close, separate from the super-admin portal.

```
app/organizer/
├── layout.tsx                        — requires role: event_operator
├── fairs/
│   ├── page.tsx                      — list organizer's fairs
│   └── new/page.tsx                  — create fair form (UI exists, API wiring unverified)
└── fair/[fairId]/
    ├── layout.tsx
    ├── page.tsx
    ├── analytics/page.tsx            — mock charts built, needs live API
    ├── orders/page.tsx               — mock orders built, needs live API
    ├── vendors/page.tsx              — mock vendors built, needs live API
    ├── disputes/page.tsx             — blank placeholder
    ├── settings/page.tsx
    └── reports/page.tsx              — NOT BUILT — post-event reports history
```

**Organizer provisioning flow:**
1. Super-admin creates `FairOrganizer` record
2. Super-admin creates `OrgMember` linking organizer's User to the org
3. Super-admin sets Clerk `publicMetadata.role = 'event_operator'`
4. Organizer can now access `/organizer/fair/[fairId]/analytics`

---

## TIER 3 — Multi-Vendor Orders + Financial Accountability

Build after Tier 1 is proven stable with at least one live event.

---

### Phase 3.1 — Multi-Vendor Cart (5-Vendor Cap)
**Time:** 2 days | **Files:** `src/context/CartContext.jsx`, `src/components/Cart.jsx` | **Status:** 🔴 NOT STARTED

`CartContext.jsx` still uses a single-vendor model. No multi-vendor grouping or cap enforcement.

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
**Time:** 1 day schema + 3 days implementation | **Complexity:** XL | **Breaking change** | **Status:** 🔴 NOT STARTED

`MasterOrder`, `SubOrder`, `SubOrderItem` models not in schema. Migration not run. Do not start until Tier 1 is proven stable at a live event.

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
**Time:** 2 days | **Files:** `app/api/orders/route.ts` — full rewrite of POST handler | **Status:** 🔴 NOT STARTED

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
**Time:** 2-3 days | **Files:** New `app/api/sub-orders/[id]/status/route.ts` | **Status:** 🔴 NOT STARTED

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
**Time:** 3 days | **Files:** New `lib/reconciliation.ts`, `app/api/admin/events/[id]/close/route.ts` | **Status:** 🔴 NOT STARTED

`handleBulkRefundEvent` in `workers/order-worker.ts` is a stub with a TODO. `lib/reconciliation.ts` does not exist. No close or emergency-cancel API routes.

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
**Time:** 2-3 days | **Files:** `app/api/disputes/`, `app/api/admin/disputes/` | **Status:** 🔴 NOT STARTED

`JOB_ESCALATE_DISPUTE` constant defined and worker handler shell exists. `Dispute` model in schema. No `/api/disputes/` routes built. Vendor dashboard disputes tab is a blank placeholder.

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

**Status:** 🔴 NOT STARTED

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

**Status:** 🔴 NOT STARTED

Per playbook: *"Vendor dashboards keep working when connectivity drops. Orders queue locally and sync when connection returns."*

```bash
npm install next-pwa
```

- Service worker for offline caching
- Firebase offline persistence: `firebase.database().setPersistenceEnabled(true)` — vendor dashboard RTDB listener works offline, syncs on reconnect
- localStorage order queue replay for cases where BullMQ is unreachable
- PWA manifest for "Add to Home Screen" on vendor tablets

### Phase 4.3 — Advanced Analytics

**Status:** 🔴 NOT STARTED — Recharts installed. Organizer analytics page has mock chart UI built (ahead of schedule, not connected to real data).

- Recharts already installed
- Peak order window chart (30-min buckets)
- Year-over-year comparison across events (PostEventReport data)
- Vendor performance leaderboard
- Real-time GMV counter on super-admin dashboard

### Phase 4.4 — Ratings + Favorites

**Status:** 🔴 NOT STARTED — `FavoriteItem` model in schema. SPA routes for `/favorites` and `/history` are stubs.

- `FavoriteItem` model already in schema (Phase 1 migration)
- Heart toggle on `FoodCard.jsx` → `POST /api/favorites` with `{ menuItemId }`
- `/favorites` route — currently "Coming Soon" stub
- `/history` route — `GET /api/orders` already exists with cursor pagination; wire it up

---

## Progress Summary (April 13 2026 Audit)

| Tier | Items | ✅ Done | 🟡 Partial | 🔴 Not Started | ⚠️ Broken |
|---|---|---|---|---|---|
| Tier 0 — Immediate Fixes | 5 | 3 | 1 | 0 | 1 |
| Schema + Infra (Sections 1–4) | 3 | 2 | 1 | 0 | 1 |
| Tier 1 — First Live Event | 10 | 3 | 3 | 4 | 0 |
| Tier 2 — Multi-Fair Experience | 6 | 1 | 3 | 2 | 0 |
| Tier 3 — Multi-Vendor + Finance | 6 | 0 | 0 | 6 | 0 |
| Tier 4 — 2027 Readiness | 4 | 0 | 0 | 4 | 0 |
| **Total** | **34** | **9** | **8** | **16** | **2** |

**Overall:** ~35% code written, ~15% fully functional (blocked by infra bugs and missing Tier 1 items).

---

## Items Built But Not In Plan

Work that exists in the codebase but was not tracked in this plan. Noted here so it is not accidentally discarded or rebuilt.

- **`app/fair/[fairSlug]/` full route tree** — All pages built with `lib/mock/` data as UI scaffolding. Ahead of Phase 2.2. Swap mock data for live API calls to complete the phase.
- **`app/fairs/page.tsx` + `app/_components/FairCard.tsx`** — Discovery page and FairCard component built with mock data. Ahead of Phase 2.3. Wire to `GET /api/events` to complete.
- **`app/organizer/` full portal shell** — Analytics, orders, vendors, disputes, settings pages built with mock data. Layout and auth check in place. Ahead of Phase 2.6. Wire all pages to real API to complete.
- **`lib/mock/` directory** — `fairs.ts`, `vendors.ts`, `organizer.ts`, `index.ts` — all mock data driving the above UI scaffolding. Delete file-by-file as each page is wired to live API.
- **`app/_contexts/FairCartContext.tsx`** — Fair-scoped cart context for App Router pages. Bridges `app/fair/[fairSlug]/cart/` to the legacy SPA cart via `syncToSpaCart()`. Not needed once Phase 3.1 (multi-vendor cart) replaces the SPA cart.

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
✅ DONE — T0.1, T0.4, T0.5, Schema migration, 1.4, 1.9, 2.1

TODAY (bugs — fix before writing any new code):
  BUG   Fix REDIS_URL double-prefix in .env.local (2 min)
  BUG   Add JOB_UNACCEPTED scheduling to POST /api/orders (30 min)
  BUG   Add isPaused check to POST /api/orders (15 min)
  T0.2  Update POST /api/vendors to set publicMetadata.role = 'vendor' (30 min)
  T0.3  Add RESEND_API_KEY to .env.local + Vercel (5 min)

WEEK 1 (remaining Tier 1 critical path):
  1.1   Clerk phone+password config in dashboard (1 day)
  1.2   Verify post-payment nav + add estimated ready time display (0.5 day)
  1.5   Verify Firebase subscription in TrackOrder.jsx (0.5 day, line 627 TODO)

WEEK 2:
  1.6   Vendor dashboard: live API + real-time orders + heartbeat (3-4 days)
        — Build: /api/vendors/[id]/stats, /api/vendors/[id]/revenue
        — Wire Firebase order listener + heartbeat ping
        — Build vendor menu manager tab + /api/storage/upload

WEEK 3:
  1.7   Admin portal MVP (4-5 days)
        — Build full app/admin/[eventSlug]/ route tree
        — All admin API endpoints (dashboard, vendor approval, fulfillment, pause)
        — Go Live checklist + Platform Pause button

WEEK 4:
  1.8   Runner app (4-5 days)
  1.10  Post-event report (2 days, parallel with runner app)
        — npm install resend
        — lib/reports/post-event-report.ts
        — Implement handleGeneratePostEventReport worker handler

── FIRST EVENT CAN GO LIVE AFTER WEEK 4 ──────────────────────

WEEKS 5–7 (multi-fair public experience — UI scaffolding already built):
  2.2   Wire app/fair/[fairSlug]/ pages to live API (swap lib/mock/ data)
  2.3   Wire app/fairs/page.tsx to GET /api/events + add geo/search filters
  2.4   QR code generation (2 hrs)
  2.5   10-step vendor onboarding wizard (3 days)
  2.6   Wire app/organizer/ pages to live API + build reports tab

WEEKS 8–12 (multi-vendor + financial accountability):
  3.1   Multi-vendor cart (2 days)
  3.2   MasterOrder/SubOrder schema (1 day schema + 3 days wiring)
  3.3   Multi-vendor order creation API (2 days)
  3.4   Multi-vendor state machine (2-3 days)
  3.5   Payout reconciliation engine (3 days)
  3.6   Dispute system (2-3 days)

WEEKS 13+ (2027 readiness):
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
