import { getSupabaseClient } from '../lib/supabase/client';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './baseService';

const ERROR_MESSAGES = Object.freeze({
  '23505': 'That order item is already in this order.',
  '42501': 'You do not have permission to manage orders.',
  PGRST116: 'The order could not be found.',
});

const ORDER_ITEM_COLUMNS = `
  id,
  business_id,
  order_id,
  product_id,
  variant_id,
  product_name_snapshot,
  variant_name_snapshot,
  sku_snapshot,
  unit_price,
  quantity,
  reserved_quantity,
  line_total,
  created_at,
  updated_at
`;

const ORDER_EVENT_COLUMNS = `
  id,
  business_id,
  order_id,
  event_type,
  summary,
  details,
  actor_id,
  actor_name,
  created_at
`;

export class OrderServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'OrderServiceError';
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

export function toOrderServiceError(error) {
  if (error instanceof OrderServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (code === '23505') {
    message =
      /order_items_unique_unit_key|already appears|only appear once/i.test(
        error?.message ?? '',
      )
        ? 'Each product or variant can only appear once in an order.'
        : ERROR_MESSAGES['23505'];
  }
  if (!message && isPermissionError(error)) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message && code === '22023') message = error?.message;
  if (!message && code === '23503') {
    message = 'A selected product is no longer available. Refresh and try again.';
  }
  if (!message && code === '28000') {
    message = 'Sign in again to manage orders.';
  }
  if (!message) {
    message = error?.message || 'The order request could not be completed.';
  }

  return new OrderServiceError(message, {
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
    throw toOrderServiceError(error);
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

function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    orderNumber: row.order_number,
    customerId: row.customer_id ?? null,
    isGuest: !row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    customerEmail: row.customer_email ?? null,
    status: row.status,
    stockState: row.stock_state,
    currency: row.currency,
    subtotal: Number(row.subtotal ?? 0),
    total: Number(row.total ?? 0),
    notes: row.notes ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    itemCount: Number(row.item_count ?? 0),
    confirmedAt: row.confirmed_at ?? null,
    completedAt: row.completed_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: Number(row.total_count ?? 1),
  };
}

export function mapOrderItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    productName: row.product_name_snapshot,
    variantName: row.variant_name_snapshot ?? null,
    sku: row.sku_snapshot ?? null,
    unitPrice: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    reservedQuantity: Number(row.reserved_quantity ?? 0),
    lineTotal: Number(row.line_total ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOrderEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    eventType: row.event_type,
    summary: row.summary,
    details: row.details ?? {},
    actorId: row.actor_id ?? null,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

export function mapOrderCatalogueItem(row) {
  if (!row) return null;
  return {
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    productName: row.product_name,
    variantName: row.variant_name ?? null,
    sku: row.sku ?? null,
    unitPrice: Number(row.unit_price ?? 0),
    isTracked: Boolean(row.is_tracked),
    availableQuantity: Number(row.available_quantity ?? 0),
    inventoryStatus: row.inventory_status,
    totalCount: Number(row.total_count ?? 0),
  };
}

export function mapOrderOverview(row) {
  if (!row) {
    return {
      totalOrders: 0,
      draftCount: 0,
      awaitingConfirmationCount: 0,
      awaitingBusinessApprovalCount: 0,
      confirmedCount: 0,
      processingCount: 0,
      readyCount: 0,
      completedCount: 0,
      cancelledCount: 0,
      openValue: 0,
      completedValue: 0,
      ordersToday: 0,
    };
  }

  return {
    totalOrders: Number(row.total_orders ?? 0),
    draftCount: Number(row.draft_count ?? 0),
    awaitingConfirmationCount: Number(
      row.awaiting_confirmation_count ?? 0,
    ),
    awaitingBusinessApprovalCount: Number(
      row.awaiting_business_approval_count ?? 0,
    ),
    confirmedCount: Number(row.confirmed_count ?? 0),
    processingCount: Number(row.processing_count ?? 0),
    readyCount: Number(row.ready_count ?? 0),
    completedCount: Number(row.completed_count ?? 0),
    cancelledCount: Number(row.cancelled_count ?? 0),
    openValue: Number(row.open_value ?? 0),
    completedValue: Number(row.completed_value ?? 0),
    ordersToday: Number(row.orders_today ?? 0),
  };
}

function toItemPayload(items = []) {
  return items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId || null,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  }));
}

export async function searchOrders({
  businessId,
  search = '',
  status = null,
  customerId = null,
  orderId = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  sort = 'recent',
  direction = 'desc',
  dateFrom = '',
  dateTo = '',
} = {}) {
  if (!businessId) throw new OrderServiceError('Select a workspace first.');

  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('search_orders', {
    p_business_id: businessId,
    p_search: toNullableText(search),
    p_status: status || null,
    p_customer_id: customerId || null,
    p_order_id: orderId || null,
    p_limit: safePageSize,
    p_offset: offset,
    p_sort: sort || 'recent',
    p_direction: direction === 'asc' ? 'asc' : 'desc',
    p_created_from: toNullableText(dateFrom),
    p_created_to: toNullableText(dateTo),
  });

  if (error) throw toOrderServiceError(error);

  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  return {
    data: rows.map(mapOrder),
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + rows.length < total,
  };
}

export function mapStorefrontOrderQueueItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? null,
    status: row.status,
    stockState: row.stock_state,
    source: row.source,
    channel: row.channel ?? null,
    currency: row.currency,
    total: Number(row.total ?? 0),
    itemCount: Number(row.item_count ?? 0),
    deliveryMethod: row.delivery_method ?? null,
    customerConfirmedAt: row.customer_confirmed_at ?? null,
    createdAt: row.created_at,
    whatsappConnected: Boolean(row.whatsapp_connected),
    latestNotificationTitle: row.latest_notification_title ?? null,
    latestNotificationMessage: row.latest_notification_message ?? null,
  };
}

export async function listStorefrontOrderQueue({
  businessId,
  status = null,
  limit = 20,
} = {}) {
  if (!businessId) throw new OrderServiceError('Select a workspace first.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('list_storefront_order_queue', {
    p_business_id: businessId,
    p_status: toNullableText(status),
    p_limit: Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100),
  });
  if (error) throw toOrderServiceError(error);

  return (data ?? []).map(mapStorefrontOrderQueueItem);
}

async function loadOrderItems(supabase, { businessId, orderId }) {
  const { data, error } = await supabase
    .from('order_items')
    .select(ORDER_ITEM_COLUMNS)
    .eq('business_id', businessId)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error) throw toOrderServiceError(error);
  return (data ?? []).map(mapOrderItem);
}

async function loadOrderEvents(supabase, { businessId, orderId }) {
  const { data, error } = await supabase
    .from('order_events')
    .select(ORDER_EVENT_COLUMNS)
    .eq('business_id', businessId)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });

  if (error) throw toOrderServiceError(error);
  return (data ?? []).map(mapOrderEvent);
}

export async function getOrder({ businessId, orderId }) {
  if (!businessId || !orderId) {
    throw new OrderServiceError('Order not found.');
  }

  const result = await searchOrders({
    businessId,
    orderId,
    page: 1,
    pageSize: 1,
  });
  const order = result.data[0] ?? null;
  if (!order) return { order: null, items: [], events: [] };

  const supabase = getClient();
  const [items, events] = await Promise.all([
    loadOrderItems(supabase, { businessId, orderId }),
    loadOrderEvents(supabase, { businessId, orderId }),
  ]);

  return { order, items, events };
}

export async function getOrderOverview(businessId) {
  if (!businessId) throw new OrderServiceError('Select a workspace first.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_order_overview', {
    p_business_id: businessId,
  });

  if (error) throw toOrderServiceError(error);
  return mapOrderOverview(unwrapRpc(data));
}

export async function searchOrderCatalogue({
  businessId,
  search = '',
  page = 1,
  pageSize = 20,
} = {}) {
  if (!businessId) throw new OrderServiceError('Select a workspace first.');

  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('search_order_catalogue', {
    p_business_id: businessId,
    p_search: toNullableText(search),
    p_limit: safePageSize,
    p_offset: offset,
  });

  if (error) throw toOrderServiceError(error);

  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  return {
    data: rows.map(mapOrderCatalogueItem),
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + rows.length < total,
  };
}

function assertOrderCustomer({ customerId, guestName }) {
  if (customerId) return;
  if (!String(guestName ?? '').trim()) {
    throw new OrderServiceError(
      'Choose a customer or enter the walk-in customer name.',
    );
  }
}

export async function createOrder({
  businessId,
  customerId = null,
  guestName = '',
  guestPhone = '',
  guestEmail = '',
  notes = '',
  items = [],
}) {
  if (!businessId) throw new OrderServiceError('Select a workspace first.');
  assertOrderCustomer({ customerId, guestName });
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderServiceError('Add at least one item to the order.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_order', {
    p_business_id: businessId,
    p_customer_id: customerId || null,
    p_guest_name: toNullableText(guestName),
    p_guest_phone: toNullableText(guestPhone),
    p_guest_email: toNullableText(guestEmail),
    p_notes: toNullableText(notes),
    p_items: toItemPayload(items),
  });

  if (error) throw toOrderServiceError(error);
  return mapOrder(unwrapRpc(data));
}

export async function updateOrder({
  orderId,
  customerId = null,
  guestName = '',
  guestPhone = '',
  guestEmail = '',
  notes = '',
  items = [],
}) {
  if (!orderId) throw new OrderServiceError('Order not found.');
  assertOrderCustomer({ customerId, guestName });
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderServiceError('Add at least one item to the order.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_order', {
    p_order_id: orderId,
    p_customer_id: customerId || null,
    p_guest_name: toNullableText(guestName),
    p_guest_phone: toNullableText(guestPhone),
    p_guest_email: toNullableText(guestEmail),
    p_notes: toNullableText(notes),
    p_items: toItemPayload(items),
  });

  if (error) throw toOrderServiceError(error);
  return mapOrder(unwrapRpc(data));
}

export async function updateOrderStatus({ orderId, status }) {
  if (!orderId || !status) {
    throw new OrderServiceError('Choose the next order status.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_order_status', {
    p_order_id: orderId,
    p_status: status,
  });

  if (error) throw toOrderServiceError(error);
  return mapOrder(unwrapRpc(data));
}

export async function cancelOrder({ orderId, reason }) {
  if (!orderId) throw new OrderServiceError('Order not found.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: toNullableText(reason),
  });

  if (error) throw toOrderServiceError(error);
  return mapOrder(unwrapRpc(data));
}
