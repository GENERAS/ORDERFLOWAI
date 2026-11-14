import { getSupabaseClient } from '../lib/supabase/client';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Normalised error surfaced by the data-access layer so features never
 * depend on raw PostgREST/Supabase error shapes.
 */
export class DataAccessError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'DataAccessError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function toDataAccessError(error) {
  return new DataAccessError(error?.message ?? 'Unexpected data access error.', {
    cause: error,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

function applyFilter(query, { column, operator = 'eq', value }) {
  switch (operator) {
    case 'eq':
      return query.eq(column, value);
    case 'neq':
      return query.neq(column, value);
    case 'gt':
      return query.gt(column, value);
    case 'gte':
      return query.gte(column, value);
    case 'lt':
      return query.lt(column, value);
    case 'lte':
      return query.lte(column, value);
    case 'like':
      return query.like(column, value);
    case 'ilike':
      return query.ilike(column, value);
    case 'is':
      return query.is(column, value);
    case 'in':
      return query.in(column, value);
    default:
      throw new DataAccessError(`Unsupported filter operator: ${operator}`);
  }
}

/**
 * Paginated read helper. Features should call focused service functions that
 * use this helper instead of scattering Supabase queries through components.
 *
 * @param {Object} options
 * @param {string} options.table
 * @param {string} [options.columns]
 * @param {Array<{column: string, operator?: string, value: unknown}>} [options.filters]
 * @param {string} [options.orderBy]
 * @param {boolean} [options.ascending]
 * @param {number} [options.page] 1-based page number
 * @param {number} [options.pageSize]
 * @param {AbortSignal} [options.signal]
 */
export async function selectPage({
  table,
  columns = '*',
  filters = [],
  orderBy,
  ascending = true,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  signal,
}) {
  const supabase = getSupabaseClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(
    Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  );
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;

  let query = supabase.from(table).select(columns, { count: 'exact' });

  for (const filter of filters) {
    query = applyFilter(query, filter);
  }

  if (orderBy) {
    query = query.order(orderBy, { ascending });
  }

  query = query.range(from, to);

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, count, error } = await query;

  if (error) {
    throw toDataAccessError(error);
  }

  const rows = data ?? [];
  const total = count ?? 0;

  return {
    data: rows,
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: count == null ? rows.length === safePageSize : to < total - 1,
  };
}

/**
 * Retry-safe wrapper for idempotent operations (reads, upserts with stable keys).
 * Do not use it to automatically retry non-idempotent writes.
 */
export async function withRetry(operation, { retries = 2, delayMs = 300 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs * (attempt + 1));
      });
    }
  }

  throw lastError;
}
