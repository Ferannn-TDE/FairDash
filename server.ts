/**
 * FairSynq — Standalone Express Server (Render deployment)
 *
 * Responsibilities:
 *   1. Clerk webhook handler  (/api/webhooks/clerk)
 *   2. Stripe webhook handler (/api/webhooks/stripe)
 *   3. BullMQ order-worker    (order timeout jobs)
 *   4. Health check           (/health)
 *
 * All regular API routes (/api/orders, /api/vendors, etc.) continue to run
 * as Next.js serverless functions on Vercel — they rely on @clerk/nextjs/server
 * and next/headers which are Next.js-specific APIs unavailable here.
 *
 * Webhook URLs to configure:
 *   Clerk Dashboard  → https://fairdash-api.onrender.com/api/webhooks/clerk
 *   Stripe Dashboard → https://fairdash-api.onrender.com/api/webhooks/stripe
 *
 * Start via:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' server.ts
 */

import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { Webhook } from 'svix'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'
import admin from 'firebase-admin'

// ─── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'

// ─── Prisma ──────────────────────────────────────────────────────────────────
// Use DIRECT_URL for the persistent server to bypass pgbouncer's
// prepared-statement limitations that apply to long-lived connections.

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  },
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})

// ─── Stripe ──────────────────────────────────────────────────────────────────

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
  typescript: true,
})

// ─── Firebase Admin ──────────────────────────────────────────────────────────

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    })
    console.log('[Firebase Admin] Initialized')
  } else {
    console.warn('[Firebase Admin] Missing credentials — realtime features disabled')
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express()

// CORS — allow the Vercel frontend and any configured origin
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server) and the configured frontend
      const allowed = [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001']
      if (!origin || allowed.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'fairdash-api', timestamp: new Date().toISOString() })
})

// ─── Clerk Webhook ────────────────────────────────────────────────────────────
// Receives raw body — MUST be mounted before express.json()

app.post(
  '/api/webhooks/clerk',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not set')
      return res.status(500).json({ error: 'Webhook secret not configured' })
    }

    const svixId = req.headers['svix-id'] as string | undefined
    const svixTimestamp = req.headers['svix-timestamp'] as string | undefined
    const svixSignature = req.headers['svix-signature'] as string | undefined

    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: 'Missing svix headers' })
    }

    const rawBody = req.body.toString('utf-8')

    type ClerkPayload = {
      type: string
      data: {
        id: string
        email_addresses: Array<{ email_address: string; id: string }>
        primary_email_address_id: string
        first_name: string | null
        last_name: string | null
        phone_numbers?: Array<{ phone_number: string }>
      }
    }

    let event: ClerkPayload
    try {
      const wh = new Webhook(webhookSecret)
      event = wh.verify(rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkPayload
    } catch {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const { type, data } = event

    try {
      switch (type) {
        case 'user.created':
        case 'user.updated': {
          const primaryEmail = data.email_addresses.find(
            (e) => e.id === data.primary_email_address_id
          )?.email_address

          if (!primaryEmail) {
            return res.status(400).json({ error: 'No primary email on user' })
          }

          const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null
          const phone = data.phone_numbers?.[0]?.phone_number ?? null

          await prisma.user.upsert({
            where: { clerkId: data.id },
            create: { clerkId: data.id, email: primaryEmail, name, phone },
            update: { email: primaryEmail, name, phone },
          })

          console.log(`[Clerk Webhook] ${type} → synced user ${data.id}`)
          break
        }

        case 'user.deleted': {
          const existing = await prisma.user.findUnique({ where: { clerkId: data.id } })
          if (existing) {
            await prisma.user.delete({ where: { clerkId: data.id } })
            console.log(`[Clerk Webhook] user.deleted → removed user ${data.id}`)
          }
          break
        }

        default:
          console.log(`[Clerk Webhook] Unhandled event type: ${type}`)
      }

      return res.json({ received: true })
    } catch (err) {
      console.error('[Clerk Webhook] Handler error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set')
      return res.status(500).json({ error: 'Webhook secret not configured' })
    }

    const signature = req.headers['stripe-signature'] as string | undefined
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' })
    }

    const rawBody = req.body as Buffer

    let event: Stripe.Event
    try {
      event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err)
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as Stripe.PaymentIntent
        await prisma.order.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { stripeChargeId: (pi.latest_charge as string | null) ?? undefined },
        })
        console.log(`[Stripe Webhook] payment_intent.succeeded → ${pi.id}`)

      } else if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object as Stripe.PaymentIntent
        await prisma.order.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { status: 'CANCELLED', cancelledBy: 'system', cancellationReason: 'Payment failed' },
        })
        console.log(`[Stripe Webhook] payment_intent.payment_failed → ${pi.id}`)

      } else if (event.type === 'transfer.created') {
        const transfer = event.data.object as Stripe.Transfer
        const meta = transfer.metadata as Record<string, string>
        if (meta?.vendorId && meta?.eventId) {
          const gross = transfer.amount / 100
          const fee = parseFloat(meta.fairSynqFee ?? '0')
          await prisma.payout.upsert({
            where: { stripeTransferId: transfer.id },
            create: {
              vendorId: meta.vendorId,
              eventId: meta.eventId,
              grossAmount: gross,
              fairSynqFee: fee,
              netAmount: gross - fee,
              stripeTransferId: transfer.id,
              stripeStatus: 'pending',
            },
            update: {},
          })
        }
        console.log(`[Stripe Webhook] transfer.created → ${transfer.id}`)

      } else if ((event.type as string) === 'transfer.paid') {
        const obj = event.data.object as { id: string }
        await prisma.payout.updateMany({
          where: { stripeTransferId: obj.id },
          data: { stripeStatus: 'paid', processedAt: new Date() },
        })
        console.log(`[Stripe Webhook] transfer.paid → ${obj.id}`)

      } else {
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
      }

      return res.json({ received: true })
    } catch (err) {
      console.error('[Stripe Webhook] Handler error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  // Verify DB connection
  try {
    await prisma.$connect()
    console.log('[Server] Database connected')
  } catch (err) {
    console.error('[Server] Database connection failed:', err)
    process.exit(1)
  }

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[Server] FairSynq API running on port ${PORT}`)
    console.log(`[Server] CORS allowed origin: ${FRONTEND_URL}`)
  })
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received — shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})
