import { fairSubpageMetadata } from '../_components/subpage-metadata'

export async function generateMetadata({ params }: { params: Promise<{ fairSlug: string }> }) {
  return fairSubpageMetadata((await params).fairSlug, 'Vendors', '/vendors')
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
