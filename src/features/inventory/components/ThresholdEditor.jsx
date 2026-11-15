import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import {
  toInventoryServiceError,
  updateInventoryThreshold,
} from '../../../services/inventoryService';

export function ThresholdEditor({ item, onUpdated }) {
  const [threshold, setThreshold] = useState(
    item.lowStockThreshold == null ? '' : String(item.lowStockThreshold),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updated = await updateInventoryThreshold({
        inventoryItemId: item.inventoryItemId,
        lowStockThreshold: threshold,
      });
      onUpdated(updated);
      setSuccess('Low-stock threshold updated.');
    } catch (saveError) {
      setError(toInventoryServiceError(saveError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField
          id="inventory-threshold"
          label="Low-stock threshold"
          type="number"
          min="0"
          step="1"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          hint="Warn when available stock reaches this number. Leave blank to disable."
          className="flex-1"
          placeholder="No threshold"
        />
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Save threshold
        </Button>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
    </form>
  );
}
