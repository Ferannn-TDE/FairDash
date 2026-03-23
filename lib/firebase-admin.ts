import admin from 'firebase-admin'

// Prevent re-initialization across hot reloads in dev
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    })
  } else {
    console.warn('[Firebase Admin] Missing credentials — realtime features disabled')
  }
}

// Export typed handles — callers guard against undefined themselves
export const adminApp = admin.apps[0] ?? null

export function getRealtimeDb() {
  if (!adminApp) return null
  return admin.database()
}

export function getFirestore() {
  if (!adminApp) return null
  return admin.firestore()
}
