/**
 * RESEND TRANSPORT (resend-email-v1, Nov 25) — real lib/email/transport.ts, fetch replaced by a fake.
 * No database, no network: every "Resend answer" below is built here.
 *
 *   [1] Which transport runs where: resend only in production AND only when asked; dev/test never
 *   [2] Settings: missing key / from, malformed from / reply-to → cannot send, ONE line naming
 *       the variables only (never a value)
 *   [3] The request: URL, method, headers, Idempotency-Key, from / reply_to / to / subject / text,
 *       and html when given (email-look-v1)
 *   [4] Refused before any network call: control characters in subject or address, no recipient
 *   [5] Resend's answers: 2xx needs an id; 429 waits; 5xx / 409-concurrent / network / timeout
 *       retry; 401 / 403 / 422 invalid_from_address are OUR settings; other 4xx are permanent
 *   [6] The key, the body and the addresses never appear in an error message or a log line
 *   [7] Safety switch helpers: EMAIL_SAFE_RECIPIENT_DOMAIN, exact domain match
 *   [8] No email address is written in lib/email/transport.ts (the from-address is a setting)
 *
 * Run:  npx tsx scripts/resend-transport-test.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
/** One section; an exception (e.g. a missing export in old code) is a failure, not a crash. */
async function section(title: string, body: () => Promise<void>) {
  console.log(`\n${title}`)
  try { await body() } catch (e) { fail++; console.log(`  ❌ section threw: ${e instanceof Error ? e.message : String(e)}`) }
}

// Made-up values. The key deliberately does not look like a real Resend key.
const KEY = 'rk-test-not-a-real-key-7Q2'
const FROM = 'FairSynq <support@fairsynq.com>'
const REPLY_TO = 'support@fairsynq.com'
const TO = 'pat@fairsynq.com'
const BODY_MARKER = 'BODY-MARKER-91c4'
const PROD = { NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_REPLY_TO: REPLY_TO }

