import { getStatusConfig } from '@/lib/order-status-config'

/**
 * `className` is for the pill's BOX in its parent's layout — alignment and sizing, nothing else.
 * Colour, padding and shape stay owned here so every status looks identical everywhere.
 *
 * It exists because `inline-flex` does NOT survive a flex COLUMN parent: `align-items` defaults
 * to `stretch`, and on a column that stretches the CROSS axis, which is width. The pill then
 * fills the row instead of hugging its label — a full-width green slab where a word should be.
 * A caller in that situation passes `self-start`.
 */
export function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  const config = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.color} ${config.textColor} ${config.borderColor}${className ? ` ${className}` : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  )
}
