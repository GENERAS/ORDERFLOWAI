import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  History,
  Loader2,
  PackagePlus,
  Power,
  SlidersHorizontal,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageLoader } from '../../components/ui/PageLoader';
import {
  disableInventoryTracking,
  getInventoryItem,
  listStockMovements,
  toInventoryServiceError,
} from '../../services/inventoryService';
import { formatDateTime } from '../../utils/format';
import { useAuth } from '../auth/authContext';
import { EnableTrackingDialog } from './components/EnableTrackingDialog';
import { StockOperationForm } from './components/StockOperationForm';
import { ThresholdEditor } from './components/ThresholdEditor';
import {
  canManageInventory,
  formatQuantity,
  formatSignedQuantity,
  getInventoryStatusBadge,
  getStockOperationMeta,
} from './inventoryUtils';

const HISTORY_PAGE_SIZE = 10;

function QuantityTile({ label, value, tone = 'slate', detail }) {
  const toneClasses = {
    slate: 'border-slate-200 bg-white text-slate-900',
    brand: 'border-brand-100 bg-brand-50/60 text-brand-700',
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">
        {formatQuantity(value)}
      </p>
      {detail ? <p className="mt-1 text-xs opacity-70">{detail}</p> : null}
    </div>
  );
}

export default function InventoryItemPage() {
  const { inventoryItemId } = useParams();
  const navigate = useNavigate();
  const { activeBusiness, activeMembership } = useAuth();
  const businessId = activeBusiness?.id;
  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [enableOpen, setEnableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    let active = true;
    if (!businessId || !inventoryItemId) return undefined;

    Promise.all([
      getInventoryItem({ businessId, inventoryItemId }),
      listStockMovements({
        businessId,
        inventoryItemId,
        page: 1,
        pageSize: HISTORY_PAGE_SIZE,
      }),
    ])
      .then(([loadedItem, history]) => {
        if (!active) return;
        setItem(loadedItem);
        setMovements(history.data);
        setMovementTotal(history.count);
        setError('');
      })
      .catch((loadError) => {
        if (active) setError(toInventoryServiceError(loadError).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [businessId, inventoryItemId, refreshKey]);

  const handleTrackingEnabled = (enabled) => {
    setEnableOpen(false);
    setItem(enabled);
    setSuccess('Stock tracking is now enabled for this item.');
    setRefreshKey((current) => current + 1);
  };

  const handleThresholdUpdated = (updated) => {
    if (updated) setItem(updated);
    setRefreshKey((current) => current + 1);
  };

  const handleDisable = async () => {
    if (!item) return;
    const confirmed = window.confirm(
      `Disable stock tracking for ${
        item.variantName
          ? `${item.productName} · ${item.variantName}`
          : item.productName
      }?\n\nPast movements stay in the ledger, but stock operations will stop.`,
    );
    if (!confirmed) return;

    setDisabling(true);
    setError('');
    try {
      await disableInventoryTracking(item.inventoryItemId);
      navigate('/inventory', {
        state: {
          message: `Stock tracking was disabled for ${
            item.variantName
              ? `${item.productName} · ${item.variantName}`
              : item.productName
          }.`,
        },
      });
    } catch (disableError) {
      setError(toInventoryServiceError(disableError).message);
    } finally {
      setDisabling(false);
    }
  };

  if (loading && !item) return <PageLoader />;

  if (!item) {
    return (
      <section className="space-y-4">
        <Link
          to="/inventory"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to inventory
        </Link>
        <Alert variant="error">
          {error || 'This inventory record could not be found.'}
        </Alert>
      </section>
    );
  }

  const statusBadge = getInventoryStatusBadge(item.inventoryStatus);
  const itemLabel = item.variantName
    ? `${item.productName} · ${item.variantName}`
    : item.productName;
  const canManage = canManageInventory(activeMembership?.role);
  const hasStock = item.physicalQuantity > 0 || item.reservedQuantity > 0;

  return (
    <section className="space-y-6" aria-labelledby="inventory-item-title">
      <div>
        <Link
          to="/inventory"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to inventory
        </Link>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="inventory-item-title"
                className="truncate text-lg font-semibold tracking-tight text-slate-900"
              >
                {itemLabel}
              </h2>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              {!item.isTracked ? (
                <Badge variant="neutral">Tracking disabled</Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              {item.sku ? <Badge variant="neutral">SKU {item.sku}</Badge> : null}
              {item.categoryName ? (
                <Badge variant="neutral">{item.categoryName}</Badge>
              ) : null}
              {item.productStatus ? (
                <Badge variant="neutral">
                  Product {item.productStatus}
                </Badge>
              ) : null}
            </div>
          </div>

          <Link
            to={`/products/${item.productId}/edit`}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            Open product
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <QuantityTile
          label="Physical stock"
          value={item.physicalQuantity}
          detail="Counted units on hand"
        />
        <QuantityTile
          label="Reserved"
          value={item.reservedQuantity}
          detail="Held for pending orders"
        />
        <QuantityTile
          label="Available"
          value={item.availableQuantity}
          tone="emerald"
          detail="Physical minus reserved"
        />
        <QuantityTile
          label="Low-stock threshold"
          value={item.lowStockThreshold ?? 0}
          tone="brand"
          detail={
            item.lowStockThreshold == null
              ? 'Not configured'
              : 'Warns at or below this level'
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle as="h2">Record stock movement</CardTitle>
              <CardDescription>
                Balances change only through an audited operation.
              </CardDescription>
            </div>
            <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {item.isTracked ? (
              <StockOperationForm
                item={item}
                onRecorded={() =>
                  setRefreshKey((current) => current + 1)
                }
              />
            ) : (
              <div className="space-y-4">
                <Alert variant="warning">
                  Stock tracking is disabled. Past movements remain available, but
                  new stock operations are blocked until tracking is enabled.
                </Alert>
                {canManage ? (
                  <Button onClick={() => setEnableOpen(true)}>
                    <PackagePlus className="h-4 w-4" aria-hidden="true" />
                    Enable tracking
                  </Button>
                ) : (
                  <p className="text-sm text-slate-500">
                    Ask a manager or admin to enable tracking for this item.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle as="h2">Tracking settings</CardTitle>
              <CardDescription>
                Controls for stock warnings and the ledger.
              </CardDescription>
            </div>
            <SlidersHorizontal
              className="h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
          </CardHeader>
          <CardContent className="space-y-5">
            {item.isTracked ? (
              canManage ? (
                <ThresholdEditor
                  key={item.inventoryItemId}
                  item={item}
                  onUpdated={handleThresholdUpdated}
                />
              ) : (
                <p className="text-sm text-slate-500">
                  Current low-stock threshold:{' '}
                  <span className="font-medium text-slate-900">
                    {item.lowStockThreshold == null
                      ? 'not set'
                      : formatQuantity(item.lowStockThreshold)}
                  </span>
                  . A manager or admin can change it.
                </p>
              )
            ) : (
              <p className="text-sm text-slate-500">
                Tracking is off. Enable it to manage thresholds and record stock
                operations.
              </p>
            )}

            {canManage ? (
              <div className="border-t border-slate-100 pt-4">
                <Button
                  variant="danger"
                  onClick={handleDisable}
                  disabled={!item.isTracked || hasStock || disabling}
                  className="w-full"
                >
                  {disabling ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Power className="h-4 w-4" aria-hidden="true" />
                  )}
                  Disable tracking
                </Button>
                <p className="mt-2 text-xs text-slate-500">
                  {hasStock
                    ? 'Reduce physical stock and release reservations before disabling tracking.'
                    : 'Past movements stay in the ledger if tracking is disabled.'}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle as="h2">Recent movements</CardTitle>
            <CardDescription>
              The latest {movements.length} of {formatQuantity(movementTotal)}{' '}
              ledger entries for this item.
            </CardDescription>
          </div>
          <Link
            to={`/inventory/movements?item=${item.inventoryItemId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 transition-colors hover:text-brand-800"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <EmptyState
              icon={History}
              title="No stock movements yet"
              description="Receive or adjust stock to create the first ledger entry."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-3 py-2.5">
                      Operation
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      Change
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      Physical
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right">
                      Reserved
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Reason
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      By
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((movement) => {
                    const meta = getStockOperationMeta(movement.operation);
                    return (
                      <tr key={movement.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5">
                          <Badge variant={meta.variant}>{meta.shortLabel}</Badge>
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-semibold ${
                            movement.quantityChange > 0
                              ? 'text-emerald-600'
                              : 'text-red-600'
                          }`}
                        >
                          {formatSignedQuantity(movement.quantityChange)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600">
                          {formatQuantity(movement.newPhysical)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600">
                          {formatQuantity(movement.newReserved)}
                        </td>
                        <td className="max-w-[12rem] px-3 py-2.5 text-slate-600">
                          <span className="line-clamp-2">
                            {movement.reason || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {movement.performedByName}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                          {formatDateTime(movement.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {enableOpen ? (
        <EnableTrackingDialog
          item={item}
          onClose={() => setEnableOpen(false)}
          onEnabled={handleTrackingEnabled}
        />
      ) : null}
    </section>
  );
}
