# Vendor Dashboard — State Reconciliation Rules

**Audience:** engineers working on the vendor dashboard, vendor-status API, or Firebase sync.

---

## Why this document exists

The vendor dashboard maintains live order state across three data sources simultaneously:

| Source | Transport | Latency | Authority |
|---|---|---|---|
| Postgres REST | HTTP fetch | ~100–400 ms | Highest — persisted truth |
| Firebase RTDB | WebSocket push | ~50–200 ms | High — authoritative for new events |
| Optimistic local state | Synchronous | 0 ms | Intermediate — assumed correct, can revert |
| Cached analytics snapshot | HTTP + cache | 0–10 s stale | Lowest — aggregate approximation |

Without explicit rules, race conditions produce split-brain: a decline that clears revenue on one tab but not another, or a refunded order that still appears in the queue.

---

## Priority Order

```
1. Server-confirmed REST response      ← highest authority
2. Firebase real-time push             ← authoritative for new events
3. Optimistic local state              ← immediate UX, always revertible
4. Cached analytics snapshot           ← lowest priority, stale allowed
```

**Never overwrite a higher-priority source with a lower-priority one.**

Concretely:
- A Firebase push must not overwrite a REST-confirmed status if the REST response arrived later.
- A cached analytics value must not replace a Firebase-pushed live stat.
- An optimistic update must always be revertible to the last REST-confirmed state.

---

## Rule 1 — Optimistic state is always provisional

Every status transition (Accept, Decline, Preparing, Ready, Complete) applies an optimistic update immediately:

```ts
patchStatus(orderId, newStatus)   // instant — no network wait
await transitionOrder(orderId, newStatus)   // REST call — ~200ms
// on failure: patchStatus(orderId, previousStatus)  // revert
```

**Rule:** The previous status must be captured *before* the optimistic patch so rollback is always possible. Never patch and discard the prior state.

**Implementation:** `handleAccept`, `handleDecline`, etc. in `dashboard/page.tsx` follow this pattern. Each saves `order.status` before patching.

---

## Rule 2 — Firebase pushes are version-gated

The vendor-status route writes a monotonically incrementing `version` integer on every `VendorOrderStatus` update:

```ts
await db.vendorOrderStatus.update({
  data: { status: newStatus, version: { increment: 1 } },
  select: { version: true },
})
```

The Firebase payload always includes `version`:

```ts
fireAndForgetFirebaseUpdate(path, { id, status, updatedAt, version: updated.version })
```

The `onChildChanged` listener in the dashboard **rejects pushes with a version ≤ the current known version**:

```ts
if (data.version !== undefined && data.version <= (existing.version ?? 0)) return prev
```

This prevents stale out-of-order pushes (network jitter, reconnect replay) from overwriting newer confirmed state.

---

## Rule 3 — REST response wins over Firebase on any conflict

If a REST response and a Firebase push arrive for the same order in close succession:

