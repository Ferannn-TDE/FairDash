/**
 * Menu data — thin layer over vendorData.
 * Keeps backward compatibility with existing Menu page and Home page imports.
 */
import {
  vendorItems,
  getAllItems,
  getPopularItems as getPopularVendorItems,
  searchVendorItems,
} from './vendorData';

// Derive categories from the unique item categories
export const categories = [
  { id: 'italian', name: 'Italian', emoji: '🍝' },
  { id: 'bbq', name: 'BBQ & Grilled', emoji: '🍖' },
  { id: 'fair-food', name: 'Fair Food', emoji: '🎪' },
  { id: 'desserts', name: 'Desserts', emoji: '🍰' },
  { id: 'drinks', name: 'Drinks', emoji: '🧊' },
  { id: 'specialty', name: 'Specialty', emoji: '✨' },
  { id: 'merchandise', name: 'Merchandise', emoji: '👕' },
];

export const menuItems = vendorItems;

export const getItemsByCategory = (categoryId) => {
  return vendorItems.filter((item) => item.category === categoryId);
};

export const getPopularItems = () => {
  return getPopularVendorItems();
};

export const searchItems = (query) => {
  return searchVendorItems(query);
};