interface Call { url: string; init: RequestInit }
/** A fake fetch that records each call and gives back one prepared answer. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return answer()
  }) as typeof fetch
  return { calls, impl }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const email = (over: Partial<{ to: string[]; subject: string; text: string; html: string; idempotencyKey: string }> = {}) =>
  ({ to: [TO], subject: 'Your FairSynq application', text: `Hi Pat ${BODY_MARKER}`, idempotencyKey: 'notification-abc123', ...over })

async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null } catch (e) { return e }
}

async function main() {
  const T: any = await import('../lib/email/transport')
  const isSendError = (e: unknown): e is { failure: string; message: string; retryAfterMs?: number } =>
    typeof T.EmailSendError === 'function' && e instanceof T.EmailSendError
  const allMessages: string[] = [] // every error message and log line seen, for [6]
  const errorLines: string[] = []
  const errorLog = (l: string) => { errorLines.push(l); allMessages.push(l) }
  const devLines: string[] = []
  const devLog = (l: string) => { devLines.push(l) }

  /** Send one email through a resend transport whose fetch gives `answer`. */
  async function sendWith(answer: () => Response | Promise<Response>, env: Record<string, string> = PROD, mail = email()) {
    const f = fakeFetch(answer)
    const t = T.getEmailTransport(env, devLog, { fetchImpl: f.impl, errorLog })
    const err = await caught(t.send(mail))
    if (err instanceof Error) allMessages.push(err.message)
    return { t, err, calls: f.calls }
  }

  await section('[1] Which transport runs where', async () => {
    assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend' }) === 'resend', 'production + EMAIL_TRANSPORT=resend → resend')
    assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: ' Resend ' }) === 'resend', 'case and spaces are ignored ( Resend )')
    assert(T.resolveEmailTransport({ NODE_ENV: 'production' }) === 'none', '[0] control: production with EMAIL_TRANSPORT unset → none (pushing code sends nothing)')
    assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' }) === 'none', 'production asking for log → still none')
    assert(T.resolveEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'resendx' }) === 'none', 'production with a near-miss value → none')
    assert(T.resolveEmailTransport({ NODE_ENV: 'development', EMAIL_TRANSPORT: 'resend' }) === 'log', 'local dev asking for resend → log (never reaches Resend)')
    assert(T.resolveEmailTransport({ NODE_ENV: 'test', EMAIL_TRANSPORT: 'resend' }) === 'log', 'tests asking for resend → log')
    assert(T.resolveEmailTransport({ NODE_ENV: 'development', EMAIL_TRANSPORT: 'none' }) === 'none', '[0] control: dev can still ask for none')
    const t = T.getEmailTransport(PROD, devLog, { fetchImpl: fakeFetch(() => json(200, { id: 'x' })).impl, errorLog })
    assert(t.kind === 'resend' && t.canSend === true, 'full settings in production → a resend transport that can send')
  })

  await section('[2] Settings missing or malformed', async () => {
    const before = errorLines.length
    const noKey = T.getEmailTransport({ ...PROD, RESEND_API_KEY: '' }, devLog, { errorLog })
    assert(noKey.kind === 'resend' && noKey.canSend === false, 'no RESEND_API_KEY → cannot send (rows stay waiting)')
    assert(errorLines.length === before + 1 && errorLines[before].includes('missing RESEND_API_KEY'), 'one error line naming RESEND_API_KEY')
    T.getEmailTransport({ ...PROD, RESEND_API_KEY: '   ' }, devLog, { errorLog })
    assert(errorLines.length === before + 1, 'the same problem again (every minute in the worker) → no second line')
    const e1 = await caught(noKey.send(email()))
    assert(isSendError(e1) && e1.failure === 'config', 'sending anyway → a settings error, never a send')

    const noFrom = T.getEmailTransport({ ...PROD, EMAIL_FROM: '' }, devLog, { errorLog })
    assert(noFrom.canSend === false && errorLines.some(l => l.includes('missing EMAIL_FROM')), 'no EMAIL_FROM → cannot send, line names EMAIL_FROM')

    const badFroms = [
      'FairSynq support@fairsynq.com',          // no angle brackets
      'FairSynq <sup port@fairsynq.com>',       // space inside the address
      'FairSynq <support@fairsynq>',            // no dot in the domain
      '<support@fairsynq.com>',                 // brackets with no name
      'support@fairsynq.com\r\nBcc: x@y.test',  // header injection
      'FairSynq <support@fairsynq.com',         // unclosed bracket
    ]
    for (const bad of badFroms) {
      const t = T.getEmailTransport({ ...PROD, EMAIL_FROM: bad }, devLog, { errorLog })
      assert(t.canSend === false, `malformed EMAIL_FROM ${JSON.stringify(bad)} → cannot send`)
    }
    assert(errorLines.filter(l => l.includes('malformed EMAIL_FROM')).length === 1, 'all those malformed from-addresses → one error line in total')
    for (const good of [FROM, 'support@fairsynq.com', '"FairSynq Team" <support@fairsynq.com>']) {
      const t = T.getEmailTransport({ ...PROD, EMAIL_FROM: good }, devLog, { errorLog })
      assert(t.canSend === true, `[0] control: well-formed EMAIL_FROM ${JSON.stringify(good)} → can send`)
    }
    const badReply = T.getEmailTransport({ ...PROD, EMAIL_REPLY_TO: 'support at fairsynq' }, devLog, { errorLog })
    assert(badReply.canSend === false && errorLines.some(l => l.includes('malformed EMAIL_REPLY_TO')), 'malformed EMAIL_REPLY_TO → cannot send, line names it')
    const badKey = T.getEmailTransport({ ...PROD, RESEND_API_KEY: 'abc\ndef' }, devLog, { errorLog })
    assert(badKey.canSend === false && errorLines.some(l => l.includes('malformed RESEND_API_KEY')), 'a key with a line break → cannot send')
    assert(errorLines.every(l => !l.includes(FROM) && !l.includes('support@') && !l.includes('abc')), 'settings lines name variables only, never a value')
  })

  await section('[3] The request sent to Resend', async () => {
    const { err, calls } = await sendWith(() => json(200, { id: '49a3999c-0ce1' }))
    assert(err === null && calls.length === 1, 'a 200 with an id → sent, one request')
    const c = calls[0]
    const h = (c?.init.headers ?? {}) as Record<string, string>
    const body = JSON.parse(String(c?.init.body ?? '{}'))
    assert(c?.url === 'https://api.resend.com/emails' && c.init.method === 'POST', 'POST https://api.resend.com/emails')
    assert(h.Authorization === `Bearer ${KEY}` && h['Content-Type'] === 'application/json', 'Bearer key and JSON content type')
    assert(h['Idempotency-Key'] === 'notification-abc123', 'Idempotency-Key is the outbox row key')
    assert(body.from === FROM, 'from = EMAIL_FROM exactly')
    assert(body.reply_to === REPLY_TO, 'reply_to = EMAIL_REPLY_TO')
    assert(JSON.stringify(body.to) === JSON.stringify([TO]) && body.subject === 'Your FairSynq application' && body.text === `Hi Pat ${BODY_MARKER}`, 'to, subject and text as given')
    assert(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['from', 'reply_to', 'subject', 'text', 'to']), 'no other fields in the body (no html given → no html field)')
    assert(c?.init.signal instanceof AbortSignal, 'the request carries a timeout signal')
    assert(T.RESEND_TIMEOUT_MS === 10_000, 'the timeout is 10 seconds')

    const noReply = await sendWith(() => json(200, { id: 'x' }), { ...PROD, EMAIL_REPLY_TO: '' })
    const nb = JSON.parse(String(noReply.calls[0]?.init.body ?? '{}'))
    assert(noReply.err === null && !('reply_to' in nb), 'EMAIL_REPLY_TO unset → no reply_to in the body')
    const other = await sendWith(() => json(200, { id: 'x' }), { ...PROD, EMAIL_FROM: 'Fair Team <hello@notifications.fairsynq.com>' })
    assert(JSON.parse(String(other.calls[0]?.init.body ?? '{}')).from === 'Fair Team <hello@notifications.fairsynq.com>', 'a different EMAIL_FROM is used as is (moving domains is a settings change)')

    // email-look-v1: the HTML part goes with the text (multipart).
    const HTML = `<!DOCTYPE html><p>Hi Pat ${BODY_MARKER}</p>`
    const withHtml = await sendWith(() => json(200, { id: 'x' }), PROD, { ...email(), html: HTML })
    const hb = JSON.parse(String(withHtml.calls[0]?.init.body ?? '{}'))
    assert(withHtml.err === null && hb.html === HTML && hb.text === `Hi Pat ${BODY_MARKER}`, 'html is sent exactly as given, next to text')
    assert(JSON.stringify(Object.keys(hb).sort()) === JSON.stringify(['from', 'html', 'reply_to', 'subject', 'text', 'to']), 'with html: no other fields in the body')
  })

  await section('[4] Refused before any network call', async () => {
    const cases: [string, ReturnType<typeof email>][] = [
      ['a line break in the subject', email({ subject: 'Hi\r\nBcc: x@y.test' })],
      ['a line break in an address', email({ to: [`${TO}\r\nBcc: x@y.test`] })],
      ['a space in an address', email({ to: ['pat @fairsynq.com'] })],
      ['a Unicode line separator in the subject', email({ subject: `Hi${String.fromCharCode(0x2028)}there` })],
      ['no recipient', email({ to: [] })],
    ]
    for (const [label, mail] of cases) {
      const { err, calls } = await sendWith(() => json(200, { id: 'x' }), PROD, mail)
      assert(isSendError(err) && err.failure === 'permanent' && calls.length === 0, `${label} → permanent, no request made`)
    }
  })

  await section('[5] What each Resend answer means', async () => {
    const expect = async (label: string, answer: () => Response | Promise<Response>, failure: string, message?: string) => {
      const { err } = await sendWith(answer)
      assert(isSendError(err) && err.failure === failure && (message === undefined || err.message === message),
        `${label} → ${failure}${message ? ` ("${message}")` : ''}`)
      return err
    }
    await expect('200 with no id', () => json(200, {}), 'retry', 'Resend 200 reply had no email id')
    await expect('200 with an empty id', () => json(200, { id: '  ' }), 'retry')
    await expect('200 that is not JSON', () => new Response('ok', { status: 200 }), 'retry')
    const r1 = await expect('429 rate_limit_exceeded with Retry-After 30', () => json(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '30' }), 'rate_limited', 'Resend 429 rate_limit_exceeded')
    assert(isSendError(r1) && r1.retryAfterMs === 30_000, 'the wait from Retry-After is kept (30 s)')
    const r2 = await expect('429 daily_quota_exceeded, no Retry-After', () => json(429, { name: 'daily_quota_exceeded' }), 'rate_limited')
    assert(isSendError(r2) && r2.retryAfterMs === undefined, 'no Retry-After → the outbox picks the wait')
    await expect('500 application_error', () => json(500, { name: 'application_error' }), 'retry', 'Resend 500 application_error')
    await expect('503 with no body', () => new Response('', { status: 503 }), 'retry', 'Resend 503 error')
    await expect('409 concurrent_idempotent_requests', () => json(409, { name: 'concurrent_idempotent_requests' }), 'retry')
    await expect('401 (wrong or revoked key)', () => json(401, { name: 'missing_api_key' }), 'config', 'Resend 401 missing_api_key')
    await expect('403 (domain not allowed)', () => json(403, { name: 'validation_error' }), 'config', 'Resend 403 validation_error')
    await expect('422 invalid_from_address', () => json(422, { name: 'invalid_from_address' }), 'config', 'Resend 422 invalid_from_address')
    await expect('[0] control: 422 missing_required_field', () => json(422, { name: 'missing_required_field' }), 'permanent', 'Resend 422 missing_required_field')
    await expect('400 validation_error', () => json(400, { name: 'validation_error', message: `Invalid \`to\` field: ${TO}` }), 'permanent', 'Resend 400 validation_error')
    await expect('409 invalid_idempotent_request', () => json(409, { name: 'invalid_idempotent_request' }), 'permanent')
    await expect('an error name that is not a plain word', () => json(400, { name: `bad ${TO}` }), 'permanent', 'Resend 400 error')
    await expect('the network failing', () => { throw new TypeError('fetch failed') }, 'retry', 'Resend could not be reached')
    await expect('the 10-second timeout firing', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }, 'retry', 'Resend request timed out')
  })

  await section('[6] Nothing secret or personal in errors and logs', async () => {
    assert(allMessages.length >= 20, `[0] control: the probe saw the messages above (${allMessages.length})`)
    assert(allMessages.every(m => !m.includes(KEY)), 'the API key appears in no error message or log line')
    assert(allMessages.every(m => !m.includes(BODY_MARKER)), 'the email body appears in none')
    assert(allMessages.every(m => !m.includes(TO) && !m.includes('support@')), 'no address appears in any')
    assert(devLines.length === 0, 'the resend transport writes nothing to the ordinary log')
  })

  await section('[7] Safety switch helpers', async () => {
    assert(T.safeRecipientDomain({}) === null && T.safeRecipientDomain({ EMAIL_SAFE_RECIPIENT_DOMAIN: '  ' }) === null, 'unset or blank → no limit')
    assert(T.safeRecipientDomain({ EMAIL_SAFE_RECIPIENT_DOMAIN: ' @FairSynq.com ' }) === 'fairsynq.com', 'spaces, a leading @ and capitals are tidied')
    const d = 'fairsynq.com'
    assert(T.outsideSafeDomain(['jordan@fairsynq.com'], d) === false, '[0] control: an address in the domain is allowed')
    assert(T.outsideSafeDomain(['Jordan@FairSynq.COM'], d) === false, 'any capitals are allowed')
    assert(T.outsideSafeDomain(['vendor@gmail.test'], d) === true, 'another domain → blocked')
    assert(T.outsideSafeDomain(['a@fairsynq.com.evil.test'], d) === true, 'a look-alike that ends differently → blocked')
    assert(T.outsideSafeDomain(['a@sub.fairsynq.com'], d) === true, 'a subdomain is not the same domain → blocked')
    assert(T.outsideSafeDomain(['a@fairsynq.com', 'b@gmail.test'], d) === true, 'one outside address blocks the whole email')
    assert(T.outsideSafeDomain(['no-at-sign'], d) === true, 'something that is not an address → blocked')
    assert(T.outsideSafeDomain(['vendor@gmail.test'], null) === false, 'no safe domain set → nothing blocked')
  })

  await section('[8] No address written in lib/email/transport.ts', async () => {
    const src = readFileSync(fileURLToPath(new URL('../lib/email/transport.ts', import.meta.url)), 'utf8')
    assert(src.length > 1000, '[0] control: the transport source was read')
    assert(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.test(src), 'no email address in the source')
    assert(!/fairsynq\.com/i.test(src), 'no fairsynq.com domain in the source')
    assert(src.includes('EMAIL_FROM') && src.includes('EMAIL_REPLY_TO'), 'from and reply-to come from EMAIL_FROM / EMAIL_REPLY_TO')
  })
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(() => {
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
