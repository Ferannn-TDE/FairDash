/**
 * Never ask twice (block never-ask-twice, 2026-11-24): the details a signed-in person already gave
 * Clerk at sign-up, used to START a form filled in. Every box stays editable.
 *
 * Pure and safe in the browser. The server-side Clerk read is lib/signed-in-contact.ts.
 *
 * Same rules as app/onboarding/page.tsx: the PRIMARY email (never another address on the
 * account), first + last name, the first phone. Anything missing is '' so the box simply starts
 * empty.
 */

export interface ContactPrefill {
  name: string
  email: string
  phone: string
}

export const EMPTY_CONTACT: ContactPrefill = { name: '', email: '', phone: '' }

/**
 * The one-line hint under an email box that started as the sign-in email. True to the code: the
 * approval/decline email goes to this address (lib/approvals.ts, Vendor.contactEmail and the
 * partner contactEmail), and nothing lets the person change it after submitting, so it says "now".
 */
export const PREFILLED_EMAIL_HINT = "We'll send your updates here. Change it now if needed."

/** The parts of a Clerk user this reads (Clerk's User type fits this shape). */
interface ClerkUserLike {
  primaryEmailAddressId?: string | null
  emailAddresses?: readonly { id: string; emailAddress: string }[] | null
  firstName?: string | null
  lastName?: string | null
  phoneNumbers?: readonly { phoneNumber: string }[] | null
}

export function contactFromClerkUser(user: ClerkUserLike | null | undefined): ContactPrefill {
  if (!user) return { ...EMPTY_CONTACT }
  const primaryId = user.primaryEmailAddressId
  const email = primaryId
    ? user.emailAddresses?.find(e => e.id === primaryId)?.emailAddress ?? ''
    : ''
  const name = [user.firstName, user.lastName]
    .map(part => part?.trim() ?? '')
    .filter(part => part !== '')
    .join(' ')
  const phone = user.phoneNumbers?.[0]?.phoneNumber ?? ''
  return { name, email: email.trim(), phone: phone.trim() }
}

/**
 * A copy of `base` where each box that is still '' takes its prefill value. A box that already
 * has a value is never overwritten, a blank or spaces-only prefill fills nothing, and `base` is
 * not changed.
 */
export function fillEmptyFields<T extends object>(base: T, prefill: Partial<Record<keyof T, string>>): T {
  const out = { ...base }
  for (const key of Object.keys(prefill) as (keyof T)[]) {
    const value = prefill[key]?.trim()
    if (value && out[key] === '') out[key] = value as T[keyof T]
  }
  return out
}
