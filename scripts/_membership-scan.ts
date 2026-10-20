/**
 * MEMBERSHIP-CREATE SCANNER (readiness 1.9). Finds code that creates a Runner, VendorMember or
 * OrgMember row directly — any Prisma client, nested creates (multi-line), and raw SQL. Only
 * lib/payee-membership.ts may do that, because only it also adds the Clerk role; the cutover
 * seed and every other script must go through it. Used by scripts/role-reconcile-test.ts.
 */

import { stripComments } from './_strip-comments'

export const MEMBERSHIP_WRITER = 'lib/payee-membership.ts'

const PATTERNS: RegExp[] = [
  /\.\s*(runner|vendorMember|orgMember)\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g,
  /\b(vendorMembers|orgMembers|members)\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert)\b/g,
  /\brunner\s*:\s*\{\s*(create|connectOrCreate)\b/g,
  /INSERT\s+INTO\s+"?(Runner|VendorMember|OrgMember)"?/gi,
]

/** Each match is a direct create; line numbers are 1-based. */
export function findBareMembershipCreates(source: string): Array<{ line: number; text: string }> {
  const code = stripComments(source)
  const hits: Array<{ line: number; text: string }> = []
  for (const re of PATTERNS) {
    for (const m of code.matchAll(re)) {
      hits.push({ line: code.slice(0, m.index).split('\n').length, text: m[0].replace(/\s+/g, ' ') })
    }
  }
  return hits
}

/**
 * Test fixtures run only against the test database and build their own rows on purpose:
 * scripts named *-test, *-guard, *-proof or test-*. Plus the Part B shadow cohorts, which seed
 * fake users with fake Clerk ids and are never part of a seed or cutover.
 */
const SHADOW_COHORTS = new Set([
  'scripts/b2-shadow-seed-and-verify.ts',
  'scripts/b3-shadow-seed-and-verify.ts',
  'scripts/b4-shadow-seed-and-verify.ts',
])
export function isTestFixture(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  if (!p.startsWith('scripts/')) return false
  if (SHADOW_COHORTS.has(p)) return true
  const name = p.slice('scripts/'.length)
  return !name.includes('/') && (/^test-/.test(name) || /-(test|guard|proof)\.ts$/.test(name))
}
