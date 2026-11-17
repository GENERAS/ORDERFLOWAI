import { useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { useStorefront } from './StorefrontContext';
import { cartItemKey } from './storefrontUtils';
import {
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
  const {
    store,
    storeSlug,
    cart,
    subtotal,
    clearCart,
  } = useStorefront();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const idempotencyKeyRef = useRef(null);
  const submittingRef = useRef(false);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.customerName.trim()) nextErrors.customerName = 'Enter your name.';
    if (!form.phone.trim()) nextErrors.phone = 'Enter a phone number where the business can reach you.';
    if (form.email.trim() && !/^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$/.test(form.email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (cart.length === 0) nextErrors.cart = 'Your cart is empty.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || !validate()) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');

    try {
      const result = await submitStorefrontOrder({
        storeSlug,
        customerName: form.customerName,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        instructions: form.instructions,
        items: cart,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setConfirmation(result);
      clearCart();
    } catch (error) {
      setSubmitError(toStorefrontServiceError(error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (confirmation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <div className="rounded-2xl border border-emerald-200 bg-white p-7 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Order received</h1>
          <p className="mt-2 text-sm text-slate-600">{confirmation.message}</p>
          <dl className="mt-7 grid gap-4 rounded-xl bg-slate-50 p-5 text-left sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Order number</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{confirmation.orderNumber}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Status</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                Awaiting business approval
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Total</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {formatCurrency(confirmation.total, { currency: confirmation.currency })}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Received</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTime(confirmation.createdAt)}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs text-slate-500">
            No payment has been recorded. The business will confirm your order and arrangements directly.
          </p>
          <Link
            to={`/store/${storeSlug}`}
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to={`/store/${storeSlug}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Continue shopping
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">Checkout</h1>
      <p className="mt-2 text-sm text-slate-600">
        Enter your details and we will create a real order for {store.name}.
      </p>

      {cart.length === 0 ? (
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
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
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

            <Button className="mt-6 w-full" type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {submitting ? 'Submitting order…' : 'Place order'}
            </Button>
            <p className="mt-3 text-center text-xs text-slate-500">
              By placing this order you agree that the business may contact you about it.
            </p>
          </form>

          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-slate-900">Order summary</h2>
            <ul className="mt-5 space-y-4">
              {cart.map((item) => (
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
                    {formatCurrency(item.price * item.quantity, { currency: item.currency })}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-sm text-slate-600">Estimated subtotal</span>
              <span className="text-lg font-semibold text-slate-900">
                {formatCurrency(subtotal, { currency: store.currency })}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The final total is recalculated from live catalogue prices before the order is created.
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
