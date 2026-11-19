import { getSupabaseClient } from '../lib/supabase/client';

const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 100;

const ERROR_MESSAGES = Object.freeze({
  '42501': 'You do not have permission to view this workspace.',
  '28000': 'Sign in to continue.',
  '22P02': 'One of the workspace records is no longer available.',
});

export class WorkspaceSearchServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'WorkspaceSearchServiceError';
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

export function toWorkspaceSearchServiceError(error) {
  if (error instanceof WorkspaceSearchServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) message = ERROR_MESSAGES['42501'];
  if (!message) {
    message = error?.message || 'The workspace request could not be completed.';
  }

  return new WorkspaceSearchServiceError(message, {
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
    throw toWorkspaceSearchServiceError(error);
  }
}

function clampLimit(value, fallback, maximum) {
  const numeric = Math.floor(Number(value) || fallback);
  return Math.min(Math.max(numeric, 1), maximum);
}

function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function mapWorkspaceSearchResult(row) {
  if (!row) return null;
  return {
    resultType: row.result_type,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? '',
    href: row.href,
  };
}

export function mapWorkspaceNotification(row) {
  if (!row) return null;
  return {
    notificationKey: row.notification_key,
    resultType: row.result_type,
    referenceId: row.reference_id,
    title: row.title,
    subtitle: row.subtitle ?? '',
    href: row.href,
    occurredAt: row.occurred_at ?? null,
    isRead: Boolean(row.is_read),
    readAt: row.read_at ?? null,
    unreadCount: Number(row.unread_count ?? 0),
  };
}

export async function searchWorkspace({
  businessId,
  query = '',
  limit = DEFAULT_SEARCH_LIMIT,
} = {}) {
  if (!businessId) throw new WorkspaceSearchServiceError('Select a workspace first.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_global_search', {
    p_business_id: businessId,
    p_query: toNullableText(query),
    p_limit: clampLimit(limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
  });

  if (error) throw toWorkspaceSearchServiceError(error);
  return (data ?? []).map(mapWorkspaceSearchResult);
}

export async function listWorkspaceNotifications({
  businessId,
  limit = DEFAULT_NOTIFICATION_LIMIT,
} = {}) {
  if (!businessId) throw new WorkspaceSearchServiceError('Select a workspace first.');

  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_list_notifications', {
    p_business_id: businessId,
    p_limit: clampLimit(limit, DEFAULT_NOTIFICATION_LIMIT, MAX_NOTIFICATION_LIMIT),
  });

  if (error) throw toWorkspaceSearchServiceError(error);
  return (data ?? []).map(mapWorkspaceNotification);
}

export async function markWorkspaceNotificationRead({
  businessId,
  notificationKey,
} = {}) {
  if (!businessId || !notificationKey) {
    throw new WorkspaceSearchServiceError('Select a notification to mark as read.');
  }

  const supabase = getClient();
  const { data, error } = await supabase.rpc('workspace_mark_notification_read', {
    p_business_id: businessId,
    p_notification_key: String(notificationKey).trim(),
  });

  if (error) throw toWorkspaceSearchServiceError(error);
  return Boolean(data);
}
