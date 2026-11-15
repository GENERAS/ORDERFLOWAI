import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  History,
  Layers,
  Loader2,
  PackagePlus,
  PackageX,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  getInventoryOverview,
  listInventory,
  toInventoryServiceError,
} from '../../services/inventoryService';
import { listCategories } from '../../services/catalogueService';
import { formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { EnableTrackingDialog } from './components/EnableTrackingDialog';
import {
  canManageInventory,
  formatQuantity,
  getInventoryStatusBadge,
  INVENTORY_SORT_OPTIONS,
  INVENTORY_STATUS_OPTIONS,
  SORT_DIRECTION_OPTIONS,
} from './inventoryUtils';

const PAGE_SIZE = 12;

const OVERVIEW_TONES = Object.freeze({
  brand: 'border-brand-100 bg-brand-50/70 text-brand-700',
  emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
  amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
  red: 'border-red-100 bg-red-50/70 text-red-700',
});

function OverviewCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${OVERVIEW_TONES[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">
        {value == null ? '—' : formatQuantity(value)}
      </p>
      <p className="mt-1 text-xs opacity-80">{detail}</p>
    </div>
  );
}

export default function InventoryPage() {
  const { activeBusiness, activeMembership } = useAuth();
  const location = useLocation();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    categoryId: '',
    sort: 'name',
    direction: 'asc',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(
    () => location.state?.message ?? '',
  );
  const [dialogItem, setDialogItem] = useState(null);
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

    listCategories(businessId)
      .then((rows) => {
        if (active) setCategories(rows);
      })
      .catch((loadError) => {
        if (active) setError(toInventoryServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    getInventoryOverview(businessId)
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch((loadError) => {
        if (active) setError(toInventoryServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId, refreshKey]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    if (!businessId) return undefined;

    listInventory({
      businessId,
      search: debouncedSearch,
      status: filters.status,
      categoryId: filters.categoryId,
      page,
      pageSize: PAGE_SIZE,
      sort: filters.sort,
      direction: filters.direction,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setItems(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toInventoryServiceError(loadError).message);
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
    filters.status,
    filters.categoryId,
    filters.sort,
    filters.direction,
    page,
    refreshKey,
  ]);

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setLoading(true);
  }, []);

  const clearFilters = () => {
    setFilters({
      search: '',
      status: '',
      categoryId: '',
      sort: 'name',
      direction: 'asc',
    });
    setDebouncedSearch('');
    setPage(1);
    setLoading(true);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    setPage(nextPage);
  };

  const handleTrackingEnabled = (source) => {
    setDialogItem(null);
    setSuccess(
      `${source.variantName ? `${source.productName} · ${source.variantName}` : source.productName} is now tracked.`,
    );
    setLoading(true);
    setRefreshKey((current) => current + 1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    Boolean(filters.search) ||
    Boolean(filters.status) ||
    Boolean(filters.categoryId) ||
    filters.sort !== 'name' ||
    filters.direction !== 'asc';
  const canManage = canManageInventory(activeMembership?.role);

  return (
    <section className="space-y-6" aria-labelledby="inventory-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="inventory-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Inventory
            </h2>
            <Badge variant="brand">Live stock</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Track physical, reserved and available stock with a permanent movement
            history. Quantities are always whole units.
          </p>
          {overview ? (
            <p className="mt-2 text-xs text-slate-400">
              {formatQuantity(overview.movementCount)} movement
              {overview.movementCount === 1 ? '' : 's'} recorded ·{' '}
              {formatQuantity(overview.movementsToday)} today
              {overview.lastMovementAt
                ? ` · last ${formatDateTime(overview.lastMovementAt)}`
                : ''}
            </p>
          ) : null}
        </div>

        <Link
          to="/inventory/movements"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Movement history
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="Available"
          value={overview?.totalAvailable}
          detail={`${formatQuantity(
            overview?.totalPhysical ?? 0,
          )} physical · ${formatQuantity(
            overview?.totalReserved ?? 0,
          )} reserved`}
          icon={Boxes}
          tone="brand"
        />
        <OverviewCard
          label="Tracked units"
          value={overview?.trackedUnits}
          detail={`${formatQuantity(
            overview?.untrackedUnits ?? 0,
          )} not tracked yet`}
          icon={Layers}
          tone="emerald"
        />
        <OverviewCard
          label="Low stock"
          value={overview?.lowStockUnits}
          detail="At or below the configured threshold"
          icon={AlertTriangle}
          tone="amber"
        />
        <OverviewCard
          label="Out of stock"
          value={overview?.outOfStockUnits}
          detail="Tracked units with nothing available"
          icon={PackageX}
          tone="red"
        />
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] xl:items-end">
          <FormField
            id="inventory-search"
            label="Search inventory"
            type="search"
            placeholder="Product, variant, SKU or barcode"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            trailing={
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            }
          />
          <SelectField
            id="inventory-status"
            label="Status"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            options={INVENTORY_STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <SelectField
            id="inventory-category"
            label="Category"
            value={filters.categoryId}
            onChange={(event) => updateFilter('categoryId', event.target.value)}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            placeholder="All categories"
          />
          <SelectField
            id="inventory-sort"
            label="Sort by"
            value={filters.sort}
            onChange={(event) => updateFilter('sort', event.target.value)}
            options={INVENTORY_SORT_OPTIONS}
            placeholder="Item name"
          />
          <SelectField
            id="inventory-direction"
            label="Direction"
            value={filters.direction}
            onChange={(event) => updateFilter('direction', event.target.value)}
            options={SORT_DIRECTION_OPTIONS}
            placeholder="Ascending"
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
            ? 'Loading inventory…'
            : `${formatQuantity(total)} unit${
                total === 1 ? '' : 's'
              } across this workspace`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading inventory"
          />
        ) : null}
      </div>

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={hasFilters ? 'No inventory matches these filters' : 'No products yet'}
          description={
            hasFilters
              ? 'Clear the filters or try a different search.'
              : 'Add products to the catalogue, then enable stock tracking for the items you sell.'
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
                Add product
              </Link>
            )
          }
        />
      ) : null}

      {items.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const statusBadge = getInventoryStatusBadge(item.inventoryStatus);
            const itemLabel = item.variantName
              ? `${item.productName} · ${item.variantName}`
              : item.productName;
            const managesHistory =
              item.isTracked || Boolean(item.inventoryItemId);

            return (
              <article
                key={
                  item.inventoryItemId ??
                  `${item.productId}:${item.variantId ?? 'product'}`
                }
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">
                        {itemLabel}
                      </h3>
                      <Badge variant={statusBadge.variant}>
                        {statusBadge.label}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {item.sku ? `SKU ${item.sku}` : 'No SKU'}
                      {item.categoryName ? ` · ${item.categoryName}` : ''}
                    </p>
                  </div>
                  <SlidersHorizontal
                    className="h-4 w-4 shrink-0 text-slate-300"
                    aria-hidden="true"
                  />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Physical
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900">
                      {formatQuantity(item.physicalQuantity)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Reserved
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-slate-900">
                      {formatQuantity(item.reservedQuantity)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Available
                    </dt>
                    <dd
                      className={`mt-1 text-lg font-semibold ${
                        item.availableQuantity === 0
                          ? 'text-red-600'
                          : item.inventoryStatus === 'low_stock'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      }`}
                    >
                      {formatQuantity(item.availableQuantity)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="text-xs text-slate-500">
                    {item.isTracked && item.lowStockThreshold != null
                      ? `Low-stock threshold ${formatQuantity(
                          item.lowStockThreshold,
                        )}`
                      : item.isTracked
                        ? 'No low-stock threshold'
                        : item.inventoryItemId
                          ? 'Tracking disabled · history retained'
                          : 'Stock tracking is off'}
                  </div>

                  <div className="flex items-center gap-2">
                    {managesHistory ? (
                      <Link
                        to={`/inventory/items/${item.inventoryItemId}`}
                        className="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      >
                        Manage
                      </Link>
                    ) : null}
                    {!item.isTracked && canManage ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDialogItem(item)}
                      >
                        <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                        Enable tracking
                      </Button>
                    ) : null}
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

      {dialogItem ? (
        <EnableTrackingDialog
          item={dialogItem}
          onClose={() => setDialogItem(null)}
          onEnabled={handleTrackingEnabled}
        />
      ) : null}
    </section>
  );
}
