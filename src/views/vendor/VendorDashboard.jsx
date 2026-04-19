import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import { getDatabase, ref, onChildAdded, onChildChanged, off } from "firebase/database";
import toast from "react-hot-toast";
import { getFirebaseApp } from "../../lib/firebase";
import SignOutModal from "../../components/SignOutModal";
import {
  HomeModernIcon,
  ClipboardDocumentListIcon,
  Squares2X2Icon,
  ChartBarIcon,
  BanknotesIcon,
  Cog6ToothIcon,
  Bars3Icon,
  BellIcon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  ShoppingBagIcon,
  StarIcon,
  BuildingStorefrontIcon,
  ChevronRightIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  PhotoIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { ADMIN_HEARTBEAT_INTERVAL_MS } from "../../utils/constants";

// ─── Constants ─────────────────────────────────────────────────────────────────

const ORDER_NEXT_STATUS = {
  PLACED:    "ACCEPTED",
  ACCEPTED:  "PREPARING",
  PREPARING: "READY",
  READY:     "COMPLETED",
};

const ORDER_ACTION_LABEL = {
  PLACED:    "Accept",
  ACCEPTED:  "Start Preparing",
  PREPARING: "Mark Ready",
  READY:     "Mark Completed",
};

const STATUS_STYLES = {
  PLACED:    "bg-neon-pink/10 text-neon-pink border-neon-pink/20",
  ACCEPTED:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
  PREPARING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  READY:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CANCELLED: "bg-red-500/10 text-red-400 border-red-500/20",
  UNCOLLECTED: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_LABELS = {
  PLACED:    "New",
  ACCEPTED:  "Accepted",
  PREPARING: "Preparing",
  READY:     "Ready",
  COMPLETED: "Completed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  UNCOLLECTED: "Uncollected",
};

const MENU_CATEGORIES = [
  "Mains", "Sides", "Drinks", "Desserts", "Snacks", "Combos", "Other",
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const normalizeRestOrder = (o) => ({
  id: o.id,
  customer: o.customerName,
  items: o.orderItems
    ? o.orderItems.map(i => `${i.menuItem?.name ?? "Item"} ×${i.quantity}`).join(", ")
    : "—",
  total: o.total ?? 0,
  status: o.status,
  time: new Date(o.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  fulfillmentType: o.fulfillmentType,
});

const normalizeFirebaseOrder = (data) => ({
  id: data.orderId,
  customer: data.customerName,
  items: data.itemSummary ?? "—",
  total: data.total ?? 0,
  status: data.status,
  time: new Date(data.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  fulfillmentType: data.fulfillmentType,
});

// ─── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${STATUS_STYLES[status] ?? STATUS_STYLES.PLACED}`}
  >
    {STATUS_LABELS[status] ?? status}
  </span>
);

// ── Stat Card ──────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, trend, trendUp, icon: Icon, accentColor = "pink", loading }) => {
  const accent = {
    pink:    { bg: "bg-neon-pink/10",      border: "border-neon-pink/20",      text: "text-neon-pink" },
    amber:   { bg: "bg-amber-500/10",      border: "border-amber-500/20",      text: "text-amber-400" },
    emerald: { bg: "bg-emerald-500/10",    border: "border-emerald-500/20",    text: "text-emerald-400" },
    blue:    { bg: "bg-blue-500/10",       border: "border-blue-500/20",       text: "text-blue-400" },
  }[accentColor];

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-white/20 hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 ${accent.bg} ${accent.border} border rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${accent.text}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${trendUp ? "text-emerald-400" : "text-red-400"}`}>
            {trendUp
              ? <ArrowTrendingUpIcon className="w-3.5 h-3.5" />
              : <ArrowTrendingDownIcon className="w-3.5 h-3.5" />}
            {trend}
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse mb-1" />
      ) : (
        <div className="font-bebas text-[2rem] tracking-wide text-white leading-none mb-1">
          {value}
        </div>
      )}
      <div className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold">
        {label}
      </div>
    </div>
  );
};

// ── Earnings Bar Chart ─────────────────────────────────────────────────────────
const EarningsChart = ({ data, period, onPeriodChange, loading, totalRevenue }) => {
  const max = Math.max(...(data.map(d => d.revenue).filter(v => v > 0)), 1);
  const total = totalRevenue ?? data.reduce((s, d) => s + d.revenue, 0);

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="font-bebas text-xl tracking-wide text-white mb-0.5">
            Revenue Overview
          </h3>
          <p className="text-text-gray text-sm">
            <span className="text-white font-semibold">
              ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>{" "}
            this period
          </p>
        </div>
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {["7d", "30d", "90d"].map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 border-0 uppercase ${
                period === p
                  ? "bg-neon-pink text-white shadow-[0_2px_8px_rgba(255,0,119,0.3)]"
                  : "bg-transparent text-text-gray hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-end gap-2 flex-1 min-h-0" style={{ height: "8rem" }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
              <div
                className="w-full rounded-t-md bg-white/5 animate-pulse"
                style={{ height: `${20 + Math.random() * 60}%` }}
              />
              <div className="w-6 h-2 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-2 flex-1 min-h-0" style={{ height: "8rem" }}>
          {data.map((item, i) => {
            const isLast = i === data.length - 1;
            const heightPct = Math.max((item.revenue / max) * 100, 3);
            return (
              <div
                key={item.day + i}
                className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-bg-dark border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-semibold whitespace-nowrap pointer-events-none mb-1">
                  ${item.revenue.toFixed(0)}
                </div>
                <div
                  className={`w-full rounded-t-md transition-all duration-700 ${
                    isLast
                      ? "bg-neon-pink/20 border border-neon-pink/30 border-b-0"
                      : "bg-gradient-to-t from-neon-pink to-[#ff6eb7] group-hover:from-[#e0006b] group-hover:to-neon-pink"
                  }`}
                  style={{ height: `${heightPct}%` }}
                />
                <span
                  className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${
                    isLast ? "text-neon-pink" : "text-text-gray"
                  }`}
                >
                  {item.day}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-neon-pink to-[#ff6eb7]" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">Past Days</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-neon-pink/20 border border-neon-pink/30" />
          <span className="text-text-gray text-[0.625rem] font-semibold uppercase tracking-wide">Today</span>
        </div>
      </div>
    </div>
  );
};

// ── Live Order Queue ───────────────────────────────────────────────────────────
const LiveOrderQueue = ({ orders, onUpdateStatus, updatingIds }) => {
  const active = orders.filter(
    o => ["PLACED", "ACCEPTED", "PREPARING", "READY"].includes(o.status)
  );

  const queueBg = {
    PLACED:    "border-neon-pink/30 bg-neon-pink/5",
    ACCEPTED:  "border-amber-500/30 bg-amber-500/5",
    PREPARING: "border-amber-500/30 bg-amber-500/5",
    READY:     "border-blue-500/30 bg-blue-500/5",
  };

  const actionStyle = {
    PLACED:    "bg-neon-pink hover:bg-[#e0006b] shadow-[0_2px_8px_rgba(255,0,119,0.3)]",
    ACCEPTED:  "bg-amber-500 hover:bg-amber-600 shadow-[0_2px_8px_rgba(245,158,11,0.3)]",
    PREPARING: "bg-amber-500 hover:bg-amber-600 shadow-[0_2px_8px_rgba(245,158,11,0.3)]",
    READY:     "bg-blue-500 hover:bg-blue-600 shadow-[0_2px_8px_rgba(59,130,246,0.3)]",
  };

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bebas text-xl tracking-wide text-white">Live Queue</h3>
        {active.length > 0 && (
          <span className="bg-neon-pink text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse-custom">
            {active.length} active
          </span>
        )}
      </div>

      {active.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <CheckCircleIcon className="w-12 h-12 text-emerald-400/30 mb-3" />
          <p className="text-white font-semibold text-sm mb-1">All caught up!</p>
          <p className="text-text-gray text-xs">No active orders right now.</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {active.map((order) => {
            const isUpdating = updatingIds.has(order.id);
            return (
              <div
                key={order.id}
                className={`p-4 rounded-xl border transition-all duration-200 ${queueBg[order.status] ?? "border-white/10 bg-white/5"}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</span>
                  <StatusBadge status={order.status} />
                </div>
                <p className="text-text-gray text-xs mb-0.5">{order.customer}</p>
                <p className="text-white/60 text-xs mb-3 truncate">{order.items}</p>
                <div className="flex items-center justify-between">
                  <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                  {ORDER_NEXT_STATUS[order.status] && (
                    <button
                      disabled={isUpdating}
                      onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                      className={`px-3 py-1.5 text-white rounded-lg text-xs font-semibold cursor-pointer border-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${actionStyle[order.status]}`}
                    >
                      {isUpdating ? "…" : ORDER_ACTION_LABEL[order.status]}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Orders Table ───────────────────────────────────────────────────────────────
const OrdersTable = ({ orders, onUpdateStatus, updatingIds }) => {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? orders
    : orders.filter(o => o.status === filter);

  const filterOptions = [
    { value: "all",      label: `All (${orders.length})` },
    { value: "PLACED",   label: "New" },
    { value: "PREPARING",label: "Preparing" },
    { value: "READY",    label: "Ready" },
    { value: "COMPLETED",label: "Completed" },
    { value: "CANCELLED",label: "Cancelled" },
  ];

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">All Orders</h3>
            <p className="text-text-gray text-xs">{orders.length} orders today</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {filterOptions.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1 rounded-full text-[0.6875rem] font-semibold border cursor-pointer transition-all duration-200 ${
                  filter === f.value
                    ? "bg-neon-pink border-neon-pink text-white"
                    : "bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-text-gray text-sm">No orders match this filter.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {["Order ID", "Customer", "Items", "Total", "Status", "Time", "Action"].map(h => (
                  <th key={h} className="text-left text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold px-6 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(order => {
                const isUpdating = updatingIds.has(order.id);
                return (
                  <tr key={order.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors duration-150">
                    <td className="px-6 py-4 text-sm font-bold text-white whitespace-nowrap">
                      #{order.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-gray whitespace-nowrap">{order.customer}</td>
                    <td className="px-6 py-4 text-sm text-white/70 max-w-[200px] truncate">{order.items}</td>
                    <td className="px-6 py-4 text-sm font-bold text-neon-pink whitespace-nowrap">${order.total.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap"><StatusBadge status={order.status} /></td>
                    <td className="px-6 py-4 text-xs text-text-gray whitespace-nowrap">{order.time}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {ORDER_NEXT_STATUS[order.status] ? (
                        <button
                          disabled={isUpdating}
                          onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                          className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpdating ? "…" : ORDER_ACTION_LABEL[order.status]}
                        </button>
                      ) : (
                        <span className="text-text-gray/40 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden divide-y divide-white/5">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-text-gray text-sm">No orders match this filter.</div>
        ) : (
          filtered.map(order => {
            const isUpdating = updatingIds.has(order.id);
            return (
              <div key={order.id} className="p-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-bold text-white text-sm">#{order.id.slice(-8).toUpperCase()}</p>
                    <p className="text-text-gray text-xs">{order.customer} · {order.time}</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <p className="text-white/60 text-xs mb-3 line-clamp-2">{order.items}</p>
                <div className="flex items-center justify-between">
                  <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                  {ORDER_NEXT_STATUS[order.status] && (
                    <button
                      disabled={isUpdating}
                      onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                      className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200 disabled:opacity-50"
                    >
                      {isUpdating ? "…" : ORDER_ACTION_LABEL[order.status]}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ── Menu Manager ───────────────────────────────────────────────────────────────
const MenuManager = ({ vendor, menuItems, setMenuItems }) => {
  const [form, setForm] = useState({
    name: "", description: "", price: "", prepTime: "15", category: "Mains", imageUrl: "",
  });
  const [addingItem, setAddingItem] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [togglingIds, setTogglingIds] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputRef = useRef(null);
  const editFileRef = useRef(null);

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!form.name || !form.price || !form.category) {
      toast.error("Name, price, and category are required");
      return;
    }
    setAddingItem(true);
    try {
      const res = await fetch("/api/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vendor.id,
          name: form.name,
          description: form.description || undefined,
          price: parseFloat(form.price),
          prepTime: parseInt(form.prepTime) || 15,
          category: form.category,
          imageUrl: form.imageUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Failed to add item");
      setMenuItems(prev => [...prev, json.data]);
      setForm({ name: "", description: "", price: "", prepTime: "15", category: "Mains", imageUrl: "" });
      setShowAddForm(false);
      toast.success(`${json.data.name} added to menu`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAddingItem(false);
    }
  };

  const handleToggleAvailability = async (item) => {
    setTogglingIds(prev => new Set(prev).add(item.id));
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Update failed");
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, isAvailable: !m.isAvailable } : m));
      toast.success(`${item.name} marked ${!item.isAvailable ? "available" : "sold out"}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTogglingIds(prev => { const s = new Set(prev); s.delete(item.id); return s; });
    }
  };

  const handleSaveEdit = async (item) => {
    try {
      const res = await fetch(`/api/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          price: parseFloat(editForm.price),
          prepTime: parseInt(editForm.prepTime) || 15,
          category: editForm.category,
          imageUrl: editForm.imageUrl || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Update failed");
      setMenuItems(prev => prev.map(m => m.id === item.id ? json.data : m));
      setEditingId(null);
      toast.success(`${json.data.name} updated`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/menu/${item.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Delete failed");
      setMenuItems(prev => prev.filter(m => m.id !== item.id));
      toast.success(`${item.name} removed from menu`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePhotoUpload = async (file, itemId, isEdit) => {
    setUploadingId(itemId ?? "new");
    try {
      const res = await fetch("/api/storage/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error?.message ?? "Photo upload not available");
        return;
      }
      // Upload the file to the presigned URL
      await fetch(json.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const publicUrl = json.data.publicUrl;
      if (isEdit) {
        setEditForm(prev => ({ ...prev, imageUrl: publicUrl }));
      } else {
        setForm(prev => ({ ...prev, imageUrl: publicUrl }));
      }
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error("Photo upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  const grouped = menuItems.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] ?? []).push(item);
    return acc;
  }, {});

  return (
    <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
            Menu <span className="text-neon-pink">Manager</span>
          </h1>
          <p className="text-text-gray text-sm">{menuItems.length} items across {Object.keys(grouped).length} categories</p>
        </div>
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors duration-200 cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
        >
          <PlusIcon className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* ── Add Item Form ── */}
      {showAddForm && (
        <div className="bg-bg-card border border-neon-pink/20 rounded-2xl p-6 mb-8 animate-fadeIn">
          <h3 className="font-bebas text-xl tracking-wide text-white mb-5">New Menu Item</h3>
          <form onSubmit={handleAddItem} className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <div>
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Item Name *
              </label>
              <input
                required
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g., Jerk Chicken Platter"
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
              />
            </div>
            <div>
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Category *
              </label>
              <select
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors"
              >
                {MENU_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Price (USD) *
              </label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
              />
            </div>
            <div>
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Prep Time (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="120"
                value={form.prepTime}
                onChange={e => setForm(p => ({ ...p, prepTime: e.target.value }))}
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Description
              </label>
              <textarea
                rows={2}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="What makes this item special…"
                className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40 resize-none"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                Photo
              </label>
              <div className="flex gap-3">
                <input
                  value={form.imageUrl}
                  onChange={e => setForm(p => ({ ...p, imageUrl: e.target.value }))}
                  placeholder="Paste image URL, or upload →"
                  className="flex-1 bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handlePhotoUpload(file, null, false);
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingId === "new"}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer border-0 disabled:opacity-50"
                >
                  <PhotoIcon className="w-4 h-4" />
                  {uploadingId === "new" ? "…" : "Upload"}
                </button>
              </div>
            </div>
            <div className="col-span-2 md:col-span-1 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingItem}
                className="px-5 py-2.5 bg-neon-pink text-white rounded-xl text-sm font-semibold hover:bg-[#e0006b] transition-colors cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-50"
              >
                {addingItem ? "Adding…" : "Add Item"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Item List by Category ── */}
      {menuItems.length === 0 ? (
        <div className="text-center py-20 bg-bg-card border border-white/10 rounded-2xl">
          <div className="text-[5rem] mb-4 opacity-20">🍽️</div>
          <h3 className="font-bebas text-[2rem] tracking-wide mb-2">No items yet</h3>
          <p className="text-text-gray text-sm mb-6">Add your first menu item to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="font-bebas text-lg tracking-wide text-text-gray mb-3">{category}</h3>
              <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
                {items.map(item => {
                  const isEditing = editingId === item.id;
                  const isDeleting = deletingId === item.id;
                  const isToggling = togglingIds.has(item.id);

                  if (isEditing) {
                    return (
                      <div key={item.id} className="p-4 bg-neon-pink/5 border-l-2 border-neon-pink animate-fadeIn">
                        <div className="grid grid-cols-2 md:grid-cols-1 gap-3 mb-3">
                          <input
                            value={editForm.name ?? ""}
                            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                            placeholder="Name"
                            className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors"
                          />
                          <select
                            value={editForm.category ?? ""}
                            onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                            className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors"
                          >
                            {MENU_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.price ?? ""}
                            onChange={e => setEditForm(p => ({ ...p, price: e.target.value }))}
                            placeholder="Price"
                            className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors"
                          />
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={editForm.prepTime ?? ""}
                            onChange={e => setEditForm(p => ({ ...p, prepTime: e.target.value }))}
                            placeholder="Prep time (min)"
                            className="bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors"
                          />
                          <div className="col-span-2 md:col-span-1 flex gap-2">
                            <input
                              value={editForm.imageUrl ?? ""}
                              onChange={e => setEditForm(p => ({ ...p, imageUrl: e.target.value }))}
                              placeholder="Image URL"
                              className="flex-1 bg-bg-dark border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                            />
                            <input
                              ref={editFileRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handlePhotoUpload(file, item.id, true);
                              }}
                            />
                            <button
                              type="button"
                              disabled={uploadingId === item.id}
                              onClick={() => editFileRef.current?.click()}
                              className="px-3 py-2 bg-white/5 border border-white/10 text-white rounded-xl text-xs hover:bg-white/10 transition-colors cursor-pointer border-0 disabled:opacity-50"
                            >
                              <PhotoIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(item)}
                            className="px-3 py-1.5 bg-neon-pink text-white rounded-lg text-xs font-semibold hover:bg-[#e0006b] transition-colors cursor-pointer border-0"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0 bg-white/5" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 text-xl">🍽️</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold text-sm">{item.name}</p>
                          {item.prepTime && (
                            <span className="flex items-center gap-1 text-text-gray text-[0.625rem] bg-white/5 px-1.5 py-0.5 rounded-md">
                              <ClockIcon className="w-3 h-3" />{item.prepTime}m
                            </span>
                          )}
                        </div>
                        <p className="text-neon-pink font-semibold text-sm">${item.price.toFixed(2)}</p>
                        {item.description && (
                          <p className="text-text-gray text-xs mt-0.5 truncate">{item.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Availability toggle */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${item.isAvailable ? "text-emerald-400" : "text-red-400"}`}>
                            {item.isAvailable ? "Available" : "Sold out"}
                          </span>
                          <button
                            disabled={isToggling}
                            onClick={() => handleToggleAvailability(item)}
                            className={`relative w-9 h-5 rounded-full transition-colors duration-300 cursor-pointer border-0 flex-shrink-0 disabled:opacity-50 ${item.isAvailable ? "bg-emerald-500" : "bg-white/20"}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${item.isAvailable ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                        </div>
                        <button
                          onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, description: item.description ?? "", price: String(item.price), prepTime: String(item.prepTime ?? 15), category: item.category, imageUrl: item.imageUrl ?? "" }); }}
                          className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
                        >
                          <PencilIcon className="w-4 h-4 text-text-gray hover:text-white" />
                        </button>
                        <button
                          disabled={isDeleting}
                          onClick={() => handleDelete(item)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer bg-transparent border-0 disabled:opacity-50"
                        >
                          <TrashIcon className="w-4 h-4 text-text-gray hover:text-red-400" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Sidebar Nav Config ────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/vendor/dashboard", label: "Dashboard",   icon: HomeModernIcon },
      { to: "/vendor/orders",    label: "Orders",      icon: ClipboardDocumentListIcon },
      { to: "/vendor/menu",      label: "My Menu",     icon: Squares2X2Icon },
    ],
  },
  {
    label: "Analytics",
    items: [
      { to: "/vendor/analytics", label: "Revenue",   icon: ChartBarIcon },
      { to: "/vendor/reviews",   label: "Reviews",   icon: StarIcon },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/vendor/settings", label: "Settings", icon: Cog6ToothIcon },
    ],
  },
];

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const VendorSidebar = ({ onClose, onSignOutRequest, vendorName, isStoreOpen, onToggleStore, activeTab, onTabChange }) => {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full p-5">
      {/* Brand */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <img src="/images/logo/newIcon.png" alt="FairSynq" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="font-bebas text-[1.375rem] tracking-[0.125rem] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.3)]">
            FAIR<span className="text-neon-pink">SYNQ</span>
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0" aria-label="Close menu">
            <XMarkIcon className="w-5 h-5 text-text-gray" />
          </button>
        )}
      </div>

      {/* Vendor Profile */}
      <div className="mb-5 p-3.5 bg-white/5 border border-white/10 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-neon-pink to-[#cc0060] rounded-xl flex items-center justify-center flex-shrink-0 shadow-[0_2px_8px_rgba(255,0,119,0.3)]">
            <BuildingStorefrontIcon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{vendorName}</p>
            <p className="text-text-gray text-[0.625rem]">Vendor Portal</p>
          </div>
        </div>
      </div>

      {/* Open / Closed Toggle */}
      <div className="mb-5 p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isStoreOpen ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
        <span className="text-sm font-semibold text-white flex-1">
          {isStoreOpen ? "Store Open" : "Store Closed"}
        </span>
        <button
          onClick={onToggleStore}
          aria-label="Toggle store status"
          className={`relative w-10 h-5 rounded-full transition-colors duration-300 cursor-pointer border-0 flex-shrink-0 ${isStoreOpen ? "bg-emerald-500" : "bg-white/20"}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${isStoreOpen ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* Nav Tabs (Dashboard / Menu Manager) */}
      <nav className="flex-1 overflow-y-auto space-y-5">
        <div>
          <p className="text-[0.5625rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-2 px-1">Views</p>
          <div className="space-y-0.5">
            {[
              { key: "dashboard", label: "Dashboard", icon: HomeModernIcon },
              { key: "menu",      label: "Menu Manager", icon: Squares2X2Icon },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { onTabChange(key); onClose?.(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-left transition-all duration-200 cursor-pointer bg-transparent border-0 ${
                  activeTab === key ? "bg-neon-pink/10 text-neon-pink" : "text-text-gray hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="w-[1.125rem] h-[1.125rem] flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </div>
        {NAV_SECTIONS.filter(s => s.label !== "Main").map(section => (
          <div key={section.label}>
            <p className="text-[0.5625rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-2 px-1">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm no-underline transition-all duration-200 ${
                      active ? "bg-neon-pink/10 text-neon-pink" : "text-text-gray hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className="w-[1.125rem] h-[1.125rem] flex-shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <Link to="/home" onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-white no-underline transition-all duration-200 mb-1">
        <ChevronRightIcon className="w-[1.125rem] h-[1.125rem] rotate-180 flex-shrink-0" />
        Back to FairSynq
      </Link>
      <button onClick={onSignOutRequest} className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-red-400 transition-all duration-200 cursor-pointer bg-transparent border-0 w-full text-left">
        <ArrowRightOnRectangleIcon className="w-[1.125rem] h-[1.125rem] flex-shrink-0" />
        Sign Out
      </button>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────
const VendorDashboard = () => {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  // ── Vendor info ──────────────────────────────────────────────────────────
  const [vendor, setVendor] = useState(null);
  const [vendorLoading, setVendorLoading] = useState(true);

  // ── Dashboard data ───────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);
  const [revenueData, setRevenueData] = useState([]);
  const [revenuePeriod, setRevenuePeriod] = useState("7d");
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [updatingIds, setUpdatingIds] = useState(new Set());

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isStoreOpen, setIsStoreOpen] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const heartbeatRef = useRef(null);

  // ── 1. Fetch vendor on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/vendors/me")
      .then(r => r.json())
      .then(json => {
        if (!json.success) { setVendorLoading(false); return; }
        const v = json.data.vendor;
        setVendor(v);
        setIsStoreOpen(!v.isOffline);
        setIsBusy(v.isBusy);
        setMenuItems(v.menuItems ?? []);
        setVendorLoading(false);
      })
      .catch(() => setVendorLoading(false));
  }, []);

  // ── 2. Load stats + today's orders when vendor is known ──────────────────
  useEffect(() => {
    if (!vendor) return;

    // Stats
    fetch(`/api/vendors/${vendor.id}/stats`)
      .then(r => r.json())
      .then(json => { if (json.success) setStats(json.data); })
      .catch(() => {});

    // Today's orders (REST fallback / initial load)
    fetch(`/api/vendors/${vendor.id}/orders`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setOrders(json.data.orders.map(normalizeRestOrder));
        }
      })
      .catch(() => {});
  }, [vendor?.id]);

  // ── 3. Revenue chart — refetch when period changes ───────────────────────
  useEffect(() => {
    if (!vendor) return;
    setRevenueLoading(true);
    fetch(`/api/vendors/${vendor.id}/revenue?period=${revenuePeriod}`)
      .then(r => r.json())
      .then(json => { if (json.success) setRevenueData(json.data.data); })
      .catch(() => {})
      .finally(() => setRevenueLoading(false));
  }, [vendor?.id, revenuePeriod]);

  // ── 4. Firebase RTDB — real-time order listener + heartbeat ─────────────
  useEffect(() => {
    if (!vendor?.id || !vendor?.eventId) return;

    const app = getFirebaseApp();
    if (!app) return;

    const db = getDatabase(app);
    const ordersRef = ref(db, `fairs/${vendor.eventId}/orders/${vendor.id}`);

    // New orders arrive via child_added
    const unsubAdded = onChildAdded(ordersRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      // Play alert sound for new PLACED orders
      if (data.status === "PLACED") {
        try { new Audio("/sounds/order-alert.mp3").play(); } catch (_) {}
      }
      setOrders(prev => {
        const exists = prev.find(o => o.id === data.orderId);
        if (exists) return prev;
        return [normalizeFirebaseOrder(data), ...prev];
      });
    });

    // Status changes (e.g., worker auto-cancel) via child_changed
    const unsubChanged = onChildChanged(ordersRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      setOrders(prev =>
        prev.map(o => o.id === data.orderId ? { ...o, status: data.status } : o)
      );
    });

    // Heartbeat — write timestamp every 30s so admin can detect offline vendors
    const heartbeatRef_ = ref(db, `fairs/${vendor.eventId}/heartbeats/${vendor.id}`);
    const ping = () => {
      import("firebase/database").then(({ set }) => {
        set(heartbeatRef_, Date.now()).catch(() => {});
      });
    };
    ping();
    heartbeatRef.current = setInterval(ping, ADMIN_HEARTBEAT_INTERVAL_MS);

    return () => {
      off(ordersRef);
      clearInterval(heartbeatRef.current);
    };
  }, [vendor?.id, vendor?.eventId]);

  // ── 5. Action handlers ───────────────────────────────────────────────────

  const handleUpdateStatus = useCallback(async (orderId, newStatus) => {
    setUpdatingIds(prev => new Set(prev).add(orderId));
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Update failed");
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      const labels = { ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Marked ready", COMPLETED: "Completed" };
      toast.success(`#${orderId.slice(-8).toUpperCase()} — ${labels[newStatus] ?? newStatus}`);
      // Refresh stats after a completion
      if (newStatus === "COMPLETED" && vendor) {
        fetch(`/api/vendors/${vendor.id}/stats`)
          .then(r => r.json())
          .then(j => { if (j.success) setStats(j.data); })
          .catch(() => {});
      }
    } catch (err) {
      toast.error(err.message || "Could not update order status");
    } finally {
      setUpdatingIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
    }
  }, [vendor?.id]);

  const handleToggleStore = useCallback(async () => {
    if (!vendor) return;
    const nextIsOffline = isStoreOpen; // currently open → set offline = true
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isOffline: nextIsOffline }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Update failed");
      setIsStoreOpen(prev => {
        toast.success(prev ? "Store marked closed" : "You're live!");
        return !prev;
      });
    } catch (err) {
      toast.error(err.message || "Could not update store status");
    }
  }, [vendor?.id, isStoreOpen]);

  const handleToggleBusy = useCallback(async () => {
    if (!vendor) return;
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBusy: !isBusy }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Update failed");
      setIsBusy(prev => {
        toast.success(prev ? "No longer busy" : "Busy mode on — new orders paused for 15 min");
        return !prev;
      });
    } catch (err) {
      toast.error(err.message || "Could not update busy status");
    }
  }, [vendor?.id, isBusy]);

  const handleSignOut = () => {
    signOut(() => {
      toast.success("Signed out successfully. See you soon!");
      navigate("/");
    });
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const vendorName = vendor?.name ?? user?.firstName ? `${user.firstName}'s Booth` : "My Vendor Booth";
  const pendingCount = orders.filter(o => ["PLACED", "ACCEPTED", "PREPARING"].includes(o.status)).length;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── Loading / error states ───────────────────────────────────────────────
  if (vendorLoading) {
    return (
      <div className="min-h-screen bg-bg-dark flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-neon-pink border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-text-gray text-sm">Loading vendor dashboard…</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-bg-dark flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <ExclamationTriangleIcon className="w-12 h-12 text-amber-400 mx-auto mb-4 opacity-60" />
          <h2 className="font-bebas text-2xl tracking-wide text-white mb-2">No vendor found</h2>
          <p className="text-text-gray text-sm mb-6">Your account is not linked to a vendor profile. Please complete the vendor onboarding first.</p>
          <Link to="/become-vendor" className="inline-flex items-center gap-2 px-5 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm no-underline hover:bg-[#e0006b] transition-colors">
            Apply to become a vendor
          </Link>
        </div>
      </div>
    );
  }

  const sidebarProps = {
    vendorName,
    isStoreOpen,
    onToggleStore: handleToggleStore,
    onSignOutRequest: () => setShowSignOutModal(true),
    activeTab,
    onTabChange: setActiveTab,
  };

  return (
    <>
      <div className="min-h-screen bg-bg-dark desktop:h-screen desktop:overflow-hidden flex desktop:grid desktop:grid-cols-[16rem_1fr]">

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden desktop:flex bg-bg-card border-r border-white/10 flex-col h-full overflow-y-auto z-50">
          <VendorSidebar {...sidebarProps} />
        </aside>

        {/* ── Mobile Sidebar Overlay ── */}
        {isMobileSidebarOpen && (
          <div className="desktop:hidden fixed inset-0 bg-black/70 z-[90] animate-fadeIn" onClick={() => setIsMobileSidebarOpen(false)} />
        )}

        {/* ── Mobile Sidebar Drawer ── */}
        <div className={`desktop:hidden fixed top-0 left-0 h-screen w-[17rem] bg-bg-card border-r border-white/10 z-[95] transform transition-transform duration-300 ease-out overflow-y-auto ${isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <VendorSidebar {...sidebarProps} onClose={() => setIsMobileSidebarOpen(false)} />
        </div>

        {/* ── Mobile Top Bar ── */}
        <div className="desktop:hidden fixed top-0 left-0 right-0 z-50 bg-bg-dark/90 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center justify-between px-4 py-3.5">
            <button onClick={() => setIsMobileSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0" aria-label="Open menu">
              <Bars3Icon className="w-5 h-5 text-neon-pink" />
            </button>
            <span className="font-bebas text-[1.125rem] tracking-[0.125rem] text-white">
              VENDOR <span className="text-neon-pink">PORTAL</span>
            </span>
            <button className="relative p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0" aria-label="Notifications">
              <BellIcon className="w-5 h-5 text-white" />
              {pendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-neon-pink text-white text-[0.5rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="overflow-y-auto desktop:h-full w-full min-w-0">
          <div className="h-14 desktop:hidden" />

          {/* ── Menu Manager Tab ── */}
          {activeTab === "menu" && (
            <MenuManager vendor={vendor} menuItems={menuItems} setMenuItems={setMenuItems} />
          )}

          {/* ── Dashboard Tab ── */}
          {activeTab === "dashboard" && (
            <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">

              {/* Page Header */}
              <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
                <div>
                  <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
                    Vendor <span className="text-neon-pink">Dashboard</span>
                  </h1>
                  <p className="text-text-gray text-sm">{dateStr}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                  {/* Store status pill */}
                  <div className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${isStoreOpen ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
                    <span className={`w-2 h-2 rounded-full ${isStoreOpen ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                    {isStoreOpen ? "Open" : "Closed"}
                  </div>
                  {/* Busy toggle */}
                  <button
                    onClick={handleToggleBusy}
                    className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all duration-200 ${isBusy ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white"}`}
                  >
                    <ClockIcon className="w-3.5 h-3.5" />
                    {isBusy ? "Busy (15 min)" : "Set Busy"}
                  </button>
                  {/* Notification bell */}
                  <button className="relative hidden desktop:flex p-2 bg-bg-card border border-white/10 rounded-xl hover:border-white/20 transition-all cursor-pointer" aria-label="Notifications">
                    <BellIcon className="w-5 h-5 text-white" />
                    {pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-neon-pink text-white text-[0.5rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* KPI Stat Cards */}
              <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 mb-8 animate-fadeIn">
                <StatCard
                  label="Today's Revenue"
                  value={stats ? `$${stats.todayRevenue.toFixed(2)}` : "$0.00"}
                  loading={!stats}
                  icon={CurrencyDollarIcon}
                  accentColor="pink"
                />
                <StatCard
                  label="Today's Orders"
                  value={stats ? stats.todayOrders : "—"}
                  loading={!stats}
                  icon={ShoppingBagIcon}
                  accentColor="blue"
                />
                <StatCard
                  label="Avg Order Value"
                  value={stats ? `$${stats.avgOrderValue.toFixed(2)}` : "$0.00"}
                  loading={!stats}
                  icon={BanknotesIcon}
                  accentColor="emerald"
                />
                <StatCard
                  label="Pending Orders"
                  value={stats ? stats.pendingOrders : pendingCount}
                  trend={stats?.pendingOrders > 0 ? `${stats.pendingOrders} active` : undefined}
                  trendUp={false}
                  loading={!stats}
                  icon={StarIcon}
                  accentColor="amber"
                />
              </div>

              {/* Chart + Live Queue Row */}
              <div className="grid grid-cols-1 desktop:grid-cols-[1fr_22rem] gap-5 mb-8 animate-fadeIn [animation-delay:0.1s]">
                <EarningsChart
                  data={revenueData}
                  period={revenuePeriod}
                  onPeriodChange={setRevenuePeriod}
                  loading={revenueLoading}
                />
                <LiveOrderQueue
                  orders={orders}
                  onUpdateStatus={handleUpdateStatus}
                  updatingIds={updatingIds}
                />
              </div>

              {/* Orders Table */}
              <div className="mb-8 animate-fadeIn [animation-delay:0.2s]">
                <OrdersTable orders={orders} onUpdateStatus={handleUpdateStatus} updatingIds={updatingIds} />
              </div>

              {/* Quick Links */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6 animate-fadeIn [animation-delay:0.3s]">
                {[
                  { label: "Manage Menu",      desc: "Edit items & prices",  tab: "menu",      icon: Squares2X2Icon },
                  { label: "View Analytics",   desc: "Revenue & insights",   to: "/vendor/analytics", icon: ChartBarIcon },
                  { label: "Account Settings", desc: "Business profile",     to: "/vendor/settings",  icon: Cog6ToothIcon },
                ].map(({ label, desc, tab, to, icon: Icon }) => (
                  tab ? (
                    <button
                      key={label}
                      onClick={() => setActiveTab(tab)}
                      className="bg-bg-card border border-white/10 rounded-2xl p-5 text-left group hover:border-neon-pink/30 hover:-translate-y-0.5 hover:shadow-glow transition-all duration-300 cursor-pointer"
                    >
                      <div className="w-9 h-9 bg-neon-pink/10 border border-neon-pink/20 rounded-xl flex items-center justify-center mb-3">
                        <Icon className="w-4 h-4 text-neon-pink" />
                      </div>
                      <p className="text-white font-semibold text-sm mb-0.5">{label}</p>
                      <p className="text-text-gray text-xs">{desc}</p>
                    </button>
                  ) : (
                    <Link
                      key={label}
                      to={to}
                      className="bg-bg-card border border-white/10 rounded-2xl p-5 no-underline group hover:border-neon-pink/30 hover:-translate-y-0.5 hover:shadow-glow transition-all duration-300"
                    >
                      <div className="w-9 h-9 bg-neon-pink/10 border border-neon-pink/20 rounded-xl flex items-center justify-center mb-3">
                        <Icon className="w-4 h-4 text-neon-pink" />
                      </div>
                      <p className="text-white font-semibold text-sm mb-0.5">{label}</p>
                      <p className="text-text-gray text-xs">{desc}</p>
                    </Link>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOut}
      />
    </>
  );
};

export default VendorDashboard;
