import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ImageOff,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { formatCurrency } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  listProducts,
  loadCatalogueMeta,
  toCatalogueServiceError,
  updateProductStatus,
} from '../../services/catalogueService';
import {
  canManageTaxonomy,
  getStatusBadge,
  PRODUCT_STATUS_OPTIONS,
} from './catalogueUtils';

const PAGE_SIZE = 12;

export default function ProductsPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({
    search: '',
    categoryId: '',
    brandId: '',
    status: '',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState({ categories: [], brands: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [archivingId, setArchivingId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    loadCatalogueMeta(businessId)
      .then((result) => {
        if (active) setMeta(result);
      })
      .catch((loadError) => {
        if (active) setError(toCatalogueServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;

    if (!businessId) return undefined;

    listProducts({
      businessId,
      search: debouncedSearch,
      categoryId: filters.categoryId,
      brandId: filters.brandId,
      status: filters.status,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setProducts(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toCatalogueServiceError(loadError).message);
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    businessId,
    debouncedSearch,
    filters.categoryId,
    filters.brandId,
    filters.status,
    page,
    refreshKey,
  ]);

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setLoading(true);
  }, []);

  const clearFilters = () => {
    setFilters({ search: '', categoryId: '', brandId: '', status: '' });
    setDebouncedSearch('');
    setPage(1);
    setLoading(true);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    setPage(nextPage);
  };

  const handleArchive = async (product) => {
    if (
      !window.confirm(
        `Archive "${product.name}"? It will stay in your records but leave the active catalogue.`,
      )
    ) {
      return;
    }

    setArchivingId(product.id);
    setError('');
    setSuccess('');

    try {
      await updateProductStatus({
        businessId,
        productId: product.id,
        status: 'archived',
      });
      setSuccess(`"${product.name}" was archived.`);
      setRefreshKey((current) => current + 1);
    } catch (archiveError) {
      setError(toCatalogueServiceError(archiveError).message);
    } finally {
      setArchivingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    Boolean(filters.search) ||
    Boolean(filters.categoryId) ||
    Boolean(filters.brandId) ||
    Boolean(filters.status);
  const canManage = canManageTaxonomy(activeMembership?.role);

  return (
    <section className="space-y-6" aria-labelledby="catalogue-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="catalogue-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Product catalogue
            </h2>
            <Badge variant="brand">Live records</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Build the real catalogue customers will discover through conversations.
            Prices use {activeBusiness?.currency ?? 'the workspace currency'}.
          </p>
        </div>

        <Link
          to="/products/new"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add product
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          to="/products/categories"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/40 hover:text-brand-700"
        >
          <Tags className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="flex-1">Categories</span>
          <span className="text-xs text-slate-400">{meta.categories.length}</span>
        </Link>
        <Link
          to="/products/brands"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/40 hover:text-brand-700"
        >
          <Package className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="flex-1">Brands</span>
          <span className="text-xs text-slate-400">{meta.brands.length}</span>
        </Link>
        <Link
          to="/products/attributes"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50/40 hover:text-brand-700"
        >
          <SlidersHorizontal className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="flex-1">Attributes</span>
          <span className="text-xs text-slate-400">{meta.attributes.length}</span>
        </Link>
      </div>

      {!canManage && meta.attributes.length === 0 ? (
        <Alert variant="info">
          Your role can add and edit products. A manager or admin can set up
          categories, brands and reusable attributes.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <FormField
            id="catalogue-search"
            label="Search catalogue"
            type="search"
            placeholder="Product name, SKU or barcode"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            trailing={<Search className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          />
          <SelectField
            id="catalogue-category"
            label="Category"
            value={filters.categoryId}
            onChange={(event) => updateFilter('categoryId', event.target.value)}
            options={meta.categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            placeholder="All categories"
          />
          <SelectField
            id="catalogue-brand"
            label="Brand"
            value={filters.brandId}
            onChange={(event) => updateFilter('brandId', event.target.value)}
            options={meta.brands.map((brand) => ({
              value: brand.id,
              label: brand.name,
            }))}
            placeholder="All brands"
          />
          <SelectField
            id="catalogue-status"
            label="Status"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            options={PRODUCT_STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <Button
            variant="ghost"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="h-10"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Loading products…'
            : `${total} product${total === 1 ? '' : 's'} in this workspace`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading products"
          />
        ) : null}
      </div>

      {!loading && products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? 'No products match these filters' : 'No products yet'}
          description={
            hasFilters
              ? 'Clear the filters or try a different search.'
              : 'Add your first product, then attach real photos and variants.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link
                to="/products/new"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add product
              </Link>
            )
          }
        />
      ) : null}

      {products.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const statusBadge = getStatusBadge(product.status);
            return (
              <article
                key={product.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-100">
                  {product.primaryImageUrl ? (
                    <img
                      src={product.primaryImageUrl}
                      alt={product.primaryImageAlt || product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff
                      className="h-8 w-8 text-slate-300"
                      aria-label="No product image"
                    />
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-900">
                        {product.name}
                      </h3>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {product.sku ? `SKU ${product.sku}` : 'No SKU'}
                        {product.barcode ? ` · ${product.barcode}` : ''}
                      </p>
                    </div>
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
                    {product.categoryName ? (
                      <Badge variant="neutral">{product.categoryName}</Badge>
                    ) : null}
                    {product.brandName ? (
                      <Badge variant="neutral">{product.brandName}</Badge>
                    ) : null}
                    <Badge variant="neutral">
                      {product.variantCount} variant
                      {product.variantCount === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="text-base font-semibold text-slate-900">
                      {formatCurrency(product.price, {
                        currency: product.currency,
                      })}
                    </p>
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/products/${product.id}/edit`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Link>
                      {product.status !== 'archived' ? (
                        <button
                          type="button"
                          onClick={() => handleArchive(product)}
                          disabled={archivingId === product.id}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {archivingId === product.id ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          Archive
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm sm:flex-row">
          <p className="text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => changePage(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => changePage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
