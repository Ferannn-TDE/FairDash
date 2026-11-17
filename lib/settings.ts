// Platform settings — THE one place setting keys are defined (Batch 1 item 5, BATCH-1 §3).
//
// Storage is PlatformSetting (one row per saved key) plus the append-only PlatformSettingChange
// log, written in the SAME transaction. A key with no row reads as its code default; item 5
// seeds nothing. Reading or writing a key that isn't in SETTINGS is a type error, and a runtime
// refusal for anything that arrives as a plain string (the API body).
//
// Item 5 ships only the two alert contacts. delivery.enabled arrives with item 6 (when it is
// first read, defaulting to off), money keys with item 10 (their own migration, fail-closed),
// SMS once sending exists.

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { validateEmail } from '@/lib/runner-application-validation'
import type { SettingsRole } from '@/lib/roles'

export type SettingClass = 'ops' | 'content' | 'money'
type Parsed<T> = { ok: true; value: T | null } | { ok: false; error: string }

interface SettingDef<T> {
  label: string
  help: string
  class: SettingClass
  /** The value when no row exists. null = "not set" (the setting has no real default). */
  default: T | null
  /** Shown while nothing outside this file reads the key. scripts/platform-settings-test.ts
   *  fails if the note outlives that (a reader exists) or goes missing early (none does). */
  notInEffect?: string
  /** Raw input (form string, array, null) → normalised value, null = clear, or a field error. */
  parse(raw: unknown): Parsed<T>
  /** Human rendering of a stored value, for the page and the change log. */
  format(value: T): string
}

// ── alerts.email ───────────────────────────────────────────────────────────────────────────
export const MAX_ALERT_EMAILS = 5

function parseEmailList(raw: unknown): Parsed<string[]> {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string' ? raw.split(/[\s,;]+/) : raw == null ? [] : null
  if (parts === null) return { ok: false, error: 'Enter email addresses as text' }
  const emails = Array.from(new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean)))
  if (emails.length === 0) return { ok: true, value: null }
  if (emails.length > MAX_ALERT_EMAILS) return { ok: false, error: `Enter at most ${MAX_ALERT_EMAILS} email addresses` }
  for (const e of emails) {
    // Same permissive rule as runner sign-up: the real proof of an address is mail reaching it.
    if (validateEmail(e)) return { ok: false, error: `"${e}" is not a valid email address` }
  }
  return { ok: true, value: emails }
}

// ── alerts.phone ───────────────────────────────────────────────────────────────────────────
/** A plausible US number in any common format → +1XXXXXXXXXX, or null if it isn't one. */
export function normalizeUsPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return null
  // NANP: area code and exchange both start 2–9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null
  return `+1${digits}`
}

