import { ORDER_STATUS } from '../../types';

export const ORDER_PAGE_SIZE = 12;

const STATUS_BADGES = Object.freeze({
  [ORDER_STATUS.DRAFT]: { label: 'Draft', variant: 'neutral' },
  [ORDER_STATUS.AWAITING_CONFIRMATION]: {
    label: 'Awaiting customer confirmation',
    variant: 'warning',
  },
  [ORDER_STATUS.AWAITING_BUSINESS_APPROVAL]: {
    label: 'Awaiting business approval',
    variant: 'warning',
  },
  [ORDER_STATUS.CONFIRMED]: { label: 'Confirmed', variant: 'brand' },
  [ORDER_STATUS.PROCESSING]: { label: 'Processing', variant: 'brand' },
  [ORDER_STATUS.READY]: { label: 'Ready', variant: 'success' },
  [ORDER_STATUS.COMPLETED]: { label: 'Completed', variant: 'success' },
  [ORDER_STATUS.CANCELLED]: { label: 'Cancelled', variant: 'danger' },
});

const NEXT_STATUS = Object.freeze({
  [ORDER_STATUS.DRAFT]: ORDER_STATUS.AWAITING_CONFIRMATION,
  [ORDER_STATUS.AWAITING_CONFIRMATION]:
    ORDER_STATUS.AWAITING_BUSINESS_APPROVAL,
  [ORDER_STATUS.AWAITING_BUSINESS_APPROVAL]: ORDER_STATUS.CONFIRMED,
  [ORDER_STATUS.CONFIRMED]: ORDER_STATUS.PROCESSING,
  [ORDER_STATUS.PROCESSING]: ORDER_STATUS.READY,
  [ORDER_STATUS.READY]: ORDER_STATUS.COMPLETED,
});

const NEXT_ACTION_LABELS = Object.freeze({
  [ORDER_STATUS.DRAFT]: 'Send for customer confirmation',
  [ORDER_STATUS.AWAITING_CONFIRMATION]: 'Record customer confirmation',
  [ORDER_STATUS.AWAITING_BUSINESS_APPROVAL]: 'Approve order',
  [ORDER_STATUS.CONFIRMED]: 'Start processing',
  [ORDER_STATUS.PROCESSING]: 'Mark ready',
  [ORDER_STATUS.READY]: 'Mark fulfilled',
});

export const ORDER_STATUS_OPTIONS = Object.freeze(
  Object.entries(STATUS_BADGES).map(([value, badge]) => ({
    value,
    label: badge.label,
  })),
);

export const ORDER_SORT_OPTIONS = Object.freeze([
  { value: 'recent', label: 'Newest order' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'total', label: 'Order value' },
  { value: 'number', label: 'Order number' },
  { value: 'customer', label: 'Customer name' },
]);

export const ORDER_DIRECTION_OPTIONS = Object.freeze([
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
]);

export function catalogueKey(productId, variantId) {
  return `${productId}:${variantId ?? 'base'}`;
}

export function getOrderStatusBadge(status) {
  return (
    STATUS_BADGES[status] ?? { label: status || 'Unknown', variant: 'neutral' }
  );
}

export function getNextOrderStatus(status) {
  return NEXT_STATUS[status] ?? null;
}

export function getNextOrderActionLabel(status) {
  return NEXT_ACTION_LABELS[status] ?? null;
}

export function isOrderEditable(status) {
  return status === ORDER_STATUS.DRAFT || status === ORDER_STATUS.AWAITING_CONFIRMATION;
}

export function isOrderCancellable(status) {
  return (
    status !== ORDER_STATUS.COMPLETED && status !== ORDER_STATUS.CANCELLED
  );
}

export function canManageOrders(role) {
  return ['owner', 'admin', 'manager', 'staff'].includes(role);
}

export function canApproveOrders(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}

export function getAllowedNextOrderStatus(status, role) {
  const nextStatus = getNextOrderStatus(status);
  if (!nextStatus) return null;
  if (
    (nextStatus === ORDER_STATUS.CONFIRMED ||
      nextStatus === ORDER_STATUS.COMPLETED) &&
    !canApproveOrders(role)
  ) {
    return null;
  }
  return nextStatus;
}

export function getOrderItemLabel(item) {
  if (!item) return '';
  return item.variantName
    ? `${item.productName} - ${item.variantName}`
    : item.productName;
}

export function getStockStateLabel(stockState) {
  const labels = {
    none: 'No stock action yet',
    reserved: 'Stock reserved',
    released: 'Stock released',
    consumed: 'Stock consumed',
  };
  return labels[stockState] ?? 'Stock status unknown';
}

export function getStockStateBadgeVariant(stockState) {
  if (stockState === 'reserved') return 'brand';
  if (stockState === 'consumed') return 'success';
  if (stockState === 'released') return 'warning';
  return 'neutral';
}

export function formatOrderQuantity(value) {
  return new Intl.NumberFormat('en-RW', {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}
