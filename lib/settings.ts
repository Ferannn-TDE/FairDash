// Platform settings — THE one place setting keys are defined (Batch 1 item 5, BATCH-1 §3).
//
// Storage is PlatformSetting (one row per saved key) plus the append-only PlatformSettingChange
// log, written in the SAME transaction. A key with no row reads as its code default; item 5
// seeds nothing. Reading or writing a key that isn't in SETTINGS is a type error, and a runtime
// refusal for anything that arrives as a plain string (the API body).
//
// Item 5 ships only the two alert contacts. delivery.enabled arrives with item 6 (when it is
// first read, defaulting to off), SMS once sending exists.
//
// MONEY KEYS (item 10 / B1.13 stage 2, BATCH-1 §19 S2-Q1..Q6). Four `fees.*` keys, class 'money':
//   - seeded by migration 20261118120000_add_money_settings; NO code default (default: null)
//   - read only through getMoneySettings(): all-or-nothing, uncached, MoneySettingsUnavailable
//     naming every missing/invalid key. getSetting() refuses them, so no lenient path exists.
//   - saved only by admin | super_admin (platform_manager → 'forbidden'), with a reason, never
//     cleared, values converted from text exactly (lib/money-input.ts)
//   - every successful change posts a Slack notice after the response (lib/after-response.ts)
// Readers (stage 3): POST /api/orders prices and snapshots every new order with them, and the fair
// payload carries the customer-visible terms (lib/fees/fee-terms.ts). The card-fee key is stored on
// orders from stage 3 and acted on by the stage 4 payout.

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { validateEmail } from '@/lib/runner-application-validation'
import type { SettingsRole } from '@/lib/roles'
import { dollarsToCents, percentToBps, formatBps, formatCents } from '@/lib/money-input'
import { notifyMoneySettingChanged, type MoneySettingChange } from '@/lib/notify'
import type { AfterTask } from '@/lib/after-response'
import { parseBannerText, BANNER_DEFAULT_TEXT, BANNER_MAX_CHARS } from '@/lib/homepage-copy-rules'

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

// ── fees.* (money) ─────────────────────────────────────────────────────────────────────────
// Ranges (S2-Q2): service fee 0–30%, flat $0–$5, curbside $0–$15, card fees VENDOR | PLATFORM.
export const MONEY_LIMITS = { serviceFeeBps: 3000, serviceFeeFlatCents: 500, curbsideRunnerFeeCents: 1500 } as const
export type CardFeesPaidBySetting = 'VENDOR' | 'PLATFORM'
const CARD_FEES_LABEL: Record<CardFeesPaidBySetting, string> = { VENDOR: 'Vendor pays', PLATFORM: 'FairSynq pays' }

const notInEffect = (today: string) => `Not in effect yet. ${today} This value takes effect when the new fees go live.`
const fromExact = (r: { ok: true; value: number } | { ok: false; error: string }): Parsed<number> =>
  r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error }
function parseCardFeesPaidBy(raw: unknown): Parsed<CardFeesPaidBySetting> {
  return raw === 'VENDOR' || raw === 'PLATFORM' ? { ok: true, value: raw } : { ok: false, error: 'Choose "Vendor pays" or "FairSynq pays"' }
}
// A money value as STORED (JSON), checked the same way the form checks it. Used by
// getMoneySettings(): anything else in the row makes the read fail closed.
const isIntIn = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

