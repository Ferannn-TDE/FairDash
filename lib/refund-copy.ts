// Item 10 stage 5 — the approved refund wording (Feran, 2026-11-21; BATCH-1 §19). One module so every surface says the
// same thing and scripts/refunds-stage5-test.ts can pin it. Plain strings, no server imports (client components use it).
// The "10 minutes" in VENDOR_TIMEOUT_ANSWER is checked against VENDOR_ACCEPT_TIMEOUT_MS by that test.

/** Customer FAQ — "Can I cancel an order?" (row 1, as Feran rewrote it). */
export const CANCEL_ANSWER =
  "Before any vendor accepts, you can cancel and get everything back: food, service fee, curbside fee and tip. Once a vendor accepts, that part of your order can't be cancelled; if something goes wrong, request a refund and our team will review it. If you cancel the rest of a partly accepted order, you get that food back and the service fee stays."

/** Customer FAQ — "What happens if the vendor doesn't accept my order?" (row 2). */
export const VENDOR_TIMEOUT_ANSWER =
  'If no vendor accepts within 10 minutes, your order is cancelled automatically and you get everything back.'

/** Customer cancel dialog (row 3). */
export const CUSTOMER_CANCEL_DIALOG =
  'Your order will be cancelled. If no vendor has accepted yet, you get everything back, including the service fee. Refunds usually appear within 5–10 business days.'

/** Vendor decline dialog (row 4). */
export const VENDOR_DECLINE_DIALOG =
  'The customer will be notified and refunded automatically. If no other vendor on the order accepts, the customer also gets the service fee back. It never comes out of your earnings.'

/** Refund policy page — "Cancelled Orders" (row 5: the C-2 rules). */
export const CANCELLED_ORDERS_POLICY =
  "If no vendor has accepted your order yet — you cancel it, every vendor declines it, or no vendor accepts in time — you get everything back: the food, the service fee, and any curbside fee and tip. Once a vendor accepts, their part of the order can't be cancelled and the service fee is kept; if only some vendors' parts are cancelled, you get that food back. If a curbside order is never handed to you, the curbside fee and tip come back. Missed pickups and no-shows aren't refunded. Refunds go back to the card you paid with and usually take 5–10 business days to appear."
