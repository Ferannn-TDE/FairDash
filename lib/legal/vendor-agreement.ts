// THE Vendor Agreement (Batch 1 item 8, B1.10; new text from item 11, legal pages): the one place
// its current text and version live.
//
// The sign-up wizard shows it, /vendor-agreement publishes it, and POST /api/vendors records
// VENDOR_AGREEMENT_VERSION on every acceptance (never a version sent by the browser). So the page,
// the wizard and the stored record can't disagree about which terms a vendor accepted.
//
// The text is Legal/vendor-agreement.md from the audit folder, final for this release (Jordan,
// 2026-11-23), byte for byte: scripts/legal-pages-test.ts locks its SHA-256. It is markdown,
// rendered by app/_components/LegalDocument.tsx. The version is its effective date
// (scripts/vendor-agreement-test.ts checks they match). The previous agreement (2026-01-01), which
// earlier test vendors signed, is kept unchanged in ./vendor-agreement-2026-01-01.ts.
//
// A future re-accept would compare Vendor.termsVersion with VENDOR_AGREEMENT_VERSION (not built).

export const VENDOR_AGREEMENT_VERSION = '2026-11-23'

export const VENDOR_AGREEMENT_TEXT = `# Vendor Agreement

Effective November 23, 2026

This Vendor Agreement ("Agreement") is between FairSynq LLC, an Illinois limited liability company ("FairSynq," "we," "us"), and the business that creates a vendor account ("Vendor," "you"). By checking the box at sign-up, you agree to this Agreement, our Privacy Policy and our Website Terms of Service.

### 1. What FairSynq is

FairSynq is an online marketplace that lets customers order food and other items ahead from vendors at fairs, festivals and other events, then pick them up at the vendor's booth or, at events that offer it, at a curbside pickup area. FairSynq provides the software. **You are the seller of everything you list.** FairSynq does not prepare, handle, store, inspect or deliver food, and does not buy or resell your items.

### 2. Your account and approval

2.1 You must be at least 18 and authorized to bind your business. The information you give us must be true and kept current.

2.2 Every vendor account is reviewed by FairSynq before it can take orders. We may approve, decline, pause or close an account at our discretion, including if you break this Agreement or an event's rules.

2.3 You are responsible for everything done under your account, including by your booth staff, family members or anyone else you let use it. Keep your login private.

### 3. Payments: FairSynq as your payment-collection agent

3.1 You appoint FairSynq as your limited agent to accept payment from customers for your items. When a customer pays FairSynq, that payment counts as payment to you, and the customer owes you nothing more for that order. FairSynq is the merchant of record on the customer's card charge because one charge may cover items from several vendors.

3.2 You must complete Stripe's onboarding and keep a verified Stripe payout account in good standing. Stripe's own terms apply to that account. FairSynq does not hold your bank details.

3.3 **Payouts.** We pay out what you're owed for completed orders on the schedule shown in your vendor dashboard. That is currently after each event, and weekly at events longer than 7 days. Bank timing after release is set by Stripe and your bank.

3.4 **Deductions.** We may deduct from any current or future payout: (a) refunds for orders you caused to fail (section 7); (b) chargebacks and disputes caused by your order, including the card network's dispute fee; and (c) any amount paid to you by mistake. If your payouts don't cover what you owe, you agree to pay it within 30 days of our invoice. Disputes can arrive weeks after an event, so this section survives the end of the Agreement. You are not charged for disputes caused by stolen cards or by FairSynq's own errors; FairSynq covers those.

### 4. Fees

You currently pay FairSynq no sign-up fee, platform fee, commission or monthly charge. Stripe's standard card processing on your own sales (your items and any tax collected on them) is deducted from your payouts; the current rate is shown in your vendor dashboard. The customer pays a service fee to FairSynq, which is shown at checkout.

FairSynq may introduce or change vendor fees by giving you at least 30 days' written notice by email and in your dashboard. New or changed fees apply only to orders placed after their effective date. If you don't agree, you may close your account before then. Current fees, if any, are always listed in your vendor dashboard.

### 5. Menus, prices and listings

5.1 You control your menu. Every item must have an accurate name, price and photo that shows the actual item. You must list allergens and major ingredients where a customer would reasonably need them, and mark items unavailable as soon as they run out.

5.2 **Price match.** Your online price for an item at an event may not be higher than your price for the same item at your booth at that event, unless FairSynq or the event organizer has turned on a higher allowed limit for that event. Any such limit is shown in your dashboard. We may hide or correct any item priced above the allowed limit.

5.3 You may not list alcohol, tobacco, cannabis, weapons, or anything illegal or restricted at that event. You may not list anything the event doesn't allow you to sell.

5.4 Price changes. Lowering a price, editing a description or photo, or removing an item takes effect right away. A price increase on a live item, and any new item or size, waits for approval by the event's organizer, or by FairSynq if the event has no organizer. Until it is approved, the old price keeps selling.

### 6. Taking and filling orders

6.1 Accept or decline each order promptly. Orders not accepted within the time shown in your dashboard are cancelled automatically, and the customer is refunded.

6.2 Once you accept an order, prepare it and have it ready by the ready time or pickup window you accepted. Hand it only to the customer, or to the curbside partner's runner for a curbside order, after checking the order code.

6.3 **Pickup windows and capacity.** If you set how many orders you can make per pickup window, set a number you can actually meet.

6.4 **Customer no-shows.** If a customer misses their pickup window or never collects an accepted order, the order is not refunded under FairSynq's policy and you keep your payout for it. You may choose to remake it or offer a refund yourself; any refund you choose is deducted from your payout.

### 7. Refunds you cause

If a whole order fails because of you, the customer gets a full refund, including FairSynq's service fee. If only some items are affected, the customer is refunded for those items and their tax, and FairSynq keeps its service fee. Failures include a wrong or missing item, unsafe or unacceptable food, food never handed over, or your booth being closed or out of stock after accepting. The food amount, any tax collected on it, and the card processing Stripe keeps on the refund are deducted from your payout. On a whole-order failure, FairSynq gives up its own fee. FairSynq decides refund requests fairly and will tell you the reason. You may send us information before or after the decision.

### 8. Food safety, permits and your people

8.1 You are solely responsible for your food and products: their safety, quality, preparation, storage, labelling, allergens and temperature. You are also responsible for every license, permit, health inspection and food handler requirement that applies to you.

8.2 You promise that your listings are accurate and that what you sell meets all applicable laws.

8.3 You are responsible for your employees, helpers and booth staff. That includes their conduct, their pay, their eligibility to work, and any action they take on your FairSynq account. They are not FairSynq's employees or agents.

8.4 You must keep general liability insurance and any other coverage an event requires, and upload proof when FairSynq or an event asks.

8.5 Upload any documents FairSynq or an event requires, such as permits, health certificates and insurance certificates, and keep them current. FairSynq or the event may pause your orders at that event if a required document is missing or expired.

### 9. Taxes

9.1 You are the retailer of your items and are responsible for sales tax on them. That includes state and local food and beverage taxes, plus your income taxes. Stripe may send you a Form 1099-K.

9.2 Where FairSynq's checkout adds tax to an order, FairSynq collects it from the customer for you and includes it in your payout. You remain responsible for reporting and paying it.

9.3 If FairSynq becomes required to collect and remit tax as a marketplace facilitator in any state, we will tell you in writing which sales we are collecting and remitting for. You should not also collect or remit tax on those sales. Sections 9.1 and 9.2 continue to apply to all other sales.

### 10. Events

You may use FairSynq at events you work, including events you set up yourself once FairSynq approves them. You must follow each event's rules, including any rules about ordering apps, signage and where pickup happens. If an event organizer asks FairSynq to stop orders for your booth at its event, we may do so. For any event you set up yourself, you confirm you are allowed to sell there. Events you create show your booth only, and you may not use the event's name, logo or branding unless the organizer allows it.

### 11. Customer information

You receive only what you need to fill your part of an order. Use it only to fill that order and answer the customer's questions about it. You may not use it for marketing, sell it, or add it to your own lists unless the customer gives you permission directly.

### 12. Indemnity

You will defend and cover FairSynq, its owners and contractors against claims, losses, fines and reasonable legal fees arising from: your food or products, including illness, injury or allergic reaction; your staff; your breach of this Agreement; or your violation of law or an event's rules.

### 13. Limits on FairSynq's liability

The platform is provided "as is." FairSynq does not promise that it will be uninterrupted or error-free, or that you will get a certain number of orders. To the fullest extent the law allows, FairSynq is not liable for lost profits or indirect damages. FairSynq's total liability to you under this Agreement is limited to the greater of $100 or the fees you paid FairSynq in the 12 months before the claim.

### 14. Ending the Agreement

You may close your account at any time, after any accepted orders are filled. We may suspend or close your account under section 2.2. Sections 3.4, 7, 8, 9, 11, 12, 13 and 15 survive.

### 15. General

15.1 You and FairSynq are independent businesses. This Agreement does not create a partnership, joint venture, franchise or employment relationship.

15.2 Illinois law governs this Agreement. Disputes go to the state or federal courts serving St. Clair County, Illinois.

15.3 We may update this Agreement by giving you at least 30 days' notice by email and in your dashboard. Changes to fees follow section 4. Continuing to take orders after a change takes effect means you accept it.

15.4 This Agreement, the Privacy Policy and the Website Terms of Service are the entire agreement on this subject. They replace any earlier signup form, promise or proposal, including earlier Fair Dash terms.

15.5 Notices to FairSynq: support@fairsynq.com, or by mail to FairSynq LLC's registered agent at the address on file with the Illinois Secretary of State. Notices to you: the email on your account.
`

export const VENDOR_AGREEMENT_PATH = '/vendor-agreement'
