import { getSupabaseClient } from '../lib/supabase/client';

const ERROR_MESSAGES = Object.freeze({
  UNAUTHENTICATED: 'Sign in to use the assistant.',
  FORBIDDEN: 'You do not have access to this assistant.',
  ASSISTANT_DISABLED: 'The assistant is disabled for this workspace.',
  ASSISTANT_CONFIG_ERROR: 'The assistant service is not configured. Contact your administrator.',
  INVALID_REQUEST: 'The assistant request was invalid.',
  UNSUPPORTED_LANGUAGE: 'That language is not enabled for this business.',
  CONVERSATION_NOT_FOUND: 'The assistant conversation could not be found.',
  AI_RATE_LIMITED: 'The workspace AI usage limit was reached. Try again later.',
  PROVIDER_NOT_CONFIGURED: 'No AI provider is configured. Ask your administrator to configure the assistant.',
  PROVIDER_CONFIGURATION_ERROR: 'The AI provider configuration is incomplete. Contact your administrator.',
  PROVIDER_UNSUPPORTED: 'The configured AI provider is not supported.',
  PROVIDER_RATE_LIMITED: 'The AI provider is busy. Wait a moment and try again.',
  PROVIDER_TIMEOUT: 'The assistant took too long to respond. Try again.',
  PROVIDER_UNAVAILABLE: 'The assistant provider is temporarily unavailable.',
  PROVIDER_INVALID_RESPONSE: 'The assistant provider returned an invalid response.',
  PROVIDER_ERROR: 'The assistant provider rejected the request.',
  USAGE_CHECK_FAILED: 'The assistant request could not be started.',
  INTERNAL_ERROR: 'The assistant request could not be completed.',
});

export class AIAssistantServiceError extends Error {
  constructor(message, { cause, code, status, details } = {}) {
    super(message, { cause });
    this.name = 'AIAssistantServiceError';
    this.code = code ?? null;
    this.status = status ?? null;
    this.details = details ?? null;
  }
}

async function readErrorPayload(error) {
  const response = error?.context ?? error?.response;
  if (response && typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return error?.data ?? null;
}

export async function toAIAssistantServiceError(error) {
  if (error instanceof AIAssistantServiceError) return error;

  const payload = await readErrorPayload(error);
  const code = String(payload?.code ?? error?.code ?? '');
  const status = Number(payload?.status ?? error?.status ?? error?.context?.status ?? 0) || null;
  const message = String(
    payload?.message ??
      payload?.error ??
      error?.message ??
      ERROR_MESSAGES[code] ??
      'The assistant request could not be completed.',
  );

  return new AIAssistantServiceError(message, {
    cause: error,
    code: code || null,
    status,
    details: payload?.details ?? null,
  });
}

export function getAIAssistantErrorMessage(error) {
  if (error instanceof AIAssistantServiceError) return error.message;
  return ERROR_MESSAGES[String(error?.code ?? '')] ??
    error?.message ??
    'The assistant request could not be completed.';
}

function createActionKey(prefix) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${suffix}`.slice(0, 128);
}

function unwrapRpcData(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function callOrderRpc(name, params) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw await toAIAssistantServiceError(error);
  return unwrapRpcData(data);
}

export async function listAIPreparations({
  businessId,
  status = null,
  search = '',
  limit = 25,
}) {
  return callOrderRpc('ai_search_order_preparations', {
    p_business_id: businessId,
    p_status: status || null,
    p_search: search || null,
    p_limit: limit,
    p_offset: 0,
  });
}

export async function getAIOrderSummary(orderId) {
  return callOrderRpc('get_order_summary', { p_order_id: orderId });
}

export async function approveAIOrder(orderId) {
  return callOrderRpc('approve_prepared_order', {
    p_order_id: orderId,
    p_idempotency_key: createActionKey('approve'),
  });
}

export async function rejectAIOrder(orderId, reason) {
  return callOrderRpc('reject_prepared_order', {
    p_order_id: orderId,
    p_reason: reason,
    p_idempotency_key: createActionKey('reject'),
  });
}

export async function requestAIOrderClarification(orderId, reason) {
  return callOrderRpc('request_order_clarification', {
    p_order_id: orderId,
    p_reason: reason,
    p_idempotency_key: createActionKey('clarify'),
  });
}

export async function cancelAIOrderDraft(orderId, reason) {
  return callOrderRpc('cancel_order_draft', {
    p_order_id: orderId,
    p_reason: reason,
    p_idempotency_key: createActionKey('cancel'),
  });
}

export async function askAIAssistant({
  businessId,
  message,
  language = 'auto',
  conversationId = null,
  requestId = null,
  historyLimit = 8,
}) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('ai-commerce-assistant', {
    body: {
      businessId,
      message,
      language,
      conversationId,
      requestId,
      historyLimit,
    },
  });

  if (error) throw await toAIAssistantServiceError(error);
  if (!data || typeof data !== 'object') {
    throw new AIAssistantServiceError('The assistant returned an empty response.');
  }
  if (data.error) throw await toAIAssistantServiceError(data);

  return data;
}
