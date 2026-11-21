'use client'

// B1.19 — the per-vendor tax report card (admin reports page: every vendor at the event; vendor analytics page: the
// vendor's own row). Figures come straight from the API (lib/tax-report.ts, stored records only). Renders nothing
// when no tax was ever collected or refunded, so untaxed fairs keep their pages unchanged.
import { useEffect, useState } from 'react'

interface Row { vendorId: string; vendorName: string; orderCount: number; taxableFoodCents: number; salesTaxCollectedCents: number; localTaxCollectedCents: number; salesTaxRefundedCents: number; localTaxRefundedCents: number; netSalesTaxCents: number; netLocalTaxCents: number }
interface Report { rows: Row[]; totals: Omit<Row, 'vendorId' | 'vendorName'> }

const usd = (c: number) => `$${(c / 100).toFixed(2)}`

export default function TaxReportCard({ apiUrl, showVendors }: { apiUrl: string; showVendors: boolean }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch(apiUrl)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json.success) throw new Error(json.error?.message ?? 'Failed to load the tax report')
        setReport(json.data.report)
      })
      .catch(e => setError(String(e.message ?? e)))
  }, [apiUrl])

  if (error) return <p className="text-sm text-red-400 font-inter">{error}</p>
  if (!report || report.rows.length === 0) return null
  const t = report.totals
  return (
    <div className="bg-[#111111] border border-white/5 rounded-xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-bebas text-xl text-white tracking-wide">Sales Tax</h2>
        <a href={`${apiUrl}${apiUrl.includes('?') ? '&' : '?'}format=csv`} className="text-sm text-[#FF0077] font-inter font-semibold hover:underline">Download CSV</a>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm font-inter">
        <div><p className="text-[#666] text-xs uppercase tracking-wide">Taxable food</p><p className="text-white">{usd(t.taxableFoodCents)}</p></div>
        <div><p className="text-[#666] text-xs uppercase tracking-wide">Tax collected</p><p className="text-white">{usd(t.salesTaxCollectedCents + t.localTaxCollectedCents)}</p></div>
        <div><p className="text-[#666] text-xs uppercase tracking-wide">Tax refunded</p><p className="text-white">{usd(t.salesTaxRefundedCents + t.localTaxRefundedCents)}</p></div>
        <div><p className="text-[#666] text-xs uppercase tracking-wide">Net tax</p><p className="text-white">{usd(t.netSalesTaxCents + t.netLocalTaxCents)}</p></div>
      </div>
      {showVendors && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs font-inter">
            <thead><tr className="text-[#666] text-left">
              <th className="py-2 pr-3">Vendor</th><th className="py-2 pr-3 text-right">Orders</th><th className="py-2 pr-3 text-right">Net sales tax</th><th className="py-2 text-right">Net local tax</th>
            </tr></thead>
            <tbody>{report.rows.map(r => (
              <tr key={r.vendorId} className="border-t border-white/5 text-white">
                <td className="py-2 pr-3">{r.vendorName}</td><td className="py-2 pr-3 text-right">{r.orderCount}</td>
                <td className="py-2 pr-3 text-right">{usd(r.netSalesTaxCents)}</td><td className="py-2 text-right">{usd(r.netLocalTaxCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
