import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    // Deploy fingerprint: the served commit, so a deploy is never again proven
    // by content archaeology. Vercel injects VERCEL_GIT_COMMIT_SHA at build time.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    services: {
      // Will be updated to reflect live connectivity checks in Part 2+
      database: 'pending',
      stripe: 'pending',
      firebase: 'pending',
      redis: 'pending',
    },
  })
}
