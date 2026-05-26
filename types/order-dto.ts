export interface OrderItemDTO {
  quantity: number
  itemName: string
  vendorName: string | null
}

export interface OrderDTO {
  id: string
  status: string
  placedAt: string          // ISO string
  total: number
  subtotal: number
  fulfillmentType: string
  vendor: {
    name: string
    boothNumber: string | null
    event: {
      id: string
      name: string
      urlSlug: string
      primaryColor: string
      startDate: string     // ISO string
    } | null
  } | null
  items: OrderItemDTO[]
}
