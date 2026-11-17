import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  History,
  Loader2,
  ReceiptText,
  RotateCcw,
  WalletCards,
  XCircle,
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
  getOrderPaymentSummary,
  getPayment,
  getPaymentEvents,
  getPaymentRefunds,
  toPaymentServiceError,
} from '../../services/paymentService';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { getOrderStatusBadge } from '../orders/orderUtils';
import {
  PAYMENT_EVENT_LABELS,
  canRecordAgainstOrder,
  canRequestRefunds,
  canResolveRefunds,
  canVerifyPayments,
  getPaymentRecordStatusBadge,
  getRefundStatusBadge,
} from './paymentUtils';
import {
  PaymentReviewDialog,
  RefundDialog,
  RefundResolutionDialog,
} from './components/PaymentActionDialogs';

function DetailRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-700">{value || '—'}</dd>
    </div>
  );
}

export default function PaymentDetailPage() {
  const { paymentId } = useParams();
  const location = useLocation();
  const { activeMembership } = useAuth();
  const role = activeMembership?.role;

  const [payment, setPayment] = useState(null);
  const [orderSummary, setOrderSummary] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => location.state?.message ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewMode, setReviewMode] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundResolution, setRefundResolution] = useState(null);

  useEffect(() => {
    let active = true;
    if (!paymentId) return undefined;

    getPayment(paymentId)
      .then(async (value) => {
        if (!active) return;
        if (!value) {
          setPayment(null);
          setError('This payment could not be found.');
          return;
        }
        setPayment(value);
        const [refundRows, eventRows, summary] = await Promise.all([
          getPaymentRefunds({
            businessId: value.businessId,
            paymentId: value.id,
          }),
          getPaymentEvents({
            businessId: value.businessId,
            paymentId: value.id,
          }),
          getOrderPaymentSummary(value.orderId, {
            currency: value.currency,
          }),
        ]);
        if (!active) return;
        setRefunds(refundRows);
        setEvents(eventRows);
        setOrderSummary(summary);
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toPaymentServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [paymentId, refreshKey]);

  const handleReviewCompleted = (updated, message) => {
    setReviewMode('');
    setPayment(updated);
    setSuccess(message);
    setRefreshKey((current) => current + 1);
  };

  const handleRefundCompleted = (message) => {
    setRefundOpen(false);
    setSuccess(message);
    setRefreshKey((current) => current + 1);
  };

  const handleResolutionCompleted = (message) => {
    setRefundResolution(null);
    setSuccess(message);
    setRefreshKey((current) => current + 1);
  };

  if (loading) return <PageLoader />;

  if (!payment) {
    return (
      <section className="space-y-4">
        <Link
          to="/payments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to payments
        </Link>
        <Alert variant="error">
          {error || 'This payment could not be found.'}
        </Alert>
      </section>
    );
  }

  const recordBadge = getPaymentRecordStatusBadge(payment.status);
  const orderStatusBadge = getOrderStatusBadge(payment.orderStatus);
  const canVerify = canVerifyPayments(role);
  const canRequestRefund =
    canRequestRefunds(role) &&
    payment.status === 'verified' &&
    payment.refundableAmount > 0;
  const canResolve = canResolveRefunds(role);
  const isPending = payment.status === 'pending';

  return (
    <section className="space-y-6" aria-labelledby="payment-detail-title">
      <div>
        <Link
          to="/payments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to payments
        </Link>

        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1
                id="payment-detail-title"
                className="text-lg font-semibold tracking-tight text-slate-900"
              >
                {payment.paymentNumber}
              </h1>
              <Badge variant={recordBadge.variant}>{recordBadge.label}</Badge>
              <Badge variant="neutral">{payment.methodLabel}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {formatCurrency(payment.amount, {
                currency: payment.currency,
              })}{' '}
              for{' '}
              <Link
                to={`/orders/${payment.orderId}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {payment.orderNumber}
              </Link>{' '}
              - {payment.customerName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isPending && canVerify ? (
              <>
                <Button onClick={() => setReviewMode('verify')}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Verify payment
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setReviewMode('reject')}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Reject
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setReviewMode('fail')}
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Mark failed
                </Button>
              </>
            ) : null}
            {canRequestRefund ? (
              <Button
                variant={isPending ? 'secondary' : 'primary'}
                onClick={() => setRefundOpen(true)}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Request refund
              </Button>
            ) : null}
          </div>
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

      {isPending && !canVerify ? (
        <Alert variant="info" title="Waiting for manager verification">
          This payment was recorded by your team. An owner, admin or manager must
          verify the money received before it counts towards the paid balance.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Payment details</CardTitle>
                <CardDescription>
                  Financial records are kept separately from the order status.
                </CardDescription>
              </div>
              <WalletCards className="h-5 w-5 text-slate-400" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailRow
                  label="Amount"
                  value={formatCurrency(payment.amount, {
                    currency: payment.currency,
                  })}
                />
                <DetailRow label="Method" value={payment.methodLabel} />
                <DetailRow label="Payment date" value={formatDate(payment.paymentDate)} />
                <DetailRow
                  label="Recorded"
                  value={`${payment.recordedByName} - ${formatDateTime(payment.createdAt)}`}
                />
                <DetailRow
                  label="Transaction reference"
                  value={payment.transactionReference}
                />
                <DetailRow label="Provider" value={payment.providerKey} />
                <DetailRow
                  label="Provider transaction"
                  value={payment.providerTransactionId}
                />
                <DetailRow
                  label="Refunded"
                  value={formatCurrency(payment.refundedAmount, {
                    currency: payment.currency,
                  })}
                />
              </dl>

              {payment.notes ? (
                <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{payment.notes}</p>
                </div>
              ) : null}

              {payment.status === 'verified' ? (
                <div className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-800">
                  <p className="font-medium">
                    Verified by {payment.verifiedByName} on{' '}
                    {formatDateTime(payment.verifiedAt)}
                  </p>
                  {payment.verificationNote ? (
                    <p className="mt-1 text-emerald-700">
                      {payment.verificationNote}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {payment.status === 'rejected' ? (
                <Alert variant="error" className="mt-5" title="Payment rejected">
                  {payment.rejectionReason} - {payment.rejectedByName},{' '}
                  {formatDateTime(payment.rejectedAt)}
                </Alert>
              ) : null}

              {payment.status === 'failed' ? (
                <Alert
                  variant="warning"
                  className="mt-5"
                  title="Payment failed"
                >
                  {payment.failureReason} - {formatDateTime(payment.failedAt)}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Refunds</CardTitle>
                <CardDescription>
                  Requested refunds reserve value. Only completed refunds reduce
                  the net paid balance.
                </CardDescription>
              </div>
              <Badge variant="neutral">{refunds.length}</Badge>
            </CardHeader>
            <CardContent>
              {refunds.length === 0 ? (
                <EmptyState
                  icon={RotateCcw}
                  title="No refunds"
                  description="Refund requests for this payment will appear here."
                  className="py-8"
                />
              ) : (
                <div className="space-y-3">
                  {refunds.map((refund) => {
                    const badge = getRefundStatusBadge(refund.status);
                    return (
                      <div
                        key={refund.id}
                        className="rounded-xl border border-slate-200 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900">
                                {formatCurrency(refund.amount, {
                                  currency: payment.currency,
                                })}
                              </p>
                              <Badge variant={badge.variant}>
                                {badge.label}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {refund.reason}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              Requested by {refund.requestedByName} on{' '}
                              {formatDateTime(refund.requestedAt)}
                            </p>
                            {refund.completedAt ? (
                              <p className="mt-1 text-xs text-emerald-700">
                                Completed by {refund.completedByName} on{' '}
                                {formatDateTime(refund.completedAt)}
                                {refund.reference
                                  ? ` - ${refund.reference}`
                                  : ''}
                              </p>
                            ) : null}
                            {refund.rejectedAt ? (
                              <p className="mt-1 text-xs text-red-700">
                                Rejected by {refund.rejectedByName} on{' '}
                                {formatDateTime(refund.rejectedAt)} -{' '}
                                {refund.rejectionReason}
                              </p>
                            ) : null}
                          </div>

                          {refund.status === 'requested' && canResolve ? (
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() =>
                                  setRefundResolution({
                                    refund,
                                    mode: 'complete',
                                  })
                                }
                              >
                                <CheckCircle2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  setRefundResolution({
                                    refund,
                                    mode: 'reject',
                                  })
                                }
                              >
                                <XCircle
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                Reject
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Payment history</CardTitle>
                <CardDescription>
                  Verification, rejection and refund activity is append-only.
                </CardDescription>
              </div>
              <History className="h-5 w-5 text-slate-400" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">No payment activity yet.</p>
              ) : (
                <ol className="space-y-4">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-900">
                            {PAYMENT_EVENT_LABELS[event.eventType] ??
                              event.eventType}
                          </p>
                          <span className="text-xs text-slate-400">
                            {formatDateTime(event.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">
                          {event.summary}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          By {event.actorName}
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
                <CardTitle>Order payment summary</CardTitle>
                <CardDescription>
                  Order status and payment status are independent.
                </CardDescription>
              </div>
              <Link
                to={`/orders/${payment.orderId}`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                View order
              </Link>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/orders/${payment.orderId}`}
                  className="text-sm font-semibold text-slate-900 hover:text-brand-700"
                >
                  {payment.orderNumber}
                </Link>
                <Badge variant={orderStatusBadge.variant}>
                  {orderStatusBadge.label}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {payment.customerName}
              </p>

              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Order total</dt>
                  <dd className="font-medium text-slate-900">
                    {formatCurrency(payment.orderTotal, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Net paid on order</dt>
                  <dd className="font-medium text-slate-900">
                    {formatCurrency(orderSummary?.netPaid ?? 0, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Balance due</dt>
                  <dd className="font-semibold text-slate-900">
                    {formatCurrency(orderSummary?.balanceDue ?? 0, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">This payment</dt>
                  <dd className="font-medium text-slate-900">
                    {formatCurrency(payment.amount, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refunded on this payment</dt>
                  <dd className="font-medium text-slate-900">
                    {formatCurrency(payment.refundedAmount, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refundable</dt>
                  <dd className="font-semibold text-slate-900">
                    {formatCurrency(payment.refundableAmount, {
                      currency: payment.currency,
                    })}
                  </dd>
                </div>
              </dl>

              {canRecordAgainstOrder(payment.orderStatus) &&
              (orderSummary?.balanceDue ?? 0) > 0 ? (
                <Link
                  to={`/payments/new?orderId=${payment.orderId}`}
                  className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  Record another payment
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Alert variant="info" title="Payment status">
            Verified payments count toward the order balance. Pending, rejected
            and failed records stay visible but never mark an order paid.
          </Alert>
        </div>
      </div>

      {reviewMode ? (
        <PaymentReviewDialog
          payment={payment}
          mode={reviewMode}
          onClose={() => setReviewMode('')}
          onCompleted={handleReviewCompleted}
        />
      ) : null}

      {refundOpen ? (
        <RefundDialog
          payment={payment}
          onClose={() => setRefundOpen(false)}
          onCompleted={handleRefundCompleted}
        />
      ) : null}

      {refundResolution ? (
        <RefundResolutionDialog
          refund={refundResolution.refund}
          payment={payment}
          mode={refundResolution.mode}
          onClose={() => setRefundResolution(null)}
          onCompleted={handleResolutionCompleted}
        />
      ) : null}
    </section>
  );
}
