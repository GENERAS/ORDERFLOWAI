import { getSupabaseClient } from '../../lib/supabase/client';
import { toAuthServiceError } from '../../services/authService';

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

export async function fetchPlatformOverview() {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_overview');

  if (error) throw toAuthServiceError(error);
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function fetchPlatformBusinesses({
  search = '',
  limit = 50,
  offset = 0,
} = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_list_businesses', {
    p_search: search ? String(search).trim() : null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw toAuthServiceError(error);
  return data ?? [];
}

export async function fetchPlatformSupportSessions(businessId = null) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_list_support_sessions', {
    p_business_id: businessId,
  });

  if (error) throw toAuthServiceError(error);
  return data ?? [];
}

export async function startPlatformSupportSession({
  businessId,
  purpose,
  durationMinutes = 30,
  businessRoles = [],
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_start_support_session', {
    p_business_id: businessId,
    p_purpose: String(purpose ?? '').trim(),
    p_permissions: null,
    p_business_roles: businessRoles,
    p_duration_minutes: Number(durationMinutes),
  });

  if (error) throw toAuthServiceError(error);
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function endPlatformSupportSession(sessionId) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_end_support_session', {
    p_session_id: sessionId,
  });

  if (error) throw toAuthServiceError(error);
  return Boolean(data);
}
