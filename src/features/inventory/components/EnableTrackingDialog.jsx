import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll';
import {
  enableInventoryTracking,
  toInventoryServiceError,
} from '../../../services/inventoryService';

export function EnableTrackingDialog({ item, onClose, onEnabled }) {
  const [threshold, setThreshold] = useState(
    item?.lowStockThreshold == null ? '' : String(item.lowStockThreshold),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useLockBodyScroll(Boolean(item));

  useEffect(() => {
    if (!item) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose, saving]);

  if (!item) return null;

  const itemLabel = item.variantName
    ? `${item.productName} · ${item.variantName}`
    : item.productName;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const enabled = await enableInventoryTracking({
        productId: item.productId,
        variantId: item.variantId,
        lowStockThreshold: threshold,
      });
      onEnabled(enabled);
    } catch (enableError) {
      setError(toInventoryServiceError(enableError).message);
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
        aria-labelledby="enable-tracking-title"
        className="max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="enable-tracking-title"
              className="text-base font-semibold text-slate-900"
            >
              Enable stock tracking
            </h2>
            <p className="mt-1 text-sm text-slate-500">{itemLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <FormField
            id="enable-tracking-threshold"
            label="Low-stock threshold"
            type="number"
            min="0"
            step="1"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            hint="Optional. Leave blank if this item does not need a low-stock warning."
            placeholder="For example, 10"
          />

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Enable tracking
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
