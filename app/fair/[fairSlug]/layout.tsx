import { notFound } from 'next/navigation'
import FairShell from '../../_components/FairShell'
import { getFairBySlugCached, getVendorsBySlugCached } from '@/lib/fairs'
import type { FairData, VendorData } from '@/app/_contexts/FairContext'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ fairSlug: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fairSlug } = await params
  try {
    const fair = await getFairBySlugCached(fairSlug)
    if (fair) {
      return {
        title: `${fair.name} — FairSynq`,
        description: fair.description ?? `Order food ahead at ${fair.name} on FairSynq.`,
      }
    }
  } catch {
    // DB unavailable
  }
  return { title: 'Fair not found — FairSynq' }
}

export default async function FairLayout({ params, children }: Props) {
  const { fairSlug } = await params
  let initialFair: FairData | null = null
  let initialVendors: VendorData[] = []

  try {
    const [dbFair, dbVendors] = await Promise.all([
      getFairBySlugCached(fairSlug),
      getVendorsBySlugCached(fairSlug),
    ])

    if (dbFair) {
      initialFair = dbFair
      initialVendors = dbVendors
    }
  } catch (err) {
    console.error('[FairLayout] DB error for slug "%s":', fairSlug, err)
  }

  // No such fair in the DB → 404 (no mock fallback).
  if (!initialFair) notFound()

  return (
    <FairShell
      fairSlug={fairSlug}
      initialFair={initialFair}
      initialVendors={initialVendors.length ? initialVendors : undefined}
    >
      {children}
    </FairShell>
  )
}
