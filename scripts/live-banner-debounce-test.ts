/**
 * Vendor dashboard — "Live updates paused" banner debounce.
 *
 * THE BUG: Firebase's `.info/connected` fires FALSE on every subscribe (it reports
 * disconnected until the socket handshake completes), then TRUE a few hundred ms later.
 * The banner rendered straight off that flag, so a full-width amber "Live updates paused —
 * reconnecting…" bar flashed on every login/refresh — for a connection that was never
 * broken.
 *
 * WHY IT MATTERS BEYOND THE FLICKER: a warning that fires when nothing is wrong trains the
 * vendor to ignore the one that matters. The fix is not "hide the flash" — it is "only warn
 * when something is actually wrong".
 *
 * This replays the real connection sequences against the same debounce rule the component
 * uses (grace window, cleared instantly on reconnect), and asserts what the vendor SEES.
 *
 * Run:  npx tsx scripts/live-banner-debounce-test.ts
 */

const GRACE_MS = 2500

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * The component's rule, extracted verbatim:
 *   connected      → clear the banner immediately (no grace)
 *   disconnected   → show it only if still disconnected after GRACE_MS
 * Returns whether the banner was EVER visible during the replayed sequence.
 */
function replay(events: Array<{ atMs: number; connected: boolean }>, untilMs: number) {
  let bannerShown = false
  let everShown = false
  let pendingShowAt: number | null = null

  // Step MILLISECOND-BY-MILLISECOND. An earlier version only evaluated at event
  // timestamps, which silently skipped the instant the setTimeout actually fires — so a
  // real outage that later recovered looked like it had never warned. The timer firing is
  // an event in its own right; the simulation has to model it as one.
  let connected = true // initial state: useState(true)
  const eventAt = new Map(events.map(e => [e.atMs, e.connected]))

  for (let now = 0; now <= untilMs; now++) {
    if (eventAt.has(now)) {
      connected = eventAt.get(now)!
      if (connected) {
        pendingShowAt = null      // clearTimeout — the blip resolved inside the window
        bannerShown = false       // cleared immediately on reconnect
      } else {
        pendingShowAt = now + GRACE_MS
      }
    }
    if (pendingShowAt !== null && now >= pendingShowAt) {
      bannerShown = true
      everShown = true
    }
  }
  return { bannerShown, everShown }
}

console.log('\n[1] THE BUG: the Firebase initial-handshake blip must NOT flash the banner')
// Real sequence on every load: listener attaches → false → true ~400ms later.
const handshake = replay([{ atMs: 0, connected: false }, { atMs: 400, connected: true }], 10_000)
assert(handshake.everShown === false, 'handshake blip (false → true in 400ms) NEVER shows the banner')
assert(handshake.bannerShown === false, 'and the banner is not showing at rest')

console.log('\n[2] a slower-but-still-normal handshake is also silent')
const slow = replay([{ atMs: 0, connected: false }, { atMs: 2000, connected: true }], 10_000)
assert(slow.everShown === false, '2.0s handshake (inside the 2.5s grace) stays silent')

console.log('\n[3] a REAL outage still warns — we did not just mute the banner')
const outage = replay([{ atMs: 0, connected: false }], 10_000)
assert(outage.everShown === true, 'a persistent disconnect DOES show the banner')
assert(outage.bannerShown === true, 'and it stays shown while still disconnected')

console.log('\n[4] a real outage that then recovers: warns, then clears immediately')
const recovered = replay([{ atMs: 0, connected: false }, { atMs: 6000, connected: true }], 10_000)
assert(recovered.everShown === true, 'the outage was surfaced while it lasted')
assert(recovered.bannerShown === false, 'and cleared the instant the connection came back (no grace on recovery)')

console.log('\n[5] a mid-session blip (drop + fast recover) does not nag')
const blip = replay(
  [{ atMs: 0, connected: true }, { atMs: 5000, connected: false }, { atMs: 5300, connected: true }],
  10_000,
)
assert(blip.everShown === false, 'a 300ms mid-session drop is not worth a full-width warning')

console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(60)}\n`)
process.exit(fail === 0 ? 0 : 1)
