import { useEffect, useRef, useState } from 'react';
import { Loader2, PackageSearch, Search } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
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
        style={{ backgroundColor: `${store.brandColor}12` }}
      >
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: store.brandColor }}
          >
            Discover our collection
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            {store.name}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            {store.description ||
              'Browse current products, check availability and place an order directly with this business.'}
          </p>
          <div className="mt-7 max-w-xl">
            <FormField
              label="Search products"
              type="search"
              placeholder="Search by product, category or code"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              trailing={<Search className="h-4 w-4 text-slate-400" aria-hidden="true" />}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                categoryId === null
                  ? 'text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
              style={categoryId === null ? { backgroundColor: store.brandColor } : undefined}
            >
              All products
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                  categoryId === category.id
                    ? 'text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
                style={
                  categoryId === category.id
                    ? { backgroundColor: store.brandColor }
                    : undefined
                }
              >
                {category.name}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
            >
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="name">Name</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
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
            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <StoreProductCard
                  key={product.id}
                  product={product}
                  storeSlug={store.slug}
                />
              ))}
            </div>

            {products.length < count ? (
              <div className="mt-10 flex justify-center">
                <Button
                  variant="secondary"
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
