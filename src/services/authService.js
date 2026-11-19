import { getSupabaseClient } from '../lib/supabase/client';

const ERROR_MESSAGES = Object.freeze({
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed:
    'Confirm your email address before signing in. Check your inbox for the confirmation link.',
  user_already_exists: 'An account with this email already exists.',
  email_exists: 'An account with this email already exists.',
  weak_password: 'Choose a stronger password with at least 8 characters.',
  same_password: 'Choose a password different from your current password.',
  email_address_invalid: 'Enter a valid email address.',
  password_too_short: 'Choose a password with at least 8 characters.',
  signup_disabled: 'New account registration is currently disabled.',
  email_provider_disabled: 'Email sign-in is currently disabled.',
  otp_expired: 'That link has expired. Request a new one.',
  token_expired: 'That link has expired. Request a new one.',
  invalid_token: 'That link is invalid. Request a new one.',
  bad_code_verifier: 'That link could not be verified. Request a new one.',
  flow_state_not_found: 'That link is invalid or has expired. Request a new one.',
  flow_state_expired: 'That link is invalid or has expired. Request a new one.',
  session_not_found: 'Your session has expired. Sign in again.',
  refresh_token_not_found: 'Your session has expired. Sign in again.',
  reauthentication_needed: 'Sign in again before changing your password.',
  over_email_send_rate_limit:
    'Too many emails have been sent. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a few moments and try again.',
  over_sms_send_rate_limit: 'Too many messages have been sent. Try again later.',
  '23505': 'That workspace identifier is already taken.',
  '28000': 'Sign in to continue.',
  '42501': 'You do not have permission to do that.',
  PGRST301: 'Your session has expired. Sign in again.',
});

function isNetworkError(error) {
  return (
    error?.status === 0 ||
    error?.name === 'AuthRetryableFetchError' ||
    /failed to fetch|networkerror|network request failed/i.test(error?.message ?? '')
  );
}

function resolveErrorMessage(error) {
  if (!error) return 'Something went wrong. Please try again.';
  if (isNetworkError(error)) {
    return 'We could not reach the server. Check your connection and try again.';
  }

  const code = String(error.code ?? '');
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];

  const status = Number(error.status);
  if (status === 401) return ERROR_MESSAGES.invalid_credentials;
  if (status === 429) return ERROR_MESSAGES.over_request_rate_limit;
  if (status >= 500) return 'The service is temporarily unavailable. Try again shortly.';

  return error.message || 'Something went wrong. Please try again.';
}

export class AuthServiceError extends Error {
  constructor(message, { cause, code, status } = {}) {
    super(message, { cause });
    this.name = 'AuthServiceError';
    this.code = code;
    this.status = status;
  }
}

export function toAuthServiceError(error) {
  if (error instanceof AuthServiceError) return error;

  return new AuthServiceError(resolveErrorMessage(error), {
    cause: error,
    code: error?.code,
    status: error?.status,
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toAuthServiceError(error);
  }
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBusiness(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industry: row.industry ?? null,
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMembership(row, business) {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    business,
  };
}

export async function signUp({ email, password, fullName, emailRedirectTo }) {
  const supabase = getClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(email),
    password,
    options: {
      data: { full_name: String(fullName ?? '').trim() },
      emailRedirectTo,
    },
  });

  if (error) throw toAuthServiceError(error);

  return {
    user: data.user ?? null,
    session: data.session ?? null,
    emailAlreadyRegistered: Boolean(
      data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0,
    ),
  };
}

export async function signInWithPassword({ email, password }) {
  const supabase = getClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) throw toAuthServiceError(error);
  return data;
}

export async function signOut() {
  const supabase = getClient();
  const { error } = await supabase.auth.signOut();
  if (!error) return;

  const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
  if (localError) throw toAuthServiceError(localError);
}

export async function resendSignupConfirmation({ email, emailRedirectTo }) {
  const supabase = getClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizeEmail(email),
    options: { emailRedirectTo },
  });

  if (error) throw toAuthServiceError(error);
}

export async function requestPasswordReset({ email, redirectTo }) {
  const supabase = getClient();
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo,
  });

  if (error) throw toAuthServiceError(error);
}

export async function updatePassword(password) {
  const supabase = getClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw toAuthServiceError(error);
}

export async function fetchProfile(userId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw toAuthServiceError(error);
  return mapProfile(data);
}

const EMPTY_PLATFORM_CONTEXT = Object.freeze({
  isSuperAdmin: false,
  isPlatformAdmin: false,
  permissions: [],
  roles: [],
  supportBusinessIds: [],
});

function mapPlatformContext(row) {
  return {
    isSuperAdmin: Boolean(row?.is_super_admin),
    isPlatformAdmin: Boolean(row?.is_platform_admin),
    permissions: Array.isArray(row?.permissions) ? row.permissions : [],
    roles: Array.isArray(row?.roles) ? row.roles : [],
    supportBusinessIds: Array.isArray(row?.support_business_ids)
      ? row.support_business_ids
      : [],
  };
}

export async function fetchPlatformContext() {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('platform_get_context');

  if (error) {
    if (error.code === '42501') return EMPTY_PLATFORM_CONTEXT;
    throw toAuthServiceError(error);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return mapPlatformContext(row);
}

export async function fetchMemberships(userId) {
  const supabase = getClient();
  const { data: memberRows, error: memberError } = await supabase
    .from('business_members')
    .select('id, business_id, user_id, role, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (memberError) throw toAuthServiceError(memberError);
  if (!memberRows?.length) return [];

  const businessIds = [...new Set(memberRows.map((row) => row.business_id))];
  const { data: businessRows, error: businessError } = await supabase
    .from('businesses')
    .select('id, name, slug, industry, country, currency, timezone, created_at, updated_at')
    .in('id', businessIds);

  if (businessError) throw toAuthServiceError(businessError);

  const businessesById = new Map((businessRows ?? []).map((row) => [row.id, mapBusiness(row)]));

  return memberRows
    .map((row) => mapMembership(row, businessesById.get(row.business_id) ?? null))
    .filter((membership) => membership.business);
}

export async function createBusiness({
  name,
  slug,
  industry,
  country,
  currency,
  timezone,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_business', {
    business_name: String(name ?? '').trim(),
    business_slug: slug,
    business_industry: industry ? String(industry).trim() : null,
    business_country: country,
    business_currency: currency,
    business_timezone: timezone,
  });

  if (error) throw toAuthServiceError(error);

  const row = Array.isArray(data) ? data[0] : data;
  return mapBusiness(row);
}
