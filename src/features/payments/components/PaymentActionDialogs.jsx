import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { useLockBodyScroll } from '../../../hooks/useLockBodyScroll';
import {
  completeRefund,
  failPayment,
  rejectPayment,
  rejectRefund,
  requestRefund,
  toPaymentServiceError,
  verifyPayment,
} from '../../../services/paymentService';
import { formatCurrency, formatDateTime } from '../../../utils/format';
import { createIdempotencyKey } from '../paymentUtils';

function DialogShell({ title, description, children, onClose, busy, labelledBy }) {
  useLockBodyScroll(true);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[calc(100vh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={labelledBy}
              className="text-base font-semibold text-slate-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LongTextField({ id, label, value, onChange, placeholder, hint, required }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={500}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function PaymentReviewDialog({ payment, mode, onClose, onCompleted }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isVerify = mode === 'verify';
  const isReject = mode === 'reject';
  const title = isVerify
    ? `Verify ${payment.paymentNumber}`
    : isReject
      ? `Reject ${payment.paymentNumber}`
      : `Mark ${payment.paymentNumber} as failed`;
  const description = isVerify
    ? 'Verification confirms the money was received. Only verified payments count towards the paid balance.'
    : isReject
      ? 'Rejected payments stay on record but do not count towards the paid balance.'
      : 'A failed payment stays on record without changing the paid balance.';

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalized = note.trim();

    if (!isVerify && normalized.length < 3) {
      setError('Add a reason with at least 3 characters.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let updated;
      if (isVerify) {
        updated = await verifyPayment(payment.id, normalized);
      } else if (isReject) {
        updated = await rejectPayment(payment.id, normalized);
      } else {
        updated = await failPayment(payment.id, normalized);
      }
      onCompleted(
        updated,
        isVerify
          ? `${payment.paymentNumber} was verified.`
          : isReject
            ? `${payment.paymentNumber} was rejected.`
            : `${payment.paymentNumber} was marked as failed.`,
      );
    } catch (actionError) {
      setError(toPaymentServiceError(actionError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={title}
      description={description}
      onClose={onClose}
      busy={saving}
      labelledBy="payment-review-title"
    >
      <div className="mt-4 rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">
          {formatCurrency(payment.amount, { currency: payment.currency })}
        </p>
        <p className="mt-1">
          {payment.methodLabel} - {payment.orderNumber} -{' '}
          {formatDateTime(payment.createdAt)}
        </p>
      </div>

      {error ? (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <LongTextField
          id="payment-review-note"
          label={isVerify ? 'Verification note (optional)' : 'Reason'}
          value={note}
          onChange={(value) => {
            setNote(value);
            setError('');
          }}
          placeholder={
            isVerify
              ? 'Reference checked against the bank or mobile money statement.'
              : isReject
                ? 'Why is this payment being rejected?'
                : 'What caused the payment to fail?'
          }
          hint={
            isVerify
              ? 'The note is kept in the payment history.'
              : 'The reason is kept in the payment history.'
          }
          required={!isVerify}
        />

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={isVerify ? 'primary' : 'danger'}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {isVerify ? 'Verify payment' : isReject ? 'Reject payment' : 'Mark failed'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

export function RefundDialog({ payment, onClose, onCompleted }) {
  const idempotencyKeyRef = useRef(createIdempotencyKey());
  const [amount, setAmount] = useState(String(payment.refundableAmount || ''));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter a refund amount greater than zero.');
      return;
    }
    if (numericAmount > payment.refundableAmount) {
      setError('Refund amount exceeds the refundable payment balance.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Add a refund reason with at least 3 characters.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await requestRefund({
        paymentId: payment.id,
        amount: numericAmount,
        reason: reason.trim(),
        reference: reference.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      onCompleted(
        `${formatCurrency(numericAmount, {
          currency: payment.currency,
        })} refund requested for ${payment.paymentNumber}.`,
      );
    } catch (actionError) {
      setError(toPaymentServiceError(actionError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={`Request refund for ${payment.paymentNumber}`}
      description="A refund request does not reduce the paid balance until a manager completes it."
      onClose={onClose}
      busy={saving}
      labelledBy="refund-request-title"
    >
      <div className="mt-4 rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
        <p>
          Refundable:{' '}
          <span className="font-semibold text-slate-900">
            {formatCurrency(payment.refundableAmount, {
              currency: payment.currency,
            })}
          </span>
        </p>
        <p className="mt-1">
          Verified payment:{' '}
          {formatCurrency(payment.amount, { currency: payment.currency })}
        </p>
      </div>

      {error ? (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <FormField
          id="refund-amount"
          label={`Refund amount (${payment.currency})`}
          type="number"
          min="0.01"
          max={payment.refundableAmount}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError('');
          }}
          required
        />
        <LongTextField
          id="refund-reason"
          label="Refund reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setError('');
          }}
          placeholder="Why is this payment being refunded?"
          required
        />
        <FormField
          id="refund-reference"
          label="Refund reference (optional)"
          value={reference}
          maxLength={120}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Bank or mobile money reference"
        />

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Request refund
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

export function RefundResolutionDialog({
  refund,
  payment,
  mode,
  onClose,
  onCompleted,
}) {
  const isComplete = mode === 'complete';
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isComplete && reason.trim().length < 3) {
      setError('Add a rejection reason with at least 3 characters.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (isComplete) {
        await completeRefund(refund.id, reference.trim());
        onCompleted(
          `${formatCurrency(refund.amount, {
            currency: payment.currency,
          })} refund completed.`,
        );
      } else {
        await rejectRefund(refund.id, reason.trim());
        onCompleted('The refund request was rejected.');
      }
    } catch (actionError) {
      setError(toPaymentServiceError(actionError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={isComplete ? 'Complete refund' : 'Reject refund request'}
      description={
        isComplete
          ? 'Completing the refund reduces the verified paid balance for this order.'
          : 'Rejecting the request releases the refundable amount without changing the paid balance.'
      }
      onClose={onClose}
      busy={saving}
      labelledBy="refund-resolution-title"
    >
      <div className="mt-4 rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">
          {formatCurrency(refund.amount, { currency: payment.currency })}
        </p>
        <p className="mt-1">{refund.reason}</p>
      </div>

      {error ? (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        {isComplete ? (
          <FormField
            id="refund-completion-reference"
            label="Refund reference (optional)"
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Bank or mobile money reference"
          />
        ) : (
          <LongTextField
            id="refund-rejection-reason"
            label="Rejection reason"
            value={reason}
            onChange={(value) => {
              setReason(value);
              setError('');
            }}
            placeholder="Why can this refund not be completed?"
            required
          />
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" variant={isComplete ? 'primary' : 'danger'} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {isComplete ? 'Complete refund' : 'Reject refund'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
