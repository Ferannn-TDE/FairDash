import { notFound } from 'next/navigation'
import FairShell from '../../_components/FairShell'
import { getFairBySlug } from '@/lib/mock'
import type { Metadata } from 'next'

interface Props {
  params: { fairSlug: string }
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fair = getFairBySlug(params.fairSlug)
  if (!fair) return { title: 'Fair not found — FairSynq' }
  return {
    title: `${fair.name} — FairSynq`,
    description: fair.description ?? `Order ahead at ${fair.name}`,
  }
}

export default function FairLayout({ params, children }: Props) {
  const fair = getFairBySlug(params.fairSlug)
  if (!fair) notFound()

  return (
    <FairShell fairSlug={params.fairSlug}>
      {children}
    </FairShell>
  )
}
