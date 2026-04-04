'use client'

/**
 * Fair-scoped cart context.
 *
 * Items are stored in localStorage under the key `fairsynq-cart-{fairId}` so
 * each fair has an independent cart. The existing SPA checkout reads its own
 * localStorage key (`fairsynq-cart`) — when the user proceeds to checkout from
 * a fair page we copy the active fair's cart into that key so no SPA changes
 * are needed.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { useFair } from './FairContext'
import type { MenuItem, MockVendor } from '@/lib/mock'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  menuItemId: string
  vendorId: string
  vendorName: string
  name: string
  price: number
  quantity: number
  prepTime?: number
  imageUrl?: string
}

interface FairCartState {
  fairId: string
  vendorId: string | null   // all items must be from the same vendor
  items: CartItem[]
}

type CartAction =
  | { type: 'ADD_ITEM'; item: CartItem }
  | { type: 'REMOVE_ITEM'; menuItemId: string }
  | { type: 'UPDATE_QTY'; menuItemId: string; quantity: number }
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; state: FairCartState }

interface FairCartContextValue {
  items: CartItem[]
  vendorId: string | null
  itemCount: number
  subtotal: number
  addItem: (item: MenuItem, vendor: MockVendor) => void
  removeItem: (menuItemId: string) => void
  updateQty: (menuItemId: string, quantity: number) => void
  clearCart: () => void
  /** Copy this fair's cart into the legacy SPA cart key before navigating to checkout */
  syncToSpaCart: () => void
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: FairCartState, action: CartAction): FairCartState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state

    case 'ADD_ITEM': {
      const { item } = action
      // Switching vendors clears the cart
      if (state.vendorId && state.vendorId !== item.vendorId) {
        return { ...state, vendorId: item.vendorId, items: [{ ...item, quantity: 1 }] }
      }
      const existing = state.items.find((i) => i.menuItemId === item.menuItemId)
      if (existing) {
        return {
          ...state,
          vendorId: item.vendorId,
          items: state.items.map((i) =>
            i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        }
      }
      return {
        ...state,
        vendorId: item.vendorId,
        items: [...state.items, { ...item, quantity: 1 }],
      }
    }

    case 'REMOVE_ITEM': {
      const items = state.items.filter((i) => i.menuItemId !== action.menuItemId)
      return { ...state, items, vendorId: items.length === 0 ? null : state.vendorId }
    }

    case 'UPDATE_QTY': {
      if (action.quantity <= 0) {
        const items = state.items.filter((i) => i.menuItemId !== action.menuItemId)
        return { ...state, items, vendorId: items.length === 0 ? null : state.vendorId }
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.menuItemId === action.menuItemId ? { ...i, quantity: action.quantity } : i
        ),
      }
    }

    case 'CLEAR':
      return { ...state, vendorId: null, items: [] }

    default:
      return state
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const FairCartContext = createContext<FairCartContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FairCartProvider({ children }: { children: ReactNode }) {
  const { fair } = useFair()
  const storageKey = `fairsynq-cart-${fair.id}`

  const [state, dispatch] = useReducer(reducer, {
    fairId: fair.id,
    vendorId: null,
    items: [],
  })

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as FairCartState
        if (parsed.fairId === fair.id) {
          dispatch({ type: 'HYDRATE', state: parsed })
        }
      }
    } catch {
      // ignore malformed data
    }
  }, [storageKey, fair.id])

  // Persist to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state, storageKey])

  const addItem = useCallback(
    (menuItem: MenuItem, vendor: MockVendor) => {
      dispatch({
        type: 'ADD_ITEM',
        item: {
          menuItemId: menuItem.id,
          vendorId: vendor.id,
          vendorName: vendor.name,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          prepTime: menuItem.prepTime,
          imageUrl: menuItem.imageUrl,
        },
      })
    },
    []
  )

  const removeItem = useCallback((menuItemId: string) => {
    dispatch({ type: 'REMOVE_ITEM', menuItemId })
  }, [])

  const updateQty = useCallback((menuItemId: string, quantity: number) => {
    dispatch({ type: 'UPDATE_QTY', menuItemId, quantity })
  }, [])

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR' })
  }, [])

  const syncToSpaCart = useCallback(() => {
    // The legacy SPA cart items have a slightly different shape — map across
    const spaItems = state.items.map((i) => ({
      id: i.menuItemId,
      vendorId: i.vendorId,
      vendorName: i.vendorName,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      prepTime: i.prepTime,
      imageUrl: i.imageUrl,
    }))
    localStorage.setItem('fairsynq-cart', JSON.stringify(spaItems))
  }, [state.items])

  const itemCount = useMemo(
    () => state.items.reduce((sum, i) => sum + i.quantity, 0),
    [state.items]
  )

  const subtotal = useMemo(
    () => parseFloat(state.items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2)),
    [state.items]
  )

  const value = useMemo<FairCartContextValue>(
    () => ({
      items: state.items,
      vendorId: state.vendorId,
      itemCount,
      subtotal,
      addItem,
      removeItem,
      updateQty,
      clearCart,
      syncToSpaCart,
    }),
    [state.items, state.vendorId, itemCount, subtotal, addItem, removeItem, updateQty, clearCart, syncToSpaCart]
  )

  return <FairCartContext.Provider value={value}>{children}</FairCartContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFairCart(): FairCartContextValue {
  const ctx = useContext(FairCartContext)
  if (!ctx) throw new Error('useFairCart must be used inside <FairCartProvider>')
  return ctx
}
