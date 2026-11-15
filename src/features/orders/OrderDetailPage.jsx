import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleSlash,
  Loader2,
  Mail,
  Pencil,
  Phone,
  ReceiptText,
  ShoppingCart,
  UserRound,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
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
import { PageLoader } from '../../components/ui/PageLoader';
import {
  getOrder,
  toOrderServiceError,
  updateOrderStatus,
} from '../../services/orderService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { CancelOrderDialog } from './components/CancelOrderDialog';
import {
  canManageOrders,
  formatOrderQuantity,
  getNextOrderActionLabel,
  getNextOrderStatus,
  getOrderItemLabel,
  getOrderStatusBadge,
  getStockStateBadgeVariant,
  getStockStateLabel,
  isOrderCancellable,
  isOrderEditable,
} from './orderUtils';

const EVENT_LABELS = Object.freeze({
  created: 'Created',
  updated: 'Updated',
  status_changed: 'Status changed',
  cancelled: 'Cancelled',
});

function DetailRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-700">{value}</dd>
    </div>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => location.state?.message ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    let active = true;
    if (!businessId || !orderId) return undefined;

    getOrder({ businessId, orderId })
      .then((result) => {
        if (!active) return;
        setOrder(result.order);
        setItems(result.items);
        setEvents(result.events);
        if (!result.order) setError('This order could not be found.');
        else setError('');
      })
      .catch((loadError) => {
        if (active) setError(toOrderServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, orderId, refreshKey]);

  const handleAdvance = async () => {
    const nextStatus = getNextOrderStatus(order?.status);
    if (!nextStatus) return;

    setActing(true);
    setError('');
    setSuccess('');

    try {
      const updated = await updateOrderStatus({
        orderId,
        status: nextStatus,
      });
      setSuccess(`Order moved to ${getOrderStatusBadge(updated.status).label}.`);
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(toOrderServiceError(actionError).message);
    } finally {
      setActing(false);
    }
  };

  const handleCancelled = (cancelled) => {
    setCancelOpen(false);
    setOrder(cancelled);
    setSuccess('The order was cancelled and any reserved stock was released.');
    setRefreshKey((current) => current + 1);
  };

  if (loading) return <PageLoader />;

  if (!order) {
    return (
      <section className="space-y-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to orders
        </Link>
        <Alert variant="error">
          {error || 'This order could not be found.'}
        </Alert>
      </section>
    );
  }

  const statusBadge = getOrderStatusBadge(order.status);
  const nextStatus = getNextOrderStatus(order.status);
  const nextActionLabel = getNextOrderActionLabel(order.status);
  const editable = isOrderEditable(order.status);
  const cancellable = isOrderCancellable(order.status);
  const canManage = canManageOrders(activeMembership?.role);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section className="space-y-6" aria-labelledby="order-detail-title">
      <div>
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to orders
        </Link>

        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="order-detail-title"
                className="text-lg font-semibold tracking-tight text-slate-900"
              >
                {order.orderNumber}
              </h2>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              <Badge
                variant={getStockStateBadgeVariant(order.stockState)}
              >
                {getStockStateLabel(order.stockState)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Created {formatDateTime(order.createdAt)} -{' '}
              {order.itemCount} item{order.itemCount === 1 ? '' : 's'} -{' '}
              {formatOrderQuantity(totalUnits)} unit
              {totalUnits === 1 ? '' : 's'}
            </p>
          </div>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              {nextStatus ? (
                <Button onClick={handleAdvance} disabled={acting}>
                  {acting ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {nextActionLabel}
                </Button>
              ) : null}
              {editable ? (
                <Link
                  to={`/orders/${order.id}/edit`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit order
                </Link>
              ) : null}
              {cancellable ? (
                <Button
                  variant="secondary"
                  onClick={() => setCancelOpen(true)}
                >
                  <CircleSlash className="h-4 w-4" aria-hidden="true" />
                  Cancel order
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Order items</CardTitle>
                <CardDescription>
                  Agreed prices are preserved on this order even if the
                  catalogue changes later.
                </CardDescription>
              </div>
              <Badge variant="neutral">{order.itemCount} items</Badge>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="No items on this order"
                  description="Edit the order to add items from the catalogue."
                  className="py-8"
                />
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {getOrderItemLabel(item)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {item.sku ? `SKU ${item.sku} - ` : ''}
                            {formatCurrency(item.unitPrice, {
                              currency: order.currency,
                            })}{' '}
                            each
                            {item.reservedQuantity > 0
                              ? ` - ${formatOrderQuantity(
                                  item.reservedQuantity,
                                )} reserved`
                              : ''}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-6 sm:justify-end">
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Quantity</p>
                            <p className="text-sm font-medium text-slate-700">
                              {formatOrderQuantity(item.quantity)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Line total</p>
                            <p className="text-sm font-semibold text-slate-900">
                              {formatCurrency(item.lineTotal, {
                                currency: order.currency,
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      Order total
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {formatCurrency(order.total, {
                        currency: order.currency,
                      })}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Activity history</CardTitle>
                <CardDescription>
                  Every order change is recorded for the team.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No activity has been recorded yet.
                </p>
              ) : (
                <ol className="space-y-4">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        {event.eventType === 'cancelled' ? (
                          <CircleSlash
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        ) : event.eventType === 'status_changed' ? (
                          <CheckCircle2
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        ) : (
                          <ReceiptText
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-800">
                            {event.summary}
                          </p>
                          <Badge variant="neutral">
                            {EVENT_LABELS[event.eventType] ?? event.eventType}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {event.actorName} - {formatDateTime(event.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Customer</CardTitle>
                <CardDescription>
                  Contact details captured when the order was created.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link
                to={`/customers/${order.customerId}`}
                className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-slate-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {order.customerName}
                  </span>
                  <span className="text-xs text-brand-700">
                    View customer record
                  </span>
                </span>
              </Link>

              <div className="space-y-2 text-sm">
                {order.customerEmail ? (
                  <a
                    href={`mailto:${order.customerEmail}`}
                    className="flex items-center gap-2 break-all text-slate-600 hover:text-brand-700"
                  >
                    <Mail
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    {order.customerEmail}
                  </a>
                ) : null}
                {order.customerPhone ? (
                  <a
                    href={`tel:${order.customerPhone.replace(/\s+/g, '')}`}
                    className="flex items-center gap-2 text-slate-600 hover:text-brand-700"
                  >
                    <Phone
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                    {order.customerPhone}
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Order details</CardTitle>
                <CardDescription>
                  Status dates and internal context.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4">
                <DetailRow
                  label="Created"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays
                        className="h-3.5 w-3.5 text-slate-400"
                        aria-hidden="true"
                      />
                      {formatDateTime(order.createdAt)}
                    </span>
                  }
                />
                {order.confirmedAt ? (
                  <DetailRow
                    label="Confirmed"
                    value={formatDateTime(order.confirmedAt)}
                  />
                ) : null}
                {order.completedAt ? (
                  <DetailRow
                    label="Completed"
                    value={formatDateTime(order.completedAt)}
                  />
                ) : null}
                {order.cancelledAt ? (
                  <DetailRow
                    label="Cancelled"
                    value={formatDateTime(order.cancelledAt)}
                  />
                ) : null}
                <DetailRow
                  label="Currency"
                  value={order.currency}
                />
                <DetailRow
                  label="Subtotal"
                  value={formatCurrency(order.subtotal, {
                    currency: order.currency,
                  })}
                />
                <DetailRow
                  label="Total"
                  value={formatCurrency(order.total, {
                    currency: order.currency,
                  })}
                />
              </dl>

              {order.notes ? (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                    {order.notes}
                  </p>
                </div>
              ) : null}

              {order.cancellationReason ? (
                <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                    Cancellation reason
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-red-700">
                    {order.cancellationReason}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {cancelOpen ? (
        <CancelOrderDialog
          order={order}
          onClose={() => setCancelOpen(false)}
          onCancelled={handleCancelled}
        />
      ) : null}
    </section>
  );
}
