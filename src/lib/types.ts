// Shared frontend types for SnakZap.

export interface Restaurant {
  id: string
  name: string
  cuisine: string
  description: string
  image: string
  rating: number
  prepTimeMins: number
  priceForTwo: number
  address: string
  availableItems?: number
  gstNumber?: string
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  image: string
  spiceLevel: number
  isVeg: boolean
  isAvailable: boolean
  category: string
}

export interface OrderItem {
  id?: string
  name: string
  price: number
  quantity: number
  subtotal: number
  menuItemId?: string
}

export interface Order {
  id: string
  status: string
  totalAmount: number
  pickupOtp: string
  isCatering: boolean
  headcount: number | null
  itemsCount: number
  note: string | null
  createdAt: string
  updatedAt: string
  statusHistory: string
  restaurant: { id: string; name: string; cuisine?: string; address?: string; prepTimeMins?: number }
  items: OrderItem[]
}

export interface KillSwitch {
  id: string
  key: string
  label: string
  description: string
  enabled: boolean
  severity: string
  updatedAt: string
}

export interface AuditLog {
  id: string
  actorId: string | null
  actorName: string
  actorRole: string
  action: string
  metadata: string
  createdAt: string
}

export interface AdminMetrics {
  totalOrders: number
  activeOrders: number
  pickedUp: number
  cancelled: number
  revenue: number
  settled: number
  aov: number
  restaurants: number
  activeRestaurants: number
  menuItems: number
  consumers: number
  completionRate: number
  cancellationRate: number
}
