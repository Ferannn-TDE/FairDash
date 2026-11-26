// NETWORK TRIPWIRE — loaded into every suite with NODE_OPTIONS="--import ./scripts/ci/network-tripwire.mjs".
//
// WHY: CI must never depend on (or flake on) a real network service — Stripe, Supabase, Slack, Resend,
// Upstash, Google. A suite that quietly reaches one passes on a laptop with keys in .env.local and
// fails (or worse, passes for the wrong reason) in CI. Stubbing each call is half the fix; this file
// is the other half: it REFUSES every outbound TCP connection that isn't to this machine, so a new
// network call fails loudly on its first run instead of drifting in.
//
// Allowed: loopback (localhost, 127.0.0.0/8, ::1), unix sockets, and the GitHub Actions service-
// container hostnames below (none are used today; services publish ports on localhost).
// Every refusal is printed to stderr and, when NETWORK_TRIPWIRE_LOG is set, appended to that file
// as "<pid> <host>:<port> <script>" so a full run can list exactly which suites tried the network, plus one
// "<pid> loaded <script>" line per process (scripts/ci/tripwire-report.mjs checks every suite logged it).
import net from 'node:net'
import { appendFileSync } from 'node:fs'

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|fairsynq-test-(db|redis|upstash))$/i
const origConnect = net.Socket.prototype.connect
const script = process.argv.slice(1).find(a => /\.(m?[jt]s)$/.test(a)) ?? process.argv[1] ?? '?'

function target(args) {
  const a = args[0]
  if (Array.isArray(a)) return target(a) // internal normalized form: [options, cb]
  if (a && typeof a === 'object') return { path: a.path, host: a.host ?? 'localhost', port: a.port }
  if (typeof a === 'string' && isNaN(Number(a))) return { path: a } // unix socket path
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a }
}

// Proof the tripwire is IN each process (a run with zero refusals means nothing unless every suite logged this line).
if (process.env.NETWORK_TRIPWIRE_LOG) { try { appendFileSync(process.env.NETWORK_TRIPWIRE_LOG, `${process.pid} loaded ${script}\n`) } catch {} }

net.Socket.prototype.connect = function (...args) {
  const t = target(args)
  if (!t.path && !LOCAL.test(String(t.host))) {
    const line = `${process.pid} ${t.host}:${t.port} ${script}`
    process.stderr.write(`[network-tripwire] REFUSED outbound connection to ${t.host}:${t.port} (${script})\n`)
    if (process.env.NETWORK_TRIPWIRE_LOG) { try { appendFileSync(process.env.NETWORK_TRIPWIRE_LOG, line + '\n') } catch {} }
    const err = Object.assign(new Error(`network-tripwire: outbound connection to ${t.host}:${t.port} refused in CI`), { code: 'ECONNREFUSED' })
    process.nextTick(() => this.destroy(err))
    return this
  }
  return origConnect.apply(this, args)
}
