import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import toast from "react-hot-toast";
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
  EllipsisHorizontalIcon,
} from "@heroicons/react/24/outline";
import {
  mockOrders,
  weeklyRevenue,
  vendorStats,
  ORDER_NEXT_STATUS,
  ORDER_ACTION_LABEL,
} from "../../utils/vendorPortalData";

// ─────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────

const STATUS_STYLES = {
  new:       "bg-neon-pink/10 text-neon-pink border-neon-pink/20",
  preparing: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  ready:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  delivered: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_LABELS = {
  new: "New", preparing: "Preparing", ready: "Ready",
  delivered: "Delivered", cancelled: "Cancelled",
};

const StatusBadge = ({ status }) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${STATUS_STYLES[status] ?? STATUS_STYLES.new}`}
  >
    {STATUS_LABELS[status] ?? status}
  </span>
);

// ── Stat Card ──────────────────────────────
const StatCard = ({ label, value, trend, trendUp, icon: Icon, accentColor = "pink" }) => {
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
      <div className="font-bebas text-[2rem] tracking-wide text-white leading-none mb-1">
        {value}
      </div>
      <div className="text-text-gray text-[0.6875rem] uppercase tracking-wide font-semibold">
        {label}
      </div>
    </div>
  );
};

// ── Earnings Bar Chart ─────────────────────
const EarningsChart = ({ data }) => {
  const [period, setPeriod] = useState("7D");
  const max = Math.max(...data.map((d) => d.revenue));
  const total = data.reduce((sum, d) => sum + d.revenue, 0);
  const todayIdx = data.length - 1;

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="font-bebas text-xl tracking-wide text-white mb-0.5">
            Revenue Overview
          </h3>
          <p className="text-text-gray text-sm">
            <span className="text-white font-semibold">${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>{" "}
            this week
          </p>
        </div>
        {/* Period Switcher */}
        <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5">
          {["7D", "30D", "90D"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 border-0 ${
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

      {/* Bar Chart */}
      <div className="flex items-end gap-2 flex-1 min-h-0" style={{ height: "8rem" }}>
        {data.map((item, i) => {
          const isToday = i === todayIdx;
          const heightPct = max > 0 ? Math.max((item.revenue / max) * 100, 3) : 3;
          return (
            <div
              key={item.day}
              className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group"
            >
              {/* Tooltip on hover */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-bg-dark border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-semibold whitespace-nowrap pointer-events-none mb-1">
                ${item.revenue.toFixed(0)}
              </div>
              {/* Bar */}
              <div
                className={`w-full rounded-t-md transition-all duration-700 ${
                  isToday
                    ? "bg-neon-pink/20 border border-neon-pink/30 border-b-0"
                    : "bg-gradient-to-t from-neon-pink to-[#ff6eb7] group-hover:from-[#e0006b] group-hover:to-neon-pink"
                }`}
                style={{ height: `${heightPct}%` }}
              />
              {/* Day Label */}
              <span
                className={`text-[0.5625rem] font-semibold uppercase tracking-wide ${
                  isToday ? "text-neon-pink" : "text-text-gray"
                }`}
              >
                {item.day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
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

// ── Live Order Queue ───────────────────────
const LiveOrderQueue = ({ orders, onUpdateStatus }) => {
  const active = orders.filter(
    (o) => o.status === "new" || o.status === "preparing" || o.status === "ready"
  );

  const queueBg = {
    new:       "border-neon-pink/30 bg-neon-pink/5",
    preparing: "border-amber-500/30 bg-amber-500/5",
    ready:     "border-blue-500/30 bg-blue-500/5",
  };

  const actionStyle = {
    new:       "bg-neon-pink hover:bg-[#e0006b] shadow-[0_2px_8px_rgba(255,0,119,0.3)]",
    preparing: "bg-amber-500 hover:bg-amber-600 shadow-[0_2px_8px_rgba(245,158,11,0.3)]",
    ready:     "bg-blue-500 hover:bg-blue-600 shadow-[0_2px_8px_rgba(59,130,246,0.3)]",
  };

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl p-6 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bebas text-xl tracking-wide text-white">Live Queue</h3>
        {active.length > 0 ? (
          <span className="bg-neon-pink text-white text-xs font-bold px-2.5 py-1 rounded-full animate-pulse-custom">
            {active.length} active
          </span>
        ) : null}
      </div>

      {active.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <CheckCircleIcon className="w-12 h-12 text-emerald-400/30 mb-3" />
          <p className="text-white font-semibold text-sm mb-1">All caught up!</p>
          <p className="text-text-gray text-xs">No active orders right now.</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {active.map((order) => (
            <div
              key={order.id}
              className={`p-4 rounded-xl border transition-all duration-200 ${queueBg[order.status]}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-white text-sm">{order.id}</span>
                <StatusBadge status={order.status} />
              </div>
              <p className="text-text-gray text-xs mb-0.5">{order.customer}</p>
              <p className="text-white/60 text-xs mb-3 truncate">{order.items}</p>
              {order.note && (
                <p className="text-amber-400 text-[0.6875rem] mb-3 bg-amber-500/10 rounded-lg px-2 py-1">
                  Note: {order.note}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                {ORDER_NEXT_STATUS[order.status] && (
                  <button
                    onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                    className={`px-3 py-1.5 text-white rounded-lg text-xs font-semibold cursor-pointer border-0 transition-all duration-200 ${actionStyle[order.status]}`}
                  >
                    {ORDER_ACTION_LABEL[order.status]}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Orders Table ───────────────────────────
const OrdersTable = ({ orders, onUpdateStatus }) => {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all"
    ? orders
    : orders.filter((o) => o.status === filter);

  const filters = ["all", "new", "preparing", "ready", "delivered", "cancelled"];

  return (
    <div className="bg-bg-card border border-white/10 rounded-2xl overflow-hidden">
      {/* Table Header */}
      <div className="p-6 border-b border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">All Orders</h3>
            <p className="text-text-gray text-xs">{orders.length} orders today</p>
          </div>
          {/* Filter Pills */}
          <div className="flex gap-1.5 flex-wrap">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-[0.6875rem] font-semibold border cursor-pointer transition-all duration-200 capitalize ${
                  filter === f
                    ? "bg-neon-pink border-neon-pink text-white"
                    : "bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white"
                }`}
              >
                {f === "all" ? `All (${orders.length})` : f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-text-gray text-sm">
            No orders match this filter.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {["Order ID", "Customer", "Items", "Total", "Status", "Time", "Action"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold px-6 py-3 first:pl-6 last:pr-6 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors duration-150"
                >
                  <td className="px-6 py-4 text-sm font-bold text-white whitespace-nowrap">
                    {order.id}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-gray whitespace-nowrap">
                    {order.customer}
                  </td>
                  <td className="px-6 py-4 text-sm text-white/70 max-w-[200px] truncate">
                    {order.items}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-neon-pink whitespace-nowrap">
                    ${order.total.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 py-4 text-xs text-text-gray whitespace-nowrap">
                    {order.time}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {ORDER_NEXT_STATUS[order.status] ? (
                      <button
                        onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                        className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200"
                      >
                        {ORDER_ACTION_LABEL[order.status]}
                      </button>
                    ) : (
                      <span className="text-text-gray/40 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden divide-y divide-white/5">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-text-gray text-sm">
            No orders match this filter.
          </div>
        ) : (
          filtered.map((order) => (
            <div key={order.id} className="p-4 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-white text-sm">{order.id}</p>
                  <p className="text-text-gray text-xs">{order.customer} · {order.time}</p>
                </div>
                <StatusBadge status={order.status} />
              </div>
              <p className="text-white/60 text-xs mb-3 line-clamp-2">{order.items}</p>
              <div className="flex items-center justify-between">
                <span className="text-neon-pink font-bold text-sm">${order.total.toFixed(2)}</span>
                {ORDER_NEXT_STATUS[order.status] && (
                  <button
                    onClick={() => onUpdateStatus(order.id, ORDER_NEXT_STATUS[order.status])}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-neon-pink/10 hover:border-neon-pink/30 hover:text-neon-pink transition-all duration-200"
                  >
                    {ORDER_ACTION_LABEL[order.status]}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────
//  Sidebar Nav Config
// ─────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/vendor/dashboard", label: "Dashboard",   icon: HomeModernIcon },
      { to: "/vendor/orders",    label: "Orders",      icon: ClipboardDocumentListIcon, badge: 2 },
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

// ─────────────────────────────────────────
//  Sidebar (shared desktop + mobile drawer)
// ─────────────────────────────────────────
const VendorSidebar = ({ onClose, onSignOutRequest, vendorName, isStoreOpen, onToggleStore }) => {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full p-5">
      {/* Brand */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <img
            src="/images/logo/newIcon.png"
            alt="FairSynq"
            className="w-8 h-8 object-contain flex-shrink-0"
          />
          <span className="font-bebas text-[1.375rem] tracking-[0.125rem] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.3)]">
            FAIR<span className="text-neon-pink">SYNQ</span>
          </span>
        </div>
        {/* Close on mobile */}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
            aria-label="Close menu"
          >
            <XMarkIcon className="w-5 h-5 text-text-gray" />
          </button>
        )}
      </div>

      {/* Vendor Profile Mini Card */}
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
          className={`relative w-10 h-5 rounded-full transition-colors duration-300 cursor-pointer border-0 flex-shrink-0 ${
            isStoreOpen ? "bg-emerald-500" : "bg-white/20"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${
              isStoreOpen ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 overflow-y-auto space-y-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="text-[0.5625rem] uppercase tracking-[0.0625rem] text-text-gray font-bold mb-2 px-1">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, badge }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm no-underline transition-all duration-200 ${
                      active
                        ? "bg-neon-pink/10 text-neon-pink"
                        : "text-text-gray hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className="w-4.5 h-4.5 w-[1.125rem] h-[1.125rem] flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                    {badge && (
                      <span className="bg-neon-pink text-white text-[0.5625rem] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Back to App */}
      <Link
        to="/home"
        onClick={onClose}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-white no-underline transition-all duration-200 mb-1"
      >
        <ChevronRightIcon className="w-[1.125rem] h-[1.125rem] rotate-180 flex-shrink-0" />
        Back to FairSynq
      </Link>

      {/* Sign Out */}
      <button
        onClick={onSignOutRequest}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-text-gray hover:bg-white/5 hover:text-red-400 transition-all duration-200 cursor-pointer bg-transparent border-0 w-full text-left"
      >
        <ArrowRightOnRectangleIcon className="w-[1.125rem] h-[1.125rem] flex-shrink-0" />
        Sign Out
      </button>
    </div>
  );
};

// ─────────────────────────────────────────
//  Main VendorDashboard Page
// ─────────────────────────────────────────
const VendorDashboard = () => {
  const { user } = useUser();
  const { signOut } = useClerk();
  const navigate = useNavigate();

  const [orders, setOrders] = useState(mockOrders);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isStoreOpen, setIsStoreOpen] = useState(true);

  const vendorName = user?.firstName
    ? `${user.firstName}'s Booth`
    : "My Vendor Booth";

  const handleUpdateStatus = (orderId, newStatus) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
    const labels = { preparing: "Accepted", ready: "Marked ready", delivered: "Completed" };
    toast.success(`${orderId} — ${labels[newStatus] ?? newStatus}`);
  };

  const handleToggleStore = () => {
    setIsStoreOpen((prev) => {
      toast.success(prev ? "Store marked closed" : "You're live!");
      return !prev;
    });
  };

  const handleSignOut = () => {
    signOut(() => {
      toast.success("Signed out successfully. See you soon!");
      navigate("/");
    });
  };

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const pendingCount = orders.filter(
    (o) => o.status === "new" || o.status === "preparing"
  ).length;

  return (
    <>
      {/* ── Full-screen App Shell ── */}
      <div className="min-h-screen bg-bg-dark desktop:h-screen desktop:overflow-hidden flex desktop:grid desktop:grid-cols-[16rem_1fr]">

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden desktop:flex bg-bg-card border-r border-white/10 flex-col h-full overflow-y-auto z-50">
          <VendorSidebar
            vendorName={vendorName}
            isStoreOpen={isStoreOpen}
            onToggleStore={handleToggleStore}
            onSignOutRequest={() => setShowSignOutModal(true)}
          />
        </aside>

        {/* ── Mobile Sidebar Overlay ── */}
        {isMobileSidebarOpen && (
          <div
            className="desktop:hidden fixed inset-0 bg-black/70 z-[90] animate-fadeIn"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* ── Mobile Sidebar Drawer (slides from left) ── */}
        <div
          className={`desktop:hidden fixed top-0 left-0 h-screen w-[17rem] bg-bg-card border-r border-white/10 z-[95] transform transition-transform duration-300 ease-out overflow-y-auto ${
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <VendorSidebar
            vendorName={vendorName}
            isStoreOpen={isStoreOpen}
            onToggleStore={handleToggleStore}
            onSignOutRequest={() => setShowSignOutModal(true)}
            onClose={() => setIsMobileSidebarOpen(false)}
          />
        </div>

        {/* ── Mobile Top Bar ── */}
        <div className="desktop:hidden fixed top-0 left-0 right-0 z-50 bg-bg-dark/90 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center justify-between px-4 py-3.5">
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
              aria-label="Open menu"
            >
              <Bars3Icon className="w-5 h-5 text-neon-pink" />
            </button>
            <span className="font-bebas text-[1.125rem] tracking-[0.125rem] text-white">
              VENDOR <span className="text-neon-pink">PORTAL</span>
            </span>
            <button
              className="relative p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer bg-transparent border-0"
              aria-label="Notifications"
            >
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
          {/* Mobile spacer */}
          <div className="h-14 desktop:hidden" />

          <div className="p-6 md:p-4 sm:p-3 max-w-[78rem] mx-auto">

            {/* ── Page Header ── */}
            <div className="flex items-start justify-between mb-8 gap-4">
              <div>
                <h1 className="font-bebas text-[clamp(1.75rem,3.5vw,2.5rem)] tracking-wide text-white leading-tight mb-1">
                  Vendor <span className="text-neon-pink">Dashboard</span>
                </h1>
                <p className="text-text-gray text-sm">{dateStr}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Store status pill */}
                <div
                  className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
                    isStoreOpen
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-red-500/10 border-red-500/20 text-red-400"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isStoreOpen ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                  {isStoreOpen ? "Store Open" : "Closed"}
                </div>
                {/* Notification bell (desktop) */}
                <button
                  className="relative hidden desktop:flex p-2 bg-bg-card border border-white/10 rounded-xl hover:border-white/20 transition-all cursor-pointer"
                  aria-label="Notifications"
                >
                  <BellIcon className="w-5 h-5 text-white" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-neon-pink text-white text-[0.5rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* ── KPI Stat Cards (2×2 mobile / 4 across desktop) ── */}
            <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 mb-8 animate-fadeIn">
              <StatCard
                label="Today's Revenue"
                value={`$${vendorStats.todayRevenue.toFixed(2)}`}
                trend={`↑ ${vendorStats.revenueChangePct}%`}
                trendUp
                icon={CurrencyDollarIcon}
                accentColor="pink"
              />
              <StatCard
                label="Today's Orders"
                value={vendorStats.todayOrders}
                trend={`+${vendorStats.ordersChangeCount} new`}
                trendUp
                icon={ShoppingBagIcon}
                accentColor="blue"
              />
              <StatCard
                label="Avg Order Value"
                value={`$${vendorStats.avgOrderValue.toFixed(2)}`}
                icon={BanknotesIcon}
                accentColor="emerald"
              />
              <StatCard
                label="Your Rating"
                value={`${vendorStats.rating} ★`}
                trend={`${vendorStats.reviewCount} reviews`}
                trendUp
                icon={StarIcon}
                accentColor="amber"
              />
            </div>

            {/* ── Chart + Live Queue Row ── */}
            <div className="grid grid-cols-1 desktop:grid-cols-[1fr_22rem] gap-5 mb-8 animate-fadeIn [animation-delay:0.1s]">
              <EarningsChart data={weeklyRevenue} />
              <LiveOrderQueue orders={orders} onUpdateStatus={handleUpdateStatus} />
            </div>

            {/* ── Orders Table ── */}
            <div className="mb-8 animate-fadeIn [animation-delay:0.2s]">
              <OrdersTable orders={orders} onUpdateStatus={handleUpdateStatus} />
            </div>

            {/* ── Quick Links Row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6 animate-fadeIn [animation-delay:0.3s]">
              {[
                { label: "Manage Menu",      desc: "Edit items & prices", to: "/vendor/menu",      icon: Squares2X2Icon },
                { label: "View Analytics",   desc: "Revenue & insights",  to: "/vendor/analytics", icon: ChartBarIcon },
                { label: "Account Settings", desc: "Business profile",    to: "/vendor/settings",  icon: Cog6ToothIcon },
              ].map(({ label, desc, to, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="bg-bg-card border border-white/10 rounded-2xl p-5 no-underline group hover:border-neon-pink/30 hover:-translate-y-0.5 hover:shadow-glow transition-all duration-300"
                >
                  <div className="w-9 h-9 bg-neon-pink/10 border border-neon-pink/20 rounded-xl flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-neon-pink" />
                  </div>
                  <p className="text-white font-semibold text-sm mb-0.5">{label}</p>
                  <p className="text-text-gray text-xs">{desc}</p>
                </Link>
              ))}
            </div>

          </div>
        </div>
      </div>

      {/* Sign Out Modal */}
      <SignOutModal
        isOpen={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOut}
      />
    </>
  );
};

export default VendorDashboard;
