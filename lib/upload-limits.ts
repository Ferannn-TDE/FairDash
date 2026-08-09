// UPLOAD LIMITS — the single source of truth for "how big may an upload be".
//
// WHY ONE MODULE. Before this file the cap existed in FOUR places and agreed with itself in
// none of them: 10 MB in lib/vendor-document-storage.ts, 10 MB again in
// lib/runner-license-storage.ts, a bare `10 * 1024 * 1024` literal in the vendor settings
// page, a local MAX_BYTES in LicenseCard, and the string "Max 5MB" in the menu page's JSX
// over an input that enforced nothing at all. Four numbers, one of them fiction. The rule
// now lives here and every call site — server AND client — reads it, so the message a user
// sees and the limit the server enforces cannot drift apart.
//
// WHY IT HAS NO IMPORTS. Client components import this file. Anything reachable from here is
// bundled into the browser, so it must not pull in ApiError → api-response → next/server.
// That is why rejections are UploadRejection (a plain Error subclass defined below) rather
// than ApiError: handleApiError() knows about it (see lib/api-error.ts), so routes still just
// `catch (err) { return handleApiError(err) }` and get the right status and code.
//
// WHY 4 MB AND NOT 5. Vercel caps a serverless function's REQUEST BODY at ~4.5 MB. A 5 MB
// app-level cap on a through-server route is unreachable: the platform 413s the request
// before the handler runs, so the user gets an opaque network failure instead of our
// FILE_TOO_LARGE. 4 MB sits under the platform ceiling, which means our error message is the
// one people actually see. Verified against stored data before narrowing: the largest object
// in any bucket was 0.69 MB, so nothing existing is stranded by this.
//
// WHAT THIS FILE CANNOT DO. It cannot cap the delivery-proof photo. That upload never passes
// through our server — the client PUTs it straight to Supabase with a presigned URL — so the
// only enforcement there is the bucket's own file_size_limit. See app/api/storage/upload.

/** The cap. This is the ONLY `1024 * 1024` literal in the codebase — scripts/upload-cap-guard.ts enforces that. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/** Same number, for prose. Derived, so it can never disagree with the bytes. */
export const UPLOAD_MAX_MB = UPLOAD_MAX_BYTES / 1024 / 1024

/** Compliance documents: a scan or a photo of one. */
export const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

/** Photographs only — proof-of-delivery, menu items. No PDFs. */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

/** `accept=` attribute values, derived from the allowlists so the picker and the server agree. */
export const ACCEPT_DOC = [...ALLOWED_DOC_MIME].join(',')
export const ACCEPT_IMAGE = [...ALLOWED_IMAGE_MIME].join(',')

export const FILE_TOO_LARGE = 'FILE_TOO_LARGE'
export const INVALID_MIME = 'INVALID_MIME'

/** The one wording for "too big", used by every client and every route. */
export const uploadTooLargeMessage = (): string =>
  `File must be ${UPLOAD_MAX_MB} MB or smaller`

export const invalidMimeMessage = (allowed: ReadonlySet<string>): string =>
  allowed.has('application/pdf')
    ? 'File must be a PDF or image (JPEG, PNG, WebP)'
    : 'File must be an image (JPEG, PNG, WebP)'

/**
 * A rejected upload. Carries the HTTP shape so handleApiError() can render it without every
 * route re-deciding what a too-large file means.
 */
export class UploadRejection extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message)
    this.name = 'UploadRejection'
  }
}

/**
 * Multipart framing (boundary lines, per-part headers, the filename) sits on top of the file
 * bytes, so a request carrying an exactly-at-cap file has a Content-Length slightly ABOVE the
 * cap. Without an allowance the early check would bounce a legitimate 4 MB file. Anything that
 * slips through this allowance is caught exactly by validateUpload() after the parse.
 */
const MULTIPART_FRAMING_ALLOWANCE = 16 * 1024

