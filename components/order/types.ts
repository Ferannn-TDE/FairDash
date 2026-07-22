export interface OrderItem {
  id: string
  menuItemId: string
  vendorId: string
  quantity: number
  unitPrice: number
  subtotal: number
  specialInstructions?: string | null
  menuItem: { name: string; imageUrl?: string | null; prepTime?: number | null }
  vendor: { id: string; name: string; boothNumber?: string | null }
}

export interface VendorGroup {
  vendorId: string
  vendorName: string
  boothNumber?: string | null
  items: OrderItem[]
  subtotal: number
}

export interface VendorOrderStatus {
  vendorId: string
  status: string
  acceptedAt?: string | null
  preparingAt?: string | null
  readyAt?: string | null
  completedAt?: string | null
  declinedAt?: string | null
  vendor?: { name: string } | null
}

export interface Order {
  id: string
  status: string
  fulfillmentType: string
  eventId: string
  vendorId: string
  customerId: string
  runnerId?: string | null
  subtotal: number
  deliveryFee?: number | null
  serviceCharge?: number | null
  fairSynqFee: number
  total: number
  customerName: string
  customerPhone: string
  vehicleMake?: string | null
  vehicleColor?: string | null
  vehiclePlate?: string | null
  deliveryStreet?: string | null
  deliveryCity?: string | null
  deliveryZip?: string | null
  estimatedReadyAt?: string | null
  placedAt: string
  acceptedAt?: string | null
  readyAt?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  // Runner custody (delivery tracking): claim/collect timestamps + the runner's identity.
  dispatchedAt?: string | null
  collectedAt?: string | null
  runner?: { user?: { name?: string | null; phone?: string | null } | null } | null
  // Claim-time vehicle SNAPSHOT (item D — columns pending). The driver card reads ONLY
  // these, never the runner's mutable profile: absent → the vehicle line doesn't render.
  runnerVehicleMake?: string | null
  runnerVehicleColor?: string | null
  runnerVehiclePlate?: string | null
  vendor: { id: string; name: string; boothNumber?: string | null }
  orderItems: OrderItem[]
  vendorOrderStatuses?: VendorOrderStatus[]
}

export interface OrderTrackingProps {
  order: Order
  liveStatus: string
  fairSlug: string
  cancelling: boolean
  showCancelModal: boolean
  setShowCancelModal: (v: boolean) => void
  showSupportModal: boolean
  setShowSupportModal: (v: boolean) => void
  onCancel: () => void
  onOrderAgain: () => void
}
