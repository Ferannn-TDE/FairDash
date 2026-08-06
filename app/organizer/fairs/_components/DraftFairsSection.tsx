'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { PencilSquareIcon, TrashIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { fetchJson } from '@/lib/api-fetcher'
import { formatEventDateRange } from '@/lib/event-date'

/**
 * DRAFTS — half-built fairs, deliberately kept OUT of the My Fairs list above.
 *
 * Rendered as its own section, not as rows in My Fairs with a badge: a draft is not a fair yet.
 * It has no vendors, no orders and no revenue by construction, so putting it in the same table
 * would mean showing four zero columns and inviting someone to wire the real aggregates in later
 * — which would put drafts straight back into the counts this whole change exists to keep them
 * out of.
 *
 * Two actions only. Continue editing reopens the wizard against this row (?draft=<slug>), so
 * publishing PROMOTES it rather than creating a duplicate. Delete is a HARD delete: the row goes
 * and the slug is freed for reuse — safe only because a draft can never hold a vendor, runner or
 * order (see lib/fair-join-gate.ts).
 */

interface Draft {
  id: string
  name: string
  slug: string
  startDate: string
  endDate: string
  createdAt: string
  location: string | null
}

export default function DraftFairsSection() {
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['organizer-fair-drafts'],
    queryFn: () => fetchJson<{ drafts: Draft[] }>('/api/organizer/fairs/drafts'),
  })
  const drafts = query.data?.drafts ?? []

  // Nothing to show and nothing loading — render no heading at all rather than an empty section.
  if (query.isPending || drafts.length === 0) return null

  async function remove(slug: string, name: string) {
    setDeleting(slug)
    try {
      const res = await fetch(`/api/organizer/fairs/drafts/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? 'Failed to delete draft')
      toast.success(`Draft “${name}” deleted`)
      await qc.invalidateQueries({ queryKey: ['organizer-fair-drafts'] })
      await qc.invalidateQueries({ queryKey: ['organizer-fairs-sidebar'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete draft')
    } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }

  return (
    <section className="mt-10">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="font-bebas text-xl text-white tracking-wide">Drafts</h2>
        <span className="text-xs text-[#666] font-inter">
          {drafts.length} unpublished · not visible to vendors or customers
        </span>
      </div>

      <div className="space-y-2">
        {drafts.map(d => (
          <div
            key={d.id}
            className="bg-[#111111] border border-dashed border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="w-10 h-10 bg-white/5 rounded-xl shrink-0 flex items-center justify-center">
              <DocumentTextIcon className="w-5 h-5 text-[#777]" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-semibold text-sm truncate">{d.name}</p>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-white/5 text-[#999] border border-white/10">
                  Draft
                </span>
              </div>
              <p className="text-xs text-[#666] font-inter mt-0.5 truncate">
                {formatEventDateRange(d.startDate, d.endDate)}
                {d.location ? ` · ${d.location}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/organizer/fairs/new?draft=${encodeURIComponent(d.slug)}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" />
                Continue editing
              </Link>

              {confirming === d.slug ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => remove(d.slug, d.name)}
                    disabled={deleting === d.slug}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500/80 rounded-lg hover:bg-red-500 transition-colors disabled:opacity-40"
                  >
                    {deleting === d.slug ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="px-2 py-1.5 text-xs text-[#888] hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                /* Two-step, because this one is irreversible — unlike deleting a published fair,
                   which archives and can be recovered. */
                <button
                  onClick={() => setConfirming(d.slug)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#888] border border-white/10 rounded-lg hover:text-red-400 hover:border-red-500/30 transition-colors"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
