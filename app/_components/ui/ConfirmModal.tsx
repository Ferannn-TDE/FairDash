'use client'

import { useEffect, useRef } from 'react'

type Variant = 'default' | 'warning' | 'destructive'

interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: Variant
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Site-wide destructive confirmation. Styling mirrors the vendor portal's
// original Sign Out modal so vendor / organizer / customer surfaces match.
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const confirmClass =
    variant === 'destructive' ? 'bg-red-500 hover:bg-red-600'
    : variant === 'warning'   ? 'bg-amber-500 hover:bg-amber-600'
    :                            'bg-neon-pink hover:bg-[#e6006b]'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[#1A1A1A] border border-white/10 rounded-2xl p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <h3 className="font-bebas text-3xl tracking-wide text-white mb-2">{title}</h3>
        {message && <p className="text-text-gray text-sm mb-6 leading-relaxed">{message}</p>}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 disabled:opacity-40 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-3 ${confirmClass} text-white rounded-xl font-semibold text-sm cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
