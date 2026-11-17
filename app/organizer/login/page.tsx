import RoleAuthCard from '@/app/_components/RoleAuthCard'
import { getVideoSlot } from '@/lib/videos'

// /organizer/login (BATCH-1 §21). Shows the organizer video slot (Q7). Copy: lib/signin-copy.ts.
export default async function OrganizerLoginPage() {
  const video = await getVideoSlot('organizerPitch')
  return <RoleAuthCard role="organizer" redirectTo="/organizer" video={video} videoLabel="FairSynq for fair and festival organizers" />
}
