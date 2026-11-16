// Video slots (item 12, B1.15): the settings each placement reads. Server only.
// Cached with the 'videos' tag; app/api/admin/settings revalidates it when a video.* key is
// saved, so a new link shows on the next page load. A slot with no URL reads as null and
// <PitchVideo> renders nothing.
import { unstable_cache } from 'next/cache'
import { getSetting } from '@/lib/settings'

export interface VideoSource { url: string; posterUrl: string | null }
export type VideoSlot = 'vendorPitch' | 'partnerPitch' | 'organizerPitch'
export const VIDEOS_CACHE_TAG = 'videos'

// Keys are spelled out (not built from the slot name) so the settings test can see each reader.
const KEYS = {
  vendorPitch: ['video.vendorPitch.url', 'video.vendorPitch.posterUrl'],
  partnerPitch: ['video.partnerPitch.url', 'video.partnerPitch.posterUrl'],
  organizerPitch: ['video.organizerPitch.url', 'video.organizerPitch.posterUrl'],
} as const

async function readSlot(slot: VideoSlot): Promise<VideoSource | null> {
  const [urlKey, posterKey] = KEYS[slot]
  try {
    const [url, posterUrl] = await Promise.all([getSetting(urlKey), getSetting(posterKey)])
    return url ? { url, posterUrl: posterUrl ?? null } : null
  } catch (err) {
    // A settings read failure must never take the page down: the slot just stays empty.
    console.error(`[videos] could not read ${slot}`, err)
    return null
  }
}

export const getVideoSlot = unstable_cache(readSlot, ['video-slot'], { revalidate: 300, tags: [VIDEOS_CACHE_TAG] })
