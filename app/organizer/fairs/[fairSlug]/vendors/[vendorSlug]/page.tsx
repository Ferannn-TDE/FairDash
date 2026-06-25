'use client'

import { useState, useEffect, use, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  CheckCircleIcon,
  XCircleIcon,
  PauseCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  BuildingStorefrontIcon,
  ClockIcon,
  ShoppingBagIcon,
  CurrencyDollarIcon,
  QueueListIcon,
  ArrowPathIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { getVendorStatusConfig } from '@/lib/order-status-config'
import { OrganizerBreadcrumb } from '@/app/organizer/_components/Breadcrumb'
import ConfirmModal from '@/app/_components/ui/ConfirmModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VendorMember { role: string; userId: string; name: string | null; email: string }
interface MenuItem {
  id: string; name: string; description: string | null; price: number
  category: string; imageUrl: string | null; prepTime: number
  isAvailable: boolean; variantGroup: string | null; variantLabel: string | null
}
interface PendingRequest {
  id: string; type: string; status: string; name: string | null
  price: number | null; category: string | null; imageUrl: string | null; createdAt: string
  menuItem: { name: string } | null
}
interface OrderRow {
  id: string; status: string; total: number; subtotal: number
  vendorPayout: number; fairSynqFee: number; placedAt: string
  customerName: string; fulfillmentType: string; itemSummary: string
}
interface FulfillmentRow { type: string; count: number; revenue: number }

interface VendorDetail {
  id: string; name: string; slug: string; description: string | null
  cuisineType: string; boothNumber: string | null; vendorType: string
  status: string; isOffline: boolean; isBusy: boolean
  stripeVerified: boolean; stripeConnectedAt: string | null
  createdAt: string; lastHeartbeatAt: string | null
  foodHandlerPermitUrl: string | null; insuranceUrl: string | null
  businessLicenseUrl: string | null; insuranceExpiryDate: string | null
  insuranceExpired: boolean; operatingHours: unknown; boothPhotoUrls: unknown
  fairId: string; fairName: string; fairSlug: string
  members: VendorMember[]; menuItems: MenuItem[]; pendingMenuRequests: PendingRequest[]
  orderCount: number; totalRevenue: number; totalPayout: number
  ordersToday: number; revenueToday: number
  fulfillmentBreakdown: FulfillmentRow[]
  orderHistory: OrderRow[]; nextOrderCursor: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  PLACED:           'bg-yellow-500/10 text-yellow-400',
  ACCEPTED:         'bg-yellow-500/10 text-yellow-400',
  PREPARING:        'bg-blue-500/10 text-blue-400',
  READY:            'bg-green-500/10 text-green-400',
  RUNNER_COLLECTED: 'bg-green-500/10 text-green-400',
  COMPLETED:        'bg-white/5 text-[#555]',
  DELIVERED:        'bg-white/5 text-[#555]',
  CANCELLED:        'bg-red-500/10 text-red-400',
  UNCOLLECTED:      'bg-orange-500/10 text-orange-400',
}

const FULFILLMENT_LABELS: Record<string, string> = {
  BOOTH_PICKUP:  'Booth Pickup',
  CURBSIDE:      'Curbside',
  HOME_DELIVERY: 'Home Delivery',
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  label, icon: Icon, variant, onClick, loading,
}: {
  label: string; icon: React.ElementType; variant: 'success' | 'danger' | 'warning' | 'neutral'
  onClick: () => void; loading?: boolean
}) {
  const cls = {
    success: 'border-green-500/30 text-green-400 hover:bg-green-500/10',
    danger:  'border-red-500/30 text-red-400 hover:bg-red-500/10',
    warning: 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10',
    neutral: 'border-white/10 text-[#888] hover:bg-white/5',
  }[variant]
  return (
    <button onClick={onClick} disabled={loading}
      className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold font-inter transition-colors disabled:opacity-40 cursor-pointer ${cls}`}>
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </button>
  )
}

// ─── Menu item row ────────────────────────────────────────────────────────────

function MenuItemRow({ item }: { item: MenuItem }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-white font-inter font-medium">{item.name}</span>
          {item.variantLabel && (
            <span className="text-[10px] text-[#555] font-inter">{item.variantLabel}</span>
          )}
          {!item.isAvailable && (
            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[9px] font-bold rounded uppercase">Sold out</span>
          )}
        </div>
        <p className="text-xs text-[#444] font-inter">
          {item.category} · {item.prepTime}m prep
        </p>
      </div>
      <span className="text-sm text-white font-inter tabular-nums shrink-0">${item.price.toFixed(2)}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ fairSlug: string; vendorSlug: string }>
}) {
  const { fairSlug, vendorSlug } = use(params)
  const router = useRouter()
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState<'PAUSED' | 'SUSPENDED' | null>(null)
  const [menuFilter, setMenuFilter] = useState<string>('ALL')

  const fetchVendor = useCallback(async (cursor?: string) => {
    const url = `/api/organizer/vendors/${vendorSlug}${cursor ? `?orderCursor=${cursor}` : ''}`
    const res  = await fetch(url)
    const json = await res.json()
    return json.data as VendorDetail | null
  }, [vendorSlug])

  useEffect(() => {
    fetchVendor().then(data => {
      if (!data) return
      setVendor(data)
      // Redirect cuid URLs to the canonical slug URL
      if (data.slug && data.slug !== vendorSlug) {
        router.replace(`/organizer/fairs/${fairSlug}/vendors/${data.slug}`)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [fetchVendor, fairSlug, vendorSlug, router])

  async function loadMoreOrders() {
    if (!vendor?.nextOrderCursor) return
    setLoadingMore(true)
    try {
      const data = await fetchVendor(vendor.nextOrderCursor)
      if (data) {
        setVendor(prev => prev ? {
          ...prev,
          orderHistory: [...prev.orderHistory, ...data.orderHistory],
          nextOrderCursor: data.nextOrderCursor,
        } : prev)
      }
    } catch {
      toast.error('Failed to load more orders')
    } finally {
      setLoadingMore(false)
    }
  }

  async function setStatus(status: string) {
    if (!vendor) return
    setActing(true)
    try {
      const res  = await fetch(`/api/organizer/vendors/${vendorSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (json.data) {
        setVendor(prev => prev ? { ...prev, status: json.data.status } : prev)
        const label = status === 'ACTIVE' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'updated'
        toast.success(`Vendor ${label}`)
      } else {
        toast.error(json.error?.message ?? 'Action failed')
      }
    } catch {
      toast.error('Action failed')
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="h-8 w-48 bg-white/5 rounded-lg animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-[#111111] rounded-2xl border border-white/5 p-6 animate-pulse h-32" />
        ))}
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="text-center py-20">
        <p className="text-[#666] font-inter">Vendor not found.</p>
        <Link href={`/organizer/fairs/${fairSlug}/vendors`} className="text-[#FF0077] text-sm mt-2 inline-block hover:underline">
          ← Back to vendors
        </Link>
      </div>
    )
  }

  const statusCfg = getVendorStatusConfig(vendor.status)

  // Menu categories for filter
  const menuCategories = ['ALL', ...Array.from(new Set(vendor.menuItems.map(i => i.category))).sort()]
  const filteredMenu = menuFilter === 'ALL' ? vendor.menuItems : vendor.menuItems.filter(i => i.category === menuFilter)

  return (
    <div className="max-w-5xl mx-auto">

      <OrganizerBreadcrumb crumbs={[
        { label: 'My Fairs', href: '/organizer/fairs' },
        { label: vendor.fairName, href: `/organizer/fairs/${fairSlug}` },
        { label: 'Vendors', href: `/organizer/fairs/${fairSlug}/vendors` },
        { label: vendor.name },
      ]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-bebas text-2xl text-white tracking-wide leading-none">{vendor.name}</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusCfg.color} ${statusCfg.textColor} ${statusCfg.borderColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotColor}`} />
              {statusCfg.label}
            </span>
          </div>
          <p className="text-[#555] text-xs font-inter mt-0.5">{vendor.fairName} · {vendor.cuisineType}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Main column ──────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: ShoppingBagIcon,  label: 'Today Orders', value: String(vendor.ordersToday),  accent: 'text-amber-400' },
              { icon: CurrencyDollarIcon, label: 'Today Revenue', value: `$${vendor.revenueToday.toFixed(0)}`, accent: 'text-emerald-400' },
              { icon: ShoppingBagIcon,  label: 'All Orders',   value: String(vendor.orderCount),   accent: 'text-blue-400'  },
              { icon: CurrencyDollarIcon, label: 'Total Revenue', value: `$${Math.round(vendor.totalRevenue).toLocaleString()}`, accent: 'text-[#FF0077]' },
            ].map(s => (
              <div key={s.label} className="bg-[#111111] border border-white/5 rounded-xl p-4">
                <s.icon className={`w-4 h-4 mb-2 ${s.accent}`} />
                <p className={`font-bebas text-xl leading-none ${s.accent}`}>{s.value}</p>
                <p className="text-[#444] text-[0.6rem] font-inter uppercase tracking-wider mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Vendor info */}
          <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
            <h2 className="font-bebas text-lg text-white tracking-wide flex items-center gap-2 mb-4">
              <BuildingStorefrontIcon className="w-4 h-4 text-[#FF0077]" />
              Vendor Info
            </h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {[
                { label: 'Cuisine',   value: vendor.cuisineType },
                { label: 'Booth',     value: vendor.boothNumber ?? '—' },
                { label: 'Type',      value: vendor.vendorType === 'OPTION_A' ? 'Self-service' : 'FairSynq managed' },
                { label: 'Stripe',    value: vendor.stripeVerified ? 'Verified' : 'Not connected',
                  cls: vendor.stripeVerified ? 'text-green-400' : 'text-[#555]' },
                { label: 'Last seen', value: vendor.lastHeartbeatAt ? timeAgo(vendor.lastHeartbeatAt) : '—' },
              ].map(f => (
                <div key={f.label}>
                  <dt className="text-[#444] text-[0.6rem] uppercase tracking-wider font-semibold mb-0.5">{f.label}</dt>
                  <dd className={`text-sm ${(f as { cls?: string }).cls ?? 'text-white'}`}>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Documents */}
          <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
            <h2 className="font-bebas text-lg text-white tracking-wide flex items-center gap-2 mb-4">
              <DocumentTextIcon className="w-4 h-4 text-[#FF0077]" />
              Documents
            </h2>
            <div className="divide-y divide-white/[0.04]">
              {[
                { label: 'Food Handler Permit', url: vendor.foodHandlerPermitUrl },
                { label: 'Insurance Certificate', url: vendor.insuranceUrl, expired: vendor.insuranceExpired,
                  expiry: vendor.insuranceExpiryDate },
                { label: 'Business License', url: vendor.businessLicenseUrl },
              ].map(doc => (
                <div key={doc.label} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <DocumentTextIcon className="w-3.5 h-3.5 text-[#444] shrink-0" />
                    <span className="text-sm text-white font-inter">{doc.label}</span>
                    {doc.expired && (
                      <span className="px-1.5 py-0.5 bg-red-500/15 text-red-400 text-[9px] font-bold rounded uppercase shrink-0">Expired</span>
                    )}
                  </div>
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#FF0077] hover:underline font-inter shrink-0">View →</a>
                  ) : (
                    <span className="text-xs text-[#333] font-inter shrink-0">Not uploaded</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Revenue breakdown */}
          {vendor.fulfillmentBreakdown.length > 0 && (
            <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
              <h2 className="font-bebas text-lg text-white tracking-wide flex items-center gap-2 mb-4">
                <CurrencyDollarIcon className="w-4 h-4 text-[#FF0077]" />
                Revenue Breakdown
              </h2>
              <div className="divide-y divide-white/[0.04]">
                {vendor.fulfillmentBreakdown.map(f => (
                  <div key={f.type} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm text-white font-inter">{FULFILLMENT_LABELS[f.type] ?? f.type}</span>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-xs text-[#555] font-inter tabular-nums">{f.count} orders</span>
                      <span className="text-sm text-white font-inter tabular-nums font-semibold">
                        ${f.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Menu items */}
          <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-bebas text-lg text-white tracking-wide flex items-center gap-2">
                <QueueListIcon className="w-4 h-4 text-[#FF0077]" />
                Menu <span className="text-[#555] font-inter text-sm font-normal ml-1">({vendor.menuItems.length} items)</span>
              </h2>
              {vendor.pendingMenuRequests.length > 0 && (
                <Link
                  href={`/organizer/fairs/${fairSlug}/menu-requests`}
                  className="text-xs text-amber-400 hover:underline font-inter shrink-0"
                >
                  {vendor.pendingMenuRequests.length} pending →
                </Link>
              )}
            </div>

            {/* Category filter */}
            {menuCategories.length > 2 && (
              <div className="flex gap-1 mb-4 overflow-x-auto scrollbar-none">
                {menuCategories.map(cat => (
                  <button key={cat} onClick={() => setMenuFilter(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold font-inter whitespace-nowrap transition-colors cursor-pointer ${
                      menuFilter === cat ? 'bg-white/10 text-white' : 'text-[#555] hover:text-[#888]'
                    }`}>
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {vendor.menuItems.length === 0 ? (
              <p className="text-[#555] text-sm font-inter">No menu items yet.</p>
            ) : (
              <div>
                {filteredMenu.map(item => <MenuItemRow key={item.id} item={item} />)}
              </div>
            )}
          </div>

          {/* Order history */}
          <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
            <h2 className="font-bebas text-lg text-white tracking-wide flex items-center gap-2 mb-4">
              <ClockIcon className="w-4 h-4 text-[#FF0077]" />
              Order History <span className="text-[#555] font-inter text-sm font-normal ml-1">({vendor.orderCount} total)</span>
            </h2>

            {vendor.orderHistory.length === 0 ? (
              <p className="text-[#555] text-sm font-inter">No orders yet.</p>
            ) : (
              <>
                <div className="divide-y divide-white/[0.04]">
                  {vendor.orderHistory.map(order => (
                    <div key={order.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs text-white font-inter font-semibold">#{order.id.slice(-6).toUpperCase()}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${ORDER_STATUS_COLORS[order.status] ?? ''}`}>
                            {order.status}
                          </span>
                          <span className="text-[10px] text-[#444] font-inter">{FULFILLMENT_LABELS[order.fulfillmentType] ?? order.fulfillmentType}</span>
                        </div>
                        <p className="text-[11px] text-[#444] font-inter truncate">
                          {order.customerName} · {timeAgo(order.placedAt)}
                        </p>
                        {order.itemSummary && (
                          <p className="text-[10px] text-[#333] font-inter truncate mt-0.5">{order.itemSummary}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm text-white font-inter tabular-nums">${order.total.toFixed(2)}</p>
                        <p className="text-[10px] text-[#444] font-inter tabular-nums">
                          ${order.vendorPayout.toFixed(2)} payout
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {vendor.nextOrderCursor && (
                  <button
                    onClick={() => void loadMoreOrders()}
                    disabled={loadingMore}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 border border-white/10 rounded-xl text-xs text-[#666] hover:text-white hover:bg-white/5 font-inter transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {loadingMore
                      ? <><ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> Loading…</>
                      : <><ChevronDownIcon className="w-3.5 h-3.5" /> Load more orders</>}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Status actions */}
          <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
            <h2 className="font-bebas text-lg text-white tracking-wide mb-4">Actions</h2>
            <div className="space-y-2">
              {vendor.status === 'PENDING' && (
                <>
                  <ActionButton label="Approve Vendor"    icon={CheckCircleIcon}       variant="success" loading={acting} onClick={() => setStatus('ACTIVE')}    />
                  <ActionButton label="Reject Application" icon={XCircleIcon}           variant="danger"  loading={acting} onClick={() => setStatus('REJECTED')}  />
                </>
              )}
              {vendor.status === 'ACTIVE' && (
                <>
                  <ActionButton label="Pause Vendor"      icon={PauseCircleIcon}       variant="warning" loading={acting} onClick={() => setConfirmStatus('PAUSED')}    />
                  <ActionButton label="Suspend Vendor"    icon={ExclamationTriangleIcon} variant="danger" loading={acting} onClick={() => setConfirmStatus('SUSPENDED')} />
                </>
              )}
              {(vendor.status === 'PAUSED' || vendor.status === 'SUSPENDED') && (
                <ActionButton label="Reactivate Vendor"  icon={CheckCircleIcon}        variant="success" loading={acting} onClick={() => setStatus('ACTIVE')}    />
              )}
              {vendor.status === 'REJECTED' && (
                <ActionButton label="Re-approve Vendor"  icon={CheckCircleIcon}        variant="success" loading={acting} onClick={() => setStatus('ACTIVE')}    />
              )}
              <Link href={`/organizer/fairs/${fairSlug}/menu-requests?vendor=${vendorSlug}`}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold font-inter text-[#888] hover:bg-white/5 transition-colors">
                <QueueListIcon className="w-4 h-4 shrink-0" />
                Menu Requests {vendor.pendingMenuRequests.length > 0 && (
                  <span className="ml-auto text-amber-400 text-xs">{vendor.pendingMenuRequests.length}</span>
                )}
              </Link>
              <Link href={`/organizer/vendors/${vendorSlug}/audit-log`}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold font-inter text-[#888] hover:bg-white/5 transition-colors">
                <DocumentTextIcon className="w-4 h-4 shrink-0" />
                Audit Log
              </Link>
            </div>
          </div>

          {/* Team */}
          {vendor.members.length > 0 && (
            <div className="bg-[#111111] rounded-2xl border border-white/5 p-5">
              <h2 className="font-bebas text-lg text-white tracking-wide mb-4">Team</h2>
              <div className="space-y-3">
                {vendor.members.map(m => (
                  <div key={m.userId} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#FF0077]/10 flex items-center justify-center text-[#FF0077] font-bebas text-sm shrink-0">
                      {(m.name ?? m.email)[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-inter truncate">{m.name ?? m.email}</p>
                      <p className="text-xs text-[#555] font-inter capitalize">{m.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending menu requests */}
          {vendor.pendingMenuRequests.length > 0 && (
            <div className="bg-[#111111] rounded-2xl border border-amber-500/20 p-5">
              <h2 className="font-bebas text-lg text-amber-400 tracking-wide mb-3 flex items-center gap-2">
                <ExclamationTriangleIcon className="w-4 h-4" />
                Pending Requests
              </h2>
              <div className="space-y-2">
                {vendor.pendingMenuRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      req.type === 'ADD' ? 'bg-emerald-500/15 text-emerald-400' :
                      req.type === 'EDIT' ? 'bg-blue-500/15 text-blue-400' :
                      'bg-red-500/15 text-red-400'}`}>
                      {req.type}
                    </span>
                    <span className="text-xs text-white font-inter flex-1 min-w-0 truncate">
                      {req.name ?? req.menuItem?.name ?? '—'}
                    </span>
                    {req.price !== null && (
                      <span className="text-xs text-[#555] font-inter shrink-0">${req.price.toFixed(2)}</span>
                    )}
                  </div>
                ))}
                <Link href={`/organizer/fairs/${fairSlug}/menu-requests`}
                  className="block text-center text-xs text-amber-400 hover:underline font-inter mt-3">
                  Review all →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmStatus === 'PAUSED'}
        variant="warning"
        title="Pause this vendor?"
        message={`${vendor.name} will stop receiving new orders. Existing orders are unaffected. You can unpause anytime.`}
        confirmLabel="Pause Vendor"
        loading={acting}
        onConfirm={async () => { await setStatus('PAUSED'); setConfirmStatus(null) }}
        onCancel={() => setConfirmStatus(null)}
      />

      <ConfirmModal
        open={confirmStatus === 'SUSPENDED'}
        variant="destructive"
        title="Suspend this vendor?"
        message={`${vendor.name} will be removed from the live fair and cannot operate until reinstated. This is more severe than pausing.`}
        confirmLabel="Suspend Vendor"
        loading={acting}
        onConfirm={async () => { await setStatus('SUSPENDED'); setConfirmStatus(null) }}
        onCancel={() => setConfirmStatus(null)}
      />
    </div>
  )
}
