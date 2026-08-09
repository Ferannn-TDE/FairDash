'use client'

import { useEffect, useRef, useState } from 'react'
import { IdCard, Upload, AlertTriangle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  ACCEPT_DOC,
  ALLOWED_DOC_MIME,
  invalidMimeMessage,
  isWithinUploadCap,
  uploadTooLargeMessage,
} from '@/lib/upload-limits'

// Driver's-licence upload — SENSITIVE PII.
//
// Honest states only: idle / uploading / uploaded / error. It never shows "saved" unless
// the server confirmed the object is really in the bucket (the old vendor placeholder
// reported success while silently discarding the file — that bug is not repeated here).
//
// The preview is a SHORT-LIVED SIGNED URL minted per request (~60s), never a durable
// public link, and it is never persisted client-side. On reload we re-ask the server for
// a fresh one. If storage is misconfigured the card says so plainly rather than pretending.

// Accept string, MIME allowlist, cap and wording all come from lib/upload-limits.ts. Nothing
// about the limit is restated here, so this card cannot promise a number the route won't honour.

interface LicenseState {
  uploaded: boolean
  uploadedAt: string | null
  viewUrl: string | null
}

export default function LicenseCard() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<LicenseState | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Render from the authoritative source — ask the server what's actually on file.
  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/runners/me/license')
      const json = await res.json()
      if (json.success) {
        setState(json.data)
        setError(null)
      } else {
        setError(json.error?.message ?? 'Could not load your licence')
      }
    } catch {
      setError('Network error — could not load your licence')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after a failure
    if (!file) return

    // Client-side pre-checks are courtesy; the route enforces both again.
    if (!ALLOWED_DOC_MIME.has(file.type)) {
      toast.error(invalidMimeMessage(ALLOWED_DOC_MIME))
      return
    }
    if (!isWithinUploadCap(file.size)) {
      toast.error(uploadTooLargeMessage())
      return
    }

    setUploading(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/runners/me/license', { method: 'POST', body })
      const json = await res.json()

      if (res.ok && json.success) {
        setState(json.data)
        toast.success('Licence uploaded')
      } else {
        // Storage not configured / public bucket refusal surfaces here, verbatim.
        const msg = json.error?.message ?? 'Upload failed'
        setError(msg)
        toast.error(msg)
      }
    } catch {
      setError('Network error — upload failed')
      toast.error('Network error — upload failed')
    } finally {
      setUploading(false)
    }
  }

  const uploaded = !!state?.uploaded

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 space-y-4">
      <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold flex items-center gap-2">
        <IdCard className="w-3.5 h-3.5" /> Driver&apos;s Licence
      </p>

      {loading && (
        <div className="h-24 bg-white/5 border border-white/10 rounded-xl animate-pulse" />
      )}

      {!loading && (
        <>
          {uploaded && state?.viewUrl && (
            <a
              href={state.viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block border border-white/10 rounded-xl overflow-hidden bg-bg-dark hover:border-white/25 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.viewUrl}
                alt="Your driver's licence"
                className="w-full max-h-56 object-contain"
                // A PDF (or an expired link) won't render as an image — fall back to a
                // plain link rather than showing a broken-image icon.
                onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
              <p className="text-neon-pink text-xs px-4 py-2.5">Open licence ↗</p>
            </a>
          )}

          {uploaded && !state?.viewUrl && (
            <div className="flex items-start gap-2 text-xs text-amber-400/90 bg-amber-400/5 border border-amber-400/20 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>Your licence is on file, but the preview couldn&apos;t be loaded right now.</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <input ref={fileRef} type="file" accept={ACCEPT_DOC} onChange={onFile} className="hidden" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-5 py-2.5 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] transition-colors cursor-pointer border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
              : <><Upload className="w-4 h-4" /> {uploaded ? 'Replace licence' : 'Upload licence'}</>}
          </button>
        </>
      )}
    </div>
  )
}
