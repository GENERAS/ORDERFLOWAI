import { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { SelectField } from '../../../components/ui/SelectField';
import { controlClasses } from '../../../components/ui/formStyles';
import {
  getSignedQuantity,
  recordStockOperation,
  toInventoryServiceError,
} from '../../../services/inventoryService';
import { cn } from '../../../utils/cn';
import {
  ADJUSTMENT_DIRECTION_OPTIONS,
  affectsReservedStock,
  formatQuantity,
  getStockOperationMeta,
  requiresStockReason,
  STOCK_OPERATION_OPTIONS,
} from '../inventoryUtils';

function createOperationKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function StockOperationForm({ item, onRecorded }) {
  const [operation, setOperation] = useState('receive');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState('increase');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(createOperationKey);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const operationMeta = getStockOperationMeta(operation);
  const reasonRequired = requiresStockReason(operation);
  const reservedOperation = affectsReservedStock(operation);
  const itemLabel = item.variantName
    ? `${item.productName} · ${item.variantName}`
    : item.productName;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    let signedQuantity;
    try {
      signedQuantity = getSignedQuantity(operation, quantity, direction);
    } catch (validationError) {
      setError(toInventoryServiceError(validationError).message);
      return;
    }

    const confirmed = window.confirm(
      `Record "${operationMeta.label}" for ${itemLabel}?\n\n` +
        `Quantity change: ${signedQuantity > 0 ? '+' : ''}${signedQuantity}\n` +
        `Available before: ${formatQuantity(item.availableQuantity)}`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    try {
      const movement = await recordStockOperation({
        inventoryItemId: item.inventoryItemId,
        operation,
        quantity,
        direction,
        reason,
        idempotencyKey,
      });
      setSuccess(
        `Recorded ${operationMeta.shortLabel.toLowerCase()} movement. Available stock is now ${formatQuantity(
          movement.newPhysical - movement.newReserved,
        )}.`,
      );
      setQuantity('');
      setReason('');
      setIdempotencyKey(createOperationKey());
      onRecorded(movement);
    } catch (recordError) {
      setError(toInventoryServiceError(recordError).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="stock-operation"
          label="Movement type"
          value={operation}
          onChange={(event) => {
            setOperation(event.target.value);
            setIdempotencyKey(createOperationKey());
            setError('');
            setSuccess('');
          }}
          options={STOCK_OPERATION_OPTIONS}
          placeholder="Choose an operation"
          required
        />
        <FormField
          id="stock-quantity"
          label="Quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value);
            setIdempotencyKey(createOperationKey());
          }}
          hint={
            reservedOperation
              ? `${formatQuantity(
                  item.reservedQuantity,
                )} currently reserved, ${formatQuantity(
                  item.availableQuantity,
                )} available.`
              : `${formatQuantity(
                  item.physicalQuantity,
                )} physical, ${formatQuantity(
                  item.reservedQuantity,
                )} reserved right now.`
          }
          required
        />
      </div>

      {operation === 'adjustment' ? (
        <SelectField
          id="stock-adjustment-direction"
          label="Adjustment direction"
          value={direction}
          onChange={(event) => {
            setDirection(event.target.value);
            setIdempotencyKey(createOperationKey());
          }}
          options={ADJUSTMENT_DIRECTION_OPTIONS}
          placeholder="Choose a direction"
          required
        />
      ) : null}

      <div>
        <label
          htmlFor="stock-reason"
          className="block text-sm font-medium text-slate-700"
        >
          Reason
          {reasonRequired ? (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        <textarea
          id="stock-reason"
          rows={3}
          required={reasonRequired}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setIdempotencyKey(createOperationKey());
          }}
          className={cn(controlClasses, 'mt-1.5 resize-y')}
          placeholder={
            reasonRequired
              ? 'Explain why this balance is changing'
              : 'Optional note for the movement history'
          }
        />
        <p className="mt-1.5 text-xs text-slate-500">
          {operationMeta.description}
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        )}
        Record movement
      </Button>
    </form>
  );
}
