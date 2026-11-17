'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { OrganizerBreadcrumb } from '../../../_components/Breadcrumb'
import { statementPreview, STATEMENT_SUFFIX_MAX } from '@/lib/statement-descriptor'
import {
  bpsToPercent, parseMarkupPercentInput, MARKUP_LOCKED_MESSAGE, MARKUP_RANGE_MESSAGE, MARKUP_PERCENT_RANGE_MESSAGE,
} from '@/lib/menu/price'
import { onlineUnitPrice } from '@/lib/checkout-total'

/** The example item the markup preview prices: "On a $10.00 item, customers pay …". */
const MARKUP_EXAMPLE_PRICE = 10

/**
 * The statuses an organizer may set on this screen: exactly the settings route's ALLOWED_STATUSES
 * (app/api/organizer/fairs/[fairSlug]/settings/route.ts; pinned by online-markup-test [21]).
 * ACTIVE is FairSynq's Go Live, so it is never offered. A fair whose saved status is not in this
 * list (ACTIVE) shows its status read-only, and the page never sends a status for it.
 */
const ORGANIZER_STATUS_CHOICES: { value: FairSettings['status']; label: string }[] = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'INACTIVE', label: 'Inactive' },
]

// ── What a failed save says ───────────────────────────────────────────────────
// Every sentence a failed save shows is written HERE, chosen by the response's error CODE. The
// server's message is never shown (scripts/toast-leak-guard.ts [5]); it goes to the browser
// console only, as app/organizer/fairs/new/page.tsx does.

const SAVE_FAILED = "Couldn't save settings. Try again."
const ACCOUNT_BLOCKED = "Your organizer account can't make changes right now. Contact FairSynq support."

/** Fixed copy per code the settings PATCH can send (app/api/organizer/fairs/[fairSlug]/settings/route.ts). */
const SAVE_FAILED_COPY: Record<string, string> = {
  'UNAUTHORIZED':           'Your session ended. Sign in again, then save.',
  'FORBIDDEN':              ACCOUNT_BLOCKED,
  'ORGANIZER_NOT_APPROVED': ACCOUNT_BLOCKED,
  'ORGANIZER_REJECTED':     ACCOUNT_BLOCKED,
  'ORGANIZER_SUSPENDED':    ACCOUNT_BLOCKED,
  'DB_POOL_TIMEOUT':        'FairSynq is busy right now. Wait a moment, then save again.',
  'NOT_FOUND':              "This fair can't be changed from your account. It may have been archived or removed. Reload the page to check.",
  'VALIDATION_ERROR':       "Some settings weren't accepted. Check the fair status and the card statement name (it needs at least one letter), then try again.",
  'MARKUP_LOCKED':          `${MARKUP_LOCKED_MESSAGE} Nothing was saved; press Save again to save your other changes.`,
}

/**
 * The toast for a failed save. Takes the error CODE and whether the server refused the markup as
 * over the 10% cap, never the server's message, so no server text can reach the screen.
 */
