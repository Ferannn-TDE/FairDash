import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { STRICT_ADMIN_ROLES } from '../lib/roles'

/**
 * Seed a DEV email+password ADMIN — so you can sign in as admin without OAuth.
 *
 * Creates (idempotently): the Clerk user with a password, publicMetadata.roles = ['admin']
 * (the EXACT shape hasStrictAdminRole reads — plural array, not a singular `role`), and the
 * matching DB User row (the admin refund action looks the admin up by clerkId, so without it
 * refunds 404). Reuses the role-grant logic from grant-admin.ts.
 *
 * SECURITY GUARDRAILS — this is the highest-value credential in the system (full money
 * control across all fairs), so the script refuses to become the production hole:
 *   • REFUSES to run against a LIVE Clerk instance (sk_live_…). Dev/test only.
 *   • NEVER hardcodes a guessable password. Order: --password arg > TEST_ADMIN_PASSWORD env >
 *     a strong random one generated and printed ONCE. So no weak credential can survive in
 *     the repo, and copying this script to prod fails at the live-key guard, not silently.
 *
 * Usage:
 *   npx tsx scripts/seed-test-admin.ts [email] [--password <pw>]
 *   TEST_ADMIN_PASSWORD=... npx tsx scripts/seed-test-admin.ts testadmin@fairsynq.com
 *   (no password given → a strong one is generated and printed)
 */

const args = process.argv.slice(2)
const pwFlag = args.indexOf('--password')
const cliPassword = pwFlag !== -1 ? args[pwFlag + 1] : undefined
const email = args.find((a, i) => !a.startsWith('--') && i !== (pwFlag + 1)) ?? 'testadmin@fairsynq.com'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

async function main() {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret) throw new Error('CLERK_SECRET_KEY is not set')

  // ── GUARD: never seed a standing admin into a LIVE Clerk instance. ──────────
  if (secret.startsWith('sk_live')) {
    throw new Error(
      'REFUSING to seed a standing admin credential against a LIVE Clerk instance (sk_live_…). ' +
      'This account has full money control; a seeded dev credential must never exist in production. ' +
      'On live, create the admin manually with a strong password + 2FA, or keep admin on OAuth only.',
    )
  }

  // ── Password: arg > env > strong generated (printed once). Never hardcoded. ──
  const generated = !cliPassword && !process.env.TEST_ADMIN_PASSWORD
  const password = cliPassword ?? process.env.TEST_ADMIN_PASSWORD ?? `Adm!${randomBytes(12).toString('base64url')}`

  const clerk = createClerkClient({ secretKey: secret })

  // ── Clerk user: reuse if present, else create with the password. ────────────
  let user = (await clerk.users.getUserList({ emailAddress: [email] })).data[0]
  if (user) {
    console.log(`Clerk user already exists for ${email} (${user.id}) — reusing, not resetting the password.`)
  } else {
    try {
      user = await clerk.users.createUser({
        emailAddress: [email],
        password,
        publicMetadata: { roles: ['admin'] },
        skipPasswordChecks: true, // dev convenience; the live guard above is the real gate
      })
      console.log(`Created Clerk user ${email} (${user.id}) with a password.`)
    } catch (err: any) {
      // The most common cause: password auth is not enabled on the Clerk instance.
      throw new Error(
        `Clerk createUser failed: ${err?.errors?.[0]?.message ?? err?.message ?? err}. ` +
        'If it mentions password strategy/identifier, enable Password under Clerk → ' +
        'User & Authentication → Email, Phone, Username, then retry.',
      )
    }
  }

  // ── Role: ensure roles[] contains 'admin' (STRICT set the chokepoint reads). ─
  const meta = (user.publicMetadata ?? {}) as { roles?: string[] } & Record<string, unknown>
  const roles = Array.from(new Set([...(Array.isArray(meta.roles) ? meta.roles : []), 'admin']))
  await clerk.users.updateUserMetadata(user.id, { publicMetadata: { ...meta, roles } })
  const strict = roles.some(r => (STRICT_ADMIN_ROLES as readonly string[]).includes(r))
  console.log(`publicMetadata.roles = [${roles.join(', ')}]  (passes hasStrictAdminRole: ${strict})`)

  // ── DB User row: required by the admin refund action (looks admin up by clerkId). ─
  const dbUser = await prisma.user.upsert({
    where: { clerkId: user.id },
    create: { clerkId: user.id, email, name: 'Test Admin', role: 'admin' },
    update: { email, role: 'admin' },
    select: { id: true },
  })
  console.log(`DB User row ready (${dbUser.id}) — admin refund action can resolve this admin.`)

  console.log('\n────────────────────────────────────────────────────────')
  console.log('✅ DEV ADMIN READY')
  console.log(`   email:    ${email}`)
  if (generated) console.log(`   password: ${password}   ← generated, shown ONCE — save it now`)
  else           console.log(`   password: (the one you supplied)`)
  console.log('   → sign in with email + password; requireAdminFairContext will admit you.')
  console.log('⚠️  DEV ONLY — full money control. Never carry this account/password to production.')
  console.log('────────────────────────────────────────────────────────')
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (e) => { console.error('\n💥', e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1) })
