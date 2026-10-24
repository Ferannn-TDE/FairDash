/**
 * APPLY lib/storage-buckets.ts to a Supabase project's Storage buckets.
 *
 * Dry run by default: prints the project, then each bucket's drift from the config. `--apply`
 * writes the drifted buckets (PUT /storage/v1/bucket/:id) and then RE-READS every bucket; the
 * exit code comes from that re-read, never from the plan. Idempotent: a second run finds no
 * drift and writes nothing.
 *
 * The project comes from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment; nothing
 * here loads .env.local. Writing needs CONFIRM_STORAGE=<project ref> matching that URL, the same
 * receipt as CONFIRM_PROD_DB. It never creates or deletes a bucket, and never touches objects.
 *
 *   node --env-file=.env.prod.local --import tsx scripts/apply-bucket-config.ts            # dry run
 *   CONFIRM_STORAGE=<ref> node --env-file=.env.prod.local --import tsx scripts/apply-bucket-config.ts --apply
 */

import { STORAGE_BUCKETS, bucketDrift, type LiveBucket } from '../lib/storage-buckets'

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

async function readBucket(name: string): Promise<LiveBucket | null> {
  const res = await fetch(`${URL_}/storage/v1/bucket/${name}`, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY! } })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`read ${name}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  if (!URL_ || !KEY) { console.error('🛑 SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'); process.exit(1) }
  const ref = new URL(URL_).host.split('.')[0]
  console.log(`project ${ref}  mode ${APPLY ? 'APPLY' : 'dry run'}\n`)
  if (APPLY && process.env.CONFIRM_STORAGE !== ref) {
    console.error(`🛑 refusing to write: set CONFIRM_STORAGE=${ref} to confirm this project`)
    process.exit(1)
  }

  for (const want of STORAGE_BUCKETS) {
    const drift = bucketDrift(want, await readBucket(want.name))
    console.log(`${drift.length ? '✗' : '✓'} ${want.name}${drift.map(d => `\n    ${d}`).join('')}`)
    if (!APPLY || !drift.length) continue
    if (drift[0] === 'bucket missing') { console.log('    (not created: creating buckets is out of scope)'); continue }
    const res = await fetch(`${URL_}/storage/v1/bucket/${want.name}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: want.public, file_size_limit: want.fileSizeLimit, allowed_mime_types: want.allowedMimeTypes }),
    })
    console.log(`    PUT → HTTP ${res.status}`)
  }

  // Final state, re-read: the receipt.
  let bad = 0
  if (APPLY) console.log('\nre-read')
  for (const want of STORAGE_BUCKETS) {
    const drift = bucketDrift(want, await readBucket(want.name))
    if (drift.length) bad++
    if (APPLY) console.log(`${drift.length ? '✗' : '✓'} ${want.name}${drift.map(d => `\n    ${d}`).join('')}`)
  }
  console.log(`\n${bad ? `${bad} bucket(s) differ from lib/storage-buckets.ts` : 'all buckets match lib/storage-buckets.ts'}`)
  process.exit(bad ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
