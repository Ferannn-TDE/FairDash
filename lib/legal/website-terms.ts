// THE Website Terms of Service (item 11, legal pages): the one place their text lives. Published at
// /terms.
//
// The text is Legal/website-terms.md from the audit folder, final for this release (Jordan,
// 2026-11-23), byte for byte: scripts/legal-pages-test.ts locks its SHA-256. It is markdown,
// rendered by app/_components/LegalDocument.tsx.

/** The version recorded when someone accepts these terms: the text's "Effective" date (sign-up-fixes
 *  commit 4). scripts/organizer-apply-test.ts checks it matches the "Effective …" line below. */
export const WEBSITE_TERMS_VERSION = '2026-11-23'

export const WEBSITE_TERMS_TEXT = `# Website Terms of Service

Effective November 23, 2026

These terms apply to your use of fairsynq.com and the FairSynq platform (the "Site"), run by FairSynq LLC ("FairSynq," "we"). By using the Site, you agree to them. If you don't agree, please don't use the Site.

### 1. Who these terms cover

These terms apply to every visitor. Customers who order also agree to the Customer Terms of Service and Refund Policy. Vendors agree to the Vendor Agreement. Organizers and partner organizations agree to their own agreements. If one of those conflicts with these terms, the specific agreement controls.

### 2. FairSynq is a marketplace

FairSynq connects customers with independent vendors at events. Vendors sell, prepare and serve their own food and products, and they are responsible for them. FairSynq does not prepare food. Information about events, such as dates, hours and vendor lists, comes from organizers and vendors and can change; please confirm with the event.

### 3. Accounts

You must give accurate information and keep your login code and account secure. You must be 18 or older to create an account or buy, or have permission from a parent or guardian who agrees to these terms for you. We may suspend accounts that break these terms.

### 4. Acceptable use

You agree not to:
- break the law or an event's rules using the Site
- place fake, fraudulent or prank orders, or use someone else's card or account
- harass vendors, runners, organizers or other users
- post false, misleading, offensive or infringing content, menus or photos
- scrape, copy or resell Site data, or use bots to access the Site
- probe, test or get around the Site's security, or interfere with how it runs
- use messaging tools for anything other than the event or order they were made for

### 5. Content you post

You keep ownership of the menus, photos, logos and other content you upload. You give FairSynq a free, non-exclusive license to host, display and adapt that content in order to run and promote the Site, including showing your listing in event pages and FairSynq marketing about events you take part in. This license lasts while your content is on the Site, plus a reasonable time after removal. You confirm that you have the rights to everything you upload.

### 6. Our content

The FairSynq name, logo, design, software and Site content belong to FairSynq. You may not copy or use them without our written permission, except to share links to the Site.

### 7. Third-party services

Payments are processed by Stripe, and texts are sent by Twilio. Their terms also apply when you use them. We are not responsible for other websites that the Site links to.

### 8. Disclaimers

The Site is provided "as is" and "as available." We don't promise that it will always be available or error-free, or that any vendor, item or event will be available. FairSynq does not make any promise about food that vendors sell, including allergens. Ask the vendor directly if you have a food allergy.

### 9. Limitation of liability

To the fullest extent the law allows, FairSynq is not liable for indirect, incidental or consequential damages, or lost profits. FairSynq's total liability for any claim about the Site is limited to the greater of $100 or what you paid FairSynq (not vendors) in the 12 months before the claim. Some places don't allow these limits, so they may not fully apply to you.

### 10. Indemnity

You agree to cover FairSynq for claims and costs arising from your breach of these terms or your misuse of the Site.

### 11. Ending access

We may suspend or end anyone's access for breaking these terms or to protect users or the Site. You may stop using the Site at any time.

### 12. Governing law

Illinois law governs these terms. Disputes go to the state or federal courts serving St. Clair County, Illinois, unless the law where you live gives you a different right.

### 13. Changes

We may update these terms. We will post the new version here with a new effective date, and email account holders about significant changes. Using the Site after changes take effect means you accept them.

### 14. Contact

support@fairsynq.com · FairSynq LLC
`

export const WEBSITE_TERMS_PATH = '/terms'
