// Partner organization application (Batch 1 item 7, B1.11) — ONE validator for both sides.
//
// The /partners form uses it for per-field feedback; POST /api/partners/apply runs the same function
// as the real gate. Pure and dependency-free apart from the runner validators it reuses (also pure),
// so it is safe in a 'use client' component.

import { validateEmail } from '@/lib/runner-application-validation'
import { checkPhone, normalizeUsPhone } from '@/lib/phone'
import { TERMS_REQUIRED_MESSAGE } from '@/lib/application-limits'

export const GROUP_TYPES = [
  { value: 'school', label: 'School' },
  { value: 'church', label: 'Church' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'club', label: 'Club or team' },
  { value: 'other', label: 'Other' },
] as const
export type GroupType = (typeof GROUP_TYPES)[number]['value']

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const

export const PARTNER_MAX_LEN = {
  name: 120, groupTypeOther: 80, contactName: 80, email: 254, phone: 30, city: 80,
  interests: 1000, staffHours: 500, note: 2000,
} as const

export interface PartnerApplicationInput {
  name?: unknown; groupType?: unknown; groupTypeOther?: unknown
  contactName?: unknown; email?: unknown; phone?: unknown
  city?: unknown; state?: unknown
  interests?: unknown; staffHours?: unknown; note?: unknown
  /** The required "I agree to the FairSynq Terms and Privacy Policy" box (sign-up-fixes commit 4). */
  agreedToTerms?: unknown
}

export interface PartnerApplication {
  name: string; groupType: GroupType; groupTypeOther: string | null
  contactName: string; contactEmail: string; contactPhone: string
  city: string; state: string
  interests: string | null; staffHours: string | null; note: string | null
}

export type PartnerFieldErrors = Record<string, string>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function required(v: unknown, label: string, max: number): string | null {
  const s = str(v)
  if (!s) return `${label} is required`
  if (s.length > max) return `${label} must be ${max} characters or fewer`
  return null
}
function optional(v: unknown, label: string, max: number): string | null {
  const s = str(v)
  return s.length > max ? `${label} must be ${max} characters or fewer` : null
}

/** Field key → message; empty means valid. Keys match the form's field names. */
export function validatePartnerApplication(input: PartnerApplicationInput): PartnerFieldErrors {
  const e: PartnerFieldErrors = {}
  const set = (k: string, m: string | null) => { if (m) e[k] = m }
  set('name', required(input.name, 'Organization name', PARTNER_MAX_LEN.name))
  const type = str(input.groupType)
  if (!type) e.groupType = 'Choose the type of group'
  else if (!GROUP_TYPES.some(g => g.value === type)) e.groupType = 'Choose one of the listed types'
  if (type === 'other') set('groupTypeOther', required(input.groupTypeOther, 'Describe your group', PARTNER_MAX_LEN.groupTypeOther))
  set('contactName', required(input.contactName, 'Contact name', PARTNER_MAX_LEN.contactName))
  set('email', validateEmail(input.email))
  const phone = checkPhone(input.phone, { required: true })
  if (!phone.ok) e.phone = phone.error
  set('city', required(input.city, 'City', PARTNER_MAX_LEN.city))
  const st = str(input.state).toUpperCase()
  if (!st) e.state = 'State is required'
  else if (!US_STATES.some(([code]) => code === st)) e.state = 'Choose a US state'
  set('interests', optional(input.interests, 'Fairs or events', PARTNER_MAX_LEN.interests))
  set('staffHours', optional(input.staffHours, 'Hours', PARTNER_MAX_LEN.staffHours))
  set('note', optional(input.note, 'Note', PARTNER_MAX_LEN.note))
  if (input.agreedToTerms !== true) e.agreedToTerms = TERMS_REQUIRED_MESSAGE
  return e
}

/** The normalised record to store. Call only after validatePartnerApplication returned {}. */
export function normalizePartnerApplication(input: PartnerApplicationInput): PartnerApplication {
  const opt = (v: unknown) => str(v) || null
  const type = str(input.groupType) as GroupType
  return {
    name: str(input.name), groupType: type, groupTypeOther: type === 'other' ? str(input.groupTypeOther) : null,
    contactName: str(input.contactName), contactEmail: str(input.email).toLowerCase(),
    // +1XXXXXXXXXX (lib/phone). Validation has already passed, so the fallback is never reached.
    contactPhone: normalizeUsPhone(str(input.phone)) ?? str(input.phone),
    city: str(input.city), state: str(input.state).toUpperCase(),
    interests: opt(input.interests), staffHours: opt(input.staffHours), note: opt(input.note),
  }
}

/** What a new application (and a honeypot hit) sees. */
export const PARTNER_APPLY_SUCCESS = "Thanks! We've received your application and will be in touch soon."

/** What a second application from an email with one already pending sees. Nothing is written. */
export const PARTNER_APPLY_DUPLICATE = "We already have an application from this email, and it's being reviewed. We'll be in touch soon, so there's no need to apply again."

/** A hidden form field people never see; a submission that fills it is treated as a bot. */
export const HONEYPOT_FIELD = 'website'
