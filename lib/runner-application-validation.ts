// Runner application validation — ONE source of truth, imported by BOTH sides.
//
// The client (app/become-driver/page.tsx) uses these for per-field feedback and to
// gate Next/Submit. The server (POST /api/drivers) runs the SAME functions as the
// real enforcement — the client gate is UX, never a security boundary. Keeping both
// on this module is what stops them drifting into disagreement.
//
// Pure + dependency-free (no Prisma, no Next) so it is safe to import into a
// 'use client' component.

export const MAX_LEN = {
  firstName: 60,
  lastName: 60,
  email: 254, // RFC 5321 practical max
  phone: 30,
  city: 80,
  vehicleType: 40,
  vehicleMake: 40,
  vehicleModel: 40,
  vehicleColor: 30,
  vehiclePlate: 15,
} as const

// Deliberately permissive: one @, no whitespace, a dot-something TLD. Stricter
// regexes reject real addresses; the real proof of an email is a message reaching it.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Plausible, not authoritative — we accept international shapes and only require a
// digit count in range once formatting (spaces, dashes, parens, +) is stripped.
const PHONE_STRIP_RE = /[\s()+.-]/g
const PHONE_DIGITS_RE = /^\d{7,15}$/

export const MIN_AGE = 18 // DRIVER_TERMS §1(a) — drivers must be 18+
const MAX_AGE = 100

export interface ApplicationInput {
  personal?: {
    firstName?: unknown; lastName?: unknown; email?: unknown
    phone?: unknown; dob?: unknown; city?: unknown
  }
  vehicle?: {
    type?: unknown; make?: unknown; model?: unknown
    year?: unknown; color?: unknown; plate?: unknown
  }
  agreed?: unknown
  bgConsent?: unknown
}

// field key → human message. Empty object means valid.
export type FieldErrors = Record<string, string>

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Whole-number age at `on` for someone born `dob`. */
export function ageAt(dob: Date, on: Date): number {
  let age = on.getFullYear() - dob.getFullYear()
  const m = on.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--
  return age
}

/**
 * Validates the DOB string ('YYYY-MM-DD', the shape the wizard emits).
 * Returns an error message, or null if valid.
 */
export function validateDob(raw: unknown, now: Date = new Date()): string | null {
  const s = str(raw)
  if (!s) return 'Date of birth is required'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return 'Enter a valid date of birth'
  if (d.getTime() > now.getTime()) return 'Date of birth cannot be in the future'
  const age = ageAt(d, now)
  if (age < MIN_AGE) return `You must be at least ${MIN_AGE} to drive`
  if (age > MAX_AGE) return 'Enter a valid date of birth'
  return null
}

export function validateEmail(raw: unknown): string | null {
  const s = str(raw)
  if (!s) return 'Email is required'
  if (s.length > MAX_LEN.email) return `Email must be ${MAX_LEN.email} characters or fewer`
  if (!EMAIL_RE.test(s)) return 'Enter a valid email address'
  return null
}

export function validatePhone(raw: unknown): string | null {
  const s = str(raw)
  if (!s) return 'Phone number is required'
  if (s.length > MAX_LEN.phone) return `Phone must be ${MAX_LEN.phone} characters or fewer`
  const digits = s.replace(PHONE_STRIP_RE, '')
  if (!PHONE_DIGITS_RE.test(digits)) return 'Enter a valid phone number'
  return null
}

export function validateVehicleYear(raw: unknown, now: Date = new Date()): string | null {
  const s = str(raw)
  if (!s) return 'Vehicle year is required'
  if (!/^\d{4}$/.test(s)) return 'Vehicle year must be a 4-digit year'
  const y = Number(s)
  // +1 so next-model-year vehicles (sold ahead of the calendar year) aren't rejected.
  if (y < 1900 || y > now.getFullYear() + 1) return 'Enter a valid vehicle year'
  return null
}

function requiredText(raw: unknown, label: string, max: number): string | null {
  const s = str(raw)
  if (!s) return `${label} is required`
  if (s.length > max) return `${label} must be ${max} characters or fewer`
  return null
}

/** Optional free text — only length-capped. */
function optionalText(raw: unknown, label: string, max: number): string | null {
  const s = str(raw)
  if (s && s.length > max) return `${label} must be ${max} characters or fewer`
  return null
}

/**
 * Full application validation. Returns a map of field key → message; an empty map
 * means the payload is valid. Field keys match the wizard's own state paths so the
 * client can render each message under the right input.
 */
export function validateApplication(
  input: ApplicationInput,
  now: Date = new Date()
): FieldErrors {
  const errors: FieldErrors = {}
  const p = input.personal ?? {}
  const v = input.vehicle ?? {}

  const set = (k: string, msg: string | null) => { if (msg) errors[k] = msg }

  set('firstName', requiredText(p.firstName, 'First name', MAX_LEN.firstName))
  set('lastName', requiredText(p.lastName, 'Last name', MAX_LEN.lastName))
  set('email', validateEmail(p.email))
  set('phone', validatePhone(p.phone))
  set('dob', validateDob(p.dob, now))
  set('city', optionalText(p.city, 'City', MAX_LEN.city))

  set('vehicleType', requiredText(v.type, 'Vehicle type', MAX_LEN.vehicleType))
  set('vehicleMake', requiredText(v.make, 'Make', MAX_LEN.vehicleMake))
  set('vehicleModel', requiredText(v.model, 'Model', MAX_LEN.vehicleModel))
  set('vehicleYear', validateVehicleYear(v.year, now))
  set('vehicleColor', optionalText(v.color, 'Color', MAX_LEN.vehicleColor))
  set('vehiclePlate', optionalText(v.plate, 'License plate', MAX_LEN.vehiclePlate))

  if (input.agreed !== true) {
    errors.agreed = 'You must agree to the Driver Terms & Conditions'
  }
  if (input.bgConsent !== true) {
    errors.bgConsent = 'You must consent to a background check'
  }

  return errors
}

/** Field keys owned by each wizard step — lets the client gate Next per step. */
export const STEP_FIELDS: Record<number, readonly string[]> = {
  1: ['firstName', 'lastName', 'email', 'phone', 'dob', 'city'],
  2: ['vehicleType', 'vehicleMake', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'vehiclePlate'],
  3: ['agreed', 'bgConsent'],
}
