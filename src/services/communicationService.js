import { env } from '../lib/env';
import { getSupabaseClient } from '../lib/supabase/client';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const ERROR_MESSAGES = Object.freeze({
  '42501': 'You do not have permission to manage communication channels in this workspace.',
  '28000': 'Sign in again to continue using the shared inbox.',
  '429': 'Too many requests were sent. Wait a moment and try again.',
  '503': 'The WhatsApp service is not configured. Contact your administrator.',
  PGRST116: 'The requested communication record could not be found.',
});

export class CommunicationServiceError extends Error {
  constructor(message, { cause, code, status, details, hint } = {}) {
    super(message, { cause });
    this.name = 'CommunicationServiceError';
    this.code = code ?? null;
    this.status = status ?? null;
    this.details = details ?? null;
    this.hint = hint ?? null;
  }
}

function isPermissionError(error) {
  return /row-level security|permission denied|insufficient privilege/i.test(
    error?.message ?? '',
  );
}

function isRateLimitError(error) {
  return /rate limit|too many requests/i.test(error?.message ?? '');
}

export function toCommunicationServiceError(error) {
  if (error instanceof CommunicationServiceError) return error;

  const code = String(error?.code ?? '');
  const status = Number(error?.status ?? error?.context?.status ?? 0) || null;
  let message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES[String(status)];

  if (!message && isPermissionError(error)) message = ERROR_MESSAGES['42501'];
  if (!message && (status === 429 || isRateLimitError(error))) {
    message = ERROR_MESSAGES['429'];
  }
  if (!message && code === '22023') {
    message = error?.message || 'The communication request was invalid.';
  }
  if (!message) {
    message = error?.message || 'The communication request could not be completed.';
  }

  return new CommunicationServiceError(message, {
    cause: error,
    code: code || null,
    status,
    details: error?.details,
    hint: error?.hint,
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toCommunicationServiceError(error);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function toArray(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function clampLimit(value) {
  return Math.min(
    Math.max(1, Math.floor(Number(value) || DEFAULT_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  );
}

async function rpc(name, params) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw toCommunicationServiceError(error);
  return data;
}

async function invokeFunction(name, body, options = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke(name, { body, ...options });

  if (error) {
    const response = error.context;
    let payload = null;
    if (response && typeof response.json === 'function') {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    throw toCommunicationServiceError({
      message: payload?.message ?? payload?.error ?? error.message,
      code: payload?.code ?? error.code,
      status: payload?.status ?? response?.status ?? error.status,
      details: payload?.details,
      hint: payload?.hint,
      cause: error,
    });
  }

  if (data?.error) {
    throw toCommunicationServiceError({
      message: data.message ?? data.error,
      code: data.code,
      status: data.status,
      details: data.details,
      hint: data.hint,
    });
  }

  return data;
}

export function getMetaPublicConfig() {
  return {
    appId: env.metaAppId,
    configId: env.metaConfigId,
    graphApiVersion: env.metaGraphApiVersion,
    embeddedSignupVersion: env.metaEmbeddedSignupVersion,
    isConfigured: Boolean(env.metaAppId && env.metaConfigId),
  };
}

export function mapChannel(row) {
  if (!row) return null;
  const status = row.connection_status ?? row.status ?? 'not_connected';

  return {
    id: row.id ?? row.connection_id ?? row.code ?? null,
    connectionId: row.connection_id ?? null,
    code: row.code ?? row.channel ?? 'whatsapp',
    channel: row.code ?? row.channel ?? 'whatsapp',
    name: row.name ?? null,
    description: row.description ?? null,
    channelStatus: row.channel_status ?? 'available',
    status,
    isConnected: status === 'connected',
    displayPhoneNumber: row.display_phone_number ?? null,
    phoneNumberId: row.external_phone_number_id ?? row.phone_number_id ?? null,
    wabaId: row.external_account_id ?? row.waba_id ?? null,
    businessPortfolioId: row.business_portfolio_id ?? null,
    accountId: row.external_account_id ?? null,
    verifiedName: row.verified_name ?? null,
    lastError: row.last_error ?? row.error_message ?? null,
    connectedAt: row.connected_at ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function mapConnection(row) {
  if (!row) return null;
  return {
    ...mapChannel(row),
    connection: row.connection ?? row.metadata ?? null,
  };
}

export function mapAssignableUser(row) {
  if (!row) return null;
  return {
    id: row.user_id ?? row.id,
    fullName: row.full_name ?? row.name ?? 'Team member',
    email: row.email ?? null,
    role: row.role ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
}

export function mapCustomer(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    businessId: row.business_id ?? null,
    fullName: row.full_name ?? row.name ?? null,
    companyName: row.company_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    status: row.status ?? null,
  };
}

export function mapCustomerOrder(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    orderNumber: row.order_number ?? row.number ?? null,
    status: row.status ?? null,
    totalAmount: Number(row.total_amount ?? row.total ?? 0),
    currency: row.currency ?? 'RWF',
    createdAt: row.created_at ?? null,
  };
}

export function mapConversation(row) {
  if (!row) return null;
  const status = row.status ?? 'open';
  const displayName =
    row.display_name ?? row.customer_name ?? row.external_customer_id ?? null;
  const hasCustomer = Boolean(
    row.customer ??
      row.customer_id ??
      row.customer_name ??
      row.customer_phone ??
      row.customer_email,
  );

  return {
    id: row.id ?? null,
    businessId: row.business_id ?? null,
    connectionId: row.connection_id ?? null,
    channel: row.channel ?? 'whatsapp',
    status,
    externalCustomerId: row.external_customer_id ?? null,
    externalCustomerIdType: row.external_customer_id_type ?? 'wa_id',
    customerId: row.customer_id ?? row.customer?.id ?? null,
    displayName: displayName || row.external_customer_id || 'Unknown customer',
    customer: row.customer
      ? mapCustomer(row.customer)
      : hasCustomer
        ? mapCustomer({
            id: row.customer_id,
            full_name: row.customer_name,
            phone: row.customer_phone,
            email: row.customer_email,
            status: row.customer_status,
          })
        : null,
    customerOrders: toArray(row.customer_orders ?? row.orders, 'orders').map(
      mapCustomerOrder,
    ),
    lastMessagePreview:
      row.last_message_text ??
      row.last_message_preview ??
      row.last_message_body ??
      row.last_message ??
      null,
    lastMessageAt: row.last_message_at ?? row.updated_at ?? null,
    lastMessageDirection: row.last_message_direction ?? null,
    unreadCount: Number(row.unread_count ?? 0),
    assigneeId: row.assigned_to ?? row.assignee_id ?? null,
    assigneeName:
      row.assigned_user_full_name ?? row.assignee_name ?? row.assignee?.full_name ?? null,
    optedOut: Boolean(row.is_opted_out ?? row.opted_out ?? false),
    optedOutAt: row.opted_out_at ?? null,
    connectionStatus: row.connection_status ?? null,
    connectionPhoneNumber: row.connection_phone_number ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    totalCount: Number(row.total_count ?? 0),
  };
}

export function mapMessage(row) {
  if (!row) return null;
  const deliveryStatus = row.status ?? row.delivery_status ?? row.provider_status ?? null;

  return {
    id: row.id ?? null,
    businessId: row.business_id ?? null,
    conversationId: row.conversation_id ?? null,
    direction: row.direction ?? 'inbound',
    messageType: row.message_type ?? 'text',
    text: row.text_content ?? row.text ?? row.body ?? null,
    deliveryStatus,
    providerStatus: row.provider_status ?? null,
    mediaAssetId: row.media_asset_id ?? null,
    mediaProviderId: row.media_provider_id ?? null,
    mediaUrl: row.media_url ?? row.delivery_url ?? null,
    mediaMimeType: row.media_mime_type ?? row.mime_type ?? null,
    mediaFilename: row.media_filename ?? row.file_name ?? null,
    templateName: row.template_name ?? null,
    templateLanguage: row.template_language ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? row.error ?? null,
    externalId: row.provider_message_id ?? row.wa_message_id ?? row.external_id ?? null,
    clientRequestId: row.client_request_id ?? null,
    hasMore: Boolean(row.has_more ?? false),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function mapSendContext(row) {
  if (!row) {
    return {
      templateRequired: false,
      optedOut: false,
      canSend: true,
      reason: null,
      connectionStatus: null,
      allowedTemplates: [],
    };
  }

  const templateRequired = Boolean(
    row.template_required ?? row.requires_template ?? row.templateRequired ?? false,
  );
  const optedOut = Boolean(row.opted_out ?? row.is_opted_out ?? false);
  const connectionStatus = row.connection_status ?? row.status ?? null;
  let reason = row.reason ?? row.message ?? null;
  if (!reason && connectionStatus && connectionStatus !== 'connected') {
    reason = 'The WhatsApp connection is not active. Reconnect it in Communication channels.';
  }
  if (!reason && templateRequired) {
    reason = 'The 24-hour messaging window has closed. Use an approved template.';
  }

  return {
    conversationId: row.conversation_id ?? null,
    businessId: row.business_id ?? null,
    channel: row.channel ?? null,
    connectionId: row.connection_id ?? null,
    connectionStatus,
    recipient: row.recipient ?? null,
    customerId: row.customer_id ?? null,
    lastIncomingAt: row.last_incoming_at ?? null,
    serviceWindowOpen: Boolean(row.service_window_open ?? false),
    templateRequired,
    optedOut,
    canSend: Boolean(row.can_send ?? true) && !optedOut,
    reason,
    allowedTemplates: toArray(row.allowed_templates ?? row.templates, 'templates'),
  };
}

export function mapBusinessImage(row) {
  if (!row) return null;
  return {
    id: row.media_asset_id ?? row.id ?? null,
    businessId: row.business_id ?? null,
    originalFilename: row.filename ?? row.original_filename ?? 'Image',
    deliveryUrl: row.delivery_url ?? row.url ?? row.public_url ?? null,
    mimeType: row.mime_type ?? null,
    provider: row.provider ?? null,
    providerFileId: row.provider_file_id ?? null,
    fileSize: Number(row.file_size ?? 0),
    createdAt: row.created_at ?? null,
  };
}

export async function listChannels(businessId) {
  const data = await rpc('communication_list_channels', {
    p_business_id: businessId,
  });
  return toArray(data, 'channels').map(mapChannel);
}

export async function getConnection(businessId, channel) {
  const data = await rpc('communication_get_connection', {
    p_business_id: businessId,
    p_channel: channel,
  });
  return mapConnection(unwrapRpc(data?.connection ? data.connection : data));
}

export async function connectWhatsApp({
  businessId,
  code,
  wabaId,
  phoneNumberId,
  businessPortfolioId,
  displayPhoneNumber,
  verifiedName,
}) {
  const data = await invokeFunction('whatsapp-connect', {
    businessId,
    code,
    wabaId,
    phoneNumberId,
    businessPortfolioId,
    displayPhoneNumber: displayPhoneNumber ?? null,
    verifiedName: verifiedName ?? null,
  });
  return mapConnection(unwrapRpc(data?.connection ? data.connection : data));
}

export async function disconnectChannel({ businessId, channel }) {
  const data = await rpc('communication_disconnect_channel', {
    p_business_id: businessId,
    p_channel: channel,
  });
  return Boolean(unwrapRpc(data));
}

export async function listAssignableUsers(businessId) {
  const data = await rpc('communication_list_assignable_users', {
    p_business_id: businessId,
  });
  return toArray(data, 'users').map(mapAssignableUser);
}

export async function listConversations(
  businessId,
  { status, search, limit, offset } = {},
) {
  const data = await rpc('communication_list_conversations', {
    p_business_id: businessId,
    p_status: status || null,
    p_search: String(search ?? '').trim() || null,
    p_limit: clampLimit(limit),
    p_offset: Math.max(0, Math.floor(Number(offset) || 0)),
  });
  return toArray(data, 'conversations').map(mapConversation);
}

export async function getConversation(conversationId) {
  const data = await rpc('communication_get_conversation', {
    p_conversation_id: conversationId,
  });
  return mapConversation(unwrapRpc(data?.conversation ? data.conversation : data));
}

export async function listMessages(conversationId, { before, limit } = {}) {
  const data = await rpc('communication_list_messages', {
    p_conversation_id: conversationId,
    p_before: before ?? null,
    p_limit: clampLimit(limit),
  });
  const messages = toArray(data, 'messages').map(mapMessage);
  return messages.sort(
    (left, right) =>
      new Date(left.createdAt ?? 0).getTime() -
      new Date(right.createdAt ?? 0).getTime(),
  );
}

export async function getSendContext(conversationId) {
  const data = await rpc('communication_get_send_context', {
    p_conversation_id: conversationId,
  });
  return mapSendContext(unwrapRpc(data?.context ? data.context : data));
}

export async function assignConversation(conversationId, assigneeId) {
  const data = await rpc('communication_assign_conversation', {
    p_conversation_id: conversationId,
    p_assignee_id: assigneeId || null,
  });
  return Boolean(unwrapRpc(data));
}

export async function setConversationStatus(conversationId, status) {
  const data = await rpc('communication_set_conversation_status', {
    p_conversation_id: conversationId,
    p_status: status,
  });
  return Boolean(unwrapRpc(data));
}

export async function markConversationRead(conversationId) {
  const data = await rpc('communication_mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  return Boolean(unwrapRpc(data));
}

export async function setOptOut(businessId, externalCustomerId, optedOut, reason) {
  const data = await rpc('communication_set_opt_out', {
    p_business_id: businessId,
    p_external_customer_id: externalCustomerId,
    p_opted_out: Boolean(optedOut),
    p_reason: String(reason ?? '').trim() || null,
  });
  return Boolean(unwrapRpc(data));
}

function newClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function createOutboundMessage(payload) {
  const data = await rpc('communication_create_outbound_message', {
    p_conversation_id: payload?.conversationId ?? null,
    p_message_type: payload?.messageType ?? 'text',
    p_text_content: payload?.text ?? null,
    p_media_asset_id: payload?.mediaAssetId ?? null,
    p_template_name: payload?.templateName ?? null,
    p_template_language: payload?.templateLanguage ?? null,
    p_client_request_id: payload?.clientRequestId ?? newClientRequestId(),
  });
  return mapMessage(unwrapRpc(data));
}

export async function sendMessage({
  businessId,
  conversationId,
  messageType,
  text,
  mediaAssetId,
  templateName,
  templateLanguage,
}) {
  const data = await invokeFunction('whatsapp-send', {
    businessId,
    conversationId,
    messageType: messageType ?? 'text',
    text: String(text ?? '').trim() || null,
    mediaAssetId: mediaAssetId ?? null,
    templateName: templateName ?? null,
    templateLanguage: templateLanguage ?? null,
  });
  return mapMessage(unwrapRpc(data?.message ? data.message : data));
}

export async function downloadMedia({ businessId, messageId }) {
  const data = await invokeFunction(
    'whatsapp-media',
    { businessId, messageId },
    { responseType: 'blob' },
  );

  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (ArrayBuffer.isView(data)) return new Blob([data]);
  if (Array.isArray(data?.data)) {
    return new Blob([new Uint8Array(data.data)], { type: data.contentType });
  }

  throw new CommunicationServiceError('The media file could not be downloaded.');
}

export async function listBusinessImages(businessId, limit = 60) {
  const data = await rpc('communication_list_business_images', {
    p_business_id: businessId,
    p_limit: clampLimit(limit),
  });
  return toArray(data, 'images').map(mapBusinessImage);
}
