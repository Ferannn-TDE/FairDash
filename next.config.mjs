import { execSync } from 'node:child_process'

// Deploy fingerprint, baked at BUILD time. The health route used to read VERCEL_GIT_COMMIT_SHA
// at runtime, which went null on a deploy that didn't come through the Git integration — the
// field built to identify deploys was empty on the first deploy that needed identifying. Baking
// the value here (config is evaluated during the build, where git/CI metadata lives) with a
// fallback chain that ends in an honest 'unknown' means the fingerprint can never silently be
// null again: 'unknown' is a visible answer, null was a lie of omission.
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
    } catch {
      return null // no .git in the build context (e.g. a CLI upload) — fall through to 'unknown'
    }
  })() ??
  'unknown'

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    COMMIT_SHA: commitSha,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },
  // Unoptimized images — existing code uses plain <img> tags and public/ paths
  images: {
    unoptimized: true,
  },

  // Opt into Turbopack explicitly to silence the experimental flag conflict
  turbopack: {},

  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false }
    return config
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://js.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://maps.googleapis.com https://www.google.com https://*.firebaseio.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev https://*.supabase.co https://firebasestorage.googleapis.com https://maps.gstatic.com https://maps.googleapis.com https://lh3.googleusercontent.com",
              "font-src 'self' https://fonts.gstatic.com",
              "frame-src https://js.stripe.com https://hooks.stripe.com https://clerk.accounts.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://maps.google.com https://www.google.com https://maps.googleapis.com",
              "connect-src 'self' https://api.stripe.com https://r.stripe.com https://api.clerk.com https://*.clerk.com https://*.clerk.dev https://*.clerk.accounts.dev wss://*.clerk.accounts.dev https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.supabase.co https://*.firebaseio.com wss://*.firebaseio.com https://maps.googleapis.com",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
