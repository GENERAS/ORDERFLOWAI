import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  Clock3,
  CreditCard,
  Inbox,
  Loader2,
  Package,
  ShoppingCart,
  Sparkles,
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
import {
  getWorkspaceDashboardData,
  getWorkspaceRecentActivity,
  toAnalyticsServiceError,
} from '../../services/analyticsService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { StatCard } from './components/StatCard';

const ACTIVITY_LABELS = Object.freeze({
  created: 'Order created',
  updated: 'Order updated',
  status_changed: 'Status changed',
  customer_confirmed: 'Customer confirmed',
  business_approved: 'Business approved',
  business_rejected: 'Business rejected',
  clarification_requested: 'Clarification requested',
  order_prepared: 'Order prepared',
  quote_presented: 'Quote presented',
  quote_revised: 'Quote revised',
  customer_reconfirmation_required: 'Reconfirmation required',
  customer_cancelled: 'Customer cancelled',
  stock_reserved: 'Stock reserved',
  stock_released: 'Stock released',
  stock_consumed: 'Stock consumed',
  fulfilled: 'Order fulfilled',
  cancelled: 'Order cancelled',
});

const nextSteps = [
  { to: '/assistant', label: 'Test the read-only AI assistant', icon: Sparkles },
  { to: '/products', label: 'Add products and photos', icon: Package },
  { to: '/inventory', label: 'Configure stock', icon: Boxes },
  { to: '/inbox', label: 'Capture customer inquiries', icon: Inbox },
  { to: '/settings', label: 'Set currency and business profile', icon: CreditCard },
];

function formatCount(value) {
  return new Intl.NumberFormat('en-RW').format(Math.max(0, Math.floor(value || 0)));
}

export default function DashboardPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [overview, setOverview] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const requestKey = `${businessId ?? ''}:${refresh}`;
  const loading = Boolean(businessId) && loadedKey !== requestKey;

  useEffect(() => {
    let active = true;

    if (!businessId) return undefined;

    Promise.all([
      getWorkspaceDashboardData(businessId),
      getWorkspaceRecentActivity(businessId, 8),
    ])
      .then(([overviewValue, activityValue]) => {
        if (!active) return;
        setOverview(overviewValue);
        setActivity(activityValue);
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
  }, [businessId, requestKey]);

  if (!businessId) {
    return (
      <EmptyState
        icon={Boxes}
        title="No workspace selected"
        description="Choose a workspace to see its live overview."
      />
    );
  }

  const currency = overview?.currency ?? activeBusiness?.currency;
  const visibleError = loading ? '' : error;
  const stats = [
    {
      label: 'Total orders',
      icon: ShoppingCart,
      tone: 'brand',
      value: loading ? '—' : formatCount(overview?.totalOrders),
      hint: `${formatCount(overview?.ordersToday)} placed today`,
    },
    {
      label: 'Products',
      icon: Package,
      tone: 'emerald',
      value: loading ? '—' : formatCount(overview?.activeProducts),
      hint: `${formatCount(overview?.activeProducts)} active in catalogue`,
    },
    {
      label: 'Customers',
      icon: Users,
      tone: 'slate',
      value: loading ? '—' : formatCount(overview?.totalCustomers),
      hint: `${formatCount(overview?.completedOrders)} completed orders`,
    },
    {
      label: 'Outstanding payments',
      icon: CreditCard,
      tone: 'amber',
      value: loading
        ? '—'
        : formatCurrency(overview?.outstandingAmount ?? 0, { currency }),
      hint: `${formatCount(overview?.ordersWithBalance)} orders with a balance`,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative px-6 py-7 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <Badge variant="brand">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Live workspace
              </Badge>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                {activeBusiness?.name ?? 'Workspace'} overview
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Orders, products, customers and payments are read directly from
                your business records. Verified payments are the only amounts
                counted as received.
              </p>
            </div>
            <Link
              to="/reports"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              View reports
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {visibleError ? (
        <Alert variant="error" title="Could not load workspace data">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{visibleError}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      <section aria-labelledby="metrics-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="metrics-heading" className="text-sm font-semibold text-slate-900">
            Business metrics
          </h2>
          {loading ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading live data
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {formatCurrency(overview?.paidAmount ?? 0, { currency })} received from
          verified payments. Unpaid orders are never treated as revenue.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle as="h2">Recent activity</CardTitle>
              <CardDescription>
                Latest order events recorded in this workspace.
              </CardDescription>
            </div>
            <Badge variant={activity.length > 0 ? 'brand' : 'neutral'}>
              {loading ? 'Loading' : `${activity.length} events`}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading activity...
              </div>
            ) : null}

            {!loading && activity.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No activity yet"
                description="Order events appear here as your team creates and processes orders."
              />
            ) : null}

            {!loading
              ? activity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Clock3 className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {item.summary}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {ACTIVITY_LABELS[item.eventType] ?? item.eventType} ·{' '}
                        {item.actorName} · {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                    {item.orderId ? (
                      <Link
                        to={`/orders/${item.orderId}`}
                        className="inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                      >
                        {item.orderNumber ?? 'View'}
                      </Link>
                    ) : null}
                  </div>
                ))
              : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Next steps</CardTitle>
              <CardDescription>Build the core workflow in order.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {nextSteps.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50/50 hover:text-brand-700"
              >
                <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
