'use client'

import { useState } from 'react'
import { mockOrdersForFair } from '@/lib/mock/organizer'

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/10 text-yellow-400',
  preparing: 'bg-blue-400/10 text-blue-400',
  ready:     'bg-green-400/10 text-green-400',
  completed: 'bg-white/5 text-[#888]',
  cancelled: 'bg-red-400/10 text-red-400',
}

const FILTERS = ['All', 'Pending', 'Preparing', 'Ready', 'Completed']

export default function FairOrdersPage() {
  const [filter, setFilter] = useState('All')

  const orders = filter === 'All' ? mockOrdersForFair : mockOrdersForFair.filter(o => o.status === filter.toLowerCase())
  const activeCount = mockOrdersForFair.filter(o => o.status === 'pending' || o.status === 'preparing').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bebas text-3xl text-white tracking-wide">Orders</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm text-[#666] font-inter">Live — {activeCount} active order{activeCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold font-inter whitespace-nowrap transition-colors
              ${filter === f ? 'bg-[#FF0077] text-white' : 'text-[#888] hover:text-white'}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Orders */}
      <div className="space-y-3">
        {orders.map(order => (
          <div key={order.id} className="bg-[#111111] rounded-xl border border-white/5 p-4 sm:p-5 hover:border-white/10 transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-inter font-medium text-white">Order #{order.shortId}</p>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? ''}`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-xs text-[#666] font-inter mt-0.5">{order.customerName} · {order.timeAgo}</p>
              </div>
              <p className="text-sm font-semibold text-white tabular-nums">${order.total.toFixed(2)}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {order.items.map(item => (
                <span key={item.id} className="px-2 py-1 bg-white/5 rounded text-xs text-[#aaa] font-inter">
                  {item.quantity}× {item.name}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-[#666] font-inter">{order.vendorName} · Booth {order.booth}</p>
              <button className="px-3 py-1 text-xs font-inter text-[#888] border border-white/10 rounded-lg hover:text-white hover:border-white/20 transition-colors">
                Details
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
