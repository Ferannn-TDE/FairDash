import { getVideoSlot } from '@/lib/videos'
import VendorSignIn from './VendorSignIn'

// Server wrapper: reads the vendor pitch video setting (item 12) and hands it to the client page.
export default async function VendorSignInPage() {
  const video = await getVideoSlot('vendorPitch')
  return <VendorSignIn video={video} />
}
