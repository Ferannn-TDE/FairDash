// CLIENT-SIDE IMAGE DOWNSCALE — run before an upload, never instead of a cap.
//
// WHY THIS EXISTS. The proof-of-delivery photo is taken with `capture="environment"`, so it
// arrives at whatever resolution the phone's camera produces — 12–48 MP, routinely 3–6 MB and
// sometimes more. Enforcing a 4 MB cap on that raw file would reject real deliveries, and a
// rejected proof photo is not a cosmetic failure: proofPath is REQUIRED to mark an order
// DELIVERED (app/api/orders/[id]/status/route.ts), so a runner standing at a customer's door
// would be unable to close the job, and the payout that follows the delivery never happens.
//
// So the cap is not raised — the file is made smaller. A proof photo needs to be legible
// enough to show a bag on a doorstep, not archival: 1600px on the longest edge at JPEG 0.8
// puts a full-resolution camera photo comfortably under 1 MB while staying perfectly readable.
//
// This is a BEST-EFFORT transform. If the browser can't decode the image (unsupported format,
// a HEIC the canvas won't take), it returns the ORIGINAL file rather than throwing — the
// caller then checks it against the cap and can show an honest error. Downscaling is a way to
// avoid hitting the cap; it is never the thing that enforces it.

/** Longest edge, in px, after downscale. Legible for proof-of-delivery, small on the wire. */
export const DOWNSCALE_MAX_EDGE = 1600

/** JPEG quality. 0.8 is the usual knee — visually clean, a fraction of the bytes. */
export const DOWNSCALE_QUALITY = 0.8

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/**
 * Decode to something canvas can draw. createImageBitmap is the fast path and — importantly —
 * applies EXIF orientation with `imageOrientation: 'from-image'`, so a photo taken in portrait
 * doesn't come out sideways. Older/odd browsers fall back to an <img> + object URL.
 */
async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      /* fall through to the <img> path */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

function jpegName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '') || 'photo'
  return `${base}.jpg`
}

/**
 * Returns a downscaled JPEG, or the ORIGINAL file if it is already small enough, cannot be
 * decoded, or the re-encode came out no smaller (a tiny PNG can encode larger as JPEG —
 * shipping the bigger file to save a rule would be silly).
 */
export async function downscaleImage(
  file: File,
  { maxEdge = DOWNSCALE_MAX_EDGE, quality = DOWNSCALE_QUALITY }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const decoded = await decode(file)
  if (!decoded) return file

  try {
    const { source, width, height } = decoded
    if (!width || !height) return file

    const scale = Math.min(1, maxEdge / Math.max(width, height))
    // Already within bounds AND already small: nothing to gain from a re-encode.
    if (scale === 1 && file.type === 'image/jpeg') return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // White ground: a transparent PNG flattened onto JPEG would otherwise go black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', quality),
    )
    if (!blob || blob.size >= file.size) return file

    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
  } finally {
    decoded.release()
  }
}
