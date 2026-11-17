// Video slots (item 12, B1.15): the settings each placement reads. Server only.
// Cached with the 'videos' tag; app/api/admin/settings revalidates it when a video.* key is
// saved, so a new link shows on the next page load. A slot with no URL reads as null and
// <PitchVideo> renders nothing.
import { unstable_cache } from 'next/cache'
import { getSetting } from '@/lib/settings'

// phoneUrl / phonePosterUrl: the optional phone cut (BATCH-1 §21 Q6); lib/video-pick.ts chooses.
export interface VideoSource { url: string; posterUrl: string | null; phoneUrl?: string | null; phonePosterUrl?: string | null }
export type VideoSlot = 'vendorPitch' | 'partnerPitch' | 'organizerPitch'
export const VIDEOS_CACHE_TAG = 'videos'

// Keys are spelled out (not built from the slot name) so the settings test can see each reader.
// Only the vendor and organizer slots have a phone cut (no partner video exists yet).
const KEYS = {
  vendorPitch: { url: 'video.vendorPitch.url', poster: 'video.vendorPitch.posterUrl',
    phoneUrl: 'video.vendorPitch.phoneUrl', phonePoster: 'video.vendorPitch.phonePosterUrl' },
  partnerPitch: { url: 'video.partnerPitch.url', poster: 'video.partnerPitch.posterUrl' },
  organizerPitch: { url: 'video.organizerPitch.url', poster: 'video.organizerPitch.posterUrl',
    phoneUrl: 'video.organizerPitch.phoneUrl', phonePoster: 'video.organizerPitch.phonePosterUrl' },
} as const

async function readSlot(slot: VideoSlot): Promise<VideoSource | null> {
  const k = KEYS[slot]
  try {
    const [url, posterUrl, phoneUrl, phonePosterUrl] = await Promise.all([
      getSetting(k.url), getSetting(k.poster),
      'phoneUrl' in k ? getSetting(k.phoneUrl) : null,
      'phonePoster' in k ? getSetting(k.phonePoster) : null,
    ])
    // No main video = no slot, even if a phone cut is saved: the phone cut is an alternative.
    return url ? { url, posterUrl: posterUrl ?? null, phoneUrl: phoneUrl ?? null, phonePosterUrl: phonePosterUrl ?? null } : null
  } catch (err) {
    // A settings read failure must never take the page down: the slot just stays empty.
    console.error(`[videos] could not read ${slot}`, err)
    return null
  }
}

export const getVideoSlot = unstable_cache(readSlot, ['video-slot'], { revalidate: 300, tags: [VIDEOS_CACHE_TAG] })
