import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  BarChart3,
  CircleDollarSign,
  CreditCard,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import {
  getWorkspaceChannelBreakdown,
  getWorkspaceReportSeries,
  getWorkspaceReportSummary,
  getWorkspaceTopCustomers,
  getWorkspaceTopProducts,
  toAnalyticsServiceError,
} from '../../services/analyticsService';
import { formatCurrency, formatDate } from '../../utils/format';
import { useAuth } from '../auth/authContext';

const STAT_TONES = Object.freeze({
  brand: 'border-brand-100 bg-brand-50/70 text-brand-700',
  emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
  amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
  slate: 'border-slate-200 bg-white text-slate-700',
});

function ReportStatCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${STAT_TONES[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs opacity-80">{detail}</p>
    </div>
  );
}

function formatCount(value) {
  return new Intl.NumberFormat('en-RW').format(Math.max(0, Math.floor(value || 0)));
}

function statusVariant(status) {
  if (status === 'verified' || status === 'completed') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'cancelled') return 'neutral';
  return 'danger';
}

function statusLabel(status) {
  if (!status) return 'Unknown';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function rangeLabel(from, to) {
  if (!from && !to) return 'All time';
  if (!from) return `Until ${formatDate(to)}`;
  if (!to) return `From ${formatDate(from)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export default function ReportsPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [report, setReport] = useState({
    summary: null,
    series: [],
    products: [],
    customers: [],
    channels: [],
  });
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');

  const invalidRange = Boolean(
    filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo,
  );
  const hasFilters = Boolean(filters.dateFrom || filters.dateTo);
  const requestKey = `${businessId ?? ''}:${filters.dateFrom}:${filters.dateTo}:${refresh}:${invalidRange}`;
  const loading = Boolean(businessId) && !invalidRange && loadedKey !== requestKey;

  useEffect(() => {
    let active = true;

    if (!businessId || invalidRange) return undefined;

    const from = filters.dateFrom ? `${filters.dateFrom}T00:00:00.000Z` : null;
    const to = filters.dateTo ? `${filters.dateTo}T23:59:59.999Z` : null;

    Promise.all([
      getWorkspaceReportSummary({ businessId, from, to }),
      getWorkspaceReportSeries({ businessId, from, to }),
      getWorkspaceTopProducts({ businessId, from, to, limit: 8 }),
      getWorkspaceTopCustomers({ businessId, from, to, limit: 8 }),
      getWorkspaceChannelBreakdown({ businessId, from, to }),
    ])
      .then(([summary, series, products, customers, channels]) => {
        if (!active) return;
        setReport({ summary, series, products, customers, channels });
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toAnalyticsServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoadedKey(requestKey);
      });

    return () => {
      active = false;
    };
  }, [businessId, filters.dateFrom, filters.dateTo, invalidRange, requestKey]);

  if (!businessId) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No workspace selected"
        description="Choose a workspace to view its reports."
      />
    );
  }

  const summary = report.summary;
  const currency = summary?.currency ?? activeBusiness?.currency;
  const visibleError = loading ? '' : error;
  const money = (value) => formatCurrency(value, { currency });
  const paymentStatus = summary?.paymentStatus ?? [];
  const outstandingPayments = summary?.outstandingPayments ?? [];
  const verifiedPayment =
    paymentStatus.find((row) =>
      ['verified', 'completed'].includes(row.status),
    ) ?? null;
  const maxPaidAmount = Math.max(
    1,
    ...report.series.map((row) => row.paidAmount),
  );
  const hasReportData =
    (summary?.totalOrders ?? 0) > 0 ||
    (summary?.paidAmount ?? 0) > 0 ||
    (summary?.outstandingAmount ?? 0) > 0;

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const clearFilters = () => setFilters({ dateFrom: '', dateTo: '' });

  const applyPreset = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFilters({
      dateFrom: start.toISOString().slice(0, 10),
      dateTo: end.toISOString().slice(0, 10),
    });
  };

  const refreshData = () => setRefresh((value) => value + 1);

  return (
    <section className="space-y-6" aria-labelledby="reports-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="reports-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Reports and analytics
            </h2>
            <Badge variant="brand">
              <BarChart3 className="h-3 w-3" aria-hidden="true" />
              Live data
            </Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Sales, payments, customers and channels calculated from this
            workspace's records. Only verified payments count as received
            revenue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            {invalidRange ? 'Invalid range' : rangeLabel(filters.dateFrom, filters.dateTo)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshData}
            disabled={loading || invalidRange}
            aria-label="Refresh report data"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <FormField
            id="report-date-from"
            label="From date"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          />
          <FormField
            id="report-date-to"
            label="To date"
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => applyPreset(7)}>
              7 days
            </Button>
            <Button variant="secondary" onClick={() => applyPreset(30)}>
              30 days
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              All time
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Order dates drive order counts and breakdowns; payment dates drive
          received amounts.
        </p>
      </div>

      {invalidRange ? (
        <Alert variant="warning" title="Invalid date range">
          The start date must be on or before the end date.
        </Alert>
      ) : null}

      {visibleError ? (
        <Alert variant="error" title="Could not load report data">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{visibleError}</span>
            <Button variant="secondary" size="sm" onClick={refreshData}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard
          label="Paid revenue"
          value={loading ? '—' : money(summary?.paidAmount ?? 0)}
          detail={`${formatCount(summary?.unitsSold)} units from paid orders`}
          icon={CircleDollarSign}
          tone="emerald"
        />
        <ReportStatCard
          label="Orders"
          value={loading ? '—' : formatCount(summary?.totalOrders)}
          detail={`${formatCount(summary?.completedOrders)} completed · ${formatCount(
            summary?.openOrders,
          )} open`}
          icon={ShoppingCart}
          tone="brand"
        />
        <ReportStatCard
          label="Outstanding balance"
          value={loading ? '—' : money(summary?.outstandingAmount ?? 0)}
          detail={`${formatCount(summary?.ordersWithBalance)} orders with a balance`}
          icon={CreditCard}
          tone="amber"
        />
        <ReportStatCard
          label="Verified payments"
          value={loading ? '—' : formatCount(verifiedPayment?.count)}
          detail={money(verifiedPayment?.amount ?? 0)}
          icon={BadgeCheck}
          tone="slate"
        />
      </div>

      {!loading && !error && !invalidRange && !hasReportData ? (
        <EmptyState
          icon={BarChart3}
          title="No records in this period"
          description="There are no orders or payments to report on. Try a wider date range."
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h2">Sales and order trend</CardTitle>
            <CardDescription>
              Orders created and verified payments received each day.
            </CardDescription>
          </div>
          <Badge variant="neutral">Daily</Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading trend...
            </div>
          ) : null}

          {!loading && report.series.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No trend data"
              description="No orders or payments were recorded in the selected period."
            />
          ) : null}

          {!loading && report.series.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 text-right font-medium">Orders</th>
                    <th className="pb-2 pr-4 text-right font-medium">Paid orders</th>
                    <th className="pb-2 text-right font-medium">Paid amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.series.map((row) => (
                    <tr key={row.periodStart}>
                      <td className="whitespace-nowrap py-2 pr-4 text-slate-700">
                        {formatDate(row.periodStart)}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-700">
                        {formatCount(row.orderCount)}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-700">
                        {formatCount(row.paidOrders)}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <span className="font-medium text-slate-900">
                            {money(row.paidAmount)}
                          </span>
                          <span className="hidden h-2 w-20 rounded-full bg-slate-100 sm:block">
                            <span
                              className="block h-2 rounded-full bg-brand-500"
                              style={{
                                width: `${Math.round(
                                  (row.paidAmount / maxPaidAmount) * 100,
                                )}%`,
                              }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Top products</CardTitle>
              <CardDescription>
                Units from orders with verified payments.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading products...
              </div>
            ) : null}

            {!loading && report.products.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No paid products"
                description="Paid products appear here once orders are verified."
              />
            ) : null}

            {!loading && report.products.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-medium">Product</th>
                      <th className="pb-2 pr-4 text-right font-medium">Units</th>
                      <th className="pb-2 text-right font-medium">Order value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.products.map((product) => (
                      <tr key={product.productId ?? product.productName}>
                        <td className="py-2 pr-4">
                          <p className="font-medium text-slate-800">
                            {product.productName}
                          </p>
                          {product.sku ? (
                            <p className="text-xs text-slate-400">{product.sku}</p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {formatCount(product.unitsSold)}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">
                          {formatCurrency(product.orderValue, {
                            currency: product.currency ?? currency,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Top customers</CardTitle>
              <CardDescription>
                Customers behind paid orders in this period.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading customers...
              </div>
            ) : null}

            {!loading && report.customers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No paid customers"
                description="Customers with verified orders appear here."
              />
            ) : null}

            {!loading && report.customers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-medium">Customer</th>
                      <th className="pb-2 pr-4 text-right font-medium">Orders</th>
                      <th className="pb-2 text-right font-medium">Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.customers.map((customer) => (
                      <tr key={customer.customerId ?? customer.customerName}>
                        <td className="py-2 pr-4">
                          <p className="font-medium text-slate-800">
                            {customer.customerName}
                          </p>
                          <p className="text-xs text-slate-400">
                            Last order {formatDate(customer.lastOrderAt)}
                          </p>
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {formatCount(customer.orderCount)}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">
                          {formatCurrency(customer.paidAmount, {
                            currency: customer.currency ?? currency,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Outstanding payments</CardTitle>
              <CardDescription>
                Orders with a balance after verified payments.
              </CardDescription>
            </div>
            <Badge variant="warning">
              {formatCount(summary?.ordersWithBalance)}
            </Badge>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading balances...
              </div>
            ) : null}

            {!loading && outstandingPayments.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No outstanding balances"
                description="Orders with an unpaid balance will be listed here."
              />
            ) : null}

            {!loading && outstandingPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-medium">Order</th>
                      <th className="pb-2 pr-4 text-right font-medium">Paid</th>
                      <th className="pb-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {outstandingPayments.map((payment) => (
                      <tr key={payment.orderId}>
                        <td className="py-2 pr-4">
                          {payment.orderId ? (
                            <Link
                              to={`/orders/${payment.orderId}`}
                              className="font-medium text-brand-700 hover:underline"
                            >
                              {payment.orderNumber}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-800">
                              {payment.orderNumber}
                            </span>
                          )}
                          <p className="text-xs text-slate-400">
                            {payment.customerName || 'Walk-in customer'}
                          </p>
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {money(payment.paidAmount)}
                        </td>
                        <td className="py-2 text-right font-medium text-amber-700">
                          {money(payment.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Payment status</CardTitle>
              <CardDescription>
                All payment records created in the selected period.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading payment statuses...
              </div>
            ) : null}

            {!loading && paymentStatus.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No payments recorded"
                description="Payment statuses appear here once payments are recorded."
              />
            ) : null}

            {!loading && paymentStatus.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 text-right font-medium">Count</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentStatus.map((row) => (
                      <tr key={row.status}>
                        <td className="py-2 pr-4">
                          <Badge variant={statusVariant(row.status)}>
                            {statusLabel(row.status)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {formatCount(row.count)}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">
                          {money(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h2">Channel and source breakdown</CardTitle>
            <CardDescription>
              Orders by originating channel with verified payments received.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading channels...
            </div>
          ) : null}

          {!loading && report.channels.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No channels recorded"
              description="Channel performance appears here once orders are created."
            />
          ) : null}

          {!loading && report.channels.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Channel</th>
                    <th className="pb-2 pr-4 text-right font-medium">Orders</th>
                    <th className="pb-2 text-right font-medium">Paid amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.channels.map((channel) => (
                    <tr key={`${channel.channel}-${channel.currency}`}>
                      <td className="py-2 pr-4 font-medium text-slate-800">
                        {channel.label}
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-700">
                        {formatCount(channel.orderCount)}
                      </td>
                      <td className="py-2 text-right font-medium text-slate-900">
                        {formatCurrency(channel.paidAmount, {
                          currency: channel.currency ?? currency,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400">
        Pending, rejected and failed payments are shown but never counted as
        received revenue. Outstanding balances include completed and confirmed
        orders only.
      </p>
    </section>
  );
}