- **REST wins.** The `refetchActiveOrders()` call on reconnect performs a full merge into `ordersById`, which overwrites any Firebase-derived state.
- Firebase is used for _new event notification_ (PLACED orders arriving from a different tab or another vendor's action). It is **not** the final authority on state that has already been REST-confirmed.

This is enforced by `seenOrderIds` ref: once an order has been seen via REST, a Firebase `onChildAdded` for the same ID is a no-op.

---

## Rule 4 — Revenue is always COMPLETED/DELIVERED only

Revenue figures displayed to vendors must **never** include orders that were declined or cancelled, even transiently.

**Query rule:** all revenue aggregates join `VendorOrderStatus` and filter `status IN ('COMPLETED', 'DELIVERED')`. Never aggregate `OrderItem.totalPrice` without this join.

**Firebase stats rule:** the `todayRevenue` field pushed to `fairs/${eventId}/vendorStats/${vendorId}` is computed post-join, excluding failed orders. The formula:

```ts
const todayRevenue = SUM(OrderItem.totalPrice WHERE VendorOrderStatus.status IN ('COMPLETED', 'DELIVERED')) * 0.90
```

**Trigger:** the `after()` block in `vendor-status/route.ts` runs on **every** status transition, not just on completion. This ensures a decline immediately updates the live counter to zero out revenue from that order.

---

## Rule 5 — Cache invalidation on every status change

On every `PATCH /api/orders/[id]/vendor-status`:

```ts
revalidateTag(`analytics-${vendorId}`, 'default')
revalidateTag(`stats-${vendorId}`,     'default')
revalidateTag(`revenue-${vendorId}`,   'default')
```

Cache TTL for analytics queries is 10 seconds. Manual refresh (`?bust=`) bypasses the cache entirely and hits Postgres directly.

**Never** restrict revalidation to only terminal statuses (COMPLETED, DECLINED). Any status change can affect queue counts displayed on the dashboard.

---

## Rule 6 — Cross-tab sync via onChildChanged

The dashboard subscribes to `fairs/${eventId}/orders/${vendorId}` using two Firebase listeners:

| Listener | Fires when | Action |
|---|---|---|
| `onChildAdded` | A new PLACED order appears | Fetch full order via REST, insert into `ordersById` if not already seen |
| `onChildChanged` | An existing order's status changes | Patch `ordersById` in place (version-gated — Rule 2) |

`onChildAdded` **does not fire for orders that already existed** when the listener was attached — Firebase only delivers new children. This is why initial load uses a REST fetch, not Firebase.

**Cross-tab rule:** when a vendor completes an order on Tab A, Tab B receives the `onChildChanged` event with the new status. Tab B applies the patch immediately. Tab B's `inFlightRef` check (`if (inFlightRef.current.has(orderId)) return`) prevents Firebase from overwriting a transition that Tab B itself is actively performing.

---

## Rule 7 — Reconnection recovery

On Firebase WebSocket disconnect:

1. `setFirebaseConnected(false)` → amber banner shown to vendor
2. On reconnect (`.info/connected` fires with `true`): `refetchActiveOrders()` is called immediately
3. `refetchActiveOrders()` fetches both active orders and today's terminal orders via REST and merges into `ordersById` — this catches any orders that arrived while the socket was down (Firebase `onChildAdded` does not replay missed events on reconnect)
4. Browser `online` event also triggers `refetchActiveOrders()` for device-level connectivity loss

The merge (not replace) semantics of `refetchActiveOrders()` preserve any optimistic updates that haven't been confirmed yet.

---

## Data flow diagram

```
Customer places order
        │
        ▼
POST /api/orders → Postgres insert + Firebase push to fairs/{eventId}/orders/{vendorId}/{orderId}
        │
        ├─ onChildAdded fires on vendor dashboard ─→ REST fetch /api/orders/{id} ─→ ordersById
        │
Vendor taps Accept
        │
        ├─ 1. inFlightRef.add(orderId)           [synchronous guard]
        ├─ 2. patchStatus(ACCEPTED)              [optimistic]
        ├─ 3. PATCH /api/orders/{id}/vendor-status
        │      ├─ DB update (version++)
        │      ├─ revalidateTag(analytics-*, stats-*, revenue-*)
        │      ├─ Firebase push (vendor path + customer path)
        │      └─ after(): compute today stats → Firebase vendorStats push
        ├─ 4. inFlightRef.delete(orderId)
        │
        └─ onChildChanged on OTHER tabs ─→ version check ─→ patchStatus if newer
```

---

## Source of truth per feature

| Feature | Source of truth |
|---|---|
| Order queue (Incoming / Preparing / Ready) | Local `ordersById` map (seeded from REST, synced via Firebase) |
| Order terminal state (Completed / Failed) | Postgres `VendorOrderStatus.status` |
| Revenue today | Postgres aggregate (COMPLETED/DELIVERED only), pushed to Firebase after each transition |
| Queue count (In Queue stat card) | Derived from `ordersById` via `useMemo` |
| New incoming orders | Firebase `onChildAdded` → REST fetch |
| Cross-tab status changes | Firebase `onChildChanged` (version-gated) |
| Analytics chart data | Postgres (10s cache, bust on manual refresh) |
| Menu availability | Postgres `MenuItem.isAvailable` (10s cache via `revalidateTag`) |
| Vendor auth | Redis cache → Postgres fallback |
| Stripe connection | Stripe API (5 min cache) → `Vendor.stripeVerified` DB fallback |
