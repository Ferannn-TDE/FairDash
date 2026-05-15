import { notFound } from 'next/navigation'
import FairShell from '../../_components/FairShell'
import { getFairBySlugCached, getVendorsBySlugCached } from '@/lib/fairs'
import { getFairBySlug, getVendorsByFairSlug } from '@/lib/mock'
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
    // DB unavailable — fall through to mock
  }
  const mockFair = getFairBySlug(fairSlug)
  if (mockFair) return { title: `${mockFair.name} — FairSynq` }
  return { title: 'Fair not found — FairSynq' }
}

function normalizeMock(slug: string, dbFair: FairData): FairData {
  const mock = getFairBySlug(slug)
  if (!mock) return dbFair
  return {
    ...dbFair,
    tagline: dbFair.tagline ?? mock.tagline,
    location: dbFair.location.address ? dbFair.location : mock.location,
    operatingHours: dbFair.operatingHours.open ? dbFair.operatingHours : mock.operatingHours,
    hours: dbFair.hours ?? mock.hours,
    admission: dbFair.admission ?? mock.admission,
    contact: dbFair.contact ?? mock.contact,
    admissionFree: dbFair.admissionFree || mock.admissionFree,
    contactEmail: dbFair.contactEmail ?? mock.contactEmail,
    website: dbFair.website ?? mock.website,
  }
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
      initialFair = normalizeMock(fairSlug, dbFair)
      initialVendors = dbVendors
    }
  } catch (err) {
    console.error('[FairLayout] DB error for slug "%s":', fairSlug, err)
    // Fall through to mock check
  }

  // If DB has no data, try mock; if no mock either → 404
  if (!initialFair) {
    const mockFair = getFairBySlug(fairSlug)
    if (!mockFair) notFound()
    // Layout renders — FairContext client-side will hydrate from mock
  }

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
