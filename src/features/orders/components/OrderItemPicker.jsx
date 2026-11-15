import { useEffect, useState } from 'react';
import { Loader2, Package, Plus, Search } from 'lucide-react';
import { Alert } from '../../../components/ui/Alert';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import {
  searchOrderCatalogue,
  toOrderServiceError,
} from '../../../services/orderService';
import { formatCurrency } from '../../../utils/format';
import { catalogueKey, formatOrderQuantity } from '../orderUtils';

export function OrderItemPicker({ businessId, selectedKeys, onAdd }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    if (!businessId) return undefined;

    const timeout = window.setTimeout(() => {
      setLoading(true);
      searchOrderCatalogue({
        businessId,
        search: debouncedSearch,
        page: 1,
        pageSize: 30,
      })
        .then((result) => {
          if (!active) return;
          setItems(result.data);
          setError('');
        })
        .catch((loadError) => {
          if (active) setError(toOrderServiceError(loadError).message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [businessId, debouncedSearch]);

  return (
    <div className="space-y-3">
      <FormField
        id="order-item-search"
        label="Add an item from the catalogue"
        type="search"
        placeholder="Product, variant or SKU"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        trailing={
          loading ? (
            <Loader2
              className="h-4 w-4 animate-spin text-slate-400"
              aria-label="Searching catalogue"
            />
          ) : (
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
          )
        }
      />

      {error ? <Alert variant="error">{error}</Alert> : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <Package className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-sm text-slate-500">
            {debouncedSearch
              ? 'No active catalogue items match this search.'
              : 'No active catalogue items yet.'}
          </p>
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {items.map((item) => {
            const key = catalogueKey(item.productId, item.variantId);
            const added = selectedKeys.has(key);
            const label = item.variantName
              ? `${item.productName} - ${item.variantName}`
              : item.productName;

            return (
              <li
                key={key}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {label}
                    </p>
                    {item.isTracked ? (
                      <Badge
                        variant={
                          item.availableQuantity > 0 ? 'success' : 'danger'
                        }
                      >
                        {item.availableQuantity > 0
                          ? `${formatOrderQuantity(
                              item.availableQuantity,
                            )} available`
                          : 'Out of stock'}
                      </Badge>
                    ) : (
                      <Badge variant="neutral">Not tracked</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {item.sku ? `SKU ${item.sku} - ` : ''}
                    {formatCurrency(item.unitPrice)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={added ? 'ghost' : 'secondary'}
                  disabled={added}
                  onClick={() => onAdd(item)}
                >
                  {added ? (
                    'Added'
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
