import { formatCurrency } from '../../utils/format';

export const CART_STORAGE_PREFIX = 'orderflow.storefront.cart';

export function getCartStorageKey(storeSlug) {
  return `${CART_STORAGE_PREFIX}.${storeSlug}`;
}

export function normalizeCartItem(item) {
  if (!item?.productId) return null;
  return {
    productId: String(item.productId),
    variantId: item.variantId ? String(item.variantId) : null,
    name: String(item.name ?? 'Product'),
    variantName: item.variantName ? String(item.variantName) : '',
    imageUrl: item.imageUrl || null,
    price: Number(item.price ?? 0),
    currency: String(item.currency ?? 'RWF'),
    quantity: Math.min(100, Math.max(1, Math.floor(Number(item.quantity) || 1))),
    inStock: item.inStock !== false,
    isTracked: Boolean(item.isTracked),
  };
}

export function cartItemKey(item) {
  return `${item.productId}::${item.variantId ?? ''}`;
}

export function readCart(storeSlug) {
  if (!storeSlug || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getCartStorageKey(storeSlug));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCartItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeCart(storeSlug, items) {
  if (!storeSlug || typeof window === 'undefined') return;
  const normalized = items.map(normalizeCartItem).filter(Boolean);
  window.localStorage.setItem(
    getCartStorageKey(storeSlug),
    JSON.stringify(normalized),
  );
}

export function addCartItem(storeSlug, incoming) {
  const item = normalizeCartItem(incoming);
  if (!item) return readCart(storeSlug);
  if (!item.inStock) return readCart(storeSlug);

  const items = readCart(storeSlug);
  const key = cartItemKey(item);
  const existingIndex = items.findIndex((candidate) => cartItemKey(candidate) === key);

  if (existingIndex === -1) {
    const next = [...items, item];
    writeCart(storeSlug, next);
    return next;
  }

  const next = items.map((candidate, index) =>
    index === existingIndex
      ? {
          ...candidate,
          quantity: Math.min(100, candidate.quantity + item.quantity),
          name: item.name,
          variantName: item.variantName,
          imageUrl: item.imageUrl || candidate.imageUrl,
          price: item.price,
          currency: item.currency,
          inStock: item.inStock,
          isTracked: item.isTracked,
        }
      : candidate,
  );
  writeCart(storeSlug, next);
  return next;
}

export function updateCartItemQuantity(storeSlug, key, quantity) {
  const items = readCart(storeSlug);
  const next = items
    .map((item) =>
      cartItemKey(item) === key
        ? { ...item, quantity: Math.min(100, Math.max(1, Math.floor(Number(quantity) || 1))) }
        : item,
    )
    .filter((item) => item.quantity > 0);
  writeCart(storeSlug, next);
  return next;
}

export function removeCartItem(storeSlug, key) {
  const next = readCart(storeSlug).filter((item) => cartItemKey(item) !== key);
  writeCart(storeSlug, next);
  return next;
}

export function clearCart(storeSlug) {
  if (!storeSlug || typeof window === 'undefined') return;
  window.localStorage.removeItem(getCartStorageKey(storeSlug));
}

export function buildCheckoutUrl(checkoutPath) {
  if (typeof window === 'undefined') return checkoutPath;
  return new URL(checkoutPath, window.location.origin).toString();
}

export function buildWhatsAppHandoffUrl({ phone, storeName, checkoutPath }) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;

  const checkoutUrl = buildCheckoutUrl(checkoutPath);
  const message = `Hello ${storeName}, I would like to continue this order: ${checkoutUrl}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function getCartCount(items) {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function getCartSubtotal(items) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

export function formatCartLineTotal(item) {
  return formatCurrency(item.price * item.quantity, { currency: item.currency });
}

export function getAvailabilityLabel(availability) {
  if (availability === 'in_stock') return 'In stock';
  if (availability === 'out_of_stock') return 'Out of stock';
  return 'Available';
}

export function getAvailabilityVariant(availability) {
  if (availability === 'in_stock') return 'success';
  if (availability === 'out_of_stock') return 'danger';
  return 'neutral';
}
