import {
  BUSINESS_ROLES,
  INVENTORY_STATUS,
  STOCK_OPERATION,
} from '../../types';

const STATUS_BADGES = Object.freeze({
  [INVENTORY_STATUS.TRACKED]: { label: 'In stock', variant: 'success' },
  [INVENTORY_STATUS.LOW_STOCK]: { label: 'Low stock', variant: 'warning' },
  [INVENTORY_STATUS.OUT_OF_STOCK]: {
    label: 'Out of stock',
    variant: 'danger',
  },
  [INVENTORY_STATUS.UNTRACKED]: { label: 'Not tracked', variant: 'neutral' },
});

const OPERATIONS = Object.freeze({
  [STOCK_OPERATION.RECEIVE]: {
    label: 'Receive stock',
    shortLabel: 'Receive',
    description: 'Add newly received physical stock.',
    reasonRequired: false,
    affectsReserved: false,
    variant: 'success',
  },
  [STOCK_OPERATION.REDUCE]: {
    label: 'Reduce stock',
    shortLabel: 'Reduce',
    description: 'Remove physical stock after a sale or manual issue.',
    reasonRequired: false,
    affectsReserved: false,
    variant: 'neutral',
  },
  [STOCK_OPERATION.ADJUSTMENT]: {
    label: 'Adjust stock',
    shortLabel: 'Adjust',
    description: 'Correct the physical count after a stocktake.',
    reasonRequired: true,
    affectsReserved: false,
    variant: 'brand',
  },
  [STOCK_OPERATION.DAMAGE]: {
    label: 'Record damage',
    shortLabel: 'Damage',
    description: 'Remove damaged stock from the physical balance.',
    reasonRequired: true,
    affectsReserved: false,
    variant: 'warning',
  },
  [STOCK_OPERATION.LOSS]: {
    label: 'Record loss',
    shortLabel: 'Loss',
    description: 'Remove missing or lost stock from the physical balance.',
    reasonRequired: true,
    affectsReserved: false,
    variant: 'danger',
  },
  [STOCK_OPERATION.RETURN]: {
    label: 'Return stock',
    shortLabel: 'Return',
    description: 'Put returned physical stock back into inventory.',
    reasonRequired: false,
    affectsReserved: false,
    variant: 'success',
  },
  [STOCK_OPERATION.RESERVE]: {
    label: 'Reserve stock',
    shortLabel: 'Reserve',
    description: 'Hold available stock without changing the physical count.',
    reasonRequired: false,
    affectsReserved: true,
    variant: 'brand',
  },
  [STOCK_OPERATION.RELEASE]: {
    label: 'Release reservation',
    shortLabel: 'Release',
    description: 'Release a stock reservation back to available stock.',
    reasonRequired: false,
    affectsReserved: true,
    variant: 'neutral',
  },
});

export const INVENTORY_MANAGER_ROLES = Object.freeze([
  BUSINESS_ROLES.OWNER,
  BUSINESS_ROLES.ADMIN,
  BUSINESS_ROLES.MANAGER,
]);

export const INVENTORY_STATUS_OPTIONS = Object.freeze(
  Object.entries(STATUS_BADGES).map(([value, badge]) => ({
    value,
    label: badge.label,
  })),
);

export const STOCK_OPERATION_OPTIONS = Object.freeze(
  Object.entries(OPERATIONS).map(([value, operation]) => ({
    value,
    label: operation.label,
  })),
);

export const INVENTORY_SORT_OPTIONS = Object.freeze([
  { value: 'name', label: 'Item name' },
  { value: 'available', label: 'Available quantity' },
  { value: 'updated', label: 'Recently updated' },
]);

export const SORT_DIRECTION_OPTIONS = Object.freeze([
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]);

export const ADJUSTMENT_DIRECTION_OPTIONS = Object.freeze([
  { value: 'increase', label: 'Increase physical stock' },
  { value: 'decrease', label: 'Decrease physical stock' },
]);

export function canManageInventory(role) {
  return INVENTORY_MANAGER_ROLES.includes(role);
}

export function getInventoryStatusBadge(status) {
  return (
    STATUS_BADGES[status] ?? { label: status || 'Unknown', variant: 'neutral' }
  );
}

export function getStockOperationMeta(operation) {
  return (
    OPERATIONS[operation] ?? {
      label: operation || 'Stock movement',
      shortLabel: operation || 'Movement',
      description: '',
      reasonRequired: false,
      affectsReserved: false,
      variant: 'neutral',
    }
  );
}

export function requiresStockReason(operation) {
  return getStockOperationMeta(operation).reasonRequired;
}

export function affectsReservedStock(operation) {
  return getStockOperationMeta(operation).affectsReserved;
}

export function formatQuantity(value) {
  return new Intl.NumberFormat('en-RW', {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function formatSignedQuantity(value) {
  const numeric = Number(value ?? 0);
  const formatted = formatQuantity(Math.abs(numeric));
  return numeric > 0 ? `+${formatted}` : numeric < 0 ? `-${formatted}` : '0';
}

export function getStockChangeSummary(movement) {
  if (!movement) return '';
  if (affectsReservedStock(movement.operation)) {
    return `Reserved ${formatQuantity(movement.previousReserved)} → ${formatQuantity(
      movement.newReserved,
    )}`;
  }
  return `Physical ${formatQuantity(movement.previousPhysical)} → ${formatQuantity(
    movement.newPhysical,
  )}`;
}
