import { useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { SelectField } from '../../../components/ui/SelectField';
import { labelClasses } from '../../../components/ui/formStyles';
import { COUNTRY_OPTIONS } from '../../../config/businessOptions';
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll';
import {
  saveCustomerAddress,
  toCustomerServiceError,
} from '../../../services/customerService';
import { cn } from '../../../utils/cn';
import {
  addressValuesFromRecord,
  EMPTY_ADDRESS_FORM,
} from '../customerUtils';

export function CustomerAddressDialog({
  customerId,
  address,
  defaultCountry,
  isFirstAddress,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => ({
    ...(address ? addressValuesFromRecord(address) : EMPTY_ADDRESS_FORM),
    country: address?.country ?? defaultCountry ?? 'RW',
    isDefault: address?.isDefault ?? Boolean(isFirstAddress),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useLockBodyScroll(true);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.line1.trim()) {
      setError('Enter at least the first line of the address.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const saved = await saveCustomerAddress({
        customerId,
        addressId: address?.id ?? null,
        ...form,
      });
      onSaved(saved);
    } catch (saveError) {
      setError(toCustomerServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-address-title"
        className="max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="customer-address-title"
              className="text-base font-semibold text-slate-900"
            >
              {address ? 'Edit address' : 'Add address'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Addresses help with delivery and customer context.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close address dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="address-label"
              label="Label"
              value={form.label}
              onChange={(event) => updateField('label', event.target.value)}
              placeholder="Home, Work, Shop..."
            />
            <FormField
              id="address-recipient"
              label="Recipient name"
              value={form.recipientName}
              onChange={(event) => updateField('recipientName', event.target.value)}
              placeholder="Who should receive deliveries?"
            />
          </div>

          <FormField
            id="address-line1"
            label="Address line 1"
            value={form.line1}
            onChange={(event) => updateField('line1', event.target.value)}
            placeholder="Street, building or sector"
            required
          />
          <FormField
            id="address-line2"
            label="Address line 2"
            value={form.line2}
            onChange={(event) => updateField('line2', event.target.value)}
            placeholder="Apartment, floor or landmark"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="address-city"
              label="City or district"
              value={form.city}
              onChange={(event) => updateField('city', event.target.value)}
            />
            <FormField
              id="address-region"
              label="Region or province"
              value={form.region}
              onChange={(event) => updateField('region', event.target.value)}
            />
            <FormField
              id="address-postal"
              label="Postal code"
              value={form.postalCode}
              onChange={(event) => updateField('postalCode', event.target.value)}
            />
            <SelectField
              id="address-country"
              label="Country"
              value={form.country}
              onChange={(event) => updateField('country', event.target.value)}
              options={COUNTRY_OPTIONS}
              placeholder="Select a country"
              required
            />
          </div>

          <label
            htmlFor="address-default"
            className={cn(
              labelClasses,
              'flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3',
            )}
          >
            <input
              id="address-default"
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) => updateField('isDefault', event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="font-normal normal-case tracking-normal text-slate-600">
              <span className="block text-sm font-medium text-slate-800">
                Default address
              </span>
              <span className="mt-0.5 block text-xs">
                Use this address first for future conversations and orders.
              </span>
            </span>
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="min-w-32">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {address ? 'Save address' : 'Add address'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
