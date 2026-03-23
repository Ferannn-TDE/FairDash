import { createContext, useContext, useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const CartContext = createContext();

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
};

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState(() => {
    // Migrate from old key if present
    const legacy = localStorage.getItem('fairdash-cart');
    if (legacy) {
      localStorage.setItem('fairsynq-cart', legacy);
      localStorage.removeItem('fairdash-cart');
    }
    const savedCart = localStorage.getItem('fairsynq-cart');
    return savedCart ? JSON.parse(savedCart) : [];
  });

  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('fairsynq-cart', JSON.stringify(cart));
  }, [cart]);

  // Returns true if added, false if vendor conflict was rejected
  const addToCart = (item) => {
    setCart(prevCart => {
      // Enforce single-vendor cart
      if (prevCart.length > 0 && prevCart[0].vendorId && item.vendorId && prevCart[0].vendorId !== item.vendorId) {
        // Auto-clear and start fresh with new vendor
        toast(`Cart cleared — now ordering from ${item.vendorName || 'new vendor'}`, {
          icon: '🔄',
          style: { background: '#1a1a1a', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' },
        });
        return [{ ...item, quantity: 1 }];
      }

      const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
      if (existingItem) {
        return prevCart.map(cartItem =>
          cartItem.id === item.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }

      return [...prevCart, { ...item, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (itemId) => {
    setCart(prevCart => prevCart.filter(item => item.id !== itemId));
  };

  const updateQuantity = (itemId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(itemId);
      return;
    }
    setCart(prevCart =>
      prevCart.map(item =>
        item.id === itemId ? { ...item, quantity } : item
      )
    );
  };

  const clearCart = () => {
    setCart([]);
  };

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getCartCount = () => {
    return cart.reduce((count, item) => count + item.quantity, 0);
  };

  // Extract vendorId / eventId from cart items (all items should be same vendor)
  const cartVendorId = cart[0]?.vendorId ?? null;
  const cartEventId = cart[0]?.eventId ?? null;

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        getCartTotal,
        getCartCount,
        isCartOpen,
        setIsCartOpen,
        cartVendorId,
        cartEventId,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};
