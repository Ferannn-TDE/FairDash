// TRIPWIRE REPORT — run after verify-all in CI: `node scripts/ci/tripwire-report.mjs <tripwire.log>`.
//
// Fails (exit 1) unless BOTH hold:
//   1. every suite registered in scripts/verify-all.ts logged "loaded" — the tripwire was really inside it
//      (a run with zero refusals proves nothing if the tripwire never loaded);
//   2. no process logged a refused outbound connection.
// Suites commented out of verify-all (e.g. refund-engine) are not registered and not expected.
import { readFileSync } from 'node:fs'

const logPath = process.argv[2]
if (!logPath) { console.error('usage: node scripts/ci/tripwire-report.mjs <tripwire.log>'); process.exit(2) }

const src = readFileSync('scripts/verify-all.ts', 'utf8')
const registered = src.split('\n')
  .filter(l => !/^\s*\/\//.test(l))
  .map(l => /file:\s*'([^']+)'/.exec(l)?.[1])
  .filter(Boolean)

let lines = []
try { lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean) } catch { /* missing log = nothing loaded */ }
const loaded = new Set(lines.filter(l => l.split(' ')[1] === 'loaded').map(l => l.split(' ').slice(2).join(' ')))
const refused = lines.filter(l => l.split(' ')[1] !== 'loaded')

const missing = registered.filter(f => ![...loaded].some(s => s.endsWith(f)))
console.log(`network tripwire: ${registered.length} registered suites; tripwire loaded in ${registered.length - missing.length}; refused connections: ${refused.length}`)
for (const f of missing) console.log(`  ❌ tripwire NOT loaded in ${f}`)
for (const r of refused) console.log(`  ❌ refused: ${r}`)
if (missing.length || refused.length) process.exit(1)
console.log('  ✅ every suite ran with the tripwire in place, and none reached the network')
