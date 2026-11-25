import { currentUser } from '@clerk/nextjs/server'
import { contactFromClerkUser, EMPTY_CONTACT, type ContactPrefill } from '@/lib/contact-prefill'

/**
 * Server only. The signed-in person's name, email and phone from Clerk, used to start a form
 * filled in (never ask twice). Signed out gives all ''.
 *
 * If Clerk can't be reached the form still works, just empty: the only cost is the prefill, never
 * the person's data. The warning names no person and prints no error details.
 */
export async function getSignedInContact(): Promise<ContactPrefill> {
  try {
    return contactFromClerkUser(await currentUser())
  } catch {
    console.warn('[signed-in-contact] Clerk read failed; the form starts empty')
    return { ...EMPTY_CONTACT }
  }
}
