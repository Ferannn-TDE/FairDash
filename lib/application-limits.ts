// Limits and fixed messages for the application forms (vendor, organizer, runner, partner) —
// sign-up-fixes commit 4. Pure constants, safe in a 'use client' component: the pages show these
// sentences by error code (lib/toast-error.ts), never the server's text.

/** 429 from any application limit (lib/ratelimit vendorApply / organizerApply / runnerApply). */
export const APPLY_RATE_LIMITED = 'APPLY_RATE_LIMITED'
export const APPLY_RATE_LIMITED_MESSAGE = "You've sent a lot of applications in a short time. Please try again in an hour."

/** 413 from an application body over the cap (lib/read-json-body). */
export const APPLICATION_BODY_MAX_BYTES = 10 * 1024
export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE'
export const PAYLOAD_TOO_LARGE_MESSAGE = "That's too much text. Please shorten your answers and try again."

/** The vendor's business description (D1, Jordan, Nov 27). */
export const VENDOR_DESCRIPTION_MAX = 2000
export const DESCRIPTION_TOO_LONG = 'DESCRIPTION_TOO_LONG'
export const DESCRIPTION_TOO_LONG_MESSAGE = 'Your description can be up to 2,000 characters.'

/** A required Terms + Privacy checkbox left unticked (organizer and partner applications). */
export const TERMS_REQUIRED_MESSAGE = 'Please agree to the FairSynq Terms and Privacy Policy to apply.'
