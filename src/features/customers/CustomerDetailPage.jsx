import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  ShoppingCart,
  Trash2,
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
  deleteCustomerAddress,
  getCustomer,
  toCustomerServiceError,
} from '../../services/customerService';
import {
  searchOrders,
  toOrderServiceError,
} from '../../services/orderService';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  getOrderStatusBadge,
  getStockStateLabel,
} from '../orders/orderUtils';
import { CustomerAddressDialog } from './components/CustomerAddressDialog';
import {
  formatCustomerAddress,
  getCustomerInitials,
} from './customerUtils';

export default function CustomerDetailPage() {
  const { customerId } = useParams();
  const location = useLocation();
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;

  const [customer, setCustomer] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => location.state?.message ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [addressDialog, setAddressDialog] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let active = true;
    if (!businessId || !customerId) return undefined;

    getCustomer({ businessId, customerId })
      .then((result) => {
        if (!active) return;
        setCustomer(result.customer);
        setAddresses(result.addresses);
        if (!result.customer) setError('This customer could not be found.');
        else setError('');
      })
      .catch((loadError) => {
        if (active) setError(toCustomerServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, customerId, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!businessId || !customerId) return undefined;

    searchOrders({
      businessId,
      customerId,
      page: 1,
      pageSize: 5,
      sort: 'recent',
      direction: 'desc',
    })
      .then((result) => {
        if (active) setOrders(result.data);
      })
      .catch((loadError) => {
        if (active) setError(toOrderServiceError(loadError).message);
      });

    return () => {
      active = false;
    };
  }, [businessId, customerId, refreshKey]);

  const handleAddressSaved = (saved) => {
    setAddressDialog(null);
    setSuccess(saved ? 'The address was saved.' : '');
    setRefreshKey((current) => current + 1);
  };

  const handleDeleteAddress = async (address) => {
    const label =
      address.label || address.line1 || 'this address';
    if (
      !window.confirm(
        `Delete ${label}?\n\nThis removes the address from the customer record.`,
      )
    ) {
      return;
    }

    setDeletingId(address.id);
    setError('');
    setSuccess('');

    try {
      await deleteCustomerAddress(address.id);
      setSuccess('The address was removed.');
      setRefreshKey((current) => current + 1);
    } catch (deleteError) {
      setError(toCustomerServiceError(deleteError).message);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <PageLoader />;

  if (!customer) {
    return (
      <section className="space-y-4">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to customers
        </Link>
        <Alert variant="error">
          {error || 'This customer could not be found.'}
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="customer-detail-title">
      <div>
        <Link
          to="/customers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to customers
        </Link>

        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
              {getCustomerInitials(customer.fullName)}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="customer-detail-title"
                  className="truncate text-lg font-semibold tracking-tight text-slate-900"
                >
                  {customer.fullName}
                </h2>
                <Badge variant="brand">Customer</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                {customer.companyName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {customer.companyName}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {customer.addressCount} address
                  {customer.addressCount === 1 ? '' : 'es'}
                </span>
                <span>Added {formatDate(customer.createdAt)}</span>
              </div>
            </div>
          </div>

          <Link
            to={`/customers/${customer.id}/edit`}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit customer
          </Link>
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
                <CardTitle>Contact details</CardTitle>
                <CardDescription>
                  Use these details when preparing conversations and orders.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Email
                  </dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {customer.email ? (
                      <a
                        href={`mailto:${customer.email}`}
                        className="inline-flex items-center gap-2 break-all text-brand-700 hover:underline"
                      >
                        <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {customer.email}
                      </a>
                    ) : (
                      <span className="text-slate-400">Not provided</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Phone
                  </dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {customer.phone ? (
                      <a
                        href={`tel:${customer.phone.replace(/\s+/g, '')}`}
                        className="inline-flex items-center gap-2 text-brand-700 hover:underline"
                      >
                        <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {customer.phone}
                      </a>
                    ) : (
                      <span className="text-slate-400">Not provided</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Last updated
                  </dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {formatDateTime(customer.updatedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Workspace
                  </dt>
                  <dd className="mt-1 text-sm text-slate-700">
                    {activeBusiness?.name}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Addresses</CardTitle>
                <CardDescription>
                  Keep delivery and billing locations organised for this customer.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAddressDialog({ address: null })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add address
              </Button>
            </CardHeader>
            <CardContent>
              {addresses.length === 0 ? (
                <EmptyState
                  icon={MapPin}
                  title="No addresses yet"
                  description="Add a delivery or billing address so future orders have the right details."
                  action={
                    <Button
                      size="sm"
                      onClick={() => setAddressDialog({ address: null })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add address
                    </Button>
                  }
                  className="py-8"
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {addresses.map((address) => (
                    <li
                      key={address.id}
                      className="flex flex-col rounded-xl border border-slate-200 bg-slate-50/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              {address.label || 'Address'}
                            </h3>
                            {address.isDefault ? (
                              <Badge variant="success">Default</Badge>
                            ) : null}
                          </div>
                          {address.recipientName ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {address.recipientName}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAddressDialog({ address })}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
                            aria-label={`Edit ${address.label || 'address'}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAddress(address)}
                            disabled={deletingId === address.id}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-50"
                            aria-label={`Delete ${address.label || 'address'}`}
                          >
                            {deletingId === address.id ? (
                              <Loader2
                                className="h-4 w-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <address className="mt-3 space-y-0.5 text-sm not-italic leading-relaxed text-slate-600">
                        {formatCustomerAddress(address).map((line, index) => (
                          <p key={`${index}-${line}`}>{line}</p>
                        ))}
                      </address>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Notes</CardTitle>
                <CardDescription>Internal customer context.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {customer.notes ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {customer.notes}
                </p>
              ) : (
                <p className="text-sm text-slate-400">No notes added yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Order history</CardTitle>
                <CardDescription>
                  The most recent purchases linked to this customer.
                </CardDescription>
              </div>
              <Link
                to={`/orders/new?customerId=${customer.id}`}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                New order
              </Link>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="No order history yet"
                  description="Create an order for this customer and it will appear here."
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-2">
                  {orders.map((order) => {
                    const statusBadge = getOrderStatusBadge(order.status);
                    return (
                      <li key={order.id}>
                        <Link
                          to={`/orders/${order.id}`}
                          className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/30"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">
                                  {order.orderNumber}
                                </p>
                                <Badge variant={statusBadge.variant}>
                                  {statusBadge.label}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatDate(order.createdAt)} -{' '}
                                {order.itemCount} item
                                {order.itemCount === 1 ? '' : 's'}
                              </p>
                              {order.stockState !== 'none' ? (
                                <p className="mt-1 text-[11px] text-slate-400">
                                  {getStockStateLabel(order.stockState)}
                                </p>
                              ) : null}
                            </div>
                            <p className="shrink-0 text-sm font-semibold text-slate-900">
                              {formatCurrency(order.total, {
                                currency: order.currency,
                              })}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {addressDialog ? (
        <CustomerAddressDialog
          customerId={customer.id}
          address={addressDialog.address}
          defaultCountry={activeBusiness?.country}
          isFirstAddress={addresses.length === 0}
          onClose={() => setAddressDialog(null)}
          onSaved={handleAddressSaved}
        />
      ) : null}
    </section>
  );
}
