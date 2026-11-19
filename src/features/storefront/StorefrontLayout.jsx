import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Menu,
  Minus,
  Plus,
  ShoppingBag,
  Store as StoreIcon,
  Trash2,
  X,
} from 'lucide-react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatCurrency } from '../../utils/format';
import { StorefrontContext } from './StorefrontContext';
import {
  getPublicStore,
  toStorefrontServiceError,
} from './storefrontService';
import {
  addCartItem,
  cartItemKey,
  clearCart,
  formatCartLineTotal,
  getCartCount,
  readCart,
  removeCartItem,
  updateCartItemQuantity,
} from './storefrontUtils';

export default function StorefrontLayout() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cart, setCart] = useState(() => readCart(storeSlug));
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let active = true;

    getPublicStore(storeSlug)
      .then((data) => {
        if (!active) return;
        setStore(data);
        setError('');
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(toStorefrontServiceError(loadError).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [storeSlug]);

  const handleAddToCart = (item) => {
    setCart(addCartItem(storeSlug, item));
    setCartOpen(true);
  };

  const handleUpdateQuantity = (key, quantity) => {
    setCart(updateCartItemQuantity(storeSlug, key, quantity));
  };

  const handleRemoveItem = (key) => {
    setCart(removeCartItem(storeSlug, key));
  };

  const handleClearCart = () => {
    clearCart(storeSlug);
    setCart([]);
  };

  const cartCount = getCartCount(cart);
  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const accent = store?.brandColor ?? '#4f46e5';

  const contextValue = {
    store,
    storeSlug,
    cart,
    cartCount,
    subtotal,
    addToCart: handleAddToCart,
    updateQuantity: handleUpdateQuantity,
    removeItem: handleRemoveItem,
    clearCart: handleClearCart,
    cartOpen,
    setCartOpen,
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading store…
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg">
          <Alert variant="error" title="Store unavailable">
            {error || 'This online store could not be found.'}
          </Alert>
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => navigate('/login')}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to OrderFlow AI
          </Button>
        </div>
      </div>
    );
  }

  return (
    <StorefrontContext.Provider value={contextValue}>
      <div
        className="sf-root min-h-screen bg-slate-50 text-slate-900"
        style={{ '--sf-accent': accent }}
      >
        <header
          className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"
          style={{ borderTopColor: accent, borderTopWidth: 2 }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link
              to={`/store/${store.slug}`}
              className="flex min-w-0 items-center gap-3"
            >
              {store.logoUrl ? (
                <img
                  src={store.logoUrl}
                  alt={`${store.name} logo`}
                  className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                />
              ) : (
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {store.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold tracking-tight text-slate-900">
                  {store.name}
                </span>
                <span className="block text-xs text-slate-500">Online store</span>
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <nav className="hidden items-center gap-1 sm:flex">
                <Link
                  to={`/store/${store.slug}`}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  Shop
                </Link>
                {store.contactEmail || store.contactPhone ? (
                  <a
                    href={
                      store.contactEmail
                        ? `mailto:${store.contactEmail}`
                        : `tel:${store.contactPhone}`
                    }
                    className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    Contact
                  </a>
                ) : null}
              </nav>

              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="relative inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Cart</span>
                {cartCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ring-2 ring-white" style={{ backgroundColor: accent }}>
                    {cartCount}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 sm:hidden"
                aria-label="Toggle navigation"
              >
                {mobileOpen ? (
                  <X className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Menu className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {mobileOpen ? (
            <nav className="border-t border-slate-200 bg-white px-4 py-3 sm:hidden">
              <Link
                to={`/store/${store.slug}`}
                onClick={() => setMobileOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Shop all products
              </Link>
              {store.contactEmail || store.contactPhone ? (
                <a
                  href={
                    store.contactEmail
                      ? `mailto:${store.contactEmail}`
                      : `tel:${store.contactPhone}`
                  }
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Contact business
                </a>
              ) : null}
            </nav>
          ) : null}
        </header>

        <main>
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 bg-white py-12">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6 lg:px-8">
            <div className="text-sm text-slate-500">
              <p className="font-extrabold tracking-tight text-slate-900">{store.name}</p>
              {store.description ? (
                <p className="mt-2 max-w-2xl leading-6">{store.description}</p>
              ) : null}
              {store.contactAddress ? (
                <p className="mt-2">{store.contactAddress}</p>
              ) : null}
            </div>
            <div className="text-sm sm:text-right">
              <p className="sf-kicker">OrderFlow AI</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Live catalogue prices. Business-approved orders. No payment collected here.
              </p>
            </div>
          </div>
        </footer>

        {cartOpen ? (
          <div className="fixed inset-0 z-50 flex justify-end">
            <button
              type="button"
              aria-label="Close cart"
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setCartOpen(false)}
            />
            <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-slate-900">Your cart</p>
                  <p className="text-xs text-slate-500">{cartCount} item{cartCount === 1 ? '' : 's'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close cart"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {cart.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <StoreIcon className="h-10 w-10 text-slate-300" aria-hidden="true" />
                    <p className="mt-3 text-sm font-medium text-slate-700">Your cart is empty</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Browse the collection and add products you want.
                    </p>
                    <Button
                      className="mt-5"
                      variant="secondary"
                      onClick={() => {
                        setCartOpen(false);
                        navigate(`/store/${store.slug}`);
                      }}
                    >
                      Continue shopping
                    </Button>
                  </div>
                ) : (
                  <ul className="space-y-4">
                    {cart.map((item) => {
                      const key = cartItemKey(item);
                      return (
                        <li key={key} className="flex gap-3 border-b border-slate-100 pb-4">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                            {item.variantName ? (
                              <p className="text-xs text-slate-500">{item.variantName}</p>
                            ) : null}
                            <p className="mt-0.5 text-sm font-semibold text-slate-800">
                              {formatCartLineTotal(item)}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="inline-flex items-center rounded-lg border border-slate-200">
                                <button
                                  type="button"
                                  className="p-1.5 text-slate-500 hover:text-slate-900"
                                  onClick={() => handleUpdateQuantity(key, item.quantity - 1)}
                                  aria-label={`Decrease ${item.name} quantity`}
                                >
                                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <span className="w-7 text-center text-sm">{item.quantity}</span>
                                <button
                                  type="button"
                                  className="p-1.5 text-slate-500 hover:text-slate-900"
                                  onClick={() => handleUpdateQuantity(key, item.quantity + 1)}
                                  aria-label={`Increase ${item.name} quantity`}
                                >
                                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(key)}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Remove
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="border-t border-slate-200 bg-white px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="text-lg font-semibold text-slate-900">
                    {formatCurrency(subtotal, { currency: store.currency })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Final total is confirmed from live catalogue prices at checkout.
                </p>
                <Button
                  className="mt-4 h-11 w-full rounded-xl"
                  disabled={cart.length === 0}
                  onClick={() => {
                    setCartOpen(false);
                    navigate(`/store/${store.slug}/checkout`);
                  }}
                >
                  Proceed to checkout
                </Button>
                {cart.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleClearCart}
                    className="mt-3 w-full text-center text-xs font-medium text-slate-500 hover:text-red-600"
                  >
                    Clear cart
                  </button>
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}

        <div className="fixed bottom-4 right-4 z-40 sm:hidden">
          {cartCount > 0 ? (
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-xl"
              style={{ backgroundColor: accent }}
            >
              <Badge className="border-0 bg-white/20 text-white ring-0">{cartCount}</Badge>
              View cart
            </button>
          ) : null}
        </div>
      </div>
    </StorefrontContext.Provider>
  );
}
