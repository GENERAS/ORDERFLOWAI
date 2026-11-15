import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Info,
  Loader2,
  Save,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { getCustomer, toCustomerServiceError } from '../../services/customerService';
import {
  createOrder,
  getOrder,
  toOrderServiceError,
  updateOrder,
} from '../../services/orderService';
import { formatCurrency } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { CustomerPicker } from './components/CustomerPicker';
import { OrderItemPicker } from './components/OrderItemPicker';
import {
  catalogueKey,
  formatOrderQuantity,
  getOrderItemLabel,
  isOrderEditable,
} from './orderUtils';

function itemFromCatalogue(item) {
  return {
    key: catalogueKey(item.productId, item.variantId),
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    unitPrice: String(item.unitPrice ?? ''),
    quantity: '1',
    isTracked: item.isTracked,
    availableQuantity: item.availableQuantity,
    reservedQuantity: 0,
  };
}

function itemFromOrder(item) {
  return {
    key: catalogueKey(item.productId, item.variantId),
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    unitPrice: String(item.unitPrice ?? ''),
    quantity: String(item.quantity ?? ''),
    isTracked: null,
    availableQuantity: null,
    reservedQuantity: item.reservedQuantity,
  };
}

export default function OrderEditorPage() {
  const { orderId } = useParams();
  const isNew = !orderId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const initialCustomerId = searchParams.get('customerId');

  const [customer, setCustomer] = useState(null);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!businessId || !initialCustomerId || !isNew) return undefined;

    getCustomer({ businessId, customerId: initialCustomerId })
      .then((result) => {
        if (active && result.customer) setCustomer(result.customer);
      })
      .catch((loadError) => {
        if (active) setError(toCustomerServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId, initialCustomerId, isNew]);

  useEffect(() => {
    let active = true;
    if (!businessId || !orderId) return undefined;

    getOrder({ businessId, orderId })
      .then((result) => {
        if (!active) return;
        if (!result.order) {
          setError('This order could not be found.');
          return;
        }
        if (!isOrderEditable(result.order.status)) {
          setError(
            'Only draft or awaiting orders can be edited. Open the order to review its status.',
          );
          return;
        }

        setOrder(result.order);
        setCustomer({
          id: result.order.customerId,
          fullName: result.order.customerName,
          companyName: null,
          email: result.order.customerEmail,
          phone: result.order.customerPhone,
        });
        setNotes(result.order.notes ?? '');
        setItems(result.items.map(itemFromOrder));
        setError('');
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
  }, [businessId, orderId]);

  const selectedKeys = useMemo(
    () => new Set(items.map((item) => item.key)),
    [items],
  );

  const total = items.reduce((sum, item) => {
    const price = Number(item.unitPrice);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return sum;
    return sum + Math.max(0, price) * Math.max(0, quantity);
  }, 0);

  const addItem = (catalogueItem) => {
    const nextItem = itemFromCatalogue(catalogueItem);
    if (selectedKeys.has(nextItem.key)) return;
    setItems((current) => [...current, nextItem]);
    setError('');
  };

  const updateItem = (key, field, value) => {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
    setError('');
  };

  const removeItem = (key) => {
    setItems((current) => current.filter((item) => item.key !== key));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!customer?.id) {
      setError('Choose a customer for this order.');
      return;
    }
    if (items.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }

    for (const item of items) {
      const quantity = Number(item.quantity);
      const price = Number(item.unitPrice);
      if (!Number.isInteger(quantity) || quantity < 1) {
        setError(`Enter a whole quantity for ${getOrderItemLabel(item)}.`);
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        setError(`Enter a valid agreed price for ${getOrderItemLabel(item)}.`);
        return;
      }
    }

    setSaving(true);

    try {
      const payload = {
        businessId,
        customerId: customer.id,
        notes,
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
        })),
      };

      const saved = isNew
        ? await createOrder(payload)
        : await updateOrder({ orderId, ...payload });

      navigate(`/orders/${saved.id}`, {
        state: {
          message: isNew
            ? `${saved.orderNumber} was created.`
            : `${saved.orderNumber} was updated.`,
        },
      });
    } catch (saveError) {
      setError(toOrderServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  if (!isNew && !order && error) {
    return (
      <section className="space-y-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to orders
        </Link>
        <Alert variant="error">{error}</Alert>
      </section>
    );
  }

  if (!isNew && order && !isOrderEditable(order.status)) {
    return (
      <section className="space-y-4">
        <Link
          to={`/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to order
        </Link>
        <Alert variant="error">
          {error ||
            'Only draft or awaiting orders can be edited. Cancel the order to make changes after confirmation.'}
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="order-editor-title">
      <div>
        <Link
          to={isNew ? '/orders' : `/orders/${orderId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {isNew ? 'Back to orders' : 'Back to order'}
        </Link>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="order-editor-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              {isNew ? 'New order' : `Edit ${order?.orderNumber ?? 'order'}`}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              Choose the customer, add catalogue items and record the price you
              agreed. Prices are stored on the order, so later catalogue price
              changes do not rewrite this agreement.
            </p>
          </div>
          <Badge variant="neutral">{activeBusiness?.name}</Badge>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Customer and notes</CardTitle>
                  <CardDescription>
                    Every order belongs to a customer record so purchase history
                    stays connected.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <CustomerPicker
                  businessId={businessId}
                  selectedCustomer={customer}
                  onSelect={(selected) => {
                    setCustomer(selected);
                    setError('');
                  }}
                />

                <div>
                  <label
                    htmlFor="order-notes"
                    className="text-sm font-medium text-slate-700"
                  >
                    Internal notes
                  </label>
                  <textarea
                    id="order-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Delivery instructions, agreed discount context or anything the team should know."
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Order items</CardTitle>
                  <CardDescription>
                    Add active products or variants. You can adjust quantity and
                    agreed price for each item.
                  </CardDescription>
                </div>
                <Badge variant="neutral">
                  {items.length} item{items.length === 1 ? '' : 's'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <OrderItemPicker
                  businessId={businessId}
                  selectedKeys={selectedKeys}
                  onAdd={addItem}
                />

                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                    <ShoppingCart
                      className="mx-auto h-6 w-6 text-slate-300"
                      aria-hidden="true"
                    />
                    <p className="mt-2 text-sm text-slate-500">
                      Search the catalogue above to add the first item.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {items.map((item) => {
                      const lineTotal =
                        Math.max(0, Number(item.unitPrice) || 0) *
                        Math.max(0, Number(item.quantity) || 0);

                      return (
                        <li
                          key={item.key}
                          className="rounded-xl border border-slate-200 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {getOrderItemLabel(item)}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {item.sku ? `SKU ${item.sku}` : 'No SKU'}
                                {item.isTracked != null
                                  ? item.isTracked
                                    ? ` - ${formatOrderQuantity(
                                        item.availableQuantity,
                                      )} available`
                                    : ' - not tracked'
                                  : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(item.key)}
                              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Remove ${getOrderItemLabel(item)}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                            <FormField
                              id={`quantity-${item.key}`}
                              label="Quantity"
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={(event) =>
                                updateItem(
                                  item.key,
                                  'quantity',
                                  event.target.value,
                                )
                              }
                            />
                            <FormField
                              id={`price-${item.key}`}
                              label="Agreed unit price"
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(event) =>
                                updateItem(
                                  item.key,
                                  'unitPrice',
                                  event.target.value,
                                )
                              }
                            />
                            <div className="pb-1 text-right">
                              <p className="text-xs text-slate-400">
                                Line total
                              </p>
                              <p className="text-sm font-semibold text-slate-900">
                                {formatCurrency(lineTotal, {
                                  currency: order?.currency ?? activeBusiness?.currency,
                                })}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Summary</CardTitle>
                  <CardDescription>
                    Totals are recalculated from the agreed prices.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Items</dt>
                    <dd className="font-medium text-slate-900">
                      {formatOrderQuantity(items.length)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Units</dt>
                    <dd className="font-medium text-slate-900">
                      {formatOrderQuantity(
                        items.reduce(
                          (sum, item) =>
                            sum + Math.max(0, Number(item.quantity) || 0),
                          0,
                        ),
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <dt className="text-sm font-semibold text-slate-900">
                      Order total
                    </dt>
                    <dd className="text-lg font-semibold text-slate-900">
                      {formatCurrency(total, {
                        currency: order?.currency ?? activeBusiness?.currency,
                      })}
                    </dd>
                  </div>
                </dl>

                <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
                  <p className="flex items-start gap-2">
                    <Info
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    Confirming the order reserves tracked stock. Completing it
                    consumes that stock, while cancelling releases it.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Save className="h-4 w-4" aria-hidden="true" />
                    )}
                    {isNew ? 'Create order' : 'Save order'}
                  </Button>
                  <Link
                    to={isNew ? '/orders' : `/orders/${orderId}`}
                    className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    Cancel
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </section>
  );
}
