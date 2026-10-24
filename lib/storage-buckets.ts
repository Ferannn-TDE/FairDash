// STORAGE BUCKETS — the single source of truth for every Supabase Storage bucket's settings.
//
// WHY ONE FILE. Until 2026-10-24 these settings lived only in the Supabase dashboard, set by
// hand, and the code merely READ them back (assertPrivateBucket in the three lib/*-storage.ts
// files). Nothing recorded what they should be, so a bucket could drift and only a guard run
// would notice. Now this file is the setting: scripts/apply-bucket-config.ts writes it to a
// project, and scripts/upload-cap-guard.ts checks a project against it.
// (docs/PRODUCTION_READINESS.md 2.5: the same file will seed the local storage stack.)
//
// The size cap and the allowed types are DERIVED from lib/upload-limits.ts, so the bucket can
// never disagree with the route that validates the same upload. For the delivery-proof photo
// and menu images (presigned, straight to Supabase) the bucket is the only enforcement there is.
//
// Like upload-limits, this file has no runtime imports beyond that one, so anything may read it.

import { ALLOWED_DOC_MIME, ALLOWED_IMAGE_MIME, UPLOAD_MAX_BYTES } from './upload-limits'

export interface BucketConfig {
  name: string
  /** Public = anyone with the URL can read. Only menu photos, which render as plain <img src>. */
  public: boolean
  fileSizeLimit: number
  allowedMimeTypes: string[]
}

export const STORAGE_BUCKETS: readonly BucketConfig[] = [
  { name: 'delivery-proofs',  public: false, fileSizeLimit: UPLOAD_MAX_BYTES, allowedMimeTypes: [...ALLOWED_IMAGE_MIME] },
  { name: 'vendor-documents', public: false, fileSizeLimit: UPLOAD_MAX_BYTES, allowedMimeTypes: [...ALLOWED_DOC_MIME] },
  { name: 'runner-documents', public: false, fileSizeLimit: UPLOAD_MAX_BYTES, allowedMimeTypes: [...ALLOWED_DOC_MIME] },
  { name: 'menu-images',      public: true,  fileSizeLimit: UPLOAD_MAX_BYTES, allowedMimeTypes: [...ALLOWED_IMAGE_MIME] },
]

/** What a live bucket record looks like (GET /storage/v1/bucket/:id), the fields we own. */
export interface LiveBucket {
  public?: boolean
  file_size_limit?: number | null
  allowed_mime_types?: string[] | null
}

/**
 * Every way a live bucket differs from its config, in words. Empty = matches. Type lists are
 * compared as sets: Supabase returns them in its own order.
 */
export function bucketDrift(want: BucketConfig, live: LiveBucket | null): string[] {
  if (!live) return ['bucket missing']
  const out: string[] = []
  if (live.public !== want.public) out.push(`public = ${live.public} (want ${want.public})`)
  if (live.file_size_limit !== want.fileSizeLimit) {
    out.push(`file_size_limit = ${live.file_size_limit ?? 'UNSET'} (want ${want.fileSizeLimit})`)
  }
  const have = new Set(live.allowed_mime_types ?? [])
  const missing = want.allowedMimeTypes.filter(t => !have.has(t))
  const extra = [...have].filter(t => !want.allowedMimeTypes.includes(t))
  if (!live.allowed_mime_types?.length) out.push(`allowed_mime_types = UNSET (want ${want.allowedMimeTypes.join(', ')})`)
  else if (missing.length || extra.length) {
    out.push(`allowed_mime_types missing [${missing.join(', ')}] extra [${extra.join(', ')}]`)
  }
  return out
}