// ── The registry ───────────────────────────────────────────────────────────────────────────
export const SETTINGS = {
  // Item 10 / B1.13 (money). Order matters only for the admin page: fees first.
  'fees.serviceFee.percentBps': {
    label: 'Service fee: percent of the food',
    help: 'Charged to the customer once per order, on the food subtotal. Enter a percent, e.g. 15 or 12.5 (0 to 30). Changing this also requires a new Vendor Agreement version. Talk to your developer first.',
    class: 'money',
    default: null,
    // In effect since item 10 stage 3: POST /api/orders and the checkout read it via getMoneySettings().
    parse: (raw: unknown) => fromExact(percentToBps(raw, MONEY_LIMITS.serviceFeeBps)),
    format: (v: number) => formatBps(v),
  } satisfies SettingDef<number>,
  'fees.serviceFee.flatCents': {
    label: 'Service fee: flat amount per order',
    help: 'Added to the service fee once per order. Enter dollars, e.g. 0.50 ($0.00 to $5.00). Changing this also requires a new Vendor Agreement version. Talk to your developer first.',
    class: 'money',
    default: null,
    // In effect since item 10 stage 3.
    parse: (raw: unknown) => fromExact(dollarsToCents(raw, MONEY_LIMITS.serviceFeeFlatCents)),
    format: (v: number) => formatCents(v),
  } satisfies SettingDef<number>,
  'fees.curbsideRunnerFeeCents': {
    label: 'Curbside fee',
    help: 'Charged on curbside orders. Enter dollars, e.g. 3.99 ($0.00 to $15.00).',
    class: 'money',
    default: null,
    // In effect since item 10 stage 3: curbside orders charge this, not the event's own fee.
    parse: (raw: unknown) => fromExact(dollarsToCents(raw, MONEY_LIMITS.curbsideRunnerFeeCents)),
    format: (v: number) => formatCents(v),
  } satisfies SettingDef<number>,
  'fees.cardFeesPaidBy': {
    label: 'Card processing fees',
    help: 'Who pays Stripe\'s card processing on the food: the vendor, or FairSynq. Changing this also requires a new Vendor Agreement version. Talk to your developer first.',
    class: 'money',
    // In effect since item 10 stage 4: the order stores it (stage 3) and the payout splits by it.
    default: null,
    parse: parseCardFeesPaidBy,
    format: (v: CardFeesPaidBySetting) => CARD_FEES_LABEL[v] ?? String(v),
  } satisfies SettingDef<CardFeesPaidBySetting>,
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
  'video.vendorPitch.url': videoUrl('Vendor pitch', 'on the vendor sign-in page (/sign-in/vendor) next to the sign-in form, and at the top of /become-vendor'),
  'video.vendorPitch.posterUrl': posterUrl('Vendor pitch'),
  'video.vendorPitch.phoneUrl': phoneVideoUrl('Vendor pitch'),
  'video.vendorPitch.phonePosterUrl': phonePosterUrl('Vendor pitch'),
  'video.partnerPitch.url': videoUrl('Partner pitch', 'on /partners, between the pitch and the application form'),
  'video.partnerPitch.posterUrl': posterUrl('Partner pitch'),
  // Organizer pitch. Shown on /organizer/login only; /organizers redirects there (BATCH-1 §21, 2026-11-17).
  'video.organizerPitch.url': videoUrl('Organizer pitch', 'on the organizer sign-in page (/organizer/login)'),
  'video.organizerPitch.posterUrl': posterUrl('Organizer pitch'),
  'video.organizerPitch.phoneUrl': phoneVideoUrl('Organizer pitch'),
  'video.organizerPitch.phonePosterUrl': phonePosterUrl('Organizer pitch'),
  // Homepage hero vendor sign-up banner (Jordan, 2026-11-23). OFF by default: it stays hidden until
  // an admin turns it on. Read by lib/homepage-banner.ts; the link is always the vendor sign-up
  // path (AudienceLink), only the words change. The text rules live in lib/homepage-copy-rules.ts,
  // shared with scripts/homepage-stats-guard.ts.
  'homepage.vendorBanner.enabled': {
    label: 'Homepage: vendor sign-up banner',
    help: 'Shows the pink "sign up" banner under the homepage heading. It links to vendor sign-up. The "I\'m a vendor" tile and the other sign-up links are always shown.',
    class: 'content',
    default: false,
    parse: parseBoolean,
    format: (v: boolean) => (v ? 'On' : 'Off'),
  } satisfies SettingDef<boolean>,
  'homepage.vendorBanner.text': {
    label: 'Homepage: vendor sign-up banner text',
    help: `The words on the pink banner under the homepage heading. Plain text, up to ${BANNER_MAX_CHARS} characters. The link always goes to vendor sign-up. Empty uses the default.`,
    class: 'content',
    default: BANNER_DEFAULT_TEXT,
    parse: parseBannerText,
    format: (v: string) => v,
  } satisfies SettingDef<string>,
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
  // Money keys have no default to fall back to; they are read only through getMoneySettings().
  if (SETTINGS[key].class === 'money') throw new SettingError('unknown_key', `${key} is a money setting: read it with getMoneySettings()`)
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
/** The seed migration writes actorType 'system'; the log shows it as this, never blank or a role. */
export const SYSTEM_ACTOR_TYPE = 'system'
export const SYSTEM_ACTOR_LABEL = 'System (migration)'

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
      actor: c.actorType === SYSTEM_ACTOR_TYPE ? SYSTEM_ACTOR_LABEL : (emailOf.get(c.actorId) || c.actorId),
      actorType: c.actorType,
      reason: c.reason,
      createdAt: c.createdAt.toISOString(),
    })),
  }
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────
export class SettingError extends Error {
  constructor(
    public kind: 'unknown_key' | 'invalid' | 'conflict' | 'forbidden',
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
  /** How a post-save side effect is scheduled. The route passes runAfterResponse (Next's after());
   *  absent (a script), the task runs unawaited with its errors swallowed. */
  afterResponse?: (task: AfterTask) => void
  /** Test seam for the money-change notice; defaults to notifyMoneySettingChanged (Slack). */
  notify?: (change: MoneySettingChange) => Promise<void>
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

  const isMoney = d.class === 'money'
  // S2-Q1: only admin | super_admin change fees. Checked before anything else, so a refused
  // platform_manager learns nothing about the value it sent.
  if (isMoney && input.actorType !== 'admin' && input.actorType !== 'super_admin') {
    throw new SettingError('forbidden', 'Only an admin can change fees.')
  }

  const parsed = d.parse(input.raw)
  if (!parsed.ok) throw new SettingError('invalid', parsed.error, { fieldErrors: { [key]: parsed.error } })
  const next = parsed.value

  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : null
  if (isMoney) {
    // S2-Q2: never cleared (a missing money row fails checkout closed); S2 §3: a reason, always.
    if (next === null) throw new SettingError('invalid', 'A fee setting can\'t be cleared.', { fieldErrors: { [key]: 'A fee setting can\'t be cleared.' } })
    if (!reason) throw new SettingError('invalid', 'Enter a reason for this change.', { fieldErrors: { reason: 'Enter a reason for this change.' } })
  }
  const expected = typeof input.expectedVersion === 'string' ? input.expectedVersion : ''

  let outcome: SaveSettingResult['outcome'] = 'unchanged'
  let savedFrom: unknown = undefined // the old value, set only when a write commits
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

      savedFrom = old
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

  // Money notice (S2 addition): only after the save committed, scheduled to run after the response,
  // never awaited here. A throwing or hanging notifier cannot fail or delay the save.
  if (isMoney && (outcome as SaveSettingResult['outcome']) === 'saved' && savedFrom !== undefined) {
    const change: MoneySettingChange = {
      key, label: d.label, from: formatSettingValue(key, savedFrom), to: formatSettingValue(key, next),
      actorId: input.actorId, actorType: input.actorType, reason: reason!,
    }
    const notify = input.notify ?? notifyMoneySettingChanged
    const task: AfterTask = () => notify(change)
    try {
      if (input.afterResponse) input.afterResponse(task)
      else void task().catch(() => {})
    } catch { /* scheduling itself failed: the save stands */ }
  }

  const { settings } = await listSettings()
  return { outcome, setting: settings.find((s) => s.key === key)! }
}

// ── Money reads (item 10 / B1.13 stage 2, S2-Q4) ───────────────────────────────────────────
export const MONEY_KEYS = [
  'fees.serviceFee.percentBps',
  'fees.serviceFee.flatCents',
  'fees.curbsideRunnerFeeCents',
  'fees.cardFeesPaidBy',
] as const satisfies readonly SettingKey[]
export type MoneyKey = (typeof MONEY_KEYS)[number]

export interface MoneySettings {
  serviceFeeBps: number
  serviceFeeFlatCents: number
  curbsideRunnerFeeCents: number
  cardFeesPaidBy: CardFeesPaidBySetting
}

/** The fee terms can't be read: one or more money rows are missing or hold a value the form
 *  would refuse. Stage 3 maps this to 503 at checkout (with a Slack alert and a plain customer
 *  message, never these key names). */
export class MoneySettingsUnavailable extends Error {
  constructor(public missing: MoneyKey[], public invalid: MoneyKey[]) {
    super(`Money settings unavailable — missing: ${missing.join(', ') || 'none'}; invalid: ${invalid.join(', ') || 'none'}`)
    this.name = 'MoneySettingsUnavailable'
  }
}

const STORED_OK: Record<MoneyKey, (v: unknown) => boolean> = {
  'fees.serviceFee.percentBps': (v) => isIntIn(v, MONEY_LIMITS.serviceFeeBps),
  'fees.serviceFee.flatCents': (v) => isIntIn(v, MONEY_LIMITS.serviceFeeFlatCents),
  'fees.curbsideRunnerFeeCents': (v) => isIntIn(v, MONEY_LIMITS.curbsideRunnerFeeCents),
  'fees.cardFeesPaidBy': (v) => v === 'VENDOR' || v === 'PLATFORM',
}

/**
 * The four fee terms, all or nothing. ONE uncached query; no default anywhere: a missing row or a
 * stored value the form would refuse throws MoneySettingsUnavailable naming every bad key.
 * Nothing outside this file calls it until stage 3 (proved by scripts/money-settings-test.ts [9]).
 */
export async function getMoneySettings(): Promise<MoneySettings> {
  const rows = await db.platformSetting.findMany({ where: { key: { in: [...MONEY_KEYS] } } })
  const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]))
  const missing: MoneyKey[] = [], invalid: MoneyKey[] = []
  for (const k of MONEY_KEYS) {
    if (!byKey.has(k)) missing.push(k)
    else if (!STORED_OK[k](byKey.get(k))) invalid.push(k)
  }
  if (missing.length || invalid.length) throw new MoneySettingsUnavailable(missing, invalid)
  return {
    serviceFeeBps: byKey.get('fees.serviceFee.percentBps') as number,
    serviceFeeFlatCents: byKey.get('fees.serviceFee.flatCents') as number,
    curbsideRunnerFeeCents: byKey.get('fees.curbsideRunnerFeeCents') as number,
    cardFeesPaidBy: byKey.get('fees.cardFeesPaidBy') as CardFeesPaidBySetting,
  }
}
