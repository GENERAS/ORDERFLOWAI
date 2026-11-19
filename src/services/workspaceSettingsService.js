import { getSupabaseClient } from '../lib/supabase/client';

const ERROR_MESSAGES = Object.freeze({
  '22023': 'Check the highlighted settings and try again.',
  '28000': 'Sign in again to manage workspace settings.',
  '42501': 'You do not have permission to change workspace settings.',
  PGRST116: 'The workspace could not be found.',
});

export class WorkspaceSettingsServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'WorkspaceSettingsServiceError';
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

export function toWorkspaceSettingsServiceError(error) {
  if (error instanceof WorkspaceSettingsServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message) message = error?.message || 'The settings request could not be completed.';

  return new WorkspaceSettingsServiceError(message, {
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
    throw toWorkspaceSettingsServiceError(error);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function assertBusinessId(businessId) {
  if (!businessId) throw new WorkspaceSettingsServiceError('Select a workspace first.');
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 't' || value === 'true') return true;
  if (value === 0 || value === 'f' || value === 'false') return false;
  return fallback;
}

export function mapWorkspaceSettings(row) {
  const source = unwrapRpc(row) ?? {};
  return {
    businessId: source.business_id ?? null,
    name: source.name ?? '',
    industry: source.industry ?? '',
    country: source.country ?? 'RW',
    currency: source.currency ?? 'RWF',
    timezone: source.timezone ?? 'Africa/Kigali',
    notifyEmail: toBoolean(source.notify_email, true),
    notifyNewOrders: toBoolean(source.notify_new_orders, true),
    notifyPayments: toBoolean(source.notify_payments, true),
    aiTone: source.ai_tone ?? 'concise',
    aiRequireConfirmation: toBoolean(source.ai_require_confirmation, true),
  };
}

export function mapWorkspaceSubscription(row) {
  const source = unwrapRpc(row) ?? {};
  const features = Array.isArray(source.features) ? source.features : [];
  return {
    businessId: source.business_id ?? null,
    planCode: source.plan_code ?? '',
    planName: source.plan_name ?? 'No plan',
    status: source.status ?? 'unknown',
    monthlyAmount: Number(source.monthly_amount ?? 0),
    currency: source.currency ?? 'USD',
    orderLimit: source.order_limit ?? null,
    userLimit: source.user_limit ?? null,
    currentPeriodEnd: source.current_period_end ?? null,
    features: features.filter((item) => typeof item === 'string'),
  };
}

export async function getWorkspaceSettings(businessId) {
  assertBusinessId(businessId);
  const { data, error } = await getClient().rpc('workspace_get_settings', {
    p_business_id: businessId,
  });
  if (error) throw toWorkspaceSettingsServiceError(error);
  return mapWorkspaceSettings(data);
}

export async function updateWorkspaceSettings(businessId, values = {}) {
  assertBusinessId(businessId);
  const { data, error } = await getClient().rpc('workspace_update_settings', {
    p_business_id: businessId,
    p_name: values.name,
    p_industry: values.industry || null,
    p_country: values.country,
    p_currency: values.currency,
    p_timezone: values.timezone,
    p_notify_email: toBoolean(values.notifyEmail, true),
    p_notify_new_orders: toBoolean(values.notifyNewOrders, true),
    p_notify_payments: toBoolean(values.notifyPayments, true),
    p_ai_tone: values.aiTone || 'concise',
    p_ai_require_confirmation: toBoolean(values.aiRequireConfirmation, true),
  });
  if (error) throw toWorkspaceSettingsServiceError(error);
  return mapWorkspaceSettings(data);
}

export async function getWorkspaceSubscription(businessId) {
  assertBusinessId(businessId);
  const { data, error } = await getClient().rpc('workspace_get_subscription', {
    p_business_id: businessId,
  });
  if (error) throw toWorkspaceSettingsServiceError(error);
  return mapWorkspaceSubscription(data);
}
