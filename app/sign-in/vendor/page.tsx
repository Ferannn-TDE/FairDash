import RoleAuthCard from '@/app/_components/RoleAuthCard'
import { getVideoSlot } from '@/lib/videos'

// /sign-in/vendor (BATCH-1 §21). Server page: reads the vendor pitch video setting and hands it to
// the shared sign-in shell. Copy: lib/signin-copy.ts (VENDOR_PITCH word for word).
export default async function VendorSignInPage() {
  const video = await getVideoSlot('vendorPitch')
  return <RoleAuthCard role="vendor" redirectTo="/vendor" video={video} videoLabel="FairSynq for vendors" />
}