function parsePhone(raw: unknown): Parsed<string> {
  if (raw == null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Enter the phone number as text' }
  if (!raw.trim()) return { ok: true, value: null }
  const phone = normalizeUsPhone(raw)
  return phone ? { ok: true, value: phone } : { ok: false, error: 'Enter a valid US phone number, e.g. (618) 555-0100' }
}

// ── delivery.enabled ───────────────────────────────────────────────────────────────────────
function parseBoolean(raw: unknown): Parsed<boolean> {
  if (raw === true || raw === 'true' || raw === 'on') return { ok: true, value: true }
  if (raw === false || raw === 'false' || raw === 'off') return { ok: true, value: false }
  if (raw == null || raw === '') return { ok: true, value: null } // clear → back to the default
  return { ok: false, error: 'Choose on or off' }
}

// ── video.<slot>.url / .posterUrl ──────────────────────────────────────────────────────────
// Item 12 (B1.15, 2a). Any https link whose path ends in .mp4 or .webm; poster .jpg/.png/.webp.
// The host is not checked, so moving from Vercel Blob to Bunny.net is only a new URL (§9b).
export const MAX_URL_LENGTH = 2048

function parseHttpsFile(raw: unknown, exts: readonly string[], what: string): Parsed<string> {
  if (raw == null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `Enter the ${what} link as text` }
  const t = raw.trim()
  if (!t) return { ok: true, value: null }
  const list = exts.map(e => `.${e}`).join(', ')
  if (t.length > MAX_URL_LENGTH) return { ok: false, error: `That link is too long (at most ${MAX_URL_LENGTH} characters)` }
  let u: URL
  try { u = new URL(t) } catch { return { ok: false, error: `Enter a full link starting with https://, ending in ${list}` } }
  if (u.protocol !== 'https:') return { ok: false, error: 'The link must start with https://' }
  if (u.username || u.password) return { ok: false, error: 'The link must not contain a username or password' }
  const ext = u.pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (!ext || !exts.includes(ext)) return { ok: false, error: `The ${what} link must end in ${list}` }
  return { ok: true, value: u.toString() }
}
export const VIDEO_EXTS = ['mp4', 'webm'] as const
export const POSTER_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const
export const parseVideoUrl = (raw: unknown) => parseHttpsFile(raw, VIDEO_EXTS, 'video')
export const parsePosterUrl = (raw: unknown) => parseHttpsFile(raw, POSTER_EXTS, 'poster image')

const videoUrl = (label: string, where: string) => ({
  label: `${label}: video`,
  help: `Shown ${where}. Paste an https link ending in .mp4 or .webm. Upload a changed video under a new file name: the old link stays cached for up to a month.`,
  class: 'content',
  default: null,
  parse: parseVideoUrl,
  format: (v: string) => v,
}) satisfies SettingDef<string>
const posterUrl = (label: string) => ({
  label: `${label}: poster image (optional)`,
  help: 'The still image shown before the video plays. An https link ending in .jpg, .png or .webp. Without one, the video\'s first frame is used.',
  class: 'content',
  default: null,
  parse: parsePosterUrl,
  format: (v: string) => v,
}) satisfies SettingDef<string>
// The optional phone cut (BATCH-1 §21 Q6): played instead of the main video under 640px wide.
const phoneVideoUrl = (label: string) => ({
  label: `${label}: phone video (optional)`,
  help: 'Played instead of the video above on screens narrower than 640px (phones), for a tall phone cut. An https link ending in .mp4 or .webm. Leave it empty and phones play the video above.',
  class: 'content',
  default: null,
  parse: parseVideoUrl,
  format: (v: string) => v,
}) satisfies SettingDef<string>
const phonePosterUrl = (label: string) => ({
  label: `${label}: phone poster image (optional)`,
  help: 'The still image shown before the phone video plays. An https link ending in .jpg, .png or .webp. Without one, the poster above is used, cropped to fit.',
  class: 'content',
  default: null,
  parse: parsePosterUrl,
  format: (v: string) => v,
}) satisfies SettingDef<string>

// ── The registry ───────────────────────────────────────────────────────────────────────────
export const SETTINGS = {
  // Item 6 (B1.2). Home delivery is offered only when this AND the event's own flag are on
  // (lib/delivery.ts deliveryAvailable). Added when first read, defaulting to OFF, so nothing saved
  // before it existed can switch delivery back on.
  'delivery.enabled': {
    label: 'Home delivery',
    help: 'Lets customers choose delivery to an address at fairs that also have it switched on. Curbside and booth pickup are not affected.',
    class: 'ops',
    default: false,
    parse: parseBoolean,
    format: (v: boolean) => (v ? 'On' : 'Off'),
  } satisfies SettingDef<boolean>,
  'alerts.email': {
    label: 'Alert email',
    help: `Where sign-up alerts are sent. Up to ${MAX_ALERT_EMAILS} addresses, separated by commas. Until one is set, alerts are held.`,
    class: 'ops',
    default: null,
    // Read by the notification outbox (item 9): no "not in effect yet" note any more.
    parse: parseEmailList,
    format: (v: string[]) => v.join(', '),
  } satisfies SettingDef<string[]>,
  'alerts.phone': {
    label: 'Alert phone',
    help: 'A US number for future text alerts. Stored as +1XXXXXXXXXX.',
    class: 'ops',
    default: null,
    notInEffect: 'Not in effect yet: used once sign-up alerts ship.',
    parse: parsePhone,
    format: (v: string) => v,
  } satisfies SettingDef<string>,
  // Item 12 (B1.15). Only slots with a page are listed; the others (vendor getting started,
  // customer video A) are added with their placement.
  'video.vendorPitch.url': videoUrl('Vendor pitch', 'on the vendor sign-in page (/sign-in/vendor) under the pitch, and at the top of /become-vendor'),
  'video.vendorPitch.posterUrl': posterUrl('Vendor pitch'),
  'video.vendorPitch.phoneUrl': phoneVideoUrl('Vendor pitch'),
  'video.vendorPitch.phonePosterUrl': phonePosterUrl('Vendor pitch'),
  'video.partnerPitch.url': videoUrl('Partner pitch', 'on /partners, between the pitch and the application form'),
  'video.partnerPitch.posterUrl': posterUrl('Partner pitch'),
  // Organizer pitch on /organizers. Unheld 2026-11-17 (Feran): v3 goes live as is (BATCH-1 §21).
  'video.organizerPitch.url': videoUrl('Organizer pitch', 'on /organizers, under the intro and buttons'),
  'video.organizerPitch.posterUrl': posterUrl('Organizer pitch'),
  'video.organizerPitch.phoneUrl': phoneVideoUrl('Organizer pitch'),
  'video.organizerPitch.phonePosterUrl': phonePosterUrl('Organizer pitch'),
} as const

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = Parameters<(typeof SETTINGS)[K]['format']>[0]

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS, key)
}

