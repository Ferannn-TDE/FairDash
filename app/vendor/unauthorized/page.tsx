import Link from 'next/link'

// Terminal state for wrong-role access to the Vendor Portal. Mirrors
// app/organizer/unauthorized. The vendor route guard (Step 5) redirects here;
// it is a dead end on purpose — never a link back to a login that would bounce.
export default function VendorUnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-center px-5">
      <div>
        <h1 className="font-bebas text-5xl text-white tracking-wide mb-3">Access Restricted</h1>
        <p className="text-[#666] font-inter mb-6 max-w-md">The Vendor Portal is for approved vendors only. Apply to become a vendor or contact your event organizer to get added.</p>
        <Link href="/" className="px-6 py-3 bg-[#FF0077] text-white font-semibold rounded-xl hover:bg-[#e0006b] transition-colors">
          Back to FairSynq
        </Link>
      </div>
    </div>
  )
}
