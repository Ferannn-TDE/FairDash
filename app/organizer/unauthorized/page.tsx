import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-center px-5">
      <div>
        <h1 className="font-bebas text-5xl text-white tracking-wide mb-3">Access Restricted</h1>
        <p className="text-[#666] font-inter mb-6 max-w-md">The Organizer Portal is for verified fair organizers only. Contact us to request access.</p>
        <Link href="/" className="px-6 py-3 bg-[#FF0077] text-white font-semibold rounded-xl hover:bg-[#e0006b] transition-colors">
          Back to FairSynq
        </Link>
      </div>
    </div>
  )
}
