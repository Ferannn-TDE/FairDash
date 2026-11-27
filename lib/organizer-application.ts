// Organizer sign-up form (sign-up-fixes commit 4) — ONE validator for both sides, like
// lib/partner-application.ts. The form (app/onboarding/organizer/OrganizerApplyForm.tsx) uses it
// for per-field messages and to enable Submit; POST /api/organizer/apply runs the same function as
// the real gate. Pure and import-light, so it is safe in a 'use client' component.
//
// Only fields with an existing column are collected: FairOrganizer (name, contactPhone,
// contactEmail, website) and the first event's Event columns (name, venueCity, venueState,
// startDate, endDate, openTime, closeTime, venueAddress). No migration.

import { validateEmail } from '@/lib/runner-application-validation'
import { checkPhone } from '@/lib/phone'
import { US_STATES } from '@/lib/partner-application'
import { startDateInCreationWindow, toPickerDate, CREATION_HORIZON_MONTHS } from '@/lib/calendar-date'
import { TERMS_REQUIRED_MESSAGE } from '@/lib/application-limits'

export const ORGANIZER_MAX_LEN = {
  organizationName: 120, website: 200, eventName: 120, city: 80, address: 200,
} as const

export const ORGANIZER_EMAIL_HINT = "We'll send your updates here. Change it now if needed."

export interface OrganizerApplicationInput {
  organizationName?: unknown; phone?: unknown; email?: unknown; website?: unknown
  eventName?: unknown; city?: unknown; state?: unknown
  startDate?: unknown; endDate?: unknown; openTime?: unknown; closeTime?: unknown; address?: unknown
  agreedToTerms?: unknown
}

export interface OrganizerApplication {
  organizationName: string; contactPhone: string; contactEmail: string; website: string | null
  event: {
    name: string; venueCity: string; venueState: string; startDate: string; endDate: string
    openTime: string | null; closeTime: string | null; venueAddress: string | null
  }
}

export type OrganizerFieldErrors = Record<string, string>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function required(v: unknown, label: string, max: number): string | null {
  const s = str(v)
  if (!s) return `${label} is required`
  if (s.length > max) return `${label} must be ${max} characters or fewer`
  return null
}
function optional(v: unknown, label: string, max: number): string | null {
  return str(v).length > max ? `${label} must be ${max} characters or fewer` : null
}

/** Field key → message; empty means valid. Keys match the form's field names. */
export function validateOrganizerApplication(input: OrganizerApplicationInput, now = new Date()): OrganizerFieldErrors {
  const e: OrganizerFieldErrors = {}
  const set = (k: string, m: string | null) => { if (m) e[k] = m }
  set('organizationName', required(input.organizationName, 'Organization name', ORGANIZER_MAX_LEN.organizationName))
  const phone = checkPhone(input.phone, { required: true })
  if (!phone.ok) e.phone = phone.error
  // Trimmed first, so "  a@b.com  " is accepted and an all-spaces email counts as blank.
  set('email', validateEmail(input.email))
  set('website', optional(input.website, 'Website', ORGANIZER_MAX_LEN.website))
  set('eventName', required(input.eventName, 'Event name', ORGANIZER_MAX_LEN.eventName))
  set('city', required(input.city, 'City', ORGANIZER_MAX_LEN.city))
  const st = str(input.state).toUpperCase()
  if (!st) e.state = 'State is required'
  else if (!US_STATES.some(([code]) => code === st)) e.state = 'Choose a US state'
  const start = str(input.startDate), end = str(input.endDate)
  if (!start) e.startDate = 'Start date is required'
  else if (!toPickerDate(start)) e.startDate = 'Enter a valid start date'
  else if (!startDateInCreationWindow(start, now)) e.startDate = `The start date must be between today and ${CREATION_HORIZON_MONTHS} months from now`
  if (!end) e.endDate = 'End date is required'
  else if (!toPickerDate(end)) e.endDate = 'Enter a valid end date'
  else if (start && toPickerDate(start) && end < start) e.endDate = 'The end date can’t be before the start date'
  const open = str(input.openTime), close = str(input.closeTime)
  if (open && !TIME.test(open)) e.openTime = 'Enter a time like 10:00'
  if (close && !TIME.test(close)) e.closeTime = 'Enter a time like 22:00'
  set('address', optional(input.address, 'Address', ORGANIZER_MAX_LEN.address))
  if (input.agreedToTerms !== true) e.agreedToTerms = TERMS_REQUIRED_MESSAGE
  return e
}

/** The normalised record to save. Call only after validateOrganizerApplication returned {}. */
export function normalizeOrganizerApplication(input: OrganizerApplicationInput): OrganizerApplication {
  const opt = (v: unknown) => str(v) || null
  const phone = checkPhone(input.phone, { required: true })
  return {
    organizationName: str(input.organizationName),
    contactPhone: phone.ok && phone.value ? phone.value : str(input.phone),
    contactEmail: str(input.email),
    website: opt(input.website),
    event: {
      name: str(input.eventName), venueCity: str(input.city), venueState: str(input.state).toUpperCase(),
      startDate: str(input.startDate), endDate: str(input.endDate),
      openTime: opt(input.openTime), closeTime: opt(input.closeTime), venueAddress: opt(input.address),
    },
  }
}
