import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  PhoneIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  ChatBubbleLeftEllipsisIcon,
  ReceiptPercentIcon,
  BuildingStorefrontIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import toast from "react-hot-toast";
import TrackOrderSkeleton from "../components/skeletons/TrackOrderSkeleton";

// ─── Status config ─────────────────────────────────────────────────────────────

const STEPS = [
  { label: "Order Placed", sublabel: "Confirmed", icon: ReceiptPercentIcon },
  { label: "Preparing", sublabel: "In progress", icon: ClockIcon },
  { label: "Ready", sublabel: "For pickup", icon: BuildingStorefrontIcon },
  { label: "Completed", sublabel: "All done!", icon: CheckCircleIcon },
];

const STATUS_TO_STEP = {
  PLACED: 0, ACCEPTED: 0,
  PREPARING: 1,
  READY: 2,
  COMPLETED: 3,
};

const TERMINAL_STATUSES = ["CANCELLED", "UNCOLLECTED", "UNDELIVERABLE"];

const STATUS_LABELS = {
  PLACED: "Order Placed",
  ACCEPTED: "Accepted",
  PREPARING: "Preparing",
  READY: "Ready for Pickup",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNCOLLECTED: "Uncollected",
  UNDELIVERABLE: "Undeliverable",
};

const STATUS_COLORS = {
  PLACED: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  ACCEPTED: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  PREPARING: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  READY: "text-neon-pink bg-neon-pink/10 border-neon-pink/20",
  COMPLETED: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  CANCELLED: "text-red-400 bg-red-400/10 border-red-400/20",
  UNCOLLECTED: "text-red-400 bg-red-400/10 border-red-400/20",
  UNDELIVERABLE: "text-red-400 bg-red-400/10 border-red-400/20",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const formatTime = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const getMapEmbedUrl = (order) => {
  if (!order) return null;
  let query = "";
  if (order.fulfillmentType === "HOME_DELIVERY" && order.deliveryStreet) {
    query = `${order.deliveryStreet}, ${order.deliveryCity} ${order.deliveryZip}`;
  } else if (order.vendor?.boothNumber) {
    query = `${order.vendor.name} booth ${order.vendor.boothNumber}`;
  } else {
    query = order.vendor?.name || "Fair grounds";
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed&hl=en&z=15`;
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] || "text-text-gray bg-white/5 border-white/10"}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
    {STATUS_LABELS[status] || status}
  </span>
);

const OrderStepper = ({ status, steps = STEPS }) => {
  const currentStep = STATUS_TO_STEP[status] ?? -1;
  const isCancelled = TERMINAL_STATUSES.includes(status);

  if (isCancelled) {
    return (
      <div className="bg-bg-card border border-red-500/20 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
          <XMarkIcon className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">Order {STATUS_LABELS[status]}</p>
          <p className="text-text-gray text-xs mt-0.5">
            {status === "CANCELLED" ? "This order was cancelled." :
             status === "UNCOLLECTED" ? "This order was not collected in time." :
             "This order could not be delivered."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl p-5 md:p-4">
      <div className="flex items-start">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-start flex-1">
            {/* Step node */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
                idx < currentStep
                  ? "bg-neon-pink shadow-glow"
                  : idx === currentStep
                  ? "bg-neon-pink ring-4 ring-neon-pink/20 shadow-glow-intense"
                  : "bg-white/5 border border-white/10"
              }`}>
                {idx < currentStep ? (
                  <CheckIcon className="w-5 h-5 md:w-4 md:h-4 text-white" />
                ) : (
                  <step.icon className={`w-5 h-5 md:w-4 md:h-4 ${idx === currentStep ? "text-white" : "text-text-gray"}`} />
                )}
              </div>
              <p className={`text-[0.6875rem] md:text-[0.625rem] font-semibold text-center mt-2 leading-tight ${
                idx <= currentStep ? "text-white" : "text-text-gray"
              }`}>
                {step.label}
              </p>
              <p className="hidden md:block text-[0.5625rem] text-text-gray/60 text-center mt-0.5">
                {step.sublabel}
              </p>
            </div>

            {/* Connector line between steps */}
            {idx < steps.length - 1 && (
              <div className="flex items-center flex-shrink-0 pt-5 md:pt-4 w-4 md:w-3">
                <div className={`h-0.5 w-full transition-all duration-500 ${
                  idx < currentStep ? "bg-neon-pink" : "bg-white/10"
                }`} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const OrderItemsCard = ({ order }) => {
  const subtotal = order.subtotal ?? 0;
  const deliveryFee = order.deliveryFee ?? 0;
  const total = order.total ?? 0;

  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">
            Order Items
          </p>
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Items */}
      <div className="px-5 py-3 divide-y divide-white/5">
        {(order.orderItems ?? []).map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-3">
            {item.menuItem?.imageUrl ? (
              <img
                src={item.menuItem.imageUrl}
                alt={item.menuItem.name}
                className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-white/5"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 text-base">
                🍽️
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {item.menuItem?.name || "Item"}
              </p>
              {item.specialInstructions && (
                <p className="text-text-gray text-xs mt-0.5 truncate">{item.specialInstructions}</p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-text-gray text-xs">×{item.quantity}</p>
              <p className="text-white text-sm font-medium">${item.subtotal?.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-5 py-4 bg-white/[0.02] border-t border-white/5 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-text-gray">Subtotal</span>
          <span className="text-white">${subtotal.toFixed(2)}</span>
        </div>
        {deliveryFee > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-text-gray">Delivery fee</span>
            <span className="text-white">${deliveryFee.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-white/5 pt-2 mt-2">
          <span className="text-white">Total</span>
          <span className="text-neon-pink text-base [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
            ${total.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};

const OrderMetaCard = ({ order }) => {
  const isDelivery = order.fulfillmentType === "HOME_DELIVERY";
  const isCurbside = order.fulfillmentType === "CURBSIDE";
  const hasAddress = isDelivery && order.deliveryStreet;

  return (
    <div className="bg-bg-card border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold">
          Order Details
        </p>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Order number */}
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">Order #</p>
          <p className="text-white font-mono text-sm">{order.id?.slice(-8).toUpperCase()}</p>
        </div>

        {/* Vendor */}
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">Vendor</p>
          <div className="flex items-center gap-2">
            <BuildingStorefrontIcon className="w-4 h-4 text-neon-pink flex-shrink-0" />
            <span className="text-white text-sm">{order.vendor?.name}</span>
            {order.vendor?.boothNumber && (
              <span className="text-text-gray text-xs">· Booth {order.vendor.boothNumber}</span>
            )}
          </div>
        </div>

        {/* Fulfillment type */}
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">
            Fulfillment
          </p>
          <p className="text-white text-sm">
            {isDelivery ? "🚶 Home Delivery" : isCurbside ? "🚗 Curbside" : "🏬 Booth Pickup"}
          </p>
        </div>

        {/* Vehicle (curbside) */}
        {isCurbside && order.vehicleMake && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">Vehicle</p>
            <p className="text-white text-sm">
              {order.vehicleColor} {order.vehicleMake}
              {order.vehiclePlate && ` · ${order.vehiclePlate}`}
            </p>
          </div>
        )}

        {/* Delivery address */}
        {hasAddress && (
          <div>
            <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1">
              Delivery Address
            </p>
            <div className="flex items-start gap-2">
              <MapPinIcon className="w-4 h-4 text-neon-pink flex-shrink-0 mt-0.5" />
              <p className="text-white text-sm">
                {order.deliveryStreet}<br />
                {order.deliveryCity}, {order.deliveryZip}
              </p>
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div>
          <p className="text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">Timeline</p>
          <div className="space-y-1.5">
            {[
              { label: "Placed", value: order.placedAt },
              { label: "Accepted", value: order.acceptedAt },
              { label: "Ready", value: order.readyAt },
              { label: "Completed", value: order.completedAt },
              { label: "Cancelled", value: order.cancelledAt },
            ]
              .filter((t) => t.value)
              .map((t) => (
                <div key={t.label} className="flex justify-between items-center">
                  <span className="text-text-gray text-xs">{t.label}</span>
                  <span className="text-white text-xs font-medium">
                    {formatTime(t.value)} · {formatDate(t.value)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Cancel Modal ──────────────────────────────────────────────────────────────

const CancelModal = ({ isOpen, onClose, onConfirm, loading }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-card border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">Cancel Order?</h3>
            <p className="text-text-gray text-xs">This cannot be undone.</p>
          </div>
        </div>
        <p className="text-text-gray text-sm mb-6">
          Your order will be cancelled and a full refund will be issued to your original payment method within 5–10 business days.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
          >
            Keep Order
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 active:bg-red-700 active:scale-[0.97] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Cancelling…" : "Cancel Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Support Modal ─────────────────────────────────────────────────────────────

const SupportModal = ({ isOpen, onClose, orderId }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-card border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fadeIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-text-gray hover:text-white hover:bg-white/10 rounded-lg transition-colors duration-200 cursor-pointer bg-transparent border-0"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-neon-pink/10 border border-neon-pink/20 flex items-center justify-center flex-shrink-0">
            <ChatBubbleLeftEllipsisIcon className="w-5 h-5 text-neon-pink" />
          </div>
          <div>
            <h3 className="font-bebas text-xl tracking-wide text-white">Contact Support</h3>
            <p className="text-text-gray text-xs">Order #{orderId?.slice(-8).toUpperCase()}</p>
          </div>
        </div>
        <div className="space-y-3">
          <a
            href="mailto:fairdash217@gmail.com?subject=Order Support"
            className="flex items-center gap-3 p-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium no-underline hover:bg-white/10 hover:border-neon-pink/30 transition-all duration-200"
          >
            <span className="text-lg">✉️</span>
            Email support
          </a>
          <Link
            to="/contact"
            onClick={onClose}
            className="flex items-center gap-3 p-3.5 bg-neon-pink/5 border border-neon-pink/20 rounded-xl text-neon-pink text-sm font-semibold no-underline hover:bg-neon-pink/10 transition-all duration-200"
          >
            <ChatBubbleLeftEllipsisIcon className="w-5 h-5" />
            Open support form
          </Link>
        </div>
      </div>
    </div>
  );
};

// ─── Recent Orders List (no orderId provided) ──────────────────────────────────

const RecentOrdersList = ({ orders, loading }) => {
  if (loading) return <TrackOrderSkeleton />;

  return (
    <div className="pt-20 min-h-screen pb-16">
      <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-[3.75rem] pb-10 md:py-10 border-b border-white/10">
        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
          <h1 className="font-bebas text-[clamp(2.5rem,6vw,4rem)] text-center mb-2.5 tracking-[0.125rem]">
            <span className="text-neon-pink">Track</span> Order
          </h1>
          <p className="text-center text-text-gray text-lg">
            Follow your order from the kitchen to your hands
          </p>
        </div>
      </div>

      <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-10">
        {orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-[6rem] mb-5 opacity-20">📦</div>
            <h3 className="font-bebas text-[2rem] tracking-wide mb-2">No orders yet</h3>
            <p className="text-text-gray text-lg mb-8">Place an order and you'll be able to track it here.</p>
            <Link
              to="/menu"
              className="inline-flex items-center gap-2 px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm uppercase tracking-wide hover:bg-[#e0006b] transition-colors duration-200 no-underline shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
            >
              Browse Menu
            </Link>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="font-bebas text-[1.5rem] tracking-wide text-text-gray mb-6">
              Your Recent Orders
            </h2>
            {orders.map((order) => (
              <Link
                key={order.id}
                to={`/track/${order.id}`}
                className="block bg-bg-card border border-white/5 rounded-2xl p-5 no-underline hover:border-neon-pink/30 hover:scale-[1.01] transition-all duration-200 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-semibold text-sm">{order.vendor?.name}</p>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-text-gray text-xs">
                      Order #{order.id?.slice(-8).toUpperCase()} · {formatDate(order.placedAt)}
                    </p>
                    <p className="text-text-gray text-xs mt-1">
                      {(order.orderItems ?? []).length} item{order.orderItems?.length !== 1 ? "s" : ""} · ${order.total?.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-text-gray group-hover:text-neon-pink transition-colors duration-200 flex-shrink-0">
                    →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

const TrackOrder = () => {
  const { orderId: routeOrderId } = useParams();
  const [searchParams] = useSearchParams();
  const orderId = routeOrderId || searchParams.get("orderId");

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);

  // Fetch a specific order
  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Failed to load order");
      setOrder(json.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  // Poll every 15 seconds while order is active
  // TODO: Replace with Firebase RTDB subscription at customerOrders/{customerId}/{orderId}
  //       when NEXT_PUBLIC_FIREBASE_DATABASE_URL and related vars are configured.
  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
    const shouldPoll = order
      ? !TERMINAL_STATUSES.includes(order.status) && order.status !== "COMPLETED"
      : true;
    if (!shouldPoll) return;
    const interval = setInterval(fetchOrder, 15_000);
    return () => clearInterval(interval);
  }, [fetchOrder, orderId, order?.status]);

  // Fetch recent orders list when no orderId
  useEffect(() => {
    if (orderId) { setListLoading(false); return; }
    fetch("/api/orders?limit=10")
      .then((r) => r.json())
      .then((json) => setRecentOrders(json.data?.orders ?? []))
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, [orderId]);

  // Cancel handler
  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "PATCH" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Cancellation failed");
      setShowCancelModal(false);
      toast.success("Order cancelled. Your refund is on the way.");
      fetchOrder();
    } catch (err) {
      toast.error(err.message || "Could not cancel order. Please contact support.");
    } finally {
      setCancelling(false);
    }
  };

  // ── No specific order: show list ─────────────────────────────────────────
  if (!orderId) {
    return <RecentOrdersList orders={recentOrders} loading={listLoading} />;
  }

  if (loading) return <TrackOrderSkeleton />;

  if (error) {
    return (
      <div className="pt-20 min-h-screen flex flex-col items-center justify-center pb-16 px-5">
        <div className="text-[5rem] mb-4 opacity-30">📦</div>
        <h3 className="font-bebas text-[2rem] tracking-wide mb-2">Order not found</h3>
        <p className="text-text-gray text-base mb-8 text-center max-w-sm">{error}</p>
        <Link to="/track" className="text-neon-pink font-semibold hover:text-[#e0006b] transition-colors no-underline">
          View all orders →
        </Link>
      </div>
    );
  }

  if (!order) return null;

  const canCancel = ["PLACED", "ACCEPTED"].includes(order.status);
  const isCancelled = TERMINAL_STATUSES.includes(order.status);
  const isCompleted = order.status === "COMPLETED";
  const mapSrc = getMapEmbedUrl(order);
  const stepLabel = order.fulfillmentType === "HOME_DELIVERY" ? "Out for Delivery" : "Ready for Pickup";
  const steps = STEPS.map((s, i) => i === 2 ? { ...s, label: stepLabel, sublabel: order.fulfillmentType === "HOME_DELIVERY" ? "On the way" : "For pickup" } : s);

  return (
    <>
      <div className="pt-20 min-h-screen pb-16">
        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-8 md:py-6 border-b border-white/10">
          <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5">
            <Link
              to="/track"
              className="inline-flex items-center gap-2 text-text-gray text-sm font-medium no-underline hover:text-neon-pink transition-colors duration-200 mb-4"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              All Orders
            </Link>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-bebas text-[clamp(1.75rem,4vw,2.5rem)] tracking-[0.125rem] leading-none mb-1">
                  Track Order
                </h1>
                <p className="text-text-gray text-sm">
                  #{order.id?.slice(-8).toUpperCase()} · {order.vendor?.name} · {formatDate(order.placedAt)}
                </p>
              </div>
              <StatusBadge status={order.status} />
            </div>
          </div>
        </div>

        <div className="max-w-[87.5rem] mx-auto px-[6%] md:px-5 py-6">
          {/* ── Status stepper (full-width) ───────────────────────────────────── */}
          <div className="mb-6">
            <OrderStepper status={order.status} steps={steps} />
          </div>

          {/* ── Two-column layout ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-[1fr_22rem] lg:grid-cols-1 gap-5">

            {/* Left: Map + items ───────────────────────────────────────────────── */}
            <div className="flex flex-col gap-5">

              {/* Map */}
              {!isCancelled && mapSrc && (
                <div className="bg-bg-card border border-white/5 rounded-2xl overflow-hidden">
                  <div className="relative w-full h-64 md:h-48">
                    <iframe
                      title="Order location"
                      src={mapSrc}
                      className="w-full h-full border-0"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    {/* Live tracking badge */}
                    <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-semibold text-text-gray border border-white/10">
                      <span className="w-2 h-2 rounded-full bg-text-gray/40" />
                      Live tracking coming soon
                    </div>
                  </div>
                </div>
              )}

              {/* Order items */}
              <OrderItemsCard order={order} />

              {/* Actions */}
              {!isCompleted && !isCancelled && (
                <div className="flex gap-3 md:flex-col">
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
                  >
                    <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    Contact Support
                  </button>
                  {canCancel && (
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="flex items-center justify-center gap-2 flex-1 py-3 bg-transparent border-2 border-red-500/40 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/10 hover:border-red-500/60 transition-all duration-200 cursor-pointer active:scale-[0.97]"
                    >
                      <XMarkIcon className="w-4 h-4" />
                      Cancel Order
                    </button>
                  )}
                </div>
              )}

              {isCompleted && (
                <div className="flex gap-3 md:flex-col">
                  <Link
                    to="/menu"
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-neon-pink text-white rounded-xl text-sm font-semibold no-underline hover:bg-[#e0006b] transition-colors duration-200 shadow-[0_4px_12px_rgba(255,0,119,0.3)] active:scale-[0.97]"
                  >
                    Order Again
                  </Link>
                  <button
                    onClick={() => setShowSupportModal(true)}
                    className="flex items-center justify-center gap-2 flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl text-sm font-semibold hover:bg-white/10 transition-colors duration-200 cursor-pointer active:scale-[0.97]"
                  >
                    <ChatBubbleLeftEllipsisIcon className="w-4 h-4" />
                    Support
                  </button>
                </div>
              )}
            </div>

            {/* Right: Order meta details ───────────────────────────────────────── */}
            <OrderMetaCard order={order} />
          </div>
        </div>
      </div>

      <CancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        loading={cancelling}
      />
      <SupportModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        orderId={orderId}
      />
    </>
  );
};

export default TrackOrder;
