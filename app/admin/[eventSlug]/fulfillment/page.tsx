'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'

const DEFAULT_STATE: FulfillmentState = {
  boothPickupEnabled: true,
  curbsideEnabled: false,
  homeDeliveryEnabled: false,
  curbsideZoneLat: '',
  curbsideZoneLng: '',
  curbsideZoneDescription: '',
  curbsideMethod: 'RUNNER_DELIVERS',
  homeDeliveryFee: '',
  homeDeliveryRadiusKm: '',
  runnerTransportDescription: '',
  curbsideFee: '0',
  runnerFeePercent: '0',
}

type CurbsideMethod = 'RUNNER_DELIVERS' | 'CUSTOMER_WALKS'

interface FulfillmentState {
  boothPickupEnabled: boolean
  curbsideEnabled: boolean
  homeDeliveryEnabled: boolean
  curbsideZoneLat: string
  curbsideZoneLng: string
  curbsideZoneDescription: string
  curbsideMethod: CurbsideMethod
  homeDeliveryFee: string
  homeDeliveryRadiusKm: string
  runnerTransportDescription: string
  curbsideFee: string
  runnerFeePercent: string
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${checked ? 'bg-[#FF0077]' : 'bg-white/10'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow
          ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-bebas text-xl text-white tracking-wide">{title}</h2>
        {sub && <p className="text-sm text-[#666] font-inter mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.6875rem] uppercase tracking-wide text-[#666] font-semibold mb-1.5 font-inter">
        {label}
      </label>
      {children}
    </div>
  )
}

const INPUT = 'w-full bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-inter outline-none focus:border-[#FF0077] transition-colors placeholder:text-[#444]'

export default function FulfillmentConfigPage() {
  const params = useParams<{ eventSlug: string }>()
  const [state, setState] = useState<FulfillmentState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Edge-value warning before save: runner% = 0 (runners tip-only) or 100 (organizer earns nothing).
  const [splitWarning, setSplitWarning] = useState<null | 'zero' | 'full'>(null)

  // Load the real FulfillmentConfig for this event (API accepts slug or id).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/events/${params.eventSlug}/fulfillment`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        const c = json?.data?.config
        if (c) {
          setState({
            boothPickupEnabled: c.boothPickupEnabled ?? true,
            curbsideEnabled: c.curbsideEnabled ?? false,
            homeDeliveryEnabled: c.homeDeliveryEnabled ?? false,
            curbsideZoneLat: c.curbsideZoneLat != null ? String(c.curbsideZoneLat) : '',
            curbsideZoneLng: c.curbsideZoneLng != null ? String(c.curbsideZoneLng) : '',
            curbsideZoneDescription: c.curbsideZoneDescription ?? '',
            curbsideMethod: c.curbsideMethod ?? 'RUNNER_DELIVERS',
            homeDeliveryFee: c.homeDeliveryFee != null ? String(c.homeDeliveryFee) : '',
            homeDeliveryRadiusKm: c.homeDeliveryRadiusKm != null ? String(c.homeDeliveryRadiusKm) : '',
            runnerTransportDescription: c.runnerTransportDescription ?? '',
            curbsideFee: String(c.curbsideFee ?? 0),
            runnerFeePercent: String(c.runnerFeePercent ?? 0),
          })
        }
        // No config yet → keep DEFAULT_STATE (first save creates it).
      })
      .catch(() => { if (!cancelled) setError('Failed to load fulfillment config') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params.eventSlug])

  const runnerPctNum = parseInt(state.runnerFeePercent || '0', 10) || 0

  const set = (k: keyof FulfillmentState, v: string | boolean) =>
    setState(s => ({ ...s, [k]: v }))

  // Validation: curbside can't be enabled without coords + description
  const curbsideValid =
    state.curbsideZoneLat.trim() !== '' &&
    state.curbsideZoneLng.trim() !== '' &&
    state.curbsideZoneDescription.trim() !== ''

  const canEnableCurbside = curbsideValid

  const anyMethodEnabled =
    state.boothPickupEnabled || state.curbsideEnabled || state.homeDeliveryEnabled

  const canSave =
    !loading && (!state.curbsideEnabled || curbsideValid) && anyMethodEnabled

  // Save gate: warn on runner% edge values (0 / 100) before committing.
  const handleSaveClick = () => {
    if (!canSave) return
    if (runnerPctNum === 0) { setSplitWarning('zero'); return }
    if (runnerPctNum === 100) { setSplitWarning('full'); return }
    void doSave()
  }

  const doSave = async () => {
    setSplitWarning(null)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/events/${params.eventSlug}/fulfillment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boothPickupEnabled: state.boothPickupEnabled,
          curbsideEnabled: state.curbsideEnabled,
          homeDeliveryEnabled: state.homeDeliveryEnabled,
          curbsideZoneLat: state.curbsideZoneLat ? parseFloat(state.curbsideZoneLat) : null,
          curbsideZoneLng: state.curbsideZoneLng ? parseFloat(state.curbsideZoneLng) : null,
          curbsideZoneDescription: state.curbsideZoneDescription.trim() || null,
          curbsideMethod: state.curbsideMethod,
          homeDeliveryFee: state.homeDeliveryFee ? parseFloat(state.homeDeliveryFee) : null,
          homeDeliveryRadiusKm: state.homeDeliveryRadiusKm ? parseFloat(state.homeDeliveryRadiusKm) : null,
          runnerTransportDescription: state.runnerTransportDescription.trim() || null,
          curbsideFee: state.curbsideFee ? parseFloat(state.curbsideFee) : 0,
          runnerFeePercent: parseInt(state.runnerFeePercent || '0', 10) || 0,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error?.message ?? 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-6 h-6 border-2 border-white/20 border-t-[#FF0077] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Fulfillment Config</h1>
          <p className="text-sm text-[#666] font-inter mt-1">
            Control which fulfillment modes are available to customers.
          </p>
        </div>
        <button
          onClick={handleSaveClick}
          disabled={!canSave || saving}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors
            ${!canSave || saving
              ? 'bg-white/5 text-[#555] cursor-not-allowed'
              : saved
                ? 'bg-green-600/20 border border-green-600/30 text-green-400'
                : 'bg-[#FF0077] text-white hover:bg-[#e0006b]'
            }`}
        >
          {saved
            ? <><CheckCircleIcon className="w-4 h-4" /> Saved</>
            : saving ? 'Saving…' : 'Save Changes'
          }
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 mb-5 bg-red-500/10 border border-red-500/20 rounded-lg">
          <ExclamationCircleIcon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 font-inter">{error}</p>
        </div>
      )}

      {!anyMethodEnabled && (
        <div className="flex items-start gap-2 px-3 py-2.5 mb-5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <ExclamationCircleIcon className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300 font-inter">Enable at least one fulfillment method to save.</p>
        </div>
      )}

      <div className="space-y-5">

        {/* Booth Pickup */}
        <SectionCard title="Booth Pickup" sub="Customer picks up at the vendor's booth.">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#888] font-inter">Enable booth pickup</p>
            <Toggle checked={state.boothPickupEnabled} onChange={v => set('boothPickupEnabled', v)} />
          </div>
        </SectionCard>

        {/* Curbside */}
        <SectionCard title="Curbside Pickup" sub="Runner delivers to the customer's vehicle in the parking zone.">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#888] font-inter">Enable curbside pickup</p>
              <Toggle
                checked={state.curbsideEnabled}
                onChange={v => {
                  if (v && !canEnableCurbside) return // block toggle if config incomplete
                  set('curbsideEnabled', v)
                }}
                disabled={!canEnableCurbside && !state.curbsideEnabled}
              />
            </div>

            {!curbsideValid && state.curbsideEnabled === false && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <ExclamationCircleIcon className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-300 font-inter">
                  Fill in zone coordinates and description before enabling curbside.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Zone Latitude">
                <input
                  type="number"
                  step="any"
                  value={state.curbsideZoneLat}
                  onChange={e => set('curbsideZoneLat', e.target.value)}
                  placeholder="39.7820"
                  className={INPUT}
                />
              </Field>
              <Field label="Zone Longitude">
                <input
                  type="number"
                  step="any"
                  value={state.curbsideZoneLng}
                  onChange={e => set('curbsideZoneLng', e.target.value)}
                  placeholder="-89.6498"
                  className={INPUT}
                />
              </Field>
            </div>

            <Field label="Zone Description">
              <input
                type="text"
                value={state.curbsideZoneDescription}
                onChange={e => set('curbsideZoneDescription', e.target.value)}
                placeholder="North parking lot, Row A — look for the orange cone markers"
                className={INPUT}
              />
            </Field>

            <Field label="Delivery Method">
              <div className="flex gap-3">
                {(['RUNNER_DELIVERS', 'CUSTOMER_WALKS'] as CurbsideMethod[]).map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => set('curbsideMethod', method)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold font-inter transition-colors
                      ${state.curbsideMethod === method
                        ? 'bg-[#FF0077]/15 border border-[#FF0077]/30 text-[#FF0077]'
                        : 'bg-white/5 border border-white/10 text-[#888] hover:text-white'
                      }`}
                  >
                    {method === 'RUNNER_DELIVERS' ? 'Runner Delivers' : 'Customer Walks'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </SectionCard>

        {/* Home Delivery */}
        <SectionCard title="Home Delivery" sub="Runner delivers to a customer-specified address within the radius.">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[#888] font-inter">Enable home delivery</p>
              <Toggle checked={state.homeDeliveryEnabled} onChange={v => set('homeDeliveryEnabled', v)} />
            </div>

            {state.homeDeliveryEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Flat Fee ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={state.homeDeliveryFee}
                      onChange={e => set('homeDeliveryFee', e.target.value)}
                      placeholder="2.99"
                      className={INPUT}
                    />
                  </Field>
                  <Field label="Max Radius (km)">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="50"
                      value={state.homeDeliveryRadiusKm}
                      onChange={e => set('homeDeliveryRadiusKm', e.target.value)}
                      placeholder="5"
                      className={INPUT}
                    />
                  </Field>
                </div>

                <Field label="Transport Description (shown to customers)">
                  <input
                    type="text"
                    value={state.runnerTransportDescription}
                    onChange={e => set('runnerTransportDescription', e.target.value)}
                    placeholder="Delivered by golf cart"
                    className={INPUT}
                  />
                </Field>
              </>
            )}
          </div>
        </SectionCard>

        {/* Fee split + curbside fee */}
        <SectionCard
          title="Fee Split & Curbside Fee"
          sub="How the runner-fulfilled fee (delivery or curbside) splits between the runner and you."
        >
          <div className="space-y-4">
            <Field label="Runner Share of Fee (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={state.runnerFeePercent}
                onChange={e => set('runnerFeePercent', e.target.value)}
                placeholder="0"
                className={INPUT}
              />
            </Field>
            <p className="text-xs text-[#666] font-inter">
              The leftover <span className="text-white font-semibold">{Math.max(0, Math.min(100, 100 - runnerPctNum))}%</span> is recorded as your organizer earning. Applies to both delivery and curbside fees. Tips are always 100% the runner's.
            </p>

            <Field label="Curbside Fee ($)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={state.curbsideFee}
                onChange={e => set('curbsideFee', e.target.value)}
                placeholder="0.00"
                className={INPUT}
              />
            </Field>
            <p className="text-xs text-[#666] font-inter">Default $0 — curbside is free unless you set a fee. Split by the same runner share above.</p>
          </div>
        </SectionCard>

      </div>

      <ConfirmModal
        open={splitWarning !== null}
        variant="warning"
        title={splitWarning === 'full' ? 'Runners keep the entire fee' : 'Runners earn $0 from the fee'}
        message={
          splitWarning === 'full'
            ? 'Runners keep the entire delivery fee; the event (you) earns nothing from delivery. Continue?'
            : "Runners will earn $0 from the delivery fee for this event (they'd rely on tips only). Continue?"
        }
        confirmLabel="Continue"
        cancelLabel="Go back"
        onConfirm={() => void doSave()}
        onCancel={() => setSplitWarning(null)}
      />
    </div>
  )
}
