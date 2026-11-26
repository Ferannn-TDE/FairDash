// Email transport selection (Batch 1 item 9; Resend added in resend-email-v1, Nov 25). The ONLY
// place that decides how email leaves.
//
//   log    — writes the full email to the process log, one line marked [email:log]. Local dev and
//            test ONLY. In production it can never be selected: resolveEmailTransport returns
//            'none' instead (scripts/notifications-test.ts proves it).
//   none   — no provider. Nothing is sent, nothing is logged, nothing is marked SENT: the outbox
//            holds rows with reason NO_EMAIL_PROVIDER until a real provider exists.
//   resend — production ONLY, and only when EMAIL_TRANSPORT=resend. POSTs to Resend's REST API
//            with fetch (no SDK). Needs RESEND_API_KEY and EMAIL_FROM; EMAIL_REPLY_TO is optional.
//            Sends `text` and, when given, `html` (email-look-v1): one multipart email.
//            The from and reply-to addresses live ONLY in those env vars: no address is written in
//            this file (scripts/resend-transport-test.ts checks), so changing the sending address
//            is a settings change. Missing or malformed settings → canSend false plus ONE error
//            line naming the variables (never their values); the outbox keeps every row waiting.
//
// Never written to a log line or an error message: the API key, the email body, any address.
// Every EmailSendError message is safe to store in Notification.lastError.

export type EmailTransportKind = 'log' | 'none' | 'resend'

export interface OutgoingEmail {
  to: string[]
  subject: string
  text: string
  /** The HTML part (lib/email/layout.ts). Sent with `text`, so every email is multipart. */
  html?: string
  /** The same on every retry of one outbox row, so Resend never sends it twice (kept 24 hours). */
  idempotencyKey?: string
}

export interface EmailTransport {
  kind: EmailTransportKind
  /** Can this transport deliver at all? 'none' (or 'resend' with bad settings) can't: rows stay held. */
  canSend: boolean
  send(email: OutgoingEmail): Promise<void>
}

/**
 * How a failed send is handled by the outbox (lib/notifications.ts):
 *   retry        — Resend or the network had a problem: the usual 1/5/15/60-minute ladder.
 *   rate_limited — Resend said 429: wait, attempts not counted, stop this run.
 *   config       — OUR settings are wrong (401, 403, 422 invalid_from_address; Jordan, Nov 25):
 *                  wait, attempts not counted, stop this run. Never FAILED for a settings typo.
 *   permanent    — this email can never go out as it is: FAILED at once.
 */
export type EmailSendFailure = 'retry' | 'rate_limited' | 'config' | 'permanent'

export class EmailSendError extends Error {
  constructor(readonly failure: EmailSendFailure, message: string, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'EmailSendError'
  }
}

export const RESEND_API_URL = 'https://api.resend.com/emails'
/** Hard timeout on the Resend call (PRODUCTION_READINESS.md 5.1). */
export const RESEND_TIMEOUT_MS = 10_000

/** Production = NODE_ENV production (Vercel, the Railway worker, and a local `next start`). */
export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production'
}

/**
 * Production: 'resend' only when EMAIL_TRANSPORT says exactly that (case and spaces ignored);
 * anything else, unset included, is 'none' — so pushing code alone sends nothing.
 * Outside production: 'log' (or 'none' when asked) — local dev and tests can never reach Resend.
 */
export function resolveEmailTransport(env: Record<string, string | undefined> = process.env): EmailTransportKind {
  const requested = (env.EMAIL_TRANSPORT ?? '').trim().toLowerCase()
  if (isProductionRuntime(env)) return requested === 'resend' ? 'resend' : 'none'
  return requested === 'none' ? 'none' : 'log'
}

// ── Address shapes ──────────────────────────────────────────────────────────────────────────
/** Control characters (CR, LF, tab, …) and the Unicode line/paragraph separators. */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u
/** A local part, one @, a domain with a dot; no spaces, angle brackets or quotes. */
const BARE_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/
/** Name <address> — the name has at least one visible character and no angle brackets. */
const NAMED_ADDRESS = /^([^<>]*\S)\s*<([^<>]*)>$/

/** A sender line: a name then an address in angle brackets, or a bare address; no control characters anywhere. */
export function isSenderShape(value: string): boolean {
  if (CONTROL_CHARS.test(value)) return false
  const named = NAMED_ADDRESS.exec(value)
  return named ? BARE_ADDRESS.test(named[2]) : BARE_ADDRESS.test(value)
}

function isRecipientAddress(value: string): boolean {
  return !CONTROL_CHARS.test(value) && BARE_ADDRESS.test(value)
}

// ── Safety switch: EMAIL_SAFE_RECIPIENT_DOMAIN ─────────────────────────────────────────────
/** The one domain email may go to while testing, or null (no limit). A leading @ is ignored. */
export function safeRecipientDomain(env: Record<string, string | undefined> = process.env): string | null {
  const domain = (env.EMAIL_SAFE_RECIPIENT_DOMAIN ?? '').trim().toLowerCase().replace(/^@/, '')
  return domain || null
}

/** True when a safe domain is set and ANY address is outside it (exact domain, any case). */
export function outsideSafeDomain(to: string[], domain: string | null): boolean {
  if (!domain) return false
  return to.some(address => {
    const at = address.lastIndexOf('@')
    return at < 0 || address.slice(at + 1).trim().toLowerCase() !== domain
  })
}

