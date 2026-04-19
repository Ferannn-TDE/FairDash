import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { HomeModernIcon, TruckIcon } from '@heroicons/react/24/outline'

interface Props {
  children: React.ReactNode
  params: { fairSlug: string }
}

export default async function RunnerLayout({ children, params }: Props) {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const dbUser = await db.user.findUnique({ where: { clerkId } })
  if (!dbUser) redirect('/')

  const event = await db.event.findUnique({
    where: { urlSlug: params.fairSlug },
    select: { id: true, name: true },
  })
  if (!event) redirect('/fairs')

  const runner = await db.runner.findUnique({ where: { userId: dbUser.id } })
  if (!runner || runner.eventId !== event.id) redirect('/fairs')

  const base = `/runner/${params.fairSlug}`

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg-dark/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-5 sm:px-[6%] h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <TruckIcon className="w-4 h-4 text-neon-pink" />
            <span className="font-bebas text-base tracking-widest text-white leading-none">
              RUNNER
            </span>
            <span className="text-text-gray text-xs hidden sm:block truncate max-w-[180px]">
              — {event.name}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={`${base}/dashboard`}
              className="flex items-center gap-1.5 text-sm font-medium text-text-gray hover:text-white transition-colors"
            >
              <HomeModernIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </div>
        </div>
      </nav>
      <div className="pt-14">{children}</div>
    </>
  )
}
