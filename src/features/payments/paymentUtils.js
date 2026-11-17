import {
  PAYMENT_RECORD_STATUS,
  PAYMENT_REFUND_STATUS,
  PAYMENT_STATUS,
} from '../../types';

export const PAYMENT_PAGE_SIZE = 12;
export const PAYABLE_ORDER_PAGE_SIZE = 8;

const PAYMENT_STATUS_BADGES = Object.freeze({
  [PAYMENT_STATUS.PENDING]: { label: 'Payment pending', variant: 'warning' },
  [PAYMENT_STATUS.PARTIALLY_PAID]: {
    label: 'Partially paid',
    variant: 'warning',
  },
  [PAYMENT_STATUS.PAID]: { label: 'Paid', variant: 'success' },
  [PAYMENT_STATUS.FAILED]: { label: 'Payment failed', variant: 'danger' },
  [PAYMENT_STATUS.REFUNDED]: { label: 'Refunded', variant: 'neutral' },
  [PAYMENT_STATUS.PARTIALLY_REFUNDED]: {
    label: 'Partially refunded',
    variant: 'warning',
  },
});

const PAYMENT_RECORD_BADGES = Object.freeze({
  [PAYMENT_RECORD_STATUS.PENDING]: {
    label: 'Pending verification',
    variant: 'warning',
  },
  [PAYMENT_RECORD_STATUS.VERIFIED]: { label: 'Verified', variant: 'success' },
  [PAYMENT_RECORD_STATUS.REJECTED]: { label: 'Rejected', variant: 'danger' },
  [PAYMENT_RECORD_STATUS.FAILED]: { label: 'Failed', variant: 'danger' },
});

const REFUND_STATUS_BADGES = Object.freeze({
  [PAYMENT_REFUND_STATUS.REQUESTED]: {
    label: 'Refund requested',
    variant: 'warning',
  },
  [PAYMENT_REFUND_STATUS.COMPLETED]: {
    label: 'Refund completed',
    variant: 'success',
  },
  [PAYMENT_REFUND_STATUS.REJECTED]: {
    label: 'Refund rejected',
    variant: 'danger',
  },
});

export const PAYMENT_RECORD_STATUS_OPTIONS = Object.freeze(
  Object.entries(PAYMENT_RECORD_BADGES).map(([value, badge]) => ({
    value,
    label: badge.label,
  })),
);

export const PAYMENT_SORT_OPTIONS = Object.freeze([
  { value: 'recent', label: 'Newest payment' },
  { value: 'date', label: 'Payment date' },
  { value: 'amount', label: 'Payment amount' },
  { value: 'number', label: 'Payment number' },
  { value: 'order', label: 'Order number' },
]);

export const PAYMENT_DIRECTION_OPTIONS = Object.freeze([
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
]);

export const PAYMENT_EVENT_LABELS = Object.freeze({
  created: 'Payment recorded',
  verified: 'Payment verified',
  rejected: 'Payment rejected',
  failed: 'Payment failed',
  refund_requested: 'Refund requested',
  refund_completed: 'Refund completed',
  refund_rejected: 'Refund rejected',
});

export function getPaymentStatusBadge(status) {
  return (
    PAYMENT_STATUS_BADGES[status] ?? {
      label: status || 'Payment status unknown',
      variant: 'neutral',
    }
  );
}

export function getPaymentRecordStatusBadge(status) {
  return (
    PAYMENT_RECORD_BADGES[status] ?? {
      label: status || 'Status unknown',
      variant: 'neutral',
    }
  );
}

export function getRefundStatusBadge(status) {
  return (
    REFUND_STATUS_BADGES[status] ?? {
      label: status || 'Refund status unknown',
      variant: 'neutral',
    }
  );
}

export function canRecordPayments(role) {
  return ['owner', 'admin', 'manager', 'staff'].includes(role);
}

export function canVerifyPayments(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}

export function canRequestRefunds(role) {
  return ['owner', 'admin', 'manager', 'staff'].includes(role);
}

export function canResolveRefunds(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}

export function canRecordAgainstOrder(orderStatus) {
  return ['confirmed', 'processing', 'ready', 'completed'].includes(orderStatus);
}

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatPaymentCount(value) {
  return new Intl.NumberFormat('en-RW', {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}
