# Checkout Test Cases

Use an **incognito window** for all tests — prevents Stripe Link from auto-filling saved cards.

## Test Cards
| Card | Number | Result |
|------|--------|--------|
| Success | `4242 4242 4242 4242` | Always succeeds |
| Declined | `4000 0000 0000 0002` | Always declined |

Expiry: any future date (e.g. `12/30`) · CVC: any 3 digits (e.g. `123`) · ZIP: any (e.g. `12345`)

---

## TC-01: Single item, booth pickup, card payment
1. Add 1× Fries ($8) to cart
2. Go to checkout → select **Booth Pickup**
3. Fill Name: `Test User`, Phone: `555-555-5555`
4. Click **Continue to Payment**
5. Enter card `4242 4242 4242 4242 / 12/30 / 123`
6. Click **Pay**

**Expected:**
- Redirected to order tracking page
- Order status = `PLACED`
- Vendor dashboard shows order in **Incoming** lane

---

## TC-02: Single item, curbside, card payment
1. Add 1× Nachos ($14) to cart
2. Checkout → select **Curbside**
3. Fill vehicle: Toyota · Silver · `ABC1234`
4. Complete payment with `4242` card

**Expected:**
- Order tracking shows vehicle info (make, color, plate)
- Vendor order card shows curbside badge

---

## TC-03: Multiple items, same vendor
1. Add Fries + Nachos from the same vendor
2. Complete checkout (Booth Pickup)

**Expected:**
- ONE order created with 2 line items
- Subtotal = sum of both items
- Platform fee shown and matches server-calculated amount

---

## TC-04: Multiple items, different vendors
1. Add 1 item from Vendor A + 1 item from Vendor B
2. Cart shows both items
3. Complete checkout

**Expected:**
- ONE order created (primary vendor = first item's vendor)
- Payment succeeds — no double-confirm loop
- Primary vendor sees the order in their dashboard
- Order tracking shows all items

---

## TC-05: Declined card
1. Add any item to cart
2. At payment step, enter `4000 0000 0000 0002`
3. Click **Pay**

**Expected:**
- Toast error: "Your card was declined"
- User stays on payment page — can retry
- Order remains in `PENDING_PAYMENT` state (not cancelled)

---

## TC-06: Cancel order (customer)
1. Complete TC-01 and land on order tracking
2. Click **Cancel Order** (if shown)
3. Confirm in modal

**Expected:**
- Order status = `CANCELLED`
- Refund visible in Stripe test dashboard under Refunds

---

## TC-07: Full vendor flow
1. Complete TC-01 as customer
2. Open vendor dashboard as the vendor user
3. Click **Accept** on incoming order
4. Click **Start Preparing**
5. Click **Mark Ready**
6. Click **Complete**

**Expected:**
- Each button moves the card to the correct lane
- Customer order tracking updates status at each step (via Firebase RTDB)
- No page refresh required for status changes

---

## TC-08: Payment back navigation
1. Add item to cart, proceed to checkout
2. Fill in details → click **Continue to Payment**
3. On payment screen, click **← Back**

**Expected:**
- Returns to checkout form (details preserved)
- No order created in DB (or order stays `PENDING_PAYMENT` and is cleaned up by timeout worker)
- Can re-submit with corrected details
