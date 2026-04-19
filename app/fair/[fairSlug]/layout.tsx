import { notFound } from 'next/navigation'
import FairShell from '../../_components/FairShell'
import { db } from '@/lib/db'
import { getFairBySlug } from '@/lib/mock'
import type { Metadata } from 'next'

interface Props {
  params: { fairSlug: string }
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const event = await db.event.findFirst({
      where: { urlSlug: params.fairSlug },
      select: { name: true, description: true },
    })
    if (event) {
      return {
        title: `${event.name} — FairSynq`,
        description: event.description ?? `Order food ahead at ${event.name} on FairSynq.`,
      }
    }
  } catch {
    // DB unavailable — fall through to mock
  }
  const mockFair = getFairBySlug(params.fairSlug)
  if (mockFair) return { title: `${mockFair.name} — FairSynq` }
  return { title: 'Fair not found — FairSynq' }
}

export default async function FairLayout({ params, children }: Props) {
  console.log('[FairLayout] fetching slug:', params.fairSlug)

  let eventExists = false

  try {
    const event = await db.event.findFirst({
      where: { urlSlug: params.fairSlug },
      select: { id: true },
    })
    eventExists = !!event
  } catch (err) {
    console.error('[FairLayout] database error for slug "%s":', params.fairSlug, err)
    // Fall through to mock check below
  }

  if (!eventExists) {
    const mockFair = getFairBySlug(params.fairSlug)
    if (!mockFair) {
      console.log('[FairLayout] fair not found for slug:', params.fairSlug)
      notFound()
    }
  }

  return (
    <FairShell fairSlug={params.fairSlug}>
      {children}
    </FairShell>
  )
}
