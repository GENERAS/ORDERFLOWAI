import { getSupabaseClient } from '../lib/supabase/client';

const ERROR_MESSAGES = Object.freeze({
  '22023': 'Check the selected date range and try again.',
  '28000': 'Sign in again to view workspace analytics.',
  '42501': 'You do not have permission to view these analytics.',
  PGRST116: 'The analytics data could not be found.',
});

export class AnalyticsServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'AnalyticsServiceError';
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

export function toAnalyticsServiceError(error) {
  if (error instanceof AnalyticsServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message) {
    message = error?.message || 'The analytics request could not be completed.';
  }

  return new AnalyticsServiceError(message, {
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
    throw toAnalyticsServiceError(error);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toTimestampOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = toNullableText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toArrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function limitValue(value) {
  const parsed = Math.floor(Number(value) || 10);
  return Math.min(Math.max(parsed, 1), 50);
}

function assertBusinessId(businessId) {
  if (!businessId) throw new AnalyticsServiceError('Select a workspace first.');
}

function reportParams({ businessId, from = null, to = null } = {}) {
  assertBusinessId(businessId);
  return {
    p_business_id: businessId,
    p_from: toTimestampOrNull(from),
    p_to: toTimestampOrNull(to),
  };
}

export function mapWorkspaceOverview(row) {
  const source = unwrapRpc(row) ?? {};
  return {
    currency: toNullableText(source.currency) ?? 'RWF',
    totalOrders: toNumber(source.total_orders),
    ordersToday: toNumber(source.orders_today),
    openOrders: toNumber(source.open_orders),
    completedOrders: toNumber(source.completed_orders),
    cancelledOrders: toNumber(source.cancelled_orders),
    activeProducts: toNumber(source.active_products),
    totalCustomers: toNumber(source.total_customers),
    verifiedPayments: toNumber(source.verified_payments),
    paidAmount: toNumber(source.paid_amount),
    pendingPayments: toNumber(source.pending_payments),
    pendingAmount: toNumber(source.pending_amount),
    outstandingAmount: toNumber(source.outstanding_amount),
    ordersWithBalance: toNumber(source.orders_with_balance),
  };
}

export function mapRecentActivity(rows) {
  return toArrayValue(rows).map((row) => ({
    id: row.id,
    eventType: row.event_type ?? null,
    summary: row.summary ?? '',
    orderId: row.order_id ?? null,
    orderNumber: row.order_number ?? null,
    actorName: row.actor_name ?? 'Team member',
    createdAt: row.created_at ?? null,
  }));
}

function mapPaymentStatus(row) {
  return {
    status: row.status ?? 'unknown',
    count: toNumber(row.count),
    amount: toNumber(row.amount),
  };
}

function mapOutstandingPayment(row) {
  return {
    orderId: row.order_id ?? null,
    orderNumber: row.order_number ?? null,
    customerName: row.customer_name ?? '',
    status: row.status ?? null,
    orderTotal: toNumber(row.order_total),
    paidAmount: toNumber(row.paid_amount),
    balance: toNumber(row.balance),
  };
}

export function mapReportSummary(row) {
  const source = unwrapRpc(row) ?? {};
  return {
    currency: toNullableText(source.currency) ?? 'RWF',
    dateFrom: source.date_from ?? null,
    dateTo: source.date_to ?? null,
    totalOrders: toNumber(source.total_orders),
    completedOrders: toNumber(source.completed_orders),
    openOrders: toNumber(source.open_orders),
    cancelledOrders: toNumber(source.cancelled_orders),
    unitsSold: toNumber(source.units_sold),
    paidAmount: toNumber(source.paid_amount),
    outstandingAmount: toNumber(source.outstanding_amount),
    ordersWithBalance: toNumber(source.orders_with_balance),
    paymentStatus: toArrayValue(source.payment_status).map(mapPaymentStatus),
    outstandingPayments: toArrayValue(source.outstanding_payments).map(
      mapOutstandingPayment,
    ),
  };
}

export function mapReportSeries(rows) {
  return toArrayValue(rows).map((row) => ({
    periodStart: row.period_start ?? null,
    orderCount: toNumber(row.order_count),
    paidOrders: toNumber(row.paid_orders),
    paidAmount: toNumber(row.paid_amount),
  }));
}

export function mapTopProduct(row) {
  return {
    productId: row.product_id ?? null,
    productName: row.product_name ?? 'Unnamed product',
    sku: toNullableText(row.sku),
    unitsSold: toNumber(row.units_sold),
    orderCount: toNumber(row.order_count),
    orderValue: toNumber(row.order_value),
    currency: toNullableText(row.currency),
  };
}

export function mapTopCustomer(row) {
  return {
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? 'Unnamed customer',
    orderCount: toNumber(row.order_count),
    paidAmount: toNumber(row.paid_amount),
    lastOrderAt: row.last_order_at ?? null,
    currency: toNullableText(row.currency),
  };
}

export function mapChannelBreakdown(row) {
  return {
    channel: row.channel ?? 'unassigned',
    label: row.label ?? 'Unassigned',
    orderCount: toNumber(row.order_count),
    paidAmount: toNumber(row.paid_amount),
    currency: toNullableText(row.currency),
  };
}

export async function getWorkspaceDashboardData(businessId) {
  assertBusinessId(businessId);

  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_get_dashboard_data', {
    p_business_id: businessId,
  });

  if (error) throw toAnalyticsServiceError(error);
  return mapWorkspaceOverview(data);
}

export async function getWorkspaceRecentActivity(businessId, limit = 10) {
  assertBusinessId(businessId);

  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_get_recent_activity', {
    p_business_id: businessId,
    p_limit: limitValue(limit),
  });

  if (error) throw toAnalyticsServiceError(error);
  return mapRecentActivity(data);
}

export async function getWorkspaceReportSummary(options = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(
    'workspace_get_report_summary',
    reportParams(options),
  );

  if (error) throw toAnalyticsServiceError(error);
  return mapReportSummary(data);
}

export async function getWorkspaceReportSeries(options = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(
    'workspace_get_report_series',
    reportParams(options),
  );

  if (error) throw toAnalyticsServiceError(error);
  return mapReportSeries(data);
}

export async function getWorkspaceTopProducts(options = {}) {
  const params = reportParams(options);
  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_get_top_products', {
    ...params,
    p_limit: limitValue(options.limit),
  });

  if (error) throw toAnalyticsServiceError(error);
  return toArrayValue(data).map(mapTopProduct);
}

export async function getWorkspaceTopCustomers(options = {}) {
  const params = reportParams(options);
  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_get_top_customers', {
    ...params,
    p_limit: limitValue(options.limit),
  });

  if (error) throw toAnalyticsServiceError(error);
  return toArrayValue(data).map(mapTopCustomer);
}

export async function getWorkspaceChannelBreakdown(options = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(
    'workspace_get_channel_breakdown',
    reportParams(options),
  );

  if (error) throw toAnalyticsServiceError(error);
  return toArrayValue(data).map(mapChannelBreakdown);
}
