// Which file and poster a video slot plays (BATCH-1 §21 Q6). Pure, so the guard can pin it.
//
// Phones (narrower than PHONE_MAX_WIDTH) get the slot's phone cut when one is saved; everyone
// else, and phones without a phone cut, get the main (wide) file. The choice is made once, when
// PitchVideo is about to set its src, so only one file is ever downloaded.
// Poster: the phone poster with the phone cut, else the main poster (cropped to fit by
// object-fit: cover in PitchVideo).
import type { VideoSource } from '@/lib/videos'

export const PHONE_MAX_WIDTH = 639 // px; "under 640"
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`

export interface PickedVideo { src: string; poster: string | null; phoneCut: boolean }

export function pickVideo(source: VideoSource, isPhone: boolean): PickedVideo {
  if (isPhone && source.phoneUrl) {
    return { src: source.phoneUrl, poster: source.phonePosterUrl ?? source.posterUrl, phoneCut: true }
  }
  return { src: source.url, poster: source.posterUrl, phoneCut: false }
}
