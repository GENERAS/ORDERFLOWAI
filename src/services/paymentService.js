import { getSupabaseClient } from '../lib/supabase/client';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './baseService';

const ERROR_MESSAGES = Object.freeze({
  '23503': 'The selected order or payment method is no longer available.',
  '23505': 'This payment was already recorded. Refresh before trying again.',
  '42501': 'You do not have permission to manage payments.',
  PGRST116: 'The payment could not be found.',
});

export class PaymentServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'PaymentServiceError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function isPermissionError(error) {
  return /row-level security|permission denied|insufficient privilege/i.test(
    error?.message ?? '',
  );
}

export function toPaymentServiceError(error) {
  if (error instanceof PaymentServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message && code === '22023') message = error?.message;
  if (!message && code === '28000') {
    message = 'Sign in again to manage payments.';
  }
  if (!message) {
    message = error?.message || 'The payment request could not be completed.';
  }

  return new PaymentServiceError(message, {
    cause: error,
    code,
    details: error?.details,
    hint: error?.hint,
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toPaymentServiceError(error);
  }
}

function clampPageSize(value) {
  return Math.min(
    Math.max(1, Math.floor(Number(value) || DEFAULT_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  );
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

export function mapPaymentMethod(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    paymentNumber: row.payment_number,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    orderStatus: row.order_status,
    orderTotal: Number(row.order_total ?? 0),
    amount: Number(row.amount ?? 0),
    currency: row.currency,
    methodCode: row.method_code,
    methodLabel: row.method_label,
    status: row.status,
    paymentDate: row.payment_date,
    transactionReference: row.transaction_reference ?? null,
    providerKey: row.provider_key ?? null,
    providerTransactionId: row.provider_transaction_id ?? null,
    providerEventId: row.provider_event_id ?? null,
    notes: row.notes ?? null,
    recordedByName: row.recorded_by_name,
    verifiedByName: row.verified_by_name ?? null,
    verifiedAt: row.verified_at ?? null,
    verificationNote: row.verification_note ?? null,
    rejectedByName: row.rejected_by_name ?? null,
    rejectedAt: row.rejected_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    failedAt: row.failed_at ?? null,
    failureReason: row.failure_reason ?? null,
    refundedAmount: Number(row.refunded_amount ?? 0),
    requestedRefundAmount: Number(row.requested_refund_amount ?? 0),
    refundableAmount: Number(row.refundable_amount ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: Number(row.total_count ?? 1),
  };
}

export function mapPaymentRefund(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    paymentId: row.payment_id,
    amount: Number(row.amount ?? 0),
    status: row.status,
    reason: row.reason,
    reference: row.reference ?? null,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    completedByName: row.completed_by_name ?? null,
    completedAt: row.completed_at ?? null,
    rejectedByName: row.rejected_by_name ?? null,
    rejectedAt: row.rejected_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPaymentEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    paymentId: row.payment_id,
    eventType: row.event_type,
    summary: row.summary,
    details: row.details ?? {},
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

function emptyOverview(currency) {
  return {
    currency,
    totalPayments: 0,
    pendingCount: 0,
    pendingAmount: 0,
    verifiedCount: 0,
    verifiedAmount: 0,
    failedCount: 0,
    failedAmount: 0,
    rejectedCount: 0,
    rejectedAmount: 0,
    refundedAmount: 0,
    requestedRefundAmount: 0,
    outstandingAmount: 0,
    ordersWithBalance: 0,
  };
}

export function mapPaymentOverview(row, fallbackCurrency = 'RWF') {
  if (!row) return emptyOverview(fallbackCurrency);
  return {
    currency: row.currency ?? fallbackCurrency,
    totalPayments: Number(row.total_payments ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    pendingAmount: Number(row.pending_amount ?? 0),
    verifiedCount: Number(row.verified_count ?? 0),
    verifiedAmount: Number(row.verified_amount ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    failedAmount: Number(row.failed_amount ?? 0),
    rejectedCount: Number(row.rejected_count ?? 0),
    rejectedAmount: Number(row.rejected_amount ?? 0),
    refundedAmount: Number(row.refunded_amount ?? 0),
    requestedRefundAmount: Number(row.requested_refund_amount ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    ordersWithBalance: Number(row.orders_with_balance ?? 0),
  };
}

export function mapOrderPaymentSummary(row, fallbackCurrency = 'RWF') {
  if (!row) {
    return {
      orderId: null,
      orderNumber: null,
      currency: fallbackCurrency,
      orderTotal: 0,
      verifiedAmount: 0,
      refundedAmount: 0,
      netPaid: 0,
      balanceDue: 0,
      pendingAmount: 0,
      pendingCount: 0,
      failedAmount: 0,
      requestedRefundAmount: 0,
      paymentStatus: 'pending',
      paymentCount: 0,
      lastPaymentAt: null,
    };
  }
  return {
    orderId: row.order_id,
    businessId: row.business_id,
    orderNumber: row.order_number,
    currency: row.currency ?? fallbackCurrency,
    orderTotal: Number(row.order_total ?? 0),
    verifiedAmount: Number(row.verified_amount ?? 0),
    refundedAmount: Number(row.refunded_amount ?? 0),
    netPaid: Number(row.net_paid ?? 0),
    balanceDue: Number(row.balance_due ?? 0),
    pendingAmount: Number(row.pending_amount ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    failedAmount: Number(row.failed_amount ?? 0),
    requestedRefundAmount: Number(row.requested_refund_amount ?? 0),
    paymentStatus: row.payment_status ?? 'pending',
    paymentCount: Number(row.payment_count ?? 0),
    lastPaymentAt: row.last_payment_at ?? null,
  };
}

export function mapPayableOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    status: row.status,
    currency: row.currency,
    orderTotal: Number(row.order_total ?? 0),
    verifiedAmount: Number(row.verified_amount ?? 0),
    refundedAmount: Number(row.refunded_amount ?? 0),
    netPaid: Number(row.net_paid ?? 0),
    balanceDue: Number(row.balance_due ?? 0),
    pendingAmount: Number(row.pending_amount ?? 0),
    failedAmount: Number(row.failed_amount ?? 0),
    paymentStatus: row.payment_status ?? 'pending',
    createdAt: row.created_at,
    totalCount: Number(row.total_count ?? 1),
  };
}

export async function listPaymentMethods(businessId) {
  if (!businessId) return [];
  const { data, error } = await getClient().rpc('list_payment_methods', {
    p_business_id: businessId,
  });
  if (error) throw toPaymentServiceError(error);
  return (data ?? []).map(mapPaymentMethod);
}

export async function getPaymentOverview(businessId, { currency } = {}) {
  const { data, error } = await getClient().rpc('get_payment_overview', {
    p_business_id: businessId,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPaymentOverview(unwrapRpc(data), currency);
}

export async function searchPayments({
  businessId,
  search = '',
  status = '',
  methodCode = '',
  orderId = null,
  dateFrom = '',
  dateTo = '',
  sort = 'recent',
  direction = 'desc',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const safePageSize = clampPageSize(pageSize);
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const { data, error } = await getClient().rpc('search_payments', {
    p_business_id: businessId,
    p_search: search || null,
    p_status: status || null,
    p_method_code: methodCode || null,
    p_order_id: orderId,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_sort: sort,
    p_direction: direction,
    p_limit: safePageSize,
    p_offset: (safePage - 1) * safePageSize,
  });
  if (error) throw toPaymentServiceError(error);

  const rows = data ?? [];
  const mapped = rows.map(mapPayment);
  const count = mapped[0]?.totalCount ?? 0;
  return {
    data: mapped,
    count,
    page: safePage,
    pageSize: safePageSize,
    hasMore: safePage * safePageSize < count,
  };
}

export async function getPayment(paymentId) {
  const { data, error } = await getClient().rpc('get_payment', {
    p_payment_id: paymentId,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPayment(unwrapRpc(data));
}

export async function getOrderPaymentSummary(orderId, { currency } = {}) {
  const { data, error } = await getClient().rpc(
    'get_order_payment_summary',
    { p_order_id: orderId },
  );
  if (error) throw toPaymentServiceError(error);
  return mapOrderPaymentSummary(unwrapRpc(data), currency);
}

export async function searchPayableOrders({
  businessId,
  search = '',
  page = 1,
  pageSize = 20,
}) {
  const safePageSize = clampPageSize(pageSize);
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const { data, error } = await getClient().rpc('search_payable_orders', {
    p_business_id: businessId,
    p_search: search || null,
    p_limit: safePageSize,
    p_offset: (safePage - 1) * safePageSize,
  });
  if (error) throw toPaymentServiceError(error);

  const rows = data ?? [];
  const mapped = rows.map(mapPayableOrder);
  const count = mapped[0]?.totalCount ?? 0;
  return {
    data: mapped,
    count,
    page: safePage,
    pageSize: safePageSize,
    hasMore: safePage * safePageSize < count,
  };
}

export async function getPaymentRefunds({ businessId, paymentId }) {
  const { data, error } = await getClient()
    .from('payment_refunds')
    .select(
      'id, business_id, payment_id, amount, status, reason, reference, requested_by_name, requested_at, completed_by_name, completed_at, rejected_by_name, rejected_at, rejection_reason, created_at, updated_at',
    )
    .eq('business_id', businessId)
    .eq('payment_id', paymentId)
    .order('created_at', { ascending: false });
  if (error) throw toPaymentServiceError(error);
  return (data ?? []).map(mapPaymentRefund);
}

export async function getPaymentEvents({ businessId, paymentId }) {
  const { data, error } = await getClient()
    .from('payment_events')
    .select(
      'id, business_id, payment_id, event_type, summary, details, actor_name, created_at',
    )
    .eq('business_id', businessId)
    .eq('payment_id', paymentId)
    .order('created_at', { ascending: false });
  if (error) throw toPaymentServiceError(error);
  return (data ?? []).map(mapPaymentEvent);
}

export async function recordPayment({
  orderId,
  amount,
  methodCode,
  paymentDate,
  transactionReference,
  notes,
  providerKey,
  providerTransactionId,
  providerEventId,
  idempotencyKey,
}) {
  const { data, error } = await getClient().rpc('record_payment', {
    p_order_id: orderId,
    p_amount: Number(amount),
    p_method_code: methodCode,
    p_payment_date: paymentDate || null,
    p_transaction_reference: transactionReference || null,
    p_notes: notes || null,
    p_provider_key: providerKey || null,
    p_provider_transaction_id: providerTransactionId || null,
    p_provider_event_id: providerEventId || null,
    p_idempotency_key: idempotencyKey || null,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPayment(unwrapRpc(data));
}

export async function verifyPayment(paymentId, note = '') {
  const { data, error } = await getClient().rpc('verify_payment', {
    p_payment_id: paymentId,
    p_note: note || null,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPayment(unwrapRpc(data));
}

export async function rejectPayment(paymentId, reason) {
  const { data, error } = await getClient().rpc('reject_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPayment(unwrapRpc(data));
}

export async function failPayment(paymentId, reason) {
  const { data, error } = await getClient().rpc('fail_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPayment(unwrapRpc(data));
}

export async function requestRefund({
  paymentId,
  amount,
  reason,
  reference,
  idempotencyKey,
}) {
  const { data, error } = await getClient().rpc('request_refund', {
    p_payment_id: paymentId,
    p_amount: Number(amount),
    p_reason: reason,
    p_reference: reference || null,
    p_idempotency_key: idempotencyKey || null,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPaymentRefund(unwrapRpc(data));
}

export async function completeRefund(refundId, reference = '') {
  const { data, error } = await getClient().rpc('complete_refund', {
    p_refund_id: refundId,
    p_reference: reference || null,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPaymentRefund(unwrapRpc(data));
}

export async function rejectRefund(refundId, reason) {
  const { data, error } = await getClient().rpc('reject_refund', {
    p_refund_id: refundId,
    p_reason: reason,
  });
  if (error) throw toPaymentServiceError(error);
  return mapPaymentRefund(unwrapRpc(data));
}
