import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll';
import { cancelOrder, toOrderServiceError } from '../../../services/orderService';

export function CancelOrderDialog({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState('');
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalized = reason.trim();
    if (normalized.length < 3) {
      setError('Add a cancellation reason with at least 3 characters.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const cancelled = await cancelOrder({
        orderId: order.id,
        reason: normalized,
      });
      onCancelled(cancelled);
    } catch (cancelError) {
      setError(toOrderServiceError(cancelError).message);
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
        aria-labelledby="cancel-order-title"
        className="max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="cancel-order-title"
              className="text-base font-semibold text-slate-900"
            >
              Cancel {order.orderNumber}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              The order will stay on record. Any reserved stock will be released
              back to available inventory.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close cancellation dialog"
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
          <div>
            <label
              htmlFor="cancel-order-reason"
              className="text-sm font-medium text-slate-700"
            >
              Cancellation reason
            </label>
            <textarea
              id="cancel-order-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError('');
              }}
              rows={4}
              maxLength={500}
              required
              placeholder="Why is this order being cancelled?"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              The reason is kept in the order activity history.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Keep order
            </Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Cancel order
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
