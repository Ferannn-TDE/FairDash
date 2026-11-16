import PitchVideo from '@/app/_components/PitchVideo'
import { getVideoSlot } from '@/lib/videos'

// The organizer video (item 1.15), under the intro and buttons on /organizers. Renders nothing until
// video.organizerPitch.url is set in /admin/settings. Held empty until a corrected cut arrives
// (BATCH-1 §21, Q4): the v2 cut makes claims the site can't back up yet.
export default async function OrganizerVideoSlot() {
  const video = await getVideoSlot('organizerPitch')
  return <PitchVideo source={video} label="FairSynq for fair and festival organizers" className="mt-8" />
}
