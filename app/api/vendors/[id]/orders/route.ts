import { NextRequest, NextResponse } from 'next/server'

// GET /api/vendors/:id/orders  ← DEPRECATED
// Redirects to /orders/active.
// Use /orders/active for the live kitchen queue.
// Use /orders/history for completed/cancelled orders (cursor-paginated).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const dest = new URL(req.url)
  dest.pathname = `/api/vendors/${id}/orders/active`
  return NextResponse.redirect(dest, { status: 308 })
}