function def(key: SettingKey): SettingDef<unknown> {
  return SETTINGS[key] as unknown as SettingDef<unknown>
}

/** "unset" when there is no row, else the row's updatedAt. Sent with every save. */
export const UNSET_VERSION = 'unset'
function versionOf(row: { updatedAt: Date } | null): string {
  return row ? row.updatedAt.toISOString() : UNSET_VERSION
}

/** How a stored value (or its absence) reads on the page and in the log. */
export function formatSettingValue(key: SettingKey, value: unknown): string {
  const d = def(key)
  if (value === null || value === undefined) return d.default === null ? 'not set' : 'default'
  return d.format(value)
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────
/** The effective value: the saved value, else the code default. For future readers (item 9). */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K> | null> {
  if (!isSettingKey(key)) throw new SettingError('unknown_key', `Unknown setting: ${String(key)}`)
  const row = await db.platformSetting.findUnique({ where: { key } })
  return (row ? row.value : SETTINGS[key].default) as SettingValue<K> | null
}

export interface SettingView {
  key: SettingKey
  label: string
  help: string
  class: SettingClass
  notInEffect: string | null
  value: unknown
  display: string
  isSet: boolean
  version: string
  updatedAt: string | null
}

export interface SettingChangeView {
  id: string
  key: string
  label: string
  from: string
  to: string
  actor: string
  actorType: string
  reason: string | null
  createdAt: string
}

export const CHANGE_LOG_LIMIT = 50

export async function listSettings(): Promise<{ settings: SettingView[]; changes: SettingChangeView[] }> {
  const [rows, changes] = await Promise.all([
    db.platformSetting.findMany({ where: { key: { in: SETTING_KEYS } } }),
    db.platformSettingChange.findMany({ orderBy: { createdAt: 'desc' }, take: CHANGE_LOG_LIMIT }),
  ])
  const byKey = new Map(rows.map((r) => [r.key, r]))

  // Actor emails from our own User table; a Clerk id with no row is shown raw, never blank.
  const actorIds = Array.from(new Set(changes.map((c) => c.actorId)))
  const users = actorIds.length
    ? await db.user.findMany({ where: { clerkId: { in: actorIds } }, select: { clerkId: true, email: true } })
    : []
  const emailOf = new Map(users.map((u) => [u.clerkId, u.email]))

  return {
    settings: SETTING_KEYS.map((key) => {
      const row = byKey.get(key) ?? null
      const d = def(key)
      return {
        key,
        label: d.label,
        help: d.help,
        class: d.class,
        notInEffect: d.notInEffect ?? null,
        value: row ? row.value : d.default,
        display: formatSettingValue(key, row ? row.value : null),
        isSet: !!row,
        version: versionOf(row),
        updatedAt: row ? row.updatedAt.toISOString() : null,
      }
    }),
    changes: changes.map((c) => ({
      id: c.id,
      key: c.key,
      label: isSettingKey(c.key) ? def(c.key).label : c.key,
      from: isSettingKey(c.key) ? formatSettingValue(c.key, c.oldValue) : JSON.stringify(c.oldValue),
      to: isSettingKey(c.key) ? formatSettingValue(c.key, c.newValue) : JSON.stringify(c.newValue),
      actor: emailOf.get(c.actorId) || c.actorId,
      actorType: c.actorType,
      reason: c.reason,
      createdAt: c.createdAt.toISOString(),
    })),
  }
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────
export class SettingError extends Error {
  constructor(
    public kind: 'unknown_key' | 'invalid' | 'conflict',
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'SettingError'
  }
}

export interface SaveSettingInput {
  key: unknown
  raw: unknown
  /** The version the editor loaded (SettingView.version). */
  expectedVersion: unknown
  actorId: string
  actorType: SettingsRole
  reason?: unknown
  /** Test seam: runs after the setting write and before the log write, inside the transaction. */
  hooks?: { afterSettingWrite?: () => void | Promise<void> }
}

export interface SaveSettingResult {
  outcome: 'saved' | 'cleared' | 'unchanged'
  setting: SettingView
}

class ConflictSignal extends Error {}

/**
 * Save (or clear) one setting with its change-log row in ONE transaction.
 *  - unknown key → SettingError('unknown_key'); invalid value → SettingError('invalid', field error)
 *  - the stored version moved since the editor loaded it → SettingError('conflict'), nothing written
 *  - same value as stored → 'unchanged', nothing written (no setting write, no log row)
 *  - empty input → the row is deleted (back to the default) and the log records newValue = null
 * The version check and the write are one conditional statement (updateMany/deleteMany on the
 * old updatedAt, or a create that collides on the key), so two saves can never both pass.
 */
export async function saveSetting(input: SaveSettingInput): Promise<SaveSettingResult> {
  const { key } = input
  if (!isSettingKey(key)) throw new SettingError('unknown_key', `Unknown setting: ${String(key)}`)
  const d = def(key)

  const parsed = d.parse(input.raw)
  if (!parsed.ok) throw new SettingError('invalid', parsed.error, { fieldErrors: { [key]: parsed.error } })
  const next = parsed.value

  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : null
  const expected = typeof input.expectedVersion === 'string' ? input.expectedVersion : ''

  let outcome: SaveSettingResult['outcome'] = 'unchanged'
  try {
    await db.$transaction(async (tx) => {
      const row = await tx.platformSetting.findUnique({ where: { key } })
      if (versionOf(row) !== expected) throw new ConflictSignal()

      const old = row ? row.value : null
      if (JSON.stringify(old) === JSON.stringify(next)) return // no-op: write nothing

      if (next === null) {
        // Clear → delete the row; the setting reads as its default again.
        const del = await tx.platformSetting.deleteMany({ where: { key, updatedAt: row!.updatedAt } })
        if (del.count === 0) throw new ConflictSignal()
        outcome = 'cleared'
      } else if (row) {
        // Strictly later than the old version, so even a same-millisecond save moves it.
        const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
        const upd = await tx.platformSetting.updateMany({
          where: { key, updatedAt: row.updatedAt },
          data: { value: next as Prisma.InputJsonValue, updatedAt: now, updatedById: input.actorId, updatedByType: input.actorType },
        })
        if (upd.count === 0) throw new ConflictSignal()
        outcome = 'saved'
      } else {
        // First save. A concurrent first save collides on the primary key (P2002) → conflict.
        await tx.platformSetting.create({
          data: { key, value: next as Prisma.InputJsonValue, updatedAt: new Date(), updatedById: input.actorId, updatedByType: input.actorType },
        })
        outcome = 'saved'
      }

      await input.hooks?.afterSettingWrite?.()

      await tx.platformSettingChange.create({
        data: {
          key,
          oldValue: old === null ? Prisma.DbNull : (old as Prisma.InputJsonValue),
          newValue: next === null ? Prisma.DbNull : (next as Prisma.InputJsonValue),
          actorId: input.actorId,
          actorType: input.actorType,
          reason,
        },
      })
    })
  } catch (err) {
    const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    if (err instanceof ConflictSignal || collided) {
      const { settings } = await listSettings()
      throw new SettingError('conflict', 'Changed by someone else since you opened this page.', {
        current: settings.find((s) => s.key === key),
      })
    }
    throw err
  }

  const { settings } = await listSettings()
  return { outcome, setting: settings.find((s) => s.key === key)! }
}
