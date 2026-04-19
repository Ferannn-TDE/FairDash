import { redirect } from 'next/navigation'

export default function VendorRootPage({ params }: { params: { fairSlug: string } }) {
  redirect(`/vendor/${params.fairSlug}/dashboard`)
}
