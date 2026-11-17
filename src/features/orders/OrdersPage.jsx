import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  CircleDollarSign,
  ClipboardList,
  Loader2,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  Timer,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  getOrderOverview,
  searchOrders,
  toOrderServiceError,
} from '../../services/orderService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  formatOrderQuantity,
  getOrderStatusBadge,
  ORDER_PAGE_SIZE,
  ORDER_SORT_OPTIONS,
  ORDER_STATUS_OPTIONS,
} from './orderUtils';

const OVERVIEW_TONES = Object.freeze({
  brand: 'border-brand-100 bg-brand-50/70 text-brand-700',
  emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
  amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
  slate: 'border-slate-200 bg-white text-slate-700',
});

function OverviewCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${OVERVIEW_TONES[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs opacity-80">{detail}</p>
    </div>
  );
}

export default function OrdersPage() {
  const { activeBusiness } = useAuth();
  const location = useLocation();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    sort: 'recent',
    direction: 'desc',
    dateFrom: '',
    dateTo: '',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => location.state?.message ?? '');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1);
      setLoading(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    getOrderOverview(businessId)
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch((loadError) => {
        if (active) setError(toOrderServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;

    if (!businessId) return undefined;

    searchOrders({
      businessId,
      search: debouncedSearch,
      status: filters.status,
      page,
      pageSize: ORDER_PAGE_SIZE,
      sort: filters.sort,
      direction: filters.direction,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setOrders(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toOrderServiceError(loadError).message);
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
    filters.sort,
    filters.direction,
    filters.dateFrom,
    filters.dateTo,
    page,
  ]);

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setLoading(true);
  }, []);

  const toggleDirection = () => {
    setFilters((current) => ({
      ...current,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(1);
    setLoading(true);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: '',
      sort: 'recent',
      direction: 'desc',
      dateFrom: '',
      dateTo: '',
    });
    setDebouncedSearch('');
    setPage(1);
    setLoading(true);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    setPage(nextPage);
  };

  const hasFilters =
    Boolean(filters.search) ||
    Boolean(filters.status) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    filters.sort !== 'recent' ||
    filters.direction !== 'desc';
  const totalPages = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));

  return (
    <section className="space-y-6" aria-labelledby="orders-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="orders-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Orders
            </h2>
            <Badge variant="brand">Live records</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Build orders from the catalogue, keep the price you agreed with the
            customer, and move each order through confirmation and fulfilment.
          </p>
        </div>

        <Link
          to="/orders/new"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New order
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="Open value"
          value={formatCurrency(overview?.openValue ?? 0, {
            currency: activeBusiness?.currency,
          })}
          detail={`${formatOrderQuantity(
              (overview?.draftCount ?? 0) +
              (overview?.awaitingConfirmationCount ?? 0) +
              (overview?.awaitingBusinessApprovalCount ?? 0) +
              (overview?.confirmedCount ?? 0) +
              (overview?.processingCount ?? 0) +
              (overview?.readyCount ?? 0),
          )} orders still in progress`}
          icon={CircleDollarSign}
          tone="brand"
        />
        <OverviewCard
          label="Awaiting action"
          value={formatOrderQuantity(
            (overview?.draftCount ?? 0) +
              (overview?.awaitingConfirmationCount ?? 0) +
              (overview?.awaitingBusinessApprovalCount ?? 0),
          )}
          detail="Draft, customer confirmation or business approval"
          icon={Timer}
          tone="amber"
        />
        <OverviewCard
          label="Ready to fulfil"
          value={formatOrderQuantity(
            (overview?.confirmedCount ?? 0) +
              (overview?.processingCount ?? 0) +
              (overview?.readyCount ?? 0),
          )}
          detail="Confirmed, processing or ready"
          icon={PackageCheck}
          tone="emerald"
        />
        <OverviewCard
          label="Fulfilled"
          value={formatOrderQuantity(overview?.completedCount ?? 0)}
          detail={`${formatOrderQuantity(
            overview?.ordersToday ?? 0,
          )} order${overview?.ordersToday === 1 ? '' : 's'} created today`}
          icon={ClipboardList}
          tone="slate"
        />
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? (
        <Alert variant="success">
          <div className="flex items-start justify-between gap-3">
            <span>{success}</span>
            <button
              type="button"
              className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
              onClick={() => setSuccess('')}
            >
              Dismiss
            </button>
          </div>
        </Alert>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <FormField
            id="order-search"
            label="Search orders"
            type="search"
            placeholder="Order number, customer, phone or email"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            trailing={
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            }
          />
          <SelectField
            id="order-status"
            label="Status"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            options={ORDER_STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <SelectField
            id="order-sort"
            label="Sort by"
            value={filters.sort}
            onChange={(event) => updateFilter('sort', event.target.value)}
            options={ORDER_SORT_OPTIONS}
            placeholder="Newest order"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={toggleDirection}
              className="h-10"
              aria-label={`Sort ${
                filters.direction === 'asc' ? 'descending' : 'ascending'
              }`}
            >
              <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
              {filters.direction === 'asc' ? 'Asc' : 'Desc'}
            </Button>
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

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <FormField
            id="order-date-from"
            label="Created from"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          />
          <FormField
            id="order-date-to"
            label="Created to"
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Loading orders...'
            : `${total} order${total === 1 ? '' : 's'} in this workspace`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading orders"
          />
        ) : null}
      </div>

      {!loading && orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={hasFilters ? 'No orders match these filters' : 'No orders yet'}
          description={
            hasFilters
              ? 'Clear the filters or try a different search.'
            : 'Create the first order, add items from the catalogue and review the server-calculated total.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link
                to="/orders/new"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New order
              </Link>
            )
          }
        />
      ) : null}

      {orders.length > 0 ? (
        <div className="space-y-3">
          {orders.map((order) => {
            const statusBadge = getOrderStatusBadge(order.status);
            return (
              <article
                key={order.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-200"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {order.orderNumber}
                      </h3>
                      <Badge variant={statusBadge.variant}>
                        {statusBadge.label}
                      </Badge>
                      {order.isGuest ? (
                        <Badge variant="neutral">Walk-in</Badge>
                      ) : null}
                      {order.stockState === 'reserved' ? (
                        <Badge variant="brand">Stock reserved</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {order.customerName}
                      {order.customerPhone ? ` - ${order.customerPhone}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {order.itemCount} item{order.itemCount === 1 ? '' : 's'} -
                      created {formatDateTime(order.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end">
                    <p className="text-base font-semibold text-slate-900">
                      {formatCurrency(order.total, {
                        currency: order.currency,
                      })}
                    </p>
                    <Link
                      to={`/orders/${order.id}`}
                      className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                    >
                      View order
                    </Link>
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

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Timer className="h-3.5 w-3.5" aria-hidden="true" />
        Business approval reserves tracked stock. Fulfilment consumes the
        reservation. Cancelling releases any reserved stock.
      </div>
    </section>
  );
}
