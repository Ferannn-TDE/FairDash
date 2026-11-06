/**
 * Create the vendor sign-up holding event (Batch 1 item 5b). Dry run unless --confirm.
 *
 *   Local dev:   ./scripts/with-dev-db.sh npx tsx scripts/create-signup-event.ts --organizer-email you@x.com [--confirm]
 *   Production:  ONLY after the client has an APPROVED organizer account on www AND an explicit go-ahead:
 *                CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/create-signup-event.ts --organizer-email <client> --confirm
 *
 * Options: --name, --slug, --start YYYY-MM-DD, --end YYYY-MM-DD (defaults in lib/signup-event.ts).
 * Refuses (writing nothing) for an unknown, unapproved or suspended organizer, a second live
 * sign-up event, or a taken slug. Prints the target database host before doing anything.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '../lib/db'
import { createSignupEvent, planSignupEvent, SIGNUP_EVENT_DEFAULTS, SignupEventRefused } from '../lib/signup-event'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const organizerEmail = arg('organizer-email')
  if (!organizerEmail) throw new Error('Usage: create-signup-event.ts --organizer-email <email> [--confirm]')
  const input = {
    organizerEmail,
    name: arg('name') ?? SIGNUP_EVENT_DEFAULTS.name,
    slug: arg('slug') ?? SIGNUP_EVENT_DEFAULTS.slug,
    startDate: new Date(`${arg('start') ?? SIGNUP_EVENT_DEFAULTS.start}T00:00:00-06:00`),
    endDate: new Date(`${arg('end') ?? SIGNUP_EVENT_DEFAULTS.end}T23:59:59-06:00`),
  }
  const host = (process.env.DATABASE_URL ?? '').replace(/^[^@]*@/, '').replace(/\/.*$/, '')
  console.log(`Target database: ${host || '(unset)'}`)

  const plan = await planSignupEvent(db, input)
  console.log(`Organizer: ${plan.organizer.name} (${plan.organizer.approvalStatus})`)
  console.log(`Event: "${input.name}" /${input.slug}, UPCOMING, SIGNUP_ONLY, ${input.startDate.toISOString()} → ${input.endDate.toISOString()}, no venue`)

  if (!process.argv.includes('--confirm')) {
    console.log('\nDry run: nothing written. Re-run with --confirm to create it.')
    return
  }
  const created = await createSignupEvent(db, input)
  console.log(`\nCreated ${created.urlSlug} (${created.id}) — ${created.status}, ${created.listing}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof SignupEventRefused ? `REFUSED (${e.code}): ${e.message}` : e)
    process.exit(1)
  })
