import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  MessageCircle,
  PackageSearch,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { useStorefront } from './StorefrontContext';
import StoreProductCard from './components/StoreProductCard';
import {
  listStorefrontCategories,
  searchStorefrontProducts,
  toStorefrontServiceError,
} from './storefrontService';

const PAGE_SIZE = 24;

export default function PublicStorefrontPage() {
  const { store, storeSlug } = useStorefront();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [sort, setSort] = useState('featured');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    listStorefrontCategories(storeSlug)
      .then((rows) => {
        if (active) setCategories(rows);
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, [storeSlug]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setCategoryId(null);
      setProducts([]);
      setCount(0);
      setLoading(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;

    searchStorefrontProducts({
      storeSlug,
      search,
      categoryId,
      sort,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setProducts(result.data);
        setCount(result.count);
        setError('');
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toStorefrontServiceError(loadError).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [storeSlug, search, categoryId, sort]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const result = await searchStorefrontProducts({
        storeSlug,
        search,
        categoryId,
        sort,
        limit: PAGE_SIZE,
        offset: products.length,
      });
      setProducts((current) => [...current, ...result.data]);
      setCount(result.count);
      setError('');
    } catch (loadError) {
      setError(toStorefrontServiceError(loadError).message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <section
        className="border-b border-slate-200"
        style={{ backgroundColor: `${store.brandColor}0b` }}
      >
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] lg:items-end">
            <div>
              <p className="sf-kicker">Curated for you</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-extrabold tracking-[-0.045em] text-slate-900 sm:text-6xl">
                {store.name}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
                {store.description ||
                  'Browse current products, check availability and place an order directly with this business.'}
              </p>

              <label className="sf-surface mt-8 flex max-w-xl items-center gap-3 px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-slate-900/10">
                <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search products, categories or codes"
                  aria-label="Search products"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </label>
            </div>

            <div className="sf-surface p-6 sm:p-7">
              <p className="text-sm font-bold text-slate-900">A simpler way to order</p>
              <div className="mt-5 space-y-5">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 sf-accent-text" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Live catalogue prices</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Prices and availability are confirmed before your order is created.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 sf-accent-text" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">WhatsApp support</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Continue your order in chat and get confirmation from the business.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="sf-kicker">The collection</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Browse all products
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? 'Loading products…' : `${count} available product${count === 1 ? '' : 's'}`}
            </p>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-600">
            <span className="font-medium">Sort by</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm outline-none"
            >
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="name">Name</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              categoryId === null
                ? 'sf-accent-bg text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            All products
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                categoryId === category.id
                  ? 'sf-accent-bg text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {error ? (
          <Alert className="mt-6" variant="error" title="Could not load products">
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-slate-600">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Loading products…
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon={PackageSearch}
            title="No products found"
            description="Try a different search or category. This store publishes products only after the business makes them available."
          />
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <StoreProductCard
                  key={product.id}
                  product={product}
                  storeSlug={store.slug}
                />
              ))}
            </div>

            {products.length < count ? (
              <div className="mt-12 flex justify-center">
                <Button
                  variant="secondary"
                  className="h-11 rounded-xl px-6"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Load more products
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
