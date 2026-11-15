import { getSupabaseClient } from '../lib/supabase/client';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './baseService';

const ERROR_MESSAGES = Object.freeze({
  '23505':
    'This request was already submitted with different stock details. Refresh and try again.',
  '42501': 'You do not have permission to change this inventory.',
  PGRST116: 'The inventory record could not be found.',
});

const REQUIRED_REASON_OPERATIONS = new Set([
  'adjustment',
  'damage',
  'loss',
]);

const NEGATIVE_OPERATIONS = new Set([
  'reduce',
  'damage',
  'loss',
  'release',
]);

export class InventoryServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'InventoryServiceError';
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

export function toInventoryServiceError(error) {
  if (error instanceof InventoryServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) {
    message = 'You do not have permission to change this inventory.';
  }
  if (!message && code === '22023') message = error?.message;
  if (!message) {
    message = error?.message || 'The inventory request could not be completed.';
  }

  return new InventoryServiceError(message, {
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
    throw toInventoryServiceError(error);
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

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function mapInventoryItem(row) {
  if (!row) return null;
  return {
    inventoryItemId: row.inventory_item_id ?? null,
    businessId: row.business_id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    productName: row.product_name,
    variantName: row.variant_name ?? null,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    categoryId: row.category_id ?? null,
    categoryName: row.category_name ?? null,
    productStatus: row.product_status,
    variantStatus: row.variant_status ?? null,
    isTracked: Boolean(row.is_tracked),
    physicalQuantity: Number(row.physical_quantity ?? 0),
    reservedQuantity: Number(row.reserved_quantity ?? 0),
    availableQuantity: Number(row.available_quantity ?? 0),
    lowStockThreshold:
      row.low_stock_threshold == null ? null : Number(row.low_stock_threshold),
    inventoryStatus: row.inventory_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: Number(row.total_count ?? 0),
  };
}

function mapInventoryRecord(row) {
  if (!row) return null;
  return {
    inventoryItemId: row.id ?? null,
    businessId: row.business_id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    productName: null,
    variantName: null,
    sku: null,
    barcode: null,
    categoryId: null,
    categoryName: null,
    productStatus: null,
    variantStatus: null,
    isTracked: Boolean(row.is_tracked),
    physicalQuantity: Number(row.physical_quantity ?? 0),
    reservedQuantity: Number(row.reserved_quantity ?? 0),
    availableQuantity: Number(row.available_quantity ?? 0),
    lowStockThreshold:
      row.low_stock_threshold == null ? null : Number(row.low_stock_threshold),
    inventoryStatus: row.is_tracked
      ? Number(row.available_quantity ?? 0) === 0
        ? 'out_of_stock'
        : 'tracked'
      : 'untracked',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: 1,
  };
}

async function loadInventoryItemAfterMutation(supabase, record) {
  if (!record?.id || !record.business_id) return mapInventoryRecord(record);

  const { data, error } = await supabase.rpc('search_inventory', {
    p_business_id: record.business_id,
    p_inventory_item_id: record.id,
    p_limit: 1,
    p_offset: 0,
  });

  if (error || !data?.[0]) return mapInventoryRecord(record);
  return mapInventoryItem(data[0]);
}

function mapStockMovement(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    inventoryItemId: row.inventory_item_id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    productName: row.product_name,
    variantName: row.variant_name ?? null,
    sku: row.sku ?? null,
    operation: row.operation,
    quantityChange: Number(row.quantity_change ?? 0),
    previousPhysical: Number(row.previous_physical ?? 0),
    newPhysical: Number(row.new_physical ?? 0),
    previousReserved: Number(row.previous_reserved ?? 0),
    newReserved: Number(row.new_reserved ?? 0),
    reason: row.reason ?? null,
    performedByName: row.performed_by_name,
    idempotencyKey: row.idempotency_key ?? null,
    createdAt: row.created_at,
    totalCount: Number(row.total_count ?? 0),
  };
}

function mapInventoryOverview(row) {
  if (!row) {
    return {
      totalUnits: 0,
      trackedUnits: 0,
      untrackedUnits: 0,
      inStockUnits: 0,
      lowStockUnits: 0,
      outOfStockUnits: 0,
      totalPhysical: 0,
      totalReserved: 0,
      totalAvailable: 0,
      movementCount: 0,
      movementsToday: 0,
      lastMovementAt: null,
    };
  }

  return {
    totalUnits: Number(row.total_units ?? 0),
    trackedUnits: Number(row.tracked_units ?? 0),
    untrackedUnits: Number(row.untracked_units ?? 0),
    inStockUnits: Number(row.in_stock_units ?? 0),
    lowStockUnits: Number(row.low_stock_units ?? 0),
    outOfStockUnits: Number(row.out_of_stock_units ?? 0),
    totalPhysical: Number(row.total_physical ?? 0),
    totalReserved: Number(row.total_reserved ?? 0),
    totalAvailable: Number(row.total_available ?? 0),
    movementCount: Number(row.movement_count ?? 0),
    movementsToday: Number(row.movements_today ?? 0),
    lastMovementAt: row.last_movement_at ?? null,
  };
}

export async function listInventory({
  businessId,
  search = '',
  status = null,
  categoryId = null,
  inventoryItemId = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  sort = 'name',
  direction = 'asc',
} = {}) {
  if (!businessId) throw new InventoryServiceError('Select a workspace first.');

  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('search_inventory', {
    p_business_id: businessId,
    p_search: toNullableText(search),
    p_status: status || null,
    p_category_id: categoryId || null,
    p_inventory_item_id: inventoryItemId || null,
    p_limit: safePageSize,
    p_offset: offset,
    p_sort: sort || 'name',
    p_direction: direction === 'desc' ? 'desc' : 'asc',
  });

  if (error) throw toInventoryServiceError(error);

  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  return {
    data: rows.map(mapInventoryItem),
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + rows.length < total,
  };
}

export async function getInventoryItem({ businessId, inventoryItemId }) {
  if (!businessId || !inventoryItemId) {
    throw new InventoryServiceError('Inventory record not found.');
  }

  const result = await listInventory({
    businessId,
    inventoryItemId,
    page: 1,
    pageSize: 1,
  });

  if (result.data.length === 0) {
    throw new InventoryServiceError('Inventory record not found.');
  }

  return result.data[0];
}

export async function getInventoryOverview(businessId) {
  if (!businessId) throw new InventoryServiceError('Select a workspace first.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_inventory_overview', {
    p_business_id: businessId,
  });

  if (error) throw toInventoryServiceError(error);
  return mapInventoryOverview(unwrapRpc(data));
}

export async function listStockMovements({
  businessId,
  search = '',
  operation = null,
  inventoryItemId = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (!businessId) throw new InventoryServiceError('Select a workspace first.');

  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('list_stock_movements', {
    p_business_id: businessId,
    p_search: toNullableText(search),
    p_operation: operation || null,
    p_inventory_item_id: inventoryItemId || null,
    p_limit: safePageSize,
    p_offset: offset,
  });

  if (error) throw toInventoryServiceError(error);

  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);

  return {
    data: rows.map(mapStockMovement),
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + rows.length < total,
  };
}

export async function enableInventoryTracking({
  productId,
  variantId = null,
  lowStockThreshold = null,
}) {
  if (!productId) {
    throw new InventoryServiceError('Choose a product or variant to track.');
  }

  const threshold =
    lowStockThreshold === '' || lowStockThreshold == null
      ? null
      : Math.max(0, Math.floor(Number(lowStockThreshold)));
  if (threshold != null && !Number.isFinite(threshold)) {
    throw new InventoryServiceError('Enter a valid low-stock threshold.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('enable_inventory_tracking', {
    p_product_id: productId,
    p_variant_id: variantId || null,
    p_low_stock_threshold: threshold,
  });

  if (error) throw toInventoryServiceError(error);
  return loadInventoryItemAfterMutation(supabase, unwrapRpc(data));
}

export async function disableInventoryTracking(inventoryItemId) {
  if (!inventoryItemId) {
    throw new InventoryServiceError('Inventory record not found.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('disable_inventory_tracking', {
    p_inventory_item_id: inventoryItemId,
  });

  if (error) throw toInventoryServiceError(error);
  return loadInventoryItemAfterMutation(supabase, unwrapRpc(data));
}

export async function updateInventoryThreshold({
  inventoryItemId,
  lowStockThreshold,
}) {
  if (!inventoryItemId) {
    throw new InventoryServiceError('Inventory record not found.');
  }

  const threshold =
    lowStockThreshold === '' || lowStockThreshold == null
      ? null
      : Math.max(0, Math.floor(Number(lowStockThreshold)));
  if (threshold != null && !Number.isFinite(threshold)) {
    throw new InventoryServiceError('Enter a valid low-stock threshold.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_inventory_threshold', {
    p_inventory_item_id: inventoryItemId,
    p_low_stock_threshold: threshold,
  });

  if (error) throw toInventoryServiceError(error);
  return loadInventoryItemAfterMutation(supabase, unwrapRpc(data));
}

export function getSignedQuantity(operation, quantity, direction = 'increase') {
  const amount = Math.floor(Math.abs(Number(quantity)));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new InventoryServiceError('Enter a quantity greater than zero.');
  }

  if (operation === 'adjustment') {
    return direction === 'decrease' ? -amount : amount;
  }
  if (NEGATIVE_OPERATIONS.has(operation)) return -amount;
  if (
    operation === 'receive' ||
    operation === 'return' ||
    operation === 'reserve'
  ) {
    return amount;
  }

  throw new InventoryServiceError('Choose a valid stock operation.');
}

export async function recordStockOperation({
  inventoryItemId,
  operation,
  quantity,
  direction = 'increase',
  reason,
  idempotencyKey,
}) {
  if (!inventoryItemId) {
    throw new InventoryServiceError('Inventory record not found.');
  }

  const normalizedReason = toNullableText(reason);
  if (REQUIRED_REASON_OPERATIONS.has(operation) && !normalizedReason) {
    throw new InventoryServiceError(
      'Add a reason for adjustments, damage and losses.',
    );
  }

  const quantityChange = getSignedQuantity(operation, quantity, direction);
  const supabase = getClient();
  const { data, error } = await supabase.rpc('record_stock_operation', {
    p_inventory_item_id: inventoryItemId,
    p_operation: operation,
    p_quantity_change: quantityChange,
    p_reason: normalizedReason,
    p_idempotency_key: toNullableText(idempotencyKey) ?? createIdempotencyKey(),
  });

  if (error) throw toInventoryServiceError(error);
  return mapStockMovement(unwrapRpc(data));
}
