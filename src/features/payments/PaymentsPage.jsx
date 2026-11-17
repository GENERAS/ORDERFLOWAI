import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  BadgeCheck,
  Banknote,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  WalletCards,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  getPaymentOverview,
  listPaymentMethods,
  searchPayments,
  toPaymentServiceError,
} from '../../services/paymentService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  formatPaymentCount,
  getPaymentRecordStatusBadge,
  PAYMENT_PAGE_SIZE,
  PAYMENT_RECORD_STATUS_OPTIONS,
  PAYMENT_SORT_OPTIONS,
} from './paymentUtils';

const OVERVIEW_TONES = Object.freeze({
  emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
  amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
  brand: 'border-brand-100 bg-brand-50/70 text-brand-700',
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

export default function PaymentsPage() {
  const { activeBusiness } = useAuth();
  const location = useLocation();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    methodCode: '',
    sort: 'recent',
    direction: 'desc',
    dateFrom: '',
    dateTo: '',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [methods, setMethods] = useState([]);
  const [page, setPage] = useState(1);
  const [payments, setPayments] = useState([]);
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

    Promise.all([
      getPaymentOverview(businessId, {
        currency: activeBusiness?.currency,
      }),
      listPaymentMethods(businessId),
    ])
      .then(([overviewValue, methodsValue]) => {
        if (!active) return;
        setOverview(overviewValue);
        setMethods(methodsValue);
      })
      .catch((loadError) => {
        if (active) setError(toPaymentServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [activeBusiness?.currency, businessId]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    if (!businessId) return undefined;

    searchPayments({
      businessId,
      search: debouncedSearch,
      status: filters.status,
      methodCode: filters.methodCode,
      page,
      pageSize: PAYMENT_PAGE_SIZE,
      sort: filters.sort,
      direction: filters.direction,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setPayments(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toPaymentServiceError(loadError).message);
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
    filters.methodCode,
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
      methodCode: '',
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
    Boolean(filters.methodCode) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    filters.sort !== 'recent' ||
    filters.direction !== 'desc';
  const totalPages = Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE));
  const methodOptions = methods.map((method) => ({
    value: method.code,
    label: method.label,
  }));

  return (
    <section className="space-y-6" aria-labelledby="payments-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="payments-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Payments
            </h2>
            <Badge variant="brand">Manual verification</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Record payments against orders, verify the money received and track
            refunds. Order fulfilment stays separate from payment status.
          </p>
        </div>

        <Link
          to="/payments/new"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Record payment
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="Verified payments"
          value={formatCurrency(overview?.verifiedAmount ?? 0, {
            currency: overview?.currency ?? activeBusiness?.currency,
          })}
          detail={`${formatPaymentCount(
            overview?.verifiedCount ?? 0,
          )} verified transaction${
            overview?.verifiedCount === 1 ? '' : 's'
          }`}
          icon={BadgeCheck}
          tone="emerald"
        />
        <OverviewCard
          label="Pending verification"
          value={formatCurrency(overview?.pendingAmount ?? 0, {
            currency: overview?.currency ?? activeBusiness?.currency,
          })}
          detail={`${formatPaymentCount(
            overview?.pendingCount ?? 0,
          )} awaiting review`}
          icon={Clock3}
          tone="amber"
        />
        <OverviewCard
          label="Outstanding balance"
          value={formatCurrency(overview?.outstandingAmount ?? 0, {
            currency: overview?.currency ?? activeBusiness?.currency,
          })}
          detail={`${formatPaymentCount(
            overview?.ordersWithBalance ?? 0,
          )} order${overview?.ordersWithBalance === 1 ? '' : 's'} with a balance`}
          icon={CircleDollarSign}
          tone="brand"
        />
        <OverviewCard
          label="Completed refunds"
          value={formatCurrency(overview?.refundedAmount ?? 0, {
            currency: overview?.currency ?? activeBusiness?.currency,
          })}
          detail={`${formatCurrency(overview?.requestedRefundAmount ?? 0, {
            currency: overview?.currency ?? activeBusiness?.currency,
          })} requested`}
          icon={RotateCcw}
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
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <FormField
            id="payment-search"
            label="Search payments"
            type="search"
            placeholder="Payment number, order, customer or reference"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            trailing={
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            }
          />
          <SelectField
            id="payment-status"
            label="Payment record status"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            options={PAYMENT_RECORD_STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <SelectField
            id="payment-method"
            label="Method"
            value={filters.methodCode}
            onChange={(event) =>
              updateFilter('methodCode', event.target.value)
            }
            options={methodOptions}
            placeholder="All methods"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <FormField
            id="payment-date-from"
            label="Payment date from"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          />
          <FormField
            id="payment-date-to"
            label="Payment date to"
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          />
          <SelectField
            id="payment-sort"
            label="Sort by"
            value={filters.sort}
            onChange={(event) => updateFilter('sort', event.target.value)}
            options={PAYMENT_SORT_OPTIONS}
            placeholder="Newest payment"
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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Loading payments...'
            : `${total} payment${total === 1 ? '' : 's'} in this workspace`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading payments"
          />
        ) : null}
      </div>

      {!loading && payments.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={
            hasFilters
              ? 'No payments match these filters'
              : 'No payments recorded yet'
          }
          description={
            hasFilters
              ? 'Clear the filters or try a different search.'
              : 'Record the first payment against a confirmed order. Payments stay pending until a manager verifies the money received.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link
                to="/payments/new"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Record payment
              </Link>
            )
          }
        />
      ) : null}

      {payments.length > 0 ? (
        <div className="space-y-3">
          {payments.map((payment) => {
            const statusBadge = getPaymentRecordStatusBadge(payment.status);
            return (
              <article
                key={payment.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-200"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {payment.paymentNumber}
                      </h3>
                      <Badge variant={statusBadge.variant}>
                        {statusBadge.label}
                      </Badge>
                      {payment.requestedRefundAmount > 0 ? (
                        <Badge variant="warning">Refund requested</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {payment.customerName} - {payment.orderNumber}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {payment.methodLabel} - {formatDateTime(payment.createdAt)}
                      {payment.transactionReference
                        ? ` - ${payment.transactionReference}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end">
                    <div className="text-right">
                      <p className="text-base font-semibold text-slate-900">
                        {formatCurrency(payment.amount, {
                          currency: payment.currency,
                        })}
                      </p>
                      {payment.refundedAmount > 0 ? (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatCurrency(payment.refundedAmount, {
                            currency: payment.currency,
                          })}{' '}
                          refunded
                        </p>
                      ) : null}
                    </div>
                    <Link
                      to={`/payments/${payment.id}`}
                      className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                    >
                      View payment
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <WalletCards className="h-3.5 w-3.5" aria-hidden="true" />
          Pending and failed payments never reduce the balance.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
          Refund requests reserve refundable value until resolved.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
          Payment status is separate from order fulfilment status.
        </span>
      </div>
    </section>
  );
}
