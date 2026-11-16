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
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { useFair } from './FairContext'
import {
  cartCalculatorLines,
  cartPricing,
  fromCents,
  safeMarkupBps,
  type CartPricing,
  type CheckoutLine,
} from '@/lib/checkout-total'

// ONLINE PRICES (audit H5, step 2h): every price the cart shows comes from lib/checkout-total.ts,
// the calculator the server charges with, using each line's in-person price and the fair's markup.
// The stored `price` is kept only as the fallback for carts saved before 2h (see cartInPersonCents).

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  menuItemId: string
  vendorId: string
  vendorName: string
  name: string
  /** The online price when the item was added. Not used for money: see `inPersonPrice`. */
  price: number
  /** The in-person price the calculator works from. Missing on carts saved before 2h. */
  inPersonPrice?: number
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
  /** The in-person price from the menu payload (variant.inPersonPrice). */
  inPersonPrice?: number
  prepTime?: number
  imageUrl?: string | null
}

interface FairCartState {
  fairId: string
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
  itemCount: number
  /** The online food subtotal, from lib/checkout-total.ts. */
  subtotal: number
  /** Online unit and line prices per cart line, from lib/checkout-total.ts. */
  pricing: CartPricing
  /** The cart in the calculator's form, for the checkout page's checkoutTotals(). */
  calculatorLines: CheckoutLine[]
  /** The fair's markup as the calculator uses it. */
  markupBps: number
  addItem: (item: AddableMenuItem, vendor: AddableVendor) => void
  removeItem: (menuItemId: string) => void
  updateQty: (menuItemId: string, quantity: number) => void
  clearCart: () => void
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: FairCartState, action: CartAction): FairCartState {
  switch (action.type) {
    case 'HYDRATE':
      // A saved cart is untrusted data: keep only lines the calculator can price (a whole
      // quantity of at least 1 and a menu item id). Old lines without inPersonPrice are kept; see
      // cartInPersonCents in lib/checkout-total.ts for why that is safe.
      return {
        ...action.state,
        items: (Array.isArray(action.state.items) ? action.state.items : []).filter(i =>
          i && typeof i.menuItemId === 'string' && Number.isInteger(i.quantity) && i.quantity >= 1),
      }

    case 'ADD_ITEM': {
      const existing = state.items.find(i => i.menuItemId === action.item.menuItemId)
      if (existing) {
        return {
          ...state,
          items: state.items.map(i =>
            i.menuItemId === action.item.menuItemId
              ? { ...i, quantity: i.quantity + action.item.quantity }
              : i
          ),
        }
      }
      return { ...state, items: [...state.items, action.item] }
    }

    case 'REMOVE_ITEM': {
      const items = state.items.filter((i) => i.menuItemId !== action.menuItemId)
      return { ...state, items }
    }

    case 'UPDATE_QTY': {
      if (action.quantity <= 0) {
        const items = state.items.filter((i) => i.menuItemId !== action.menuItemId)
        return { ...state, items }
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.menuItemId === action.menuItemId ? { ...i, quantity: action.quantity } : i
        ),
      }
    }

    case 'CLEAR':
      return { ...state, items: [] }

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
  // The fair's markup (FairShell nests this provider inside FairProvider).
  const { fair } = useFair()
  const markupBps = safeMarkupBps(fair.onlineMarkupBps)

  const [state, dispatch] = useReducer(reducer, {
    fairId: fairSlug,
    items: [],
  })

  // Skip the very first persistence write so hydration can read the stored
  // cart before we overwrite it with the initial empty state.
  const skipFirstPersistRef = useRef(true)

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
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false
      return
    }
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
          inPersonPrice: menuItem.inPersonPrice,
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

  // One calculator (lib/checkout-total.ts): the same unit prices checkout charges.
  const pricing = useMemo(() => cartPricing(state.items, markupBps), [state.items, markupBps])
  const calculatorLines = useMemo(() => cartCalculatorLines(state.items), [state.items])
  const subtotal = fromCents(pricing.onlineSubtotalCents)

  const value = useMemo<FairCartContextValue>(
    () => ({
      items: state.items,
      itemCount,
      subtotal,
      pricing,
      calculatorLines,
      markupBps,
      addItem,
      removeItem,
      updateQty,
      clearCart,
    }),
    [state.items, itemCount, subtotal, pricing, calculatorLines, markupBps, addItem, removeItem, updateQty, clearCart],
  )

  return <FairCartContext.Provider value={value}>{children}</FairCartContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFairCart(): FairCartContextValue {
  const ctx = useContext(FairCartContext)
  if (!ctx) throw new Error('useFairCart must be used inside <FairCartProvider>')
  return ctx
}
