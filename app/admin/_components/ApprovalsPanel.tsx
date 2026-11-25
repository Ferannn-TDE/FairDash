'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { adminErrorText } from '@/lib/admin-error-text'

// /admin/approvals panel (Batch 1 item 9). One decision per application through
// POST /api/admin/approvals/{kind}/{id}. Loading shows skeletons, never placeholder data.

type Kind = 'vendor' | 'organizer' | 'partner'

interface VendorApp {
  id: string; name: string; cuisineType: string; description: string | null
  contactName: string | null; contactEmail: string | null; contactPhone: string | null; createdAt: string
  fair: string; ownerStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  /** Set when the fair has an organizer: they decide; FairSynq only by a strict-admin override. */
  organizerName: string | null
  documents: { key: string; label: string; onFile: boolean }[]
}
interface OrganizerApp { id: string; name: string; contactEmail: string; contactPhone: string | null; createdAt: string }
interface PartnerApp {
  id: string; name: string; groupType: string; groupTypeOther: string | null
  contactName: string; contactEmail: string; contactPhone: string; city: string; state: string
  interests: string | null; staffHours: string | null; note: string | null; createdAt: string
}
interface Outbox { connected: boolean; waitingAdmin: number; waitingApplicant: number; heldNoAlertEmail: number; heldSafeDomain: number; failed: number }
interface Data { vendors: VendorApp[]; organizers: OrganizerApp[]; partners: PartnerApp[]; outbox: Outbox }

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'vendor', label: 'Vendors' },
  { kind: 'organizer', label: 'Organizers' },
  { kind: 'partner', label: 'Partners' },
]

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function OutboxLine({ o }: { o: Outbox }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (!o.connected) {
    if (o.waitingAdmin + o.waitingApplicant === 0) return <p className="text-xs text-text-gray mb-4">Email isn&apos;t connected yet. Nothing is waiting.</p>
    return (
      <p className="text-xs text-amber-300 mb-4">
        Email isn&apos;t connected yet: {plural(o.waitingAdmin, 'admin alert', 'admin alerts')} and {plural(o.waitingApplicant, 'applicant email', 'applicant emails')} waiting.
      </p>
    )
  }
  const parts = [
    o.heldNoAlertEmail > 0 && `${plural(o.heldNoAlertEmail, 'alert', 'alerts')} held: no alert email set in Platform settings`,
    o.heldSafeDomain > 0 && `${plural(o.heldSafeDomain, 'email', 'emails')} held: outside the test domain`,
    o.failed > 0 && `${plural(o.failed, 'email', 'emails')} failed`,
  ].filter(Boolean)
  if (!parts.length) return null
  return <p className="text-xs text-amber-300 mb-4">{parts.join(' · ')}</p>
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <p className="text-sm text-text-gray"><span className="text-white/60">{label}:</span> <span className="text-white/90 break-words">{value}</span></p>
  )
}

/** `override`: the vendor's fair has an organizer, and this strict admin decides anyway. Both
 *  buttons then need a reason (recorded; the organizer is emailed; lib/vendor-approver.ts). */
