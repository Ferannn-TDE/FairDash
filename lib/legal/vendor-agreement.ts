// THE Vendor Agreement (Batch 1 item 8, B1.10) — the one place its text and version live.
//
// The sign-up wizard shows it, /vendor-agreement publishes it, and POST /api/vendors records
// VENDOR_AGREEMENT_VERSION on every acceptance (never a version sent by the browser). So the page,
// the wizard and the stored record can't disagree about which terms a vendor accepted.
//
// This is the client's agreement as it stands today, verbatim (sent by the client, version
// 2026-01-01). It is NOT a placeholder: it's what vendors already sign. Item 11 (legal pages)
// replaces the text and bumps the version HERE. scripts/vendor-agreement-test.ts fails if this file
// ever holds placeholder markers, or a version that doesn't match the "Last Updated" line.

export const VENDOR_AGREEMENT_VERSION = '2026-01-01'

export const VENDOR_AGREEMENT_TEXT = `FAIRSYNQ VENDOR AGREEMENT
Last Updated: January 1, 2026

This Vendor Agreement is entered into between FairSynq LLC ("FairSynq") and the vendor applying to participate on the FairSynq platform.

1. VENDOR ELIGIBILITY
To become a FairSynq vendor, you must: (a) be a legally registered business or sole proprietor; (b) hold all required food handler permits and health department certifications; (c) maintain valid general liability insurance of at least $1,000,000 per occurrence; and (d) agree to operate within the designated FairSynq service area during scheduled fair events.

2. PLATFORM FEES
FairSynq charges customers a 10% service fee on top of your menu prices. That fee is FairSynq's and is NOT deducted from your earnings — you keep your full item subtotal. Standard Stripe payment-processing fees (approximately 2.9% + $0.30 per order, split proportionally across vendors on shared orders) are deducted from your payout, the same as any card payment. Vendors receive payment via Stripe within 3–5 business days after each event settlement period. FairSynq reserves the right to adjust the service fee with 30 days' written notice.

3. MENU & PRICING
Vendors are responsible for maintaining accurate, up-to-date menu listings including item names, descriptions, allergen information, and pricing. Prices listed on FairSynq must match or be lower than prices charged at your on-site booth.

4. ORDER FULFILLMENT & QUALITY
You agree to: (a) prepare orders promptly; (b) notify FairSynq immediately if an item becomes unavailable; (c) package orders securely for delivery or curbside pickup; and (d) maintain a minimum order fulfillment rate of 95% per event.

5. FOOD SAFETY & COMPLIANCE
All food prepared and sold through FairSynq must comply with applicable food safety regulations. Vendors indemnify FairSynq against any claims arising from foodborne illness or improper food handling.

6. CUSTOMER REVIEWS & RATINGS
Vendors with an average rating below 3.5 stars over 30 days may receive a performance notice. Continued low ratings may result in reduced visibility or account suspension.

7. TERMINATION
Either party may terminate this Agreement with 14 days' written notice. FairSynq may terminate immediately for violations, fraudulent activity, or repeated food safety complaints.

8. GOVERNING LAW
This Agreement is governed by the laws of the State of Illinois. Disputes shall be resolved by binding arbitration.

By typing your full legal name below, you confirm you have read, understood, and agree to be bound by this Agreement.`

export const VENDOR_AGREEMENT_PATH = '/vendor-agreement'
