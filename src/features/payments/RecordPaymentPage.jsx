import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  Search,
  ShoppingCart,
  WalletCards,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { SelectField } from '../../components/ui/SelectField';
import {
  getOrderPaymentSummary,
  listPaymentMethods,
  recordPayment,
  searchPayableOrders,
  toPaymentServiceError,
} from '../../services/paymentService';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  createIdempotencyKey,
  getPaymentStatusBadge,
  PAYABLE_ORDER_PAGE_SIZE,
  todayInputValue,
} from './paymentUtils';

export default function RecordPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const initialOrderId = searchParams.get('orderId');

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingSelected, setLoadingSelected] = useState(Boolean(initialOrderId));
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState('');
  const [payableOrders, setPayableOrders] = useState([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(!initialOrderId);
  const [methods, setMethods] = useState([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [form, setForm] = useState({
    amount: '',
    methodCode: '',
    paymentDate: todayInputValue(),
    transactionReference: '',
    notes: '',
    providerKey: '',
    providerTransactionId: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const idempotencyKeyRef = useRef(createIdempotencyKey());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedOrderSearch(orderSearch.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [orderSearch]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    listPaymentMethods(businessId)
      .then((value) => {
        if (!active) return;
        setMethods(value);
        setForm((current) => ({
          ...current,
          methodCode: current.methodCode || value[0]?.code || '',
        }));
      })
      .catch((loadError) => {
        if (active) setError(toPaymentServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoadingMethods(false);
      });

    return () => {
      active = false;
    };
  }, [businessId]);

  useEffect(() => {
    let active = true;
    if (!initialOrderId) return undefined;

    getOrderPaymentSummary(initialOrderId, {
      currency: activeBusiness?.currency,
    })
      .then((summary) => {
        if (!active) return;
        if (!summary.orderId) {
          setError('This order could not be found.');
          setSelectedOrder(null);
          return;
        }
        setSelectedOrder(summary);
        setForm((current) => ({
          ...current,
          amount: current.amount || String(summary.balanceDue || ''),
        }));
      })
      .catch((loadError) => {
        if (active) setError(toPaymentServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoadingSelected(false);
      });

    return () => {
      active = false;
    };
  }, [activeBusiness?.currency, initialOrderId]);

  useEffect(() => {
    let active = true;
    if (!businessId || selectedOrder) return undefined;

    searchPayableOrders({
      businessId,
      search: debouncedOrderSearch,
      pageSize: PAYABLE_ORDER_PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return;
        setPayableOrders(result.data);
        setOrderTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toPaymentServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoadingOrders(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, debouncedOrderSearch, selectedOrder]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const chooseOrder = (order) => {
    setSelectedOrder(order);
    setForm((current) => ({
      ...current,
      amount: String(order.balanceDue || ''),
    }));
    setError('');
  };

  const changeOrder = () => {
    setSelectedOrder(null);
    setLoadingOrders(true);
    setPayableOrders([]);
    setOrderSearch('');
    setDebouncedOrderSearch('');
    setForm((current) => ({ ...current, amount: '' }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedOrder) {
      setError('Choose an order before recording a payment.');
      return;
    }

    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (amount > selectedOrder.balanceDue) {
      setError('Payment amount exceeds the outstanding order balance.');
      return;
    }
    if (!form.methodCode) {
      setError('Choose a payment method.');
      return;
    }
    if (!form.paymentDate) {
      setError('Choose the payment date.');
      return;
    }
    if (form.paymentDate > todayInputValue()) {
      setError('Payment date cannot be in the future.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payment = await recordPayment({
        orderId: selectedOrder.orderId,
        amount,
        methodCode: form.methodCode,
        paymentDate: form.paymentDate,
        transactionReference: form.transactionReference.trim(),
        notes: form.notes.trim(),
        providerKey: form.providerKey.trim(),
        providerTransactionId: form.providerTransactionId.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      navigate(`/payments/${payment.id}`, {
        state: {
          message: `${payment.paymentNumber} was recorded and is pending verification.`,
        },
      });
    } catch (saveError) {
      setError(toPaymentServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  const orderStatusBadge = selectedOrder
    ? getPaymentStatusBadge(selectedOrder.paymentStatus)
    : null;

  return (
    <section className="space-y-6" aria-labelledby="record-payment-title">
      <div>
        <Link
          to="/payments"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to payments
        </Link>
        <h1
          id="record-payment-title"
          className="mt-2 text-lg font-semibold tracking-tight text-slate-900"
        >
          Record payment
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
          Record money received against a confirmed order. The payment starts as
          pending and only affects the paid balance after manual verification.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <Alert variant="info" title="Verification is separate">
        Never mark an order fulfilled because a payment was recorded. Verify the
        bank statement, mobile money message or cash handover first.
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Payment details</CardTitle>
              <CardDescription>
                Amounts use the order currency and are stored with two decimal
                places.
              </CardDescription>
            </div>
            <WalletCards className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {loadingMethods ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading payment methods...
              </div>
            ) : methods.length === 0 ? (
              <Alert variant="warning">
                No active payment methods are configured for this business.
              </Alert>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="payment-amount"
                    label={`Amount (${selectedOrder?.currency ?? activeBusiness?.currency ?? ''})`}
                    type="number"
                    min="0.01"
                    max={selectedOrder?.balanceDue}
                    step="0.01"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) =>
                      updateField('amount', event.target.value)
                    }
                    hint={
                      selectedOrder
                        ? `Balance due ${formatCurrency(selectedOrder.balanceDue, {
                            currency: selectedOrder.currency,
                          })}`
                        : 'Choose an order first'
                    }
                    required
                  />
                  <SelectField
                    id="payment-method"
                    label="Payment method"
                    value={form.methodCode}
                    onChange={(event) =>
                      updateField('methodCode', event.target.value)
                    }
                    options={methods.map((method) => ({
                      value: method.code,
                      label: method.label,
                    }))}
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="payment-date"
                    label="Payment date"
                    type="date"
                    max={todayInputValue()}
                    value={form.paymentDate}
                    onChange={(event) =>
                      updateField('paymentDate', event.target.value)
                    }
                    required
                  />
                  <FormField
                    id="payment-reference"
                    label="Transaction reference (optional)"
                    value={form.transactionReference}
                    maxLength={120}
                    onChange={(event) =>
                      updateField('transactionReference', event.target.value)
                    }
                    placeholder="Bank or mobile money reference"
                  />
                </div>

                <div>
                  <label
                    htmlFor="payment-notes"
                    className="text-sm font-medium text-slate-700"
                  >
                    Notes (optional)
                  </label>
                  <textarea
                    id="payment-notes"
                    value={form.notes}
                    onChange={(event) => updateField('notes', event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Anything the verifier should know"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>

                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    Integration references (optional)
                  </summary>
                  <p className="mt-1 text-xs text-slate-400">
                    Reserved for future provider integrations. No gateway is
                    connected in this release.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField
                      id="payment-provider"
                      label="Provider key"
                      value={form.providerKey}
                      maxLength={60}
                      onChange={(event) =>
                        updateField('providerKey', event.target.value)
                      }
                      placeholder="mobile_money"
                    />
                    <FormField
                      id="payment-provider-transaction"
                      label="Provider transaction ID"
                      value={form.providerTransactionId}
                      maxLength={160}
                      onChange={(event) =>
                        updateField('providerTransactionId', event.target.value)
                      }
                    />
                  </div>
                </details>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
                  <Link
                    to="/payments"
                    className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    Cancel
                  </Link>
                  <Button
                    type="submit"
                    disabled={
                      saving ||
                      !selectedOrder ||
                      methods.length === 0 ||
                      loadingMethods
                    }
                  >
                    {saving ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    Record pending payment
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Order</CardTitle>
                <CardDescription>
                  Payments can be recorded for confirmed or fulfilled orders.
                </CardDescription>
              </div>
              <ShoppingCart className="h-5 w-5 text-slate-400" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {loadingSelected ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading order...
                </div>
              ) : selectedOrder ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {selectedOrder.orderNumber}
                      </p>
                      {orderStatusBadge ? (
                        <Badge variant={orderStatusBadge.variant}>
                          {orderStatusBadge.label}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedOrder.customerName}
                    </p>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Order total</dt>
                      <dd className="font-medium text-slate-900">
                        {formatCurrency(selectedOrder.orderTotal, {
                          currency: selectedOrder.currency,
                        })}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Net paid</dt>
                      <dd className="font-medium text-slate-900">
                        {formatCurrency(selectedOrder.netPaid, {
                          currency: selectedOrder.currency,
                        })}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Balance due</dt>
                      <dd className="font-semibold text-slate-900">
                        {formatCurrency(selectedOrder.balanceDue, {
                          currency: selectedOrder.currency,
                        })}
                      </dd>
                    </div>
                  </dl>
                  {selectedOrder.pendingAmount > 0 ? (
                    <Alert variant="warning">
                      {formatCurrency(selectedOrder.pendingAmount, {
                        currency: selectedOrder.currency,
                      })}{' '}
                      is already pending verification.
                    </Alert>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={changeOrder}>
                    Choose another order
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <FormField
                    id="payable-order-search"
                    label="Find an order"
                    type="search"
                    placeholder="Order number or customer"
                    value={orderSearch}
                    onChange={(event) => setOrderSearch(event.target.value)}
                    trailing={
                      <Search
                        className="h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                    }
                  />
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {loadingOrders
                        ? 'Searching orders...'
                        : `${orderTotal} payable order${
                            orderTotal === 1 ? '' : 's'
                          }`}
                    </span>
                    {loadingOrders ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  {payableOrders.length === 0 && !loadingOrders ? (
                    <EmptyState
                      icon={ShoppingCart}
                      title="No payable orders found"
                      description="Confirm an order first, or search for a different order number or customer."
                      className="px-4 py-8"
                    />
                  ) : (
                    <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                      {payableOrders.map((order) => (
                        <button
                          key={order.orderId}
                          type="button"
                          onClick={() => chooseOrder(order)}
                          className="w-full rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">
                                {order.orderNumber}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {order.customerName}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                Created {formatDateTime(order.createdAt)}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold text-slate-900">
                                {formatCurrency(order.balanceDue, {
                                  currency: order.currency,
                                })}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                balance due
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