function DecisionControls({ kind, id, onDone, override = false }: { kind: Kind; id: string; onDone: () => void; override?: boolean }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (decision: 'approve' | 'reject') => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/approvals/${kind}/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: decision === 'reject' || override ? reason : undefined }),
      })
      const json = await res.json()
      if (!json.success) {
        const missing = json.error?.details?.missing as string[] | undefined
        setError(adminErrorText(res.status, missing?.length ? `${json.error.message} Missing: ${missing.join(', ')}.` : json.error?.message ?? 'Something went wrong'))
        if (json.error?.code === 'ALREADY_DECIDED') onDone()
        return
      }
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected')
      onDone()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (override) {
    return (
      <div className="mt-4 space-y-2">
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block" htmlFor={`override-${kind}-${id}`}>
          Override reason <span className="normal-case tracking-normal font-normal">(recorded and emailed to the organizer; a rejection reason is also shown to the applicant)</span>
        </label>
        <textarea
          id={`override-${kind}-${id}`} rows={2} value={reason} onChange={e => setReason(e.target.value)} disabled={busy}
          className="w-full bg-[#0F0F0F] border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => send('approve')} disabled={busy || !reason.trim()}
            className="px-4 py-2 rounded-xl bg-neon-pink text-white text-xs font-semibold border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Working…' : 'Approve anyway'}
          </button>
          <button type="button" onClick={() => send('reject')} disabled={busy || !reason.trim()}
            className="px-4 py-2 rounded-xl bg-red-500/80 text-white text-xs font-semibold border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Working…' : 'Reject anyway'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4">
      {error && <p role="alert" className="mb-3 text-xs text-red-400">{error}</p>}
      {rejecting ? (
        <div className="space-y-2">
          <label className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold block" htmlFor={`reason-${kind}-${id}`}>
            Reason <span className="normal-case tracking-normal font-normal">(Shown to the applicant)</span>
          </label>
          <textarea
            id={`reason-${kind}-${id}`} rows={2} value={reason} onChange={e => setReason(e.target.value)} disabled={busy}
            className="w-full bg-[#0F0F0F] border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => send('reject')} disabled={busy || !reason.trim()}
              className="px-4 py-2 rounded-xl bg-red-500/80 text-white text-xs font-semibold border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? 'Rejecting…' : 'Reject application'}
            </button>
            <button type="button" onClick={() => { setRejecting(false); setReason('') }} disabled={busy}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => send('approve')} disabled={busy}
            className="px-5 py-2.5 rounded-xl bg-neon-pink text-white text-sm font-semibold hover:bg-[#e0006b] border-0 cursor-pointer disabled:opacity-50">
            {busy ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" onClick={() => setRejecting(true)} disabled={busy}
            className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-semibold cursor-pointer">
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

function ViewDocButton({ vendorId, docKey, label }: { vendorId: string; docKey: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const view = async () => {
    // Open the tab synchronously (popup blockers), then point it at the signed link.
    // ('noopener' would make window.open return null; drop the opener link by hand instead.)
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/approvals/vendors/${vendorId}/documents/${docKey}`)
      const json = await res.json()
      if (!json.success) { tab?.close(); toast.error(adminErrorText(res.status, json.error?.message ?? `Couldn't open ${label}`)); return }
      if (tab) tab.location.href = json.data.url
      else toast.error('Allow pop-ups for this site to view documents')
    } catch {
      tab?.close(); toast.error(`Couldn't open ${label}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={view} disabled={busy} className="text-xs font-semibold text-neon-pink hover:underline bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50">
      {busy ? 'Opening…' : 'View'}
    </button>
  )
}

/** `canOverride`: the viewer is a strict admin (admin | super_admin), who may decide a vendor on a
 *  fair that has an organizer, with a reason. The server enforces it either way. */
export default function ApprovalsPanel({ canOverride = false }: { canOverride?: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState<Kind>('vendor')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/approvals', { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error()
      setData(json.data); setError(false)
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const counts: Record<Kind, number> = { vendor: data?.vendors.length ?? 0, organizer: data?.organizers.length ?? 0, partner: data?.partners.length ?? 0 }
  const card = 'bg-bg-card border border-white/10 rounded-2xl p-5 sm:p-6'

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-bebas text-4xl sm:text-5xl text-white tracking-wide">Approvals</h1>
        <p className="text-text-gray text-sm mt-1">New vendor, organizer and partner applications waiting for a decision.</p>
      </div>

      {error && !data && (
        <div className={`${card} text-sm text-text-gray`}>
          Couldn&apos;t load applications.{' '}
          <button type="button" onClick={load} className="text-neon-pink font-semibold bg-transparent border-0 cursor-pointer">Try again</button>
        </div>
      )}
      {!data && !error && <div aria-hidden="true" className="space-y-4">{[0, 1].map(i => <div key={i} className="h-48 bg-bg-card border border-white/10 rounded-2xl animate-pulse" />)}</div>}

      {data && (
        <>
          <OutboxLine o={data.outbox} />
          <div role="tablist" className="flex flex-wrap gap-2 mb-5">
            {TABS.map(t => (
              <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} onClick={() => setTab(t.kind)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border cursor-pointer transition-colors ${tab === t.kind ? 'bg-neon-pink border-neon-pink text-white' : 'bg-white/5 border-white/10 text-text-gray hover:text-white'}`}>
                {t.label} <span className="opacity-80">({counts[t.kind]})</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {counts[tab] === 0 && <p className="text-text-gray text-sm">Nothing waiting.</p>}

            {tab === 'vendor' && data.vendors.map(v => (
              <div key={v.id} className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-white font-semibold text-base">{v.name}</h3>
                  <span className="text-xs text-text-gray">Applied {fmtDate(v.createdAt)}</span>
                </div>
                <div className="space-y-1">
                  <Row label="Fair" value={v.fair} />
                  <Row label="Contact" value={[v.contactName, v.contactEmail, v.contactPhone].filter(Boolean).join(' · ')} />
                  <Row label="Cuisine" value={v.cuisineType} />
                  <Row label="Description" value={v.description} />
                  {v.ownerStatus && v.ownerStatus !== 'PENDING' && (
                    <p className="text-xs text-amber-300">Owner already {v.ownerStatus.toLowerCase()} separately on Booth Operators.</p>
                  )}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {v.documents.map(d => (
                    <li key={d.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white/90">{d.label}</span>
                      {d.onFile ? <ViewDocButton vendorId={v.id} docKey={d.key} label={d.label} /> : <span className="text-xs text-red-400">Missing</span>}
                    </li>
                  ))}
                </ul>
                {v.organizerName ? (
                  <>
                    <p className="mt-4 text-xs text-amber-300">
                      This fair&apos;s organizer ({v.organizerName}) approves or rejects this vendor.
                      {canOverride ? ' You can decide as FairSynq anyway, with a reason.' : ''}
                    </p>
                    {canOverride && <DecisionControls kind="vendor" id={v.id} onDone={load} override />}
                  </>
                ) : (
                  <DecisionControls kind="vendor" id={v.id} onDone={load} />
                )}
              </div>
            ))}

            {tab === 'organizer' && data.organizers.map(o => (
              <div key={o.id} className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-white font-semibold text-base">{o.name}</h3>
                  <span className="text-xs text-text-gray">Applied {fmtDate(o.createdAt)}</span>
                </div>
                <Row label="Contact" value={[o.contactEmail, o.contactPhone].filter(Boolean).join(' · ')} />
                <DecisionControls kind="organizer" id={o.id} onDone={load} />
              </div>
            ))}

            {tab === 'partner' && data.partners.map(p => (
              <div key={p.id} className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-white font-semibold text-base">{p.name}</h3>
                  <span className="text-xs text-text-gray">Applied {fmtDate(p.createdAt)}</span>
                </div>
                <div className="space-y-1">
                  <Row label="Type" value={p.groupType === 'other' ? p.groupTypeOther : p.groupType} />
                  <Row label="Contact" value={`${p.contactName} · ${p.contactEmail} · ${p.contactPhone}`} />
                  <Row label="Location" value={`${p.city}, ${p.state}`} />
                  <Row label="Fairs or events" value={p.interests} />
                  <Row label="Hours" value={p.staffHours} />
                  <Row label="Note" value={p.note} />
                </div>
                <DecisionControls kind="partner" id={p.id} onDone={load} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
