import { getSupabaseClient } from '../../lib/supabase/client';
import { toAuthServiceError } from '../../services/authService';

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

async function callRpc(name, params = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(name, params);

  if (error) throw toAuthServiceError(error);
  return data ?? [];
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function fetchPlatformOverview() {
  return firstRow(await callRpc('platform_overview'));
}

export async function fetchPlatformBusinesses({
  search = '',
  limit = 50,
  offset = 0,
} = {}) {
  return callRpc('platform_list_businesses', {
    p_search: search ? String(search).trim() : null,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformSupportSessions(businessId = null) {
  return callRpc('platform_list_support_sessions', {
    p_business_id: businessId,
  });
}

export async function startPlatformSupportSession({
  businessId,
  purpose,
  durationMinutes = 30,
  businessRoles = [],
}) {
  return firstRow(
    await callRpc('platform_start_support_session', {
      p_business_id: businessId,
      p_purpose: String(purpose ?? '').trim(),
      p_permissions: null,
      p_business_roles: businessRoles,
      p_duration_minutes: Number(durationMinutes),
    }),
  );
}

export async function endPlatformSupportSession(sessionId) {
  const data = await callRpc('platform_end_support_session', {
    p_session_id: sessionId,
  });
  return Boolean(firstRow(data));
}

export async function fetchPlatformUsers({
  search = '',
  limit = 50,
  offset = 0,
} = {}) {
  return callRpc('platform_list_users', {
    p_search: search ? String(search).trim() : null,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformStorefronts({
  search = '',
  limit = 50,
  offset = 0,
} = {}) {
  return callRpc('platform_list_storefronts', {
    p_search: search ? String(search).trim() : null,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformOrdersPayments({
  search = '',
  status = '',
  limit = 50,
  offset = 0,
} = {}) {
  return callRpc('platform_list_orders_payments', {
    p_search: search ? String(search).trim() : null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformAiActivity({ limit = 50, offset = 0 } = {}) {
  return callRpc('platform_list_ai_activity', {
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformCommunications({ limit = 50, offset = 0 } = {}) {
  return callRpc('platform_list_communications', {
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformSubscriptions({ limit = 50, offset = 0 } = {}) {
  return callRpc('platform_list_subscriptions', {
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchPlatformIntegrations() {
  return callRpc('platform_list_integrations');
}

export async function fetchPlatformStorageUsage() {
  return firstRow(await callRpc('platform_get_storage_usage'));
}

export async function fetchPlatformHealth() {
  return firstRow(await callRpc('platform_get_health'));
}

export async function fetchPlatformSettings() {
  return firstRow(await callRpc('platform_get_settings'));
}

export async function updatePlatformSetting({ key, value }) {
  const data = await callRpc('platform_update_platform_setting', {
    p_key: String(key ?? ''),
    p_value: String(value ?? ''),
  });
  return Boolean(firstRow(data));
}

export async function fetchPlatformAudit({ limit = 50 } = {}) {
  return callRpc('platform_list_audit', {
    p_limit: limit,
  });
}

export async function fetchSuperAdminActions({ limit = 50 } = {}) {
  return callRpc('super_admin_list_actions', {
    p_limit: limit,
  });
}

export async function fetchPlatformGrants({ limit = 100 } = {}) {
  return callRpc('platform_list_grants', {
    p_limit: limit,
  });
}

export async function fetchPlatformPermissions() {
  return callRpc('platform_list_permissions');
}

export async function grantPlatformPermission({
  email,
  permission,
  businessId = null,
  reason = '',
}) {
  return firstRow(
    await callRpc('platform_grant_permission', {
      p_email: String(email ?? '').trim(),
      p_permission: String(permission ?? '').trim(),
      p_business_id: businessId,
      p_reason: reason ? String(reason).trim() : null,
      p_expires_at: null,
    }),
  );
}

export async function revokePlatformPermission({ grantId, reason = '' }) {
  const data = await callRpc('platform_revoke_permission', {
    p_grant_id: grantId,
    p_reason: reason ? String(reason).trim() : null,
  });
  return Boolean(firstRow(data));
}
