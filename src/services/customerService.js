import { getSupabaseClient } from '../lib/supabase/client';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './baseService';

const ERROR_MESSAGES = Object.freeze({
  '23505': 'A customer with these contact details already exists.',
  '42501': 'You do not have permission to manage customers.',
  PGRST116: 'The customer could not be found.',
});

const ADDRESS_COLUMNS = `
  id,
  business_id,
  customer_id,
  label,
  recipient_name,
  line1,
  line2,
  city,
  region,
  postal_code,
  country,
  is_default,
  created_at,
  updated_at
`;

const NOTE_COLUMNS = `
  id,
  business_id,
  customer_id,
  body,
  author_name,
  created_by,
  created_at
`;

const EVENT_COLUMNS = `
  id,
  business_id,
  customer_id,
  event_type,
  description,
  actor_id,
  actor_name,
  created_at
`;

export class CustomerServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'CustomerServiceError';
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

function duplicateMessage(error) {
  const message = String(error?.message ?? '');
  if (/email/i.test(message)) return 'A customer with this email address already exists.';
  if (/phone/i.test(message)) return 'A customer with this phone number already exists.';
  if (message.includes('customers_business_email_key')) {
    return 'A customer with this email address already exists.';
  }
  if (message.includes('customers_business_phone_key')) {
    return 'A customer with this phone number already exists.';
  }
  return ERROR_MESSAGES['23505'];
}

export function toCustomerServiceError(error) {
  if (error instanceof CustomerServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (code === '23505') message = duplicateMessage(error);
  if (!message && isPermissionError(error)) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message && code === '22023') message = error?.message;
  if (!message && code === '28000') {
    message = 'Sign in again to manage customers.';
  }
  if (!message) {
    message = error?.message || 'The customer request could not be completed.';
  }

  return new CustomerServiceError(message, {
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
    throw toCustomerServiceError(error);
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

export function mapCustomer(row) {
  if (!row) return null;
  const addressCount = Number(row.address_count ?? 0);
  const hasPrimaryAddress = Boolean(row.primary_address_line1);

  return {
    id: row.id,
    businessId: row.business_id,
    fullName: row.full_name,
    companyName: row.company_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    status: row.status ?? 'active',
    tags: row.tags ?? [],
    addressCount,
    primaryAddress: hasPrimaryAddress
      ? {
          label: row.primary_address_label ?? null,
          line1: row.primary_address_line1,
          city: row.primary_address_city ?? null,
          country: row.primary_address_country ?? null,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalCount: Number(row.total_count ?? 1),
  };
}

export function mapCustomerAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    label: row.label ?? null,
    recipientName: row.recipient_name ?? null,
    line1: row.line1,
    line2: row.line2 ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCustomerNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    body: row.body,
    authorName: row.author_name,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

export function mapCustomerEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    eventType: row.event_type,
    description: row.description,
    actorId: row.actor_id ?? null,
    actorName: row.actor_name,
    createdAt: row.created_at,
  };
}

function mapDuplicate(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    companyName: row.company_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    matchReasons: row.match_reasons ?? [],
  };
}

export async function searchCustomers({
  businessId,
  search = '',
  customerId = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  sort = 'name',
  direction = 'asc',
  status = null,
  tag = null,
} = {}) {
  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('search_customers', {
    p_business_id: businessId,
    p_search: String(search ?? '').trim() || null,
    p_customer_id: customerId,
    p_limit: safePageSize,
    p_offset: offset,
    p_sort: sort,
    p_direction: direction,
    p_status: status || null,
    p_tag: tag || null,
  });

  if (error) throw toCustomerServiceError(error);

  const rows = (data ?? []).map(mapCustomer);
  const count = rows[0]?.totalCount ?? 0;

  return {
    data: rows,
    count,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + rows.length < count,
  };
}

async function loadCustomerAddresses({ businessId, customerId }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('customer_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw toCustomerServiceError(error);
  return (data ?? []).map(mapCustomerAddress);
}

async function loadCustomerNotes({ businessId, customerId }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('customer_notes')
    .select(NOTE_COLUMNS)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) throw toCustomerServiceError(error);
  return (data ?? []).map(mapCustomerNote);
}

async function loadCustomerEvents({ businessId, customerId }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('customer_events')
    .select(EVENT_COLUMNS)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) throw toCustomerServiceError(error);
  return (data ?? []).map(mapCustomerEvent);
}

