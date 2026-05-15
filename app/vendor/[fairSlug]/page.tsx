import { redirect } from 'next/navigation'

export default async function VendorRootPage({ params }: { params: Promise<{ fairSlug: string }> }) {
  const { fairSlug } = await params
  redirect(`/vendor/${fairSlug}/dashboard`)
}
