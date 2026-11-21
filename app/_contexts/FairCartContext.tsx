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
import toast from 'react-hot-toast'
import { useFair } from './FairContext'
import {
  cartCalculatorLines,
  cartPricing,
  fromCents,
  safeMarkupBps,
  type CartPricing,
  type CheckoutLine,
} from '@/lib/checkout-total'
import {
  MAX_ITEMS_PER_ORDER,
  ORDER_ITEM_LIMIT_MESSAGE,
  QUANTITY_LIMIT_MESSAGE,
  addBlockReason as addBlockReasonFor,
  capQuantity,
  limitBreach,
  mergeLines,
  trimToLimits,
  type OrderLimitCode,
} from '@/lib/order-limits'

// ONLINE PRICES (audit H5, step 2h): every price the cart shows comes from lib/checkout-total.ts,
// the calculator the server charges with, using each line's in-person price and the fair's markup.
// The stored `price` is kept only as the fallback for carts saved before 2h (see cartInPersonCents).
//
// ORDER LIMITS (Jordan, Nov 17; batch 1b): every change to the cart stays within lib/order-limits.ts
// (at most 5 of one dish, all sizes together; at most 15 items in all). An add that would go over
// does nothing, a quantity change is capped, and a saved cart or "order again" over the limits is
// trimmed WITH the matching fixed sentence, never silently. The server re-checks every limit.

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
  /**
   * Which dish this line is a size of (lib/order-limits.ts dishKeyFor), so the 5-per-dish limit
   * counts all sizes together. Kept in this browser's cart only and NEVER sent to the server: the
   * checkout sends menuItemId, vendorId and quantity. Missing on carts saved before batch 1b; such a
   * line counts as its own size (the server still counts all sizes together).
   */
  dishKey?: string
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
  /** The dish this item is a size of (lib/order-limits.ts). See CartItem.dishKey. */
  dishKey?: string
}

/** What a trim did: which fixed sentences were shown. */
export interface CartTrim {
  dishTrimmed: boolean
  totalTrimmed: boolean
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
  | { type: 'REPLACE'; items: CartItem[] }

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
  /**
   * Replaces the whole cart (used by "order again"). Lines of the same item are joined, then the
   * cart is trimmed to the limits; each matching fixed sentence is shown once.
   */
  replaceCart: (lines: ReadonlyArray<{ item: AddableMenuItem; vendor: AddableVendor }>) => CartTrim
  /** Would one more of this dish break a limit? Which one, or null if it may be added. */
  addBlockReason: (dishKey: string) => OrderLimitCode | null
  /** The cart holds MAX_ITEMS_PER_ORDER items: show ORDER_ITEM_LIMIT_MESSAGE. */
  atOrderLimit: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A saved cart is untrusted data: keep only lines the calculator can price (a whole quantity of at
 * least 1 and a menu item id). Old lines without inPersonPrice are kept; see cartInPersonCents in
 * lib/checkout-total.ts for why that is safe.
 */
function savedCartLines(items: CartItem[] | undefined): CartItem[] {
  return (Array.isArray(items) ? items : []).filter(i =>
    i && typeof i.menuItemId === 'string' && Number.isInteger(i.quantity) && i.quantity >= 1)
}

/** One cart line from a menu item, quantity 1 (used by addItem and replaceCart). */
function toCartItem(menuItem: AddableMenuItem, vendor: AddableVendor): CartItem {
  return {
    menuItemId: menuItem.id,
    vendorId: vendor.id,
    vendorName: vendor.name,
    name: menuItem.name,
    price: menuItem.price,
    inPersonPrice: menuItem.inPersonPrice,
    quantity: 1,
    prepTime: menuItem.prepTime,
    imageUrl: menuItem.imageUrl,
    dishKey: menuItem.dishKey,
  }
}

/**
 * Says what a trim cut, each fixed sentence at most once. The fixed toast ids mean a repeated call
 * (React runs effects twice in development) replaces the toast instead of adding a second one.
 */
export function announceCartTrim(trim: CartTrim): void {
  if (trim.totalTrimmed) toast.error(ORDER_ITEM_LIMIT_MESSAGE, { id: 'cart-limit-total' })
  if (trim.dishTrimmed) toast.error(QUANTITY_LIMIT_MESSAGE, { id: 'cart-limit-dish' })
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: FairCartState, action: CartAction): FairCartState {
  switch (action.type) {
    case 'HYDRATE':
      // Filtered (savedCartLines), then brought within the order limits. The hydrate effect works
      // out the same trim to show its sentences.
      return {
        ...action.state,
        items: trimToLimits(savedCartLines(action.state.items)).lines,
      }

    case 'ADD_ITEM': {
      const existing = state.items.find(i => i.menuItemId === action.item.menuItemId)
      const next = existing
        ? state.items.map(i =>
            i.menuItemId === action.item.menuItemId
              ? { ...i, quantity: i.quantity + action.item.quantity, dishKey: i.dishKey ?? action.item.dishKey }
              : i
          )
        : [...state.items, action.item]
      // Over either limit: the add does nothing (the + and Add buttons are disabled before this).
      if (limitBreach(next) !== null) return state
      return { ...state, items: next }
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
      // Capped to what the dish's other sizes and the rest of the cart leave room for.
      const quantity = capQuantity(state.items, action.menuItemId, action.quantity)
      return {
        ...state,
        items: state.items
          .map((i) => (i.menuItemId === action.menuItemId ? { ...i, quantity } : i))
          .filter((i) => i.quantity >= 1),
      }
    }

    case 'REPLACE':
      return { ...state, items: action.items }

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
          // The same trim the reducer applies, worked out here to say what it cut. The trimmed
          // cart is then saved, so the next load has nothing to trim and says nothing.
          const trim = trimToLimits(savedCartLines(parsed.items))
          dispatch({ type: 'HYDRATE', state: parsed })
          announceCartTrim(trim)
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
      dispatch({ type: 'ADD_ITEM', item: toCartItem(menuItem, vendor) })
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

  const replaceCart = useCallback(
    (lines: ReadonlyArray<{ item: AddableMenuItem; vendor: AddableVendor }>): CartTrim => {
      const trim = trimToLimits(mergeLines(lines.map(l => toCartItem(l.item, l.vendor))))
      dispatch({ type: 'REPLACE', items: trim.lines })
      announceCartTrim(trim)
      return { dishTrimmed: trim.dishTrimmed, totalTrimmed: trim.totalTrimmed }
    },
    [],
  )

  const addBlockReason = useCallback(
    (dishKey: string) => addBlockReasonFor(state.items, dishKey),
    [state.items],
  )

  const itemCount = useMemo(
    () => state.items.reduce((sum, i) => sum + i.quantity, 0),
    [state.items],
  )
  const atOrderLimit = itemCount >= MAX_ITEMS_PER_ORDER

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
      replaceCart,
      addBlockReason,
      atOrderLimit,
    }),
    [state.items, itemCount, subtotal, pricing, calculatorLines, markupBps, addItem, removeItem, updateQty, clearCart, replaceCart, addBlockReason, atOrderLimit],
  )

  return <FairCartContext.Provider value={value}>{children}</FairCartContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFairCart(): FairCartContextValue {
  const ctx = useContext(FairCartContext)
  if (!ctx) throw new Error('useFairCart must be used inside <FairCartProvider>')
  return ctx
}
