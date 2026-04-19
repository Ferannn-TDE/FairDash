/**
 * Firebase client SDK — App Router / SPA shared RTDB access.
 *
 * Graceful no-config fallback: if the NEXT_PUBLIC_FIREBASE_* env vars are
 * missing, getFirebaseApp() returns null and all callers skip real-time
 * features without throwing. Polling in TrackOrder continues as the fallback.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'

const config = {
  apiKey:      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
}

/**
 * Returns the singleton Firebase app, or null when not configured.
 * Safe to call multiple times — reuses the existing app on hot reloads.
 */
export function getFirebaseApp(): FirebaseApp | null {
  if (!config.apiKey || !config.databaseURL) return null
  return getApps().length > 0 ? getApp() : initializeApp(config)
}