/**
 * EARLY, PRE-BUFFER check. Reject an obviously-oversized request BEFORE `req.formData()`
 * materialises the whole body in memory.
 *
 * This is deliberately NOT the authoritative check. Content-Length is supplied by the caller
 * and is absent entirely under chunked transfer encoding, so it can be lied about or omitted
 * — a check that trusted it alone would be bypassed by anyone who bothered. Its value is
 * timing: it is the only hook this shape offers before the body is buffered. The Web FormData
 * API gives no way to abort a parse mid-stream, so without this a 500 MB POST would be fully
 * resident in memory before we looked at `file.size`. Coarse filter first, exact check after.
 */
export function assertUploadSize(req: { headers: { get(name: string): string | null } }): void {
  const raw = req.headers.get('content-length')
  if (!raw) return // chunked / absent — nothing to check early; validateUpload() still runs
  const declared = Number(raw)
  if (!Number.isFinite(declared)) return
  if (declared > UPLOAD_MAX_BYTES + MULTIPART_FRAMING_ALLOWANCE) {
    throw new UploadRejection(uploadTooLargeMessage(), 413, FILE_TOO_LARGE)
  }
}

/**
 * AUTHORITATIVE check, run after the body is parsed. `file.size` is measured from the bytes
 * actually received, so unlike Content-Length it cannot be misreported.
 */
export function validateUpload(
  file: unknown,
  { allowedMime }: { allowedMime: ReadonlySet<string> },
): asserts file is Blob {
  if (!(file instanceof Blob)) {
    throw new UploadRejection('file is required', 400, 'VALIDATION_ERROR')
  }
  assertAllowedMime(file.type, allowedMime)
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new UploadRejection(uploadTooLargeMessage(), 400, FILE_TOO_LARGE)
  }
}

/**
 * MIME allowlist on its own — for the presigned-upload route, which only ever sees a declared
 * content type and never the file.
 */
export function assertAllowedMime(type: string | undefined | null, allowed: ReadonlySet<string>): void {
  if (!type || !allowed.has(type)) {
    throw new UploadRejection(invalidMimeMessage(allowed), 400, INVALID_MIME)
  }
}

/** Client-side convenience — same number, no throwing. Courtesy UX, never the boundary. */
export function isWithinUploadCap(size: number): boolean {
  return size <= UPLOAD_MAX_BYTES
}

/**
 * A URL, not a payload. Menu items carry an `imageUrl` STRING in a JSON body, and an
 * unvalidated string field is a size cap with a door left open: `data:image/png;base64,…`
 * smuggles an arbitrarily large image past every multipart check in this file, because no file
 * upload is involved at all. Same for `blob:`, which additionally is meaningless server-side —
 * it references memory in one browser tab and is dead the moment that tab closes (writing one
 * to the database is how menu images came to be stored as permanently-broken links).
 *
 * So: a bounded-length reference to somewhere the image actually lives.
 */
export const IMAGE_URL_MAX_CHARS = 2048

export function assertSafeImageUrl(value: unknown): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'string') {
    throw new UploadRejection('imageUrl must be a string URL', 400, 'VALIDATION_ERROR')
  }
  if (value.length > IMAGE_URL_MAX_CHARS) {
    throw new UploadRejection(
      `imageUrl must be a link under ${IMAGE_URL_MAX_CHARS} characters, not embedded image data`,
      400,
      FILE_TOO_LARGE,
    )
  }
  const scheme = value.slice(0, value.indexOf(':') + 1).toLowerCase()
  if (scheme === 'data:' || scheme === 'blob:') {
    throw new UploadRejection(
      'imageUrl must be a link to a stored image, not embedded or in-browser image data',
      400,
      'VALIDATION_ERROR',
    )
  }
  // Allowed: an absolute http(s) link, or an app-relative path like /images/x.png.
  if (value.startsWith('/')) return
  if (/^https?:\/\//i.test(value)) return
  throw new UploadRejection('imageUrl must be an http(s) URL or an app-relative path', 400, 'VALIDATION_ERROR')
}