// ── Resend ──────────────────────────────────────────────────────────────────────────────────
/** What is wrong with the Resend settings, naming variables only (never a value); null when fine. */
export function resendConfigProblem(env: Record<string, string | undefined>): string | null {
  const key = (env.RESEND_API_KEY ?? '').trim()
  const from = (env.EMAIL_FROM ?? '').trim()
  const replyTo = (env.EMAIL_REPLY_TO ?? '').trim()
  const missing = [!key && 'RESEND_API_KEY', !from && 'EMAIL_FROM'].filter(Boolean)
  if (missing.length) return `missing ${missing.join(', ')}`
  const malformed = [
    (CONTROL_CHARS.test(key) || /\s/.test(key)) && 'RESEND_API_KEY',
    !isSenderShape(from) && 'EMAIL_FROM',
    replyTo && !isSenderShape(replyTo) && 'EMAIL_REPLY_TO',
  ].filter(Boolean)
  return malformed.length ? `malformed ${malformed.join(', ')}` : null
}

/** Settings problems already reported by this process: one error line each, not one a minute. */
const reportedConfigProblems = new Set<string>()

/** Resend's error type (e.g. validation_error), only when it is a plain snake_case word. */
function resendErrorName(body: unknown): string {
  const name = (body as { name?: unknown } | null)?.name
  return typeof name === 'string' && /^[a-z0-9_]{1,64}$/.test(name) ? name : 'error'
}

/** Retry-After in whole seconds → milliseconds; anything else → undefined. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header || !/^\d{1,7}$/.test(header.trim())) return undefined
  return Number(header.trim()) * 1000
}

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json() } catch { return null }
}

function resendTransport(key: string, from: string, replyTo: string | null, fetchImpl: typeof fetch): EmailTransport {
  return {
    kind: 'resend',
    canSend: true,
    async send(email) {
      if (email.to.length === 0) throw new EmailSendError('permanent', 'Email refused: no recipient')
      if (!email.to.every(isRecipientAddress)) {
        throw new EmailSendError('permanent', 'Email refused: a recipient address has a line break, control character or bad shape')
      }
      if (CONTROL_CHARS.test(email.subject)) {
        throw new EmailSendError('permanent', 'Email refused: a line break or control character in the subject')
      }

      const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
      if (email.idempotencyKey) headers['Idempotency-Key'] = email.idempotencyKey
      const body = {
        from, to: email.to, subject: email.subject, text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }

      let res: Response
      try {
        res = await fetchImpl(RESEND_API_URL, {
          method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        })
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        throw new EmailSendError('retry', timedOut ? 'Resend request timed out' : 'Resend could not be reached')
      }

      const reply = await readJson(res)
      if (res.ok) {
        const id = (reply as { id?: unknown } | null)?.id
        // Never SENT without Resend's id: a 2xx with no id is treated as "didn't go through".
        if (typeof id !== 'string' || id.trim() === '') throw new EmailSendError('retry', `Resend ${res.status} reply had no email id`)
        return
      }

      const name = resendErrorName(reply)
      const label = `Resend ${res.status} ${name}`
      if (res.status === 429) throw new EmailSendError('rate_limited', label, retryAfterMs(res.headers.get('retry-after')))
      if (res.status === 401 || res.status === 403 || (res.status === 422 && name === 'invalid_from_address')) {
        throw new EmailSendError('config', label)
      }
      if (res.status === 409 && name === 'concurrent_idempotent_requests') throw new EmailSendError('retry', label)
      if (res.status >= 500) throw new EmailSendError('retry', label)
      throw new EmailSendError('permanent', label)
    },
  }
}

export interface TransportOptions {
  /** Replaced by tests; never a real network call in a test. */
  fetchImpl?: typeof fetch
  /** Where a settings problem is reported. Default console.error (console.log is stripped in production). */
  errorLog?: (line: string) => void
}

export function getEmailTransport(
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
  options: TransportOptions = {},
): EmailTransport {
  const kind = resolveEmailTransport(env)
  if (kind === 'log') {
    return {
      kind, canSend: true,
      // The HTML is long: only its size is logged (open scripts/email-preview.ts output to see it).
      async send(email) { log(`[email:log] to=${email.to.join(',')} subject=${JSON.stringify(email.subject)} text=${JSON.stringify(email.text)} html=${email.html ? `${email.html.length} chars` : 'none'}`) },
    }
  }
  if (kind === 'resend') {
    const problem = resendConfigProblem(env)
    if (problem) {
      if (!reportedConfigProblems.has(problem)) {
        reportedConfigProblems.add(problem)
        ;(options.errorLog ?? console.error)(`[email] EMAIL_TRANSPORT is resend but ${problem}; emails stay waiting`)
      }
      return { kind, canSend: false, async send() { throw new EmailSendError('config', `Resend settings: ${problem}`) } }
    }
    const replyTo = (env.EMAIL_REPLY_TO ?? '').trim()
    return resendTransport((env.RESEND_API_KEY ?? '').trim(), (env.EMAIL_FROM ?? '').trim(), replyTo || null, options.fetchImpl ?? fetch)
  }
  return { kind: 'none', canSend: false, async send() { throw new Error('No email provider is connected') } }
}
