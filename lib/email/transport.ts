// Email transport selection (Batch 1 item 9). The ONLY place that decides how email leaves.
//
//   log   — writes the full email to the process log, one line marked [email:log]. Local dev and
//           test ONLY. In production it can never be selected: resolveEmailTransport returns
//           'none' instead (scripts/notifications-test.ts proves it).
//   none  — no provider. Nothing is sent, nothing is logged, nothing is marked SENT: the outbox
//           holds rows with reason NO_EMAIL_PROVIDER until a real provider exists.
//
// A real provider later is a new kind here plus its credentials; callers don't change.

export type EmailTransportKind = 'log' | 'none'

export interface OutgoingEmail { to: string[]; subject: string; text: string }

export interface EmailTransport {
  kind: EmailTransportKind
  /** Can this transport deliver at all? 'none' can't: rows stay held. */
  canSend: boolean
  send(email: OutgoingEmail): Promise<void>
}

/** Production = NODE_ENV production (Vercel, the Railway worker, and a local `next start`). */
export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production'
}

/** EMAIL_TRANSPORT=log works only outside production; production with no provider is 'none'. */
export function resolveEmailTransport(env: Record<string, string | undefined> = process.env): EmailTransportKind {
  const requested = (env.EMAIL_TRANSPORT ?? '').trim().toLowerCase()
  if (isProductionRuntime(env)) return 'none' // no real provider exists yet; log is never allowed here
  return requested === 'none' ? 'none' : 'log'
}

export function getEmailTransport(env: Record<string, string | undefined> = process.env, log: (line: string) => void = console.log): EmailTransport {
  const kind = resolveEmailTransport(env)
  if (kind === 'log') {
    return {
      kind, canSend: true,
      async send(email) { log(`[email:log] to=${email.to.join(',')} subject=${JSON.stringify(email.subject)} text=${JSON.stringify(email.text)}`) },
    }
  }
  return { kind: 'none', canSend: false, async send() { throw new Error('No email provider is connected') } }
}
