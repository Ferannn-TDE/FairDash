// A JSON request body with a size cap (sign-up-fixes commit 4): the application routes (vendor,
// organizer, runner) refuse a body over the cap before parsing it, so nobody can make the server
// read or store megabytes of text through a sign-up form.
//
// The Content-Length header is checked first (cheap), then the body's real size in bytes (the
// header can be missing or wrong). Messages are fixed text; the pages show their own sentences
// by code (lib/toast-error.ts).

import { ApiError } from '@/lib/api-error'
import { APPLICATION_BODY_MAX_BYTES, PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_MESSAGE } from '@/lib/application-limits'

/** The parsed JSON object, or a thrown ApiError: 413 over the cap, 400 when it isn't a JSON object. */
export async function readJsonBody(req: Request, maxBytes: number = APPLICATION_BODY_MAX_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(PAYLOAD_TOO_LARGE_MESSAGE, 413, PAYLOAD_TOO_LARGE)
  const text = await req.text()
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError(PAYLOAD_TOO_LARGE_MESSAGE, 413, PAYLOAD_TOO_LARGE)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ApiError('Invalid request', 400, 'VALIDATION_ERROR')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Invalid request', 400, 'VALIDATION_ERROR')
  return body as Record<string, unknown>
}
