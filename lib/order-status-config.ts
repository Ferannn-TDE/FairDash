export const ORDER_STATUS_CONFIG: Record<string, {
  label: string
  color: string
  textColor: string
  borderColor: string
  dotColor: string
}> = {
  PLACED:           { label: 'Order Placed',     color: 'bg-amber-500/10',  textColor: 'text-amber-400',  borderColor: 'border-amber-400/20',  dotColor: 'bg-amber-400'  },
  PENDING_PAYMENT:  { label: 'Waiting',          color: 'bg-amber-500/10',  textColor: 'text-amber-400',  borderColor: 'border-amber-400/20',  dotColor: 'bg-amber-400'  },
  ACCEPTED:         { label: 'Accepted',         color: 'bg-blue-500/10',   textColor: 'text-blue-400',   borderColor: 'border-blue-400/20',   dotColor: 'bg-blue-400'   },
  PREPARING:        { label: 'Preparing',        color: 'bg-blue-500/10',   textColor: 'text-blue-400',   borderColor: 'border-blue-400/20',   dotColor: 'bg-blue-400'   },
  READY:            { label: 'Ready',            color: 'bg-green-500/10',  textColor: 'text-green-400',  borderColor: 'border-green-400/20',  dotColor: 'bg-green-400'  },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', color: 'bg-green-500/10',  textColor: 'text-green-400',  borderColor: 'border-green-400/20',  dotColor: 'bg-green-400'  },
  RUNNER_COLLECTED: { label: 'On the Way',       color: 'bg-green-500/10',  textColor: 'text-green-400',  borderColor: 'border-green-400/20',  dotColor: 'bg-green-400'  },
  DELIVERED:        { label: 'Delivered',        color: 'bg-green-500/10',  textColor: 'text-green-400',  borderColor: 'border-green-400/20',  dotColor: 'bg-green-400'  },
  COMPLETED:        { label: 'Completed',        color: 'bg-green-500/10',  textColor: 'text-green-400',  borderColor: 'border-green-400/20',  dotColor: 'bg-green-400'  },
  DECLINED:         { label: 'Declined',         color: 'bg-red-500/10',    textColor: 'text-red-400',    borderColor: 'border-red-400/20',    dotColor: 'bg-red-400'    },
  CANCELLED:        { label: 'Cancelled',        color: 'bg-red-500/10',    textColor: 'text-red-400',    borderColor: 'border-red-400/20',    dotColor: 'bg-red-400'    },
  UNCOLLECTED:      { label: 'Uncollected',      color: 'bg-red-500/10',    textColor: 'text-red-400',    borderColor: 'border-red-400/20',    dotColor: 'bg-red-400'    },
  UNDELIVERABLE:    { label: 'Undeliverable',    color: 'bg-red-500/10',    textColor: 'text-red-400',    borderColor: 'border-red-400/20',    dotColor: 'bg-red-400'    },
}

export function getStatusConfig(status: string) {
  return ORDER_STATUS_CONFIG[status] ?? {
    label: status,
    color: 'bg-white/10',
    textColor: 'text-white/60',
    borderColor: 'border-white/20',
    dotColor: 'bg-white/40',
  }
}