export async function getCustomer({ businessId, customerId }) {
  const result = await searchCustomers({
    businessId,
    customerId,
    page: 1,
    pageSize: 1,
  });

  const customer = result.data[0] ?? null;
  if (!customer) {
    return { customer: null, addresses: [], notes: [], events: [] };
  }

  const [addresses, notes, events] = await Promise.all([
    loadCustomerAddresses({ businessId, customerId }),
    loadCustomerNotes({ businessId, customerId }),
    loadCustomerEvents({ businessId, customerId }),
  ]);
  return { customer, addresses, notes, events };
}

export async function findCustomerDuplicates({
  businessId,
  fullName = '',
  email = '',
  phone = '',
  excludeCustomerId = null,
} = {}) {
  if (!String(fullName ?? '').trim() && !String(email ?? '').trim() && !String(phone ?? '').trim()) {
    return [];
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('find_customer_duplicates', {
    p_business_id: businessId,
    p_full_name: String(fullName ?? '').trim() || null,
    p_email: String(email ?? '').trim() || null,
    p_phone: String(phone ?? '').trim() || null,
    p_exclude_customer_id: excludeCustomerId,
  });

  if (error) throw toCustomerServiceError(error);
  return (data ?? []).map(mapDuplicate);
}

export async function listCustomerTags(businessId) {
  if (!businessId) return [];

  const supabase = getClient();
  const { data, error } = await supabase.rpc('list_customer_tags', {
    p_business_id: businessId,
  });

  if (error) throw toCustomerServiceError(error);
  return (data ?? []).map((row) => ({
    tag: row.tag,
    customerCount: Number(row.customer_count ?? 0),
  }));
}

export async function addCustomerNote({ customerId, body }) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('add_customer_note', {
    p_customer_id: customerId,
    p_body: body,
  });

  if (error) throw toCustomerServiceError(error);
  return mapCustomerNote(unwrapRpc(data));
}

export async function createCustomer({
  businessId,
  fullName,
  email = '',
  phone = '',
  companyName = '',
  notes = '',
  status = 'active',
  tags = [],
  duplicateOverride = false,
  duplicateReason = '',
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_customer', {
    p_business_id: businessId,
    p_full_name: fullName,
    p_email: String(email ?? '').trim() || null,
    p_phone: String(phone ?? '').trim() || null,
    p_company_name: String(companyName ?? '').trim() || null,
    p_notes: String(notes ?? '').trim() || null,
    p_status: status || 'active',
    p_tags: tags ?? [],
    p_duplicate_override: Boolean(duplicateOverride),
    p_duplicate_reason: String(duplicateReason ?? '').trim() || null,
  });

  if (error) throw toCustomerServiceError(error);
  return mapCustomer(unwrapRpc(data));
}

export async function updateCustomer({
  customerId,
  fullName,
  email = '',
  phone = '',
  companyName = '',
  notes = null,
  status = null,
  tags = null,
  duplicateOverride = false,
  duplicateReason = '',
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_customer', {
    p_customer_id: customerId,
    p_full_name: fullName,
    p_email: String(email ?? '').trim() || null,
    p_phone: String(phone ?? '').trim() || null,
    p_company_name: String(companyName ?? '').trim() || null,
    p_notes: String(notes ?? '').trim() || null,
    p_status: status || null,
    p_tags: Array.isArray(tags) ? tags : null,
    p_duplicate_override: Boolean(duplicateOverride),
    p_duplicate_reason: String(duplicateReason ?? '').trim() || null,
  });

  if (error) throw toCustomerServiceError(error);
  return mapCustomer(unwrapRpc(data));
}

export async function saveCustomerAddress({
  customerId,
  addressId = null,
  label = '',
  recipientName = '',
  line1,
  line2 = '',
  city = '',
  region = '',
  postalCode = '',
  country = '',
  isDefault = false,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('save_customer_address', {
    p_customer_id: customerId,
    p_address_id: addressId,
    p_label: String(label ?? '').trim() || null,
    p_recipient_name: String(recipientName ?? '').trim() || null,
    p_line1: line1,
    p_line2: String(line2 ?? '').trim() || null,
    p_city: String(city ?? '').trim() || null,
    p_region: String(region ?? '').trim() || null,
    p_postal_code: String(postalCode ?? '').trim() || null,
    p_country: String(country ?? '').trim() || null,
    p_is_default: Boolean(isDefault),
  });

  if (error) throw toCustomerServiceError(error);
  return mapCustomerAddress(unwrapRpc(data));
}

export async function deleteCustomerAddress(addressId) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('delete_customer_address', {
    p_address_id: addressId,
  });

  if (error) throw toCustomerServiceError(error);
  return Boolean(data);
}
