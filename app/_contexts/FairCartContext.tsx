'use client'

/**
 * Fair-scoped cart context.
 *
 * Items are stored in localStorage under `fairsynq-cart-{fairSlug}` so each
 * fair has an independent cart. The fairSlug (URL param) is used as the stable
 * key — this avoids key changes when the DB fair ID resolves asynchronously.
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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  menuItemId: string
  vendorId: string
  vendorName: string
  name: string
  price: number
  quantity: number
  prepTime?: number
  imageUrl?: string | null
}

/** Minimal vendor shape accepted by addItem */
export interface AddableVendor {
  id: string
  name: string
}

/** Minimal menu item shape accepted by addItem */
export interface AddableMenuItem {
  id: string
  name: string
  price: number
  prepTime?: number
  imageUrl?: string | null
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
  addItem: (item: AddableMenuItem, vendor: AddableVendor) => void
  removeItem: (menuItemId: string) => void
  updateQty: (menuItemId: string, quantity: number) => void
  clearCart: () => void
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: FairCartState, action: CartAction): FairCartState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state

    case 'ADD_ITEM': {
      const { item } = action
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

interface FairCartProviderProps {
  fairSlug: string
  children: ReactNode
}

export function FairCartProvider({ fairSlug, children }: FairCartProviderProps) {
  const storageKey = `fairsynq-cart-${fairSlug}`

  const [state, dispatch] = useReducer(reducer, {
    fairId: fairSlug,
    vendorId: null,
    items: [],
  })

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored) as FairCartState
        if (parsed.fairId === fairSlug) {
          dispatch({ type: 'HYDRATE', state: parsed })
        }
      }
    } catch {
      // ignore malformed data
    }
  }, [storageKey, fairSlug])

  // Persist to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state, storageKey])

  const addItem = useCallback(
    (menuItem: AddableMenuItem, vendor: AddableVendor) => {
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
    [],
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

  const itemCount = useMemo(
    () => state.items.reduce((sum, i) => sum + i.quantity, 0),
    [state.items],
  )

  const subtotal = useMemo(
    () => parseFloat(state.items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2)),
    [state.items],
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
    }),
    [state.items, state.vendorId, itemCount, subtotal, addItem, removeItem, updateQty, clearCart],
  )

  return <FairCartContext.Provider value={value}>{children}</FairCartContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFairCart(): FairCartContextValue {
  const ctx = useContext(FairCartContext)
  if (!ctx) throw new Error('useFairCart must be used inside <FairCartProvider>')
  return ctx
}
