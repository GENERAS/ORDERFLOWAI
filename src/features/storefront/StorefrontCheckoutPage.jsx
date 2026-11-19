import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  LockKeyhole,
  MessageCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useStorefront } from './StorefrontContext';
import {
  buildCheckoutUrl,
  buildWhatsAppHandoffUrl,
  cartItemKey,
  getCartSubtotal,
} from './storefrontUtils';
import {
  createStorefrontCheckoutReference,
  getStorefrontCheckoutReference,
  getStorefrontOrderStatus,
  isStorefrontOrderNotFoundError,
  submitStorefrontOrder,
  toStorefrontServiceError,
} from './storefrontService';

const EMPTY_FORM = {
  customerName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  instructions: '',
};

export default function StorefrontCheckoutPage() {
  const { reference } = useParams();
  const {
    store,
    storeSlug,
    cart,
    clearCart,
  } = useStorefront();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [referenceData, setReferenceData] = useState(null);
  const [referenceError, setReferenceError] = useState('');
  const [createdReference, setCreatedReference] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  const [orderStatusError, setOrderStatusError] = useState('');
  const [statusLinkCopied, setStatusLinkCopied] = useState(false);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [whatsappError, setWhatsappError] = useState('');
  const [whatsappReference, setWhatsappReference] = useState(null);
  const [copied, setCopied] = useState(false);
  const submittingRef = useRef(false);
  const whatsappBusyRef = useRef(false);
  const activeReference = reference || createdReference;

  useEffect(() => {
    if (!reference) return undefined;
    let active = true;

    getStorefrontCheckoutReference({ storeSlug, reference })
      .then((data) => {
        if (!active) return;
        setReferenceData(data);
        setReferenceError('');
      })
      .catch(async (loadError) => {
        if (!active) return;
        const checkoutError = toStorefrontServiceError(loadError);

        try {
          const status = await getStorefrontOrderStatus({ storeSlug, reference });
          if (!active) return;
          setOrderStatus(status);
          setReferenceError('');
        } catch (statusError) {
          if (!active) return;
          const normalizedStatusError = toStorefrontServiceError(statusError);
          setReferenceError(
            isStorefrontOrderNotFoundError(normalizedStatusError)
              ? normalizedStatusError.message
              : checkoutError.message,
          );
        }
      });

    return () => {
      active = false;
    };
  }, [reference, storeSlug]);

  useEffect(() => {
    if (!activeReference || !orderStatus) return undefined;
    if (['completed', 'cancelled'].includes(orderStatus.status)) return undefined;

    let active = true;
    const timer = window.setInterval(() => {
      getStorefrontOrderStatus({ storeSlug, reference: activeReference })
        .then((status) => {
          if (active) setOrderStatus(status);
        })
        .catch(() => {
          if (active) setOrderStatusError('Live updates are temporarily unavailable.');
        });
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeReference, orderStatus, storeSlug]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const effectiveItems = referenceData?.items ?? cart;
  const effectiveSubtotal = getCartSubtotal(effectiveItems);
  const effectiveCurrency = referenceData?.currency || store.currency || effectiveItems[0]?.currency || 'RWF';
  const referenceLoading = Boolean(reference)
    && !referenceData
    && !orderStatus
    && !referenceError;

  const validateCart = () => {
    if (effectiveItems.length > 0) return true;
    setErrors({ cart: 'Your cart is empty.' });
    return false;
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.customerName.trim()) nextErrors.customerName = 'Enter your name.';
    if (!form.phone.trim()) nextErrors.phone = 'Enter a phone number where the business can reach you.';
    if (form.email.trim() && !/^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$/.test(form.email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (effectiveItems.length === 0) nextErrors.cart = 'Your cart is empty.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || !validate()) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');

    try {
      let orderReference = activeReference;

      if (!orderReference) {
        const created = await createStorefrontCheckoutReference({
          storeSlug,
          items: effectiveItems,
          channel: 'online_store',
        });
        orderReference = created.reference;
        setCreatedReference(created.reference);
      }

      const result = await submitStorefrontOrder({
        storeSlug,
        customerName: form.customerName,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        instructions: form.instructions,
        items: effectiveItems,
        idempotencyKey: null,
        checkoutReference: orderReference,
        channel: referenceData?.channel || (orderReference === whatsappReference?.reference
          ? 'whatsapp'
          : 'online_store'),
      });
      setConfirmation(result);

      try {
        const status = await getStorefrontOrderStatus({
          storeSlug,
          reference: orderReference,
        });
        setOrderStatus(status);
        setOrderStatusError('');
      } catch {
        setOrderStatusError('The order was received, but live status could not be loaded.');
      }

      clearCart();
    } catch (error) {
      setSubmitError(toStorefrontServiceError(error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleWhatsApp = async () => {
    if (whatsappBusyRef.current || !validateCart()) return;

    whatsappBusyRef.current = true;
    setWhatsappBusy(true);
    setWhatsappError('');
    setCopied(false);

    try {
      const created = await createStorefrontCheckoutReference({
        storeSlug,
        items: effectiveItems,
        channel: 'whatsapp',
      });
      setWhatsappReference(created);
      setCreatedReference(created.reference);

      const handoffUrl = buildWhatsAppHandoffUrl({
        phone: store.contactPhone,
        storeName: store.name,
        checkoutPath: created.checkoutPath,
      });
      if (handoffUrl) {
        window.open(handoffUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setWhatsappError(toStorefrontServiceError(error).message);
    } finally {
      whatsappBusyRef.current = false;
      setWhatsappBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!whatsappReference) return;
    const checkoutUrl = buildCheckoutUrl(whatsappReference.checkoutPath);

    try {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
    } catch {
      setWhatsappError(`Copy this link: ${checkoutUrl}`);
    }
  };

  const handleCopyStatusLink = async () => {
    if (!activeReference) return;
    const statusUrl = buildCheckoutUrl(
      `/store/${storeSlug}/checkout/${activeReference}`,
    );

    try {
      await navigator.clipboard.writeText(statusUrl);
      setStatusLinkCopied(true);
    } catch {
      setOrderStatusError(`Copy this link: ${statusUrl}`);
    }
  };

  if (confirmation || orderStatus) {
    const displayStatus = orderStatus;
    const timeline = displayStatus?.timeline ?? [];
    const latestNotification = displayStatus?.latestNotification ?? null;
    const isTerminal = ['completed', 'cancelled'].includes(displayStatus?.status);
    const orderNumber = displayStatus?.orderNumber ?? confirmation?.orderNumber;
    const total = displayStatus?.total ?? confirmation?.total ?? 0;
    const currency = displayStatus?.currency ?? confirmation?.currency;
    const createdAt = displayStatus?.createdAt ?? confirmation?.createdAt;
    const statusTitle = displayStatus?.statusTitle ?? 'Order received';
    const statusMessage = displayStatus?.statusMessage ?? confirmation?.message;

    return (
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <div className="sf-surface overflow-hidden">
          <div className="border-b border-slate-100 p-8 text-center sm:p-10">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {statusTitle}
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
              {statusMessage}
            </p>
            {!isTerminal ? (
              <p className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                This page updates automatically as the business processes your order.
              </p>
            ) : null}
          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
            <div className="sf-surface-soft p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Order details
              </p>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Order number</dt>
                  <dd className="font-semibold text-slate-900">{orderNumber}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Total</dt>
                  <dd className="font-semibold text-slate-900">
                    {formatCurrency(total, { currency })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Received</dt>
                  <dd className="font-semibold text-slate-900">
                    {formatDateTime(createdAt)}
                  </dd>
                </div>
              </dl>
              <Button
                className="mt-5 h-10 w-full rounded-xl"
                variant="secondary"
                onClick={handleCopyStatusLink}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {statusLinkCopied ? 'Status link copied' : 'Copy status link'}
              </Button>
            </div>

            <div className="p-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Progress
              </p>
              <ol className="mt-4 space-y-4">
                {timeline.map((step) => (
                  <li key={step.key} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        step.complete
                          ? step.current
                            ? 'sf-accent-bg text-white'
                            : 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {step.complete ? '✓' : ''}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-semibold ${
                          step.current ? 'text-slate-900' : 'text-slate-600'
                        }`}
                      >
                        {step.label}
                      </p>
                      {step.at ? (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDateTime(step.at)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-5 sm:px-8">
            {latestNotification ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {latestNotification.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {latestNotification.message}
                </p>
              </div>
            ) : null}
            <Alert
              className="mt-3"
              variant={displayStatus?.whatsappConnected ? 'info' : 'warning'}
              title={
                displayStatus?.whatsappConnected
                  ? 'WhatsApp updates are connected'
                  : 'WhatsApp is not connected'
              }
            >
              {displayStatus?.whatsappConnected
                ? 'You will also receive WhatsApp updates. This page keeps the same live status.'
                : 'We detected that WhatsApp is not connected, so your order status and approval updates are shown here automatically.'}
            </Alert>
            {orderStatusError ? (
              <Alert className="mt-3" variant="error">
                {orderStatusError}
              </Alert>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-slate-500">
              No payment has been recorded here. The business will confirm order details and
              payment arrangements before fulfilment.
            </p>
            <Link
              to={`/store/${storeSlug}`}
              className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (referenceLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Opening secure checkout…
      </div>
    );
  }

  if (referenceError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <Alert variant="error" title="Checkout link unavailable">
          {referenceError}
        </Alert>
        <Link
          to={`/store/${storeSlug}`}
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to store
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Link
        to={`/store/${storeSlug}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Continue shopping
      </Link>

      <h1 className="mt-6 text-3xl font-extrabold tracking-[-0.035em] text-slate-900 sm:text-4xl">
        {referenceData ? 'Confirm your order' : 'Checkout'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {referenceData
          ? `Review the items saved from your chat with ${store.name}, then confirm your details.`
          : `Choose how you want to order from ${store.name}.`}
      </p>

      <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="sf-accent-bg flex h-6 w-6 items-center justify-center rounded-full text-white">1</span>
        <span>Review items</span>
        <span className="sf-hairline w-8" />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">2</span>
        <span>Confirm details</span>
      </div>

      {referenceData ? (
        <Alert className="mt-6" variant="info" title="Secure WhatsApp checkout">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>These items and prices were locked by the store when the link was created.</span>
            <span className="inline-flex items-center gap-1 font-medium">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Expires {formatDateTime(referenceData.expiresAt)}
            </span>
          </div>
        </Alert>
      ) : null}

      {effectiveItems.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={LockKeyhole}
          title="Your cart is empty"
          description="Add products before checking out."
          action={
            <Link
              to={`/store/${storeSlug}`}
              className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white"
            >
              Browse products
            </Link>
          }
        />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
          <form
            onSubmit={handleSubmit}
            className="sf-surface p-5 sm:p-7"
          >
            {!referenceData ? (
              <div className="sf-surface-soft p-5">
                <div className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Order on WhatsApp</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      We create a secure checkout link containing your items only. The assistant confirms
                      details with you, then the business approves the order.
                    </p>
                    <Button
                      className="mt-3 h-11 w-full rounded-xl"
                      variant="secondary"
                      onClick={handleWhatsApp}
                      disabled={whatsappBusy}
                    >
                      {whatsappBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      )}
                      {whatsappBusy ? 'Creating secure link…' : 'Continue on WhatsApp'}
                    </Button>
                    {!store.contactPhone ? (
                      <p className="mt-2 text-xs text-slate-500">
                        No WhatsApp number is published. You can copy the secure link after creating it.
                      </p>
                    ) : null}
                    {whatsappReference ? (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-medium text-slate-700">Secure checkout link</p>
                        <input
                          readOnly
                          value={buildCheckoutUrl(whatsappReference.checkoutPath)}
                          className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-600"
                          aria-label="Secure checkout link"
                        />
                        <Button
                          className="mt-2"
                          size="sm"
                          variant="ghost"
                          onClick={handleCopyLink}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {copied ? 'Copied' : 'Copy link'}
                        </Button>
                      </div>
                    ) : null}
                    {whatsappError ? (
                      <Alert className="mt-3" variant="error" title="WhatsApp handoff failed">
                        {whatsappError}
                      </Alert>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div className={referenceData ? '' : 'mt-7 border-t border-slate-100 pt-6'}>
              <h2 className="text-base font-semibold text-slate-900">Your details</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Full name"
                  required
                  value={form.customerName}
                  onChange={updateField('customerName')}
                  error={errors.customerName}
                  autoComplete="name"
                />
                <FormField
                  label="Phone number"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={updateField('phone')}
                  error={errors.phone}
                  autoComplete="tel"
                />
                <FormField
                  label="Email address"
                  type="email"
                  value={form.email}
                  onChange={updateField('email')}
                  error={errors.email}
                  hint="Optional, but useful for order confirmation."
                  autoComplete="email"
                />
                <FormField
                  label="City or location"
                  value={form.city}
                  onChange={updateField('city')}
                  autoComplete="address-level2"
                />
                <FormField
                  className="sm:col-span-2"
                  label="Delivery address"
                  value={form.address}
                  onChange={updateField('address')}
                  error={errors.address}
                  hint="Include landmarks or directions where helpful."
                  autoComplete="street-address"
                />
                <div className="sm:col-span-2">
                  <label htmlFor="instructions" className="block text-sm font-medium text-slate-700">
                    Customer instructions
                  </label>
                  <textarea
                    id="instructions"
                    rows={4}
                    value={form.instructions}
                    onChange={updateField('instructions')}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                    placeholder="Delivery notes or questions for the business"
                  />
                </div>
              </div>
            </div>

            {submitError ? (
              <Alert className="mt-5" variant="error" title="Order could not be submitted">
                {submitError}
              </Alert>
            ) : null}
            {errors.cart ? (
              <Alert className="mt-5" variant="warning">
                {errors.cart}
              </Alert>
            ) : null}

            <Button className="mt-6 h-11 w-full rounded-xl" type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {submitting
                ? 'Submitting order…'
                : referenceData
                  ? 'Confirm order'
                  : 'Place order online'}
            </Button>
            <p className="mt-3 text-center text-xs text-slate-500">
              By submitting this order you agree that the business may contact you about it.
            </p>
          </form>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-slate-900">Order summary</h2>
            <ul className="mt-5 space-y-4">
              {effectiveItems.map((item) => (
                <li key={cartItemKey(item)} className="flex gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                    {item.variantName ? (
                      <p className="text-xs text-slate-500">{item.variantName}</p>
                    ) : null}
                    <p className="text-xs text-slate-500">Quantity: {item.quantity}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatCurrency(item.price * item.quantity, { currency: item.currency || effectiveCurrency })}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-sm text-slate-600">
                {referenceData ? 'Locked subtotal' : 'Estimated subtotal'}
              </span>
              <span className="text-lg font-semibold text-slate-900">
                {formatCurrency(referenceData?.estimatedTotal ?? effectiveSubtotal, {
                  currency: effectiveCurrency,
                })}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {referenceData
                ? 'The business confirms the final order before any payment is requested.'
                : 'The final total is recalculated from live catalogue prices before the order is created.'}
            </p>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              <p className="font-semibold text-slate-800">Payment</p>
              <p className="mt-1">
                No online payment is taken here. Your order will be created as unpaid and awaiting
                business approval. Payment arrangements are handled by the business.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
