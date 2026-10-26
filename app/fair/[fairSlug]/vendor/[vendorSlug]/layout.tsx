import type { Metadata } from 'next'
import { getVendorsBySlugCached } from '@/lib/fairs'
import { fairSubpageMetadata } from '../../_components/subpage-metadata'

type Params = Promise<{ fairSlug: string; vendorSlug: string }>

// A vendor's page at a fair: "<Vendor> · <Fair> | FairSynq". Only a browsable vendor (same gate
// as the vendor list) gets a name; anything else keeps the fair's metadata.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { fairSlug, vendorSlug } = await params
  const vendors = await getVendorsBySlugCached(fairSlug).catch(() => [])
  const vendor = vendors.find(v => v.slug === vendorSlug)
  if (!vendor) return {}
  const meta = await fairSubpageMetadata(fairSlug, vendor.name, `/vendor/${encodeURIComponent(vendor.slug)}`)
  return vendor.description ? { ...meta, description: vendor.description } : meta
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
