import { notFound } from 'next/navigation'
import FairShell from '../../_components/FairShell'
import { getFairBySlugCached, getFairSeoBySlugCached, getVendorsBySlugCached } from '@/lib/fairs'
import { getCustomerFeeTerms } from '@/lib/fees/fee-terms'
import { SITE_NAME, fairDescription, fairTitle, robotsFor } from '@/lib/seo'
import type { FairData, VendorData } from '@/app/_contexts/FairContext'
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ fairSlug: string }>
  children: React.ReactNode
}

// Fair pages: title and description from the fair's name, dates, place, vendor count and real
// fulfillment options; noindex until SEO_INDEX_FAIRS=1 (lib/seo.ts). Sub-pages set their own
// canonical (and private ones noindex) in their own layouts.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fairSlug } = await params
  try {
    const fair = await getFairSeoBySlugCached(fairSlug)
    if (fair) {
      const title = fairTitle(fair)
      const description = fairDescription(fair)
      return {
        title: { absolute: title },
        description,
        // UNLISTED (the B1.17 test fair): reachable by direct URL, never indexed, no canonical claim.
        alternates: fair.indexable ? { canonical: `/fair/${fair.slug}` } : { canonical: null },
        robots: fair.indexable ? robotsFor('fair') : robotsFor('private'),
        openGraph: { title, description, url: `/fair/${fair.slug}`, siteName: SITE_NAME, type: 'website', locale: 'en_US' },
        twitter: { card: 'summary_large_image', title, description },
      }
    }
  } catch {
    // DB unavailable
  }
  return { title: 'Fair not found — FairSynq', robots: robotsFor('private') }
}

export default async function FairLayout({ params, children }: Props) {
  const { fairSlug } = await params
  let initialFair: FairData | null = null
  let initialVendors: VendorData[] = []

  try {
    // The fair stays cached; the fee terms are read uncached and merged in (item 10 stage 3).
    const [dbFair, dbVendors, feeTerms] = await Promise.all([
      getFairBySlugCached(fairSlug),
      getVendorsBySlugCached(fairSlug),
      getCustomerFeeTerms(),
    ])

    if (dbFair) {
      initialFair = { ...dbFair, feeTerms }
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
