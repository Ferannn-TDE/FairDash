import PitchVideo from '@/app/_components/PitchVideo'
import { getVideoSlot } from '@/lib/videos'

// The partner video (item 1.15), above the form. Renders nothing until video.partnerPitch.url is
// set in /admin/settings, so until then the form sits directly under the points.
export default async function PartnerVideoSlot() {
  const video = await getVideoSlot('partnerPitch')
  return <PitchVideo source={video} label="FairSynq for partner organizations" className="mt-8" />
}
