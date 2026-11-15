import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, History, Loader2, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import {
  getInventoryItem,
  listStockMovements,
  toInventoryServiceError,
} from '../../services/inventoryService';
import { formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import {
  formatQuantity,
  formatSignedQuantity,
  getStockOperationMeta,
  STOCK_OPERATION_OPTIONS,
} from './inventoryUtils';

const PAGE_SIZE = 25;

export default function StockMovementsPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const inventoryItemId = searchParams.get('item');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [operation, setOperation] = useState('');
  const [page, setPage] = useState(1);
  const [movements, setMovements] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterItem, setFilterItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    if (!businessId || !inventoryItemId) return undefined;

    getInventoryItem({ businessId, inventoryItemId })
      .then((item) => {
        if (active) setFilterItem(item);
      })
      .catch(() => {
        if (active) setFilterItem(null);
      });

    return () => {
      active = false;
    };
  }, [businessId, inventoryItemId]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestIdRef.current;
    if (!businessId) return undefined;

    listStockMovements({
      businessId,
      search: debouncedSearch,
      operation,
      inventoryItemId,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active || requestId !== requestIdRef.current) return;
        setMovements(result.data);
        setTotal(result.count);
        setError('');
      })
      .catch((loadError) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(toInventoryServiceError(loadError).message);
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, debouncedSearch, operation, inventoryItemId, page]);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setOperation('');
    setFilterItem(null);
    setSearchParams({}, { replace: true });
    setPage(1);
    setLoading(true);
  };

  const clearItemFilter = () => {
    setFilterItem(null);
    setSearchParams({}, { replace: true });
    setPage(1);
    setLoading(true);
  };

  const changePage = (nextPage) => {
    setLoading(true);
    setPage(nextPage);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    Boolean(search) || Boolean(operation) || Boolean(inventoryItemId);
  const filteredItem =
    filterItem?.inventoryItemId === inventoryItemId ? filterItem : null;

  return (
    <section className="space-y-6" aria-labelledby="movements-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/inventory"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to inventory
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2
              id="movements-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Stock movements
            </h2>
            <Badge variant="neutral">Immutable ledger</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Every stock change records who made it, when, why, and the balances
            before and after.
          </p>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {inventoryItemId ? (
        <Alert variant="info">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing movements for{' '}
              <span className="font-semibold">
                {filteredItem
                  ? filteredItem.variantName
                    ? `${filteredItem.productName} · ${filteredItem.variantName}`
                    : filteredItem.productName
                  : 'one inventory item'}
              </span>
              .
            </span>
            <Button variant="ghost" size="sm" onClick={clearItemFilter}>
              Show all items
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end">
          <FormField
            id="movement-search"
            label="Search movements"
            type="search"
            placeholder="Item, SKU, reason or staff name"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLoading(true);
            }}
            trailing={
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            }
          />
          <SelectField
            id="movement-operation"
            label="Operation"
            value={operation}
            onChange={(event) => {
              setOperation(event.target.value);
              setPage(1);
              setLoading(true);
            }}
            options={STOCK_OPERATION_OPTIONS}
            placeholder="All operations"
          />
          <Button
            variant="ghost"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="h-10"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {loading
            ? 'Loading movements…'
            : `${formatQuantity(total)} movement${
                total === 1 ? '' : 's'
              } recorded`}
        </p>
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin text-slate-400"
            aria-label="Loading stock movements"
          />
        ) : null}
      </div>

      {!loading && movements.length === 0 ? (
        <EmptyState
          icon={History}
          title={hasFilters ? 'No movements match these filters' : 'No movements yet'}
          description={
            hasFilters
              ? 'Clear the filters or try a different search.'
              : 'Record stock receipts, reservations or adjustments to start the ledger.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link
                to="/inventory"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Open inventory
              </Link>
            )
          }
        />
      ) : null}

      {movements.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-3">
                    Item
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Operation
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Change
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Physical
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Reserved
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Reason
                  </th>
                  <th scope="col" className="px-4 py-3">
                    By
                  </th>
                  <th scope="col" className="px-4 py-3">
                    When
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((movement) => {
                  const meta = getStockOperationMeta(movement.operation);
                  const itemLabel = movement.variantName
                    ? `${movement.productName} · ${movement.variantName}`
                    : movement.productName;

                  return (
                    <tr key={movement.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{itemLabel}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {movement.sku ? `SKU ${movement.sku}` : 'No SKU'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.variant}>{meta.shortLabel}</Badge>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          movement.quantityChange > 0
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        }`}
                      >
                        {formatSignedQuantity(movement.quantityChange)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatQuantity(movement.previousPhysical)} →{' '}
                        <span className="font-medium text-slate-900">
                          {formatQuantity(movement.newPhysical)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatQuantity(movement.previousReserved)} →{' '}
                        <span className="font-medium text-slate-900">
                          {formatQuantity(movement.newReserved)}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-600">
                        <span className="line-clamp-2">
                          {movement.reason || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {movement.performedByName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {formatDateTime(movement.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm sm:flex-row">
          <p className="text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => changePage(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => changePage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