function saveFailedCopy(code: string | undefined, markupRangeRefused: boolean): string {
  if (code === 'VALIDATION_ERROR' && markupRangeRefused) return MARKUP_PERCENT_RANGE_MESSAGE
  if (code && Object.prototype.hasOwnProperty.call(SAVE_FAILED_COPY, code)) return SAVE_FAILED_COPY[code]
  return SAVE_FAILED
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FairSettings {
  id: string
  name: string
  status: 'UPCOMING' | 'ACTIVE' | 'INACTIVE'
  primaryColor: string
  welcomeMessage: string | null
  statementName: string | null
  // Operational timing
  orderAcceptanceWindowSec: number
  vendorOfflineHideSec: number
  maxVendorsPerOrder: number
  // Platform
  isPaused: boolean
  // Online price markup (audit H5, 2h): basis points, 0–1000. markupLocked = the event has started.
  onlineMarkupBps: number
  markupLocked: boolean
  // Owner-only
  isOwner: boolean
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, desc, children, danger }: {
  title: string; desc?: string; children: React.ReactNode; danger?: boolean
}) {
  return (
    <div className={`rounded-2xl overflow-hidden border ${danger ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-white/[0.07] bg-[#111]'}`}>
      <div className={`px-5 py-4 border-b ${danger ? 'border-red-500/15' : 'border-white/[0.06]'}`}>
        <p className={`font-semibold text-sm ${danger ? 'text-red-400' : 'text-white'}`}>{title}</p>
        {desc && <p className="text-white/30 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ label, desc, value, onChange, disabled }: {
  label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`shrink-0 relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${value ? 'bg-neon-pink' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}

// ── Number field ──────────────────────────────────────────────────────────────

function NumberField({ label, desc, value, unit, min, max, onChange }: {
  label: string; desc?: string; value: number; unit: string; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={min} max={max}
          value={value}
          onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="w-16 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-center outline-none focus:border-neon-pink font-inter"
        />
        <span className="text-white/30 text-xs font-inter whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}

// ── Select field ──────────────────────────────────────────────────────────────

function SelectField({ label, desc, value, options, onChange }: {
  label: string; desc?: string; value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-medium font-inter">{label}</p>
        {desc && <p className="text-white/35 text-xs font-inter mt-0.5">{desc}</p>}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-neon-pink font-inter cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FairSettingsPage() {
  const { fairSlug } = useParams<{ fairSlug: string }>()

  const [settings, setSettings] = useState<FairSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  // The markup as typed, in percent. Checked by parseMarkupPercentInput: never clamped.
  const [markupInput, setMarkupInput] = useState('')
  const [markupError, setMarkupError] = useState<string | null>(null)
  // The status as last loaded or saved. The page sends `status` only when the organizer changed it.
  const [savedStatus, setSavedStatus] = useState<FairSettings['status'] | null>(null)

  useEffect(() => {
    fetch(`/api/organizer/fairs/${fairSlug}/settings`)
      .then(r => r.json())
      .then(json => {
        if (json.data) {
          setSettings(json.data)
          setSavedStatus(json.data.status)
          setMarkupInput(String(bpsToPercent(json.data.onlineMarkupBps ?? 0)))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fairSlug])

  const update = useCallback(<K extends keyof FairSettings>(key: K, value: FairSettings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
    setDirty(true)
  }, [])

  const markupParse = parseMarkupPercentInput(markupInput)

  async function handleSave() {
    if (!settings) return
    // A markup over 10% (or not a number) is shown as an error and blocks the save: nothing is
    // clamped and nothing is saved until it is fixed.
    if (!settings.markupLocked && !markupParse.ok) {
      setMarkupError(markupParse.message)
      toast.error(markupParse.message)
      return
    }
    // Sent only when changed and the event has not started (the server refuses an organizer change
    // after the start with 409 MARKUP_LOCKED).
    const markupBps = !settings.markupLocked && markupParse.ok && markupParse.bps !== settings.onlineMarkupBps
      ? markupParse.bps
      : undefined
    // Sent only when the organizer picked a different status. An ACTIVE fair offers no choice, so
    // its status is never sent and its other settings save (the route allows only UPCOMING/INACTIVE).
    const statusChanged = savedStatus !== null && settings.status !== savedStatus
    setSaving(true)
    try {
      const res = await fetch(`/api/organizer/fairs/${fairSlug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryColor:             settings.primaryColor,
          welcomeMessage:           settings.welcomeMessage,
          statementName:            settings.statementName,
          orderAcceptanceWindowSec: settings.orderAcceptanceWindowSec,
          vendorOfflineHideSec:     settings.vendorOfflineHideSec,
          maxVendorsPerOrder:       settings.maxVendorsPerOrder,
          isPaused:                 settings.isPaused,
          ...(markupBps !== undefined && { onlineMarkupBps: markupBps }),
          ...(statusChanged && { status: settings.status }),
        }),
      })
      const json = await res.json()
      if (json.success) {
        toast.success('Settings saved')
        setDirty(false)
        setMarkupError(null)
        setSettings(prev => prev ? { ...prev, status: json.data.status, onlineMarkupBps: json.data.onlineMarkupBps, markupLocked: json.data.markupLocked } : prev)
        setSavedStatus(json.data.status)
        setMarkupInput(String(bpsToPercent(json.data.onlineMarkupBps)))
      } else {
        const code: string | undefined = typeof json.error?.code === 'string' ? json.error.code : undefined
        // A markup over the 10% cap is recognised by comparing with the shared constant that
        // lib/event-markup.ts sends (pinned by toast-leak-guard [5]); the server's text is not shown.
        const markupRangeRefused = markupBps !== undefined && code === 'VALIDATION_ERROR'
          && json.error?.message === MARKUP_RANGE_MESSAGE
        console.error('[FairSettings] save failed', { status: res.status, code, message: json.error?.message })
        if (json.error?.code === 'MARKUP_LOCKED') {
          // The event started while this page was open. The server saved NOTHING (it refuses the whole
          // request), so lock the field, put the saved markup back, and let the other changes be saved.
          setSettings(prev => prev ? { ...prev, markupLocked: true } : prev)
          setMarkupInput(String(bpsToPercent(settings.onlineMarkupBps)))
          setMarkupError(null)
        } else if (markupRangeRefused) {
          setMarkupError(MARKUP_PERCENT_RANGE_MESSAGE)
        }
        toast.error(saveFailedCopy(code, markupRangeRefused))
      }
    } catch (err) {
      // Network failure, or a non-JSON answer (an HTML error page) that res.json() could not read.
      console.error('[FairSettings] save failed', err)
      toast.error(SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        {[...Array(4)].map((_, i) => <div key={i} className="h-44 bg-white/[0.03] rounded-2xl" />)}
      </div>
    )
  }

  if (!settings) {
    return <p className="text-white/30 font-inter text-sm">Fair not found.</p>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <OrganizerBreadcrumb crumbs={[
        { label: 'My Fairs', href: '/organizer/fairs' },
        { label: settings.name, href: `/organizer/fairs/${fairSlug}` },
        { label: 'Settings' },
      ]} />

      <div>
        <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.25rem)] tracking-wide text-white leading-tight">
          Fair <span className="text-neon-pink">Settings</span>
        </h1>
        <p className="text-white/30 text-sm font-inter mt-0.5">{settings.name}</p>
      </div>

      {/* Fair Status */}
      <Section title="Fair Status" desc="Controls whether this fair accepts orders">
        <Toggle
          label="Platform Paused"
          desc="Block all new orders across this fair immediately — vendors still logged in won't see new orders"
          value={settings.isPaused}
          onChange={v => update('isPaused', v)}
        />
        {ORGANIZER_STATUS_CHOICES.some(c => c.value === savedStatus) ? (
          <SelectField
            label="Fair Status"
            desc="Upcoming = visible but not accepting orders · Inactive = closed. FairSynq puts a fair live."
            value={settings.status}
            options={ORGANIZER_STATUS_CHOICES}
            onChange={v => update('status', v as FairSettings['status'])}
          />
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium font-inter">Fair Status</p>
              <p className="text-white/35 text-xs font-inter mt-0.5">
                FairSynq controls a live fair&apos;s status. To stop orders now, use Platform Paused.
              </p>
            </div>
            <span role="status" className="shrink-0 text-emerald-400 text-sm font-semibold font-inter">Active — live</span>
          </div>
        )}
      </Section>

      {/* Fair Branding */}
      <Section title="Fair Branding">
        <div>
          <p className="text-white/35 text-xs uppercase tracking-wider mb-2 font-semibold font-inter">Accent Color</p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings.primaryColor}
              onChange={e => update('primaryColor', e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0"
            />
            <span className="text-white/60 text-sm font-mono">{settings.primaryColor}</span>
            <button
              type="button"
              onClick={() => update('primaryColor', '#FF0077')}
              className="text-white/25 text-xs hover:text-white/50 font-inter transition-colors cursor-pointer"
            >
              Reset to default
            </button>
          </div>
          <p className="text-white/20 text-xs font-inter mt-1.5">Applied to buttons and highlights on the customer menu</p>
        </div>
        <div>
          <p className="text-white/35 text-xs uppercase tracking-wider mb-2 font-semibold font-inter">Welcome Message</p>
          <div className="relative">
            <input
              type="text"
              value={settings.welcomeMessage ?? ''}
              onChange={e => update('welcomeMessage', e.target.value || null)}
              placeholder="Welcome to Italian Fest 2026! Enjoy the food."
              maxLength={120}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/15 focus:border-neon-pink outline-none font-inter pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 text-[0.65rem] font-inter tabular-nums">
              {(settings.welcomeMessage ?? '').length}/120
            </span>
          </div>
          <p className="text-white/20 text-xs font-inter mt-1.5">Shown on the fair home page · max 120 chars</p>
        </div>
        <div>
          <p className="text-white/35 text-xs uppercase tracking-wider mb-2 font-semibold font-inter">Card Statement Name</p>
          <input
            type="text"
            value={settings.statementName ?? ''}
            onChange={e => update('statementName', e.target.value || null)}
            placeholder={settings.name}
            maxLength={40}
            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/15 focus:border-neon-pink outline-none font-inter"
          />
          <p className="text-white/20 text-xs font-inter mt-1.5">
            Customers&apos; card statements will read{' '}
            <span className="text-white/60 font-mono">{statementPreview({ statementName: settings.statementName, name: settings.name })}</span>
            {' '}· letters and numbers, up to {STATEMENT_SUFFIX_MAX} characters after FAIRSYNQ. Leave empty to use the fair name.
          </p>
        </div>
      </Section>

      {/* Operational Timing */}
      <Section title="Operational Timing" desc="Controls how quickly vendors must respond to orders">
        <NumberField
          label="Vendor acceptance window"
          desc="Seconds vendor has to accept an order before auto-cancel"
          value={settings.orderAcceptanceWindowSec}
          unit="sec" min={30} max={600}
          onChange={v => update('orderAcceptanceWindowSec', v)}
        />
        <NumberField
          label="Vendor offline hide delay"
          desc="Seconds before an offline vendor is hidden from the customer menu"
          value={settings.vendorOfflineHideSec}
          unit="sec" min={60} max={1800}
          onChange={v => update('vendorOfflineHideSec', v)}
        />
        <NumberField
          label="Max vendors per cart"
          desc="How many different vendors a customer can combine in one order"
          value={settings.maxVendorsPerOrder}
          unit="vendors" min={1} max={10}
          onChange={v => update('maxVendorsPerOrder', v)}
        />
      </Section>

      {/* Online prices (audit H5, 2h) */}
      <Section title="Online Prices" desc="A markup added to every menu price for online orders. It goes to the vendors; FairSynq's service fee stays on the booth price.">
        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium font-inter">Online price markup</p>
              <p className="text-white/35 text-xs font-inter mt-0.5">From 0% (online price = booth price) to 10%</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={markupInput}
                disabled={settings.markupLocked}
                aria-invalid={!!markupError}
                aria-describedby="markup-help"
                onChange={e => {
                  setMarkupInput(e.target.value)
                  const p = parseMarkupPercentInput(e.target.value)
                  setMarkupError(p.ok ? null : p.message)
                  setDirty(true)
                }}
                className={`w-20 bg-white/[0.05] border rounded-lg px-2 py-1.5 text-white text-sm text-center outline-none font-inter disabled:opacity-40 disabled:cursor-not-allowed ${markupError ? 'border-red-500 focus:border-red-500' : 'border-white/10 focus:border-neon-pink'}`}
              />
              <span className="text-white/30 text-xs font-inter whitespace-nowrap">%</span>
            </div>
          </div>
          <div id="markup-help" className="mt-2">
            {settings.markupLocked ? (
              <p role="status" className="text-amber-400 text-xs font-inter">🔒 {MARKUP_LOCKED_MESSAGE}</p>
            ) : markupError ? (
              <p role="alert" className="text-red-400 text-xs font-inter">{markupError}</p>
            ) : null}
            {markupParse.ok && (
              <p className="text-white/40 text-xs font-inter mt-1">
                On a ${MARKUP_EXAMPLE_PRICE.toFixed(2)} item, customers pay{' '}
                <span className="text-white/70">${onlineUnitPrice(MARKUP_EXAMPLE_PRICE, markupParse.bps).toFixed(2)}</span> online.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !dirty}
        className="w-full py-3 bg-neon-pink hover:bg-[#e6006b] text-white font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-inter"
      >
        {saving ? 'Saving…' : dirty ? 'Save Settings' : 'No changes'}
      </button>

    </div>
  )
}
