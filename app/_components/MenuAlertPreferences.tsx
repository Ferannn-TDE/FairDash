'use client'

// MENU ALERTS — "how do you want to hear about this?" for organizers and strict admins
// (audit H5, step 3b). Shown on the organizer settings page and, for strict admins, on the admin
// settings page. Saves through PUT /api/notification-preferences; the worker
// (lib/menu-notify/digest.ts) reads the result.
//
// The buttons come from ALLOWED_CHANNELS, the same list the API and the worker use, so the price
// row never offers "None" (Jordan, Nov 15). Plain fetch on purpose: the admin portal has no React
// Query provider.

import { useEffect, useState } from 'react'
import {
  ALLOWED_CHANNELS,
  type AlertChannel,
  type MenuAlertType,
} from '@/lib/menu-notify/constants'

interface Preference {
  eventType: MenuAlertType
  label: string
  channel: AlertChannel
  allowed: AlertChannel[]
  saved: boolean
}

const CHANNEL_LABEL: Record<AlertChannel, string> = {
  EMAIL: 'Email',
  IN_APP: 'In-app',
  BOTH: 'Both',
  NONE: 'None',
}

const DESCRIPTION: Record<MenuAlertType, string> = {
  MENU_ITEMS_DELETED: 'When a vendor removes items. Grouped: one alert per vendor every 10 minutes.',
  MENU_PRICE_CHANGE_PENDING: "You approve these, so they can't be switched off.",
}

async function readError(res: Response): Promise<string> {
  try {
    const json = await res.json() as { error?: { message?: string } }
    return json.error?.message ?? 'Could not save. Try again.'
  } catch {
    return 'Could not save. Try again.'
  }
}

export default function MenuAlertPreferences() {
  const [prefs, setPrefs] = useState<Preference[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [rowError, setRowError] = useState<Partial<Record<MenuAlertType, string>>>({})
  const [saving, setSaving] = useState<MenuAlertType | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/notification-preferences')
      .then(async res => {
        if (!res.ok) throw new Error(await readError(res))
        return res.json() as Promise<{ data: { preferences: Preference[] } }>
      })
      .then(json => { if (!cancelled) setPrefs(json.data.preferences) })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [])

  const choose = async (eventType: MenuAlertType, channel: AlertChannel) => {
    if (!prefs) return
    const before = prefs
    if (before.find(p => p.eventType === eventType)?.channel === channel) return
    setPrefs(before.map(p => (p.eventType === eventType ? { ...p, channel } : p)))
    setRowError(e => ({ ...e, [eventType]: undefined }))
    setSaving(eventType)
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, channel }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const json = await res.json() as { data: { preferences: Preference[] } }
      setPrefs(json.data.preferences)
    } catch (err) {
      setPrefs(before)
      setRowError(e => ({ ...e, [eventType]: err instanceof Error ? err.message : 'Could not save. Try again.' }))
    } finally {
      setSaving(null)
    }
  }

  if (loadFailed) {
    return <p className="text-red-400 text-sm">Couldn&apos;t load your menu alert settings. Refresh the page to try again.</p>
  }

  if (!prefs) {
    return (
      <div className="space-y-3">
        {[0, 1].map(i => <div key={i} className="h-14 bg-white/[0.03] rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {prefs.map(p => (
        <div key={p.eventType} className="py-3 border-b border-white/[0.05] last:border-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p id={`menu-alert-${p.eventType}`} className="text-white text-sm font-medium">{p.label}</p>
              <p className="text-white/40 text-xs mt-0.5">{DESCRIPTION[p.eventType]}</p>
            </div>
            <div
              role="radiogroup"
              aria-labelledby={`menu-alert-${p.eventType}`}
              className="flex flex-wrap gap-1 bg-white/[0.04] border border-white/10 rounded-xl p-1"
            >
              {ALLOWED_CHANNELS[p.eventType].map(ch => {
                const selected = p.channel === ch
                return (
                  <button
                    key={ch}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={saving === p.eventType}
                    onClick={() => choose(p.eventType, ch)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                      selected ? 'bg-[#FF0077] text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {CHANNEL_LABEL[ch]}
                  </button>
                )
              })}
            </div>
          </div>
          {rowError[p.eventType] && (
            <p role="alert" className="text-red-400 text-xs mt-2">{rowError[p.eventType]}</p>
          )}
        </div>
      ))}
    </div>
  )
}
