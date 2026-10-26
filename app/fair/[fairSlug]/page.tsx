import { getFairSeoBySlugCached } from '@/lib/fairs'
import { fairEventJsonLd, jsonLdScript } from '@/lib/seo'
import FairHomePage from './FairHome'

// The fair home page: the client storefront (FairHome.tsx) plus its schema.org Event, rendered
// on the server so crawlers and the Rich Results Test see it in the first HTML.
export default async function FairPage({ params }: { params: Promise<{ fairSlug: string }> }) {
  const { fairSlug } = await params
  const fair = await getFairSeoBySlugCached(fairSlug).catch(() => null)
  return (
    <>
      {fair && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(fairEventJsonLd(fair)) }} />}
      <FairHomePage />
    </>
  )
}
