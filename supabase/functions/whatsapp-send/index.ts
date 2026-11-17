import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_TEMPLATE_LANGUAGE = 'en_US';

class ApiError extends Error {
  constructor(message, status = 500, code = 'WHATSAPP_SEND_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class ProviderError extends ApiError {
  constructor(message, status, code, provider) {
    super(message, status, code);
    this.provider = provider;
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'WHATSAPP_SEND_ERROR';
  const message = error instanceof ApiError
    ? error.message
    : 'The WhatsApp message could not be sent. Try again.';

  if (!(error instanceof ApiError)) {
    console.error('whatsapp-send error', error?.name || 'unknown');
  }
  return jsonResponse({
    error: true,
    message,
    code,
    status,
    ...(error instanceof ProviderError ? { provider: error.provider } : {}),
  }, status);
}

function requiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(`${name} is not configured.`, 503, '503');
  return value;
}

function graphApiVersion() {
  return Deno.env.get('META_GRAPH_API_VERSION') || 'v25.0';
}

function graphUrl(path) {
  return `https://graph.facebook.com/${graphApiVersion()}${path}`;
}

function createUserClient(authorization) {
  const url = requiredEnv('SUPABASE_URL');
  const key = requiredEnv('SUPABASE_ANON_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

function createServiceRoleClient() {
  const url = requiredEnv('SUPABASE_URL');
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(client, authorization) {
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw new ApiError('Sign in again to send WhatsApp messages.', 401, '28000');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('Sign in again to send WhatsApp messages.', 401, '28000');
  }
  return data.user;
}

async function callRpc(client, name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    throw new ApiError(error.message || 'The WhatsApp request failed.', 400, error.code || '400');
  }
  return Array.isArray(data) ? data[0] : data;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError('The provider took too long to respond. Try again.', 504, '504');
    }
    throw new ApiError('The provider could not be reached. Try again.', 502, '502');
  } finally {
    clearTimeout(timer);
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!trimValue(body?.[field])) {
      throw new ApiError(`${field} is required.`, 400, '22023');
    }
  }
}

async function requireBusinessAccess(client, businessId) {
  const result = await callRpc(client, 'communication_can_manage_business', {
    p_business_id: businessId,
  });
  const allowed = typeof result === 'boolean'
    ? result
    : firstDefined(result?.allowed, result?.can_manage, result?.canManage);
  if (allowed !== true) {
    throw new ApiError('You cannot send WhatsApp messages for this business.', 403, '42501');
  }
}

function providerStatus(status) {
  if ([400, 401, 403, 429].includes(status)) return status;
  return 502;
}

async function providerFailure(response, fallbackMessage) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const detail = payload?.error || {};
  const message = typeof detail.message === 'string' && detail.message
    ? detail.message
    : fallbackMessage;
  const code = typeof detail.code === 'string' && detail.code
    ? detail.code
    : 'META_API_ERROR';
  return new ProviderError(message, providerStatus(response.status), code, {
    code,
    message,
  });
}

function missingProviderId(message) {
  return new ProviderError(message, 502, '502', {
    code: 'MISSING_PROVIDER_MESSAGE_ID',
    message,
  });
}

function messageMetadata(message, overrides = {}) {
  return {
    id: firstDefined(
      overrides.id,
      message?.id,
      message?.message_id,
      message?.messageId,
    ) ?? null,
    conversationId: firstDefined(
      overrides.conversationId,
      message?.conversation_id,
      message?.conversationId,
    ) ?? null,
    messageType: firstDefined(message?.message_type, message?.messageType) ?? null,
    text: firstDefined(message?.text_content, message?.text, message?.body) ?? null,
    mediaAssetId: firstDefined(message?.media_asset_id, message?.mediaAssetId) ?? null,
    templateName: firstDefined(message?.template_name, message?.templateName) ?? null,
    templateLanguage: firstDefined(message?.template_language, message?.templateLanguage) ?? null,
    status: firstDefined(overrides.status, message?.status) ?? 'sent',
    clientRequestId: firstDefined(
      message?.client_request_id,
      message?.clientRequestId,
      overrides.clientRequestId,
    ) ?? null,
    providerMessageId: firstDefined(
      overrides.providerMessageId,
      message?.provider_message_id,
      message?.providerMessageId,
    ) ?? null,
    duplicate: overrides.duplicate === true,
  };
}

function recipientFor(context, message) {
  return firstDefined(
    message?.to,
    message?.recipient,
    context?.to,
    context?.recipient,
    context?.customer_whatsapp_id,
    context?.customerWhatsappId,
    context?.recipient_wa_id,
    context?.recipientWaId,
    context?.wa_id,
    context?.waId,
    context?.customer_phone_number,
    context?.customerPhoneNumber,
    context?.customer_phone,
    context?.customerPhone,
    context?.recipient_phone_number,
    context?.recipientPhoneNumber,
    context?.conversation_phone_number,
    context?.conversationPhoneNumber,
    context?.phone_number,
    context?.phoneNumber,
  );
}

function mediaProviderFileId(context, message) {
  return firstDefined(
    message?.media_provider_file_id,
    message?.mediaProviderFileId,
    message?.provider_file_id,
    message?.providerFileId,
    message?.media?.provider_file_id,
    message?.media?.providerFileId,
    message?.media_asset?.provider_file_id,
    message?.mediaAsset?.providerFileId,
    context?.media_provider_file_id,
    context?.mediaProviderFileId,
    context?.provider_file_id,
    context?.providerFileId,
  );
}

function safeFilename(url, contentType) {
  let name = '';
  try {
    const pathname = new URL(url).pathname;
    name = decodeURIComponent(pathname.split('/').pop() || '');
  } catch {
    name = '';
  }
  name = name.replace(/[\r\n"\\]/g, '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name || name === '.' || name === '..') {
    const extension = contentType === 'image/png'
      ? '.png'
      : contentType === 'image/webp'
        ? '.webp'
        : contentType === 'image/avif'
          ? '.avif'
          : '.jpg';
    name = `whatsapp-image${extension}`;
  }
  return name.slice(0, 180);
}

async function markConnectionExpired(serviceClient, connectionId, reason) {
  try {
    await callRpc(serviceClient, 'communication_set_connection_health', {
      p_connection_id: connectionId,
      p_status: 'expired',
      p_error: reason,
    });
  } catch {
    console.error('whatsapp-send connection health update failed');
  }
}

async function failMessage(client, messageId, error) {
  const provider = error instanceof ProviderError
    ? error.provider
    : { code: error?.code || 'WHATSAPP_SEND_ERROR', message: error?.message || 'Message failed.' };
  try {
    await callRpc(client, 'communication_fail_outbound_message', {
      p_message_id: messageId,
      p_error_code: provider?.code ?? 'WHATSAPP_SEND_ERROR',
      p_error_message: provider?.message ?? 'Message failed.',
    });
  } catch {
    console.error('whatsapp-send message failure update failed');
  }
}

async function postMessages(phoneNumberId, accessToken, payload) {
  const response = await fetchWithTimeout(
    graphUrl(`/${encodeURIComponent(phoneNumberId)}/messages`),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    },
  );
  if (!response.ok) {
    throw await providerFailure(response, 'Meta rejected the WhatsApp message.');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  const providerMessageId = result?.messages?.[0]?.id;
  if (!providerMessageId) {
    throw missingProviderId('Meta accepted the request but did not return a message id.');
  }
  return { result, providerMessageId };
}

async function sendTextOrTemplate(body, context, message, phoneNumberId, accessToken) {
  const recipient = recipientFor(context, message);
  if (!recipient) {
    throw new ApiError('The conversation has no WhatsApp recipient.', 422, '22023');
  }

  const templateRequired = firstDefined(
    context?.template_required,
    context?.templateRequired,
    message?.template_required,
    message?.templateRequired,
  ) === true;
  const templateName = trimValue(body.templateName);
  const templateLanguage = trimValue(body.templateLanguage)
    || trimValue(context?.template_language)
    || DEFAULT_TEMPLATE_LANGUAGE;

  if (templateRequired) {
    if (!templateName) {
      throw new ApiError('A template name is required outside the messaging window.', 422, '22023');
    }
    return postMessages(phoneNumberId, accessToken, {
      to: recipient,
      type: 'template',
      template: { name: templateName, language: { code: templateLanguage } },
    });
  }

  const text = trimValue(body.text);
  if (!text) {
    throw new ApiError('text is required for a WhatsApp text message.', 400, '22023');
  }
  return postMessages(phoneNumberId, accessToken, {
    to: recipient,
    type: 'text',
    text: { body: text, preview_url: false },
  });
}

async function uploadWhatsappImage(accessToken, phoneNumberId, imageResponse, filename) {
  const bytes = await imageResponse.arrayBuffer();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image');
  form.append('file', new Blob([bytes], {
    type: imageResponse.headers.get('content-type') || 'image/jpeg',
  }), filename);

  const response = await fetchWithTimeout(
    graphUrl(`/${encodeURIComponent(phoneNumberId)}/media`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
  );
  if (!response.ok) {
    throw await providerFailure(response, 'Meta could not upload the WhatsApp image.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!payload?.id) {
    throw new ProviderError('Meta did not return a media id for the image.', 502, '502', {
      code: 'MISSING_MEDIA_ID',
      message: 'Meta did not return a media id for the image.',
    });
  }
  return payload.id;
}

async function sendImage(body, client, context, message, phoneNumberId, accessToken) {
  const providerFileId = mediaProviderFileId(context, message);
  if (!providerFileId) {
    throw new ApiError('The selected image is not available for WhatsApp.', 422, '22023');
  }

  const resolved = await callRpc(client, 'media_resolve_image_url', {
    p_storage_path: String(providerFileId),
    p_width: null,
  });
  const imageUrl = typeof resolved === 'string' ? resolved : resolved?.url;
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
    throw new ApiError('The selected image could not be resolved.', 422, '22023');
  }

  const imageResponse = await fetchWithTimeout(imageUrl, { method: 'GET' });
  if (!imageResponse.ok) {
    throw new ApiError('The selected image could not be loaded.', 422, '422');
  }
  const contentType = imageResponse.headers.get('content-type') || '';
  if (contentType && !contentType.startsWith('image/')) {
    throw new ApiError('The selected image is not a supported image file.', 422, '22023');
  }

  const mediaId = await uploadWhatsappImage(
    accessToken,
    phoneNumberId,
    imageResponse,
    safeFilename(imageUrl, contentType),
  );
  const recipient = recipientFor(context, message);
  if (!recipient) {
    throw new ApiError('The conversation has no WhatsApp recipient.', 422, '22023');
  }

  const caption = trimValue(body.text);
  const image = { id: mediaId, ...(caption ? { caption } : {}) };

  return postMessages(phoneNumberId, accessToken, {
    to: recipient,
    type: 'image',
    image,
  });
}

async function send(body, authorization) {
  if (!authorization) {
    throw new ApiError('Sign in again to send WhatsApp messages.', 401, '28000');
  }
  requireFields(body, ['businessId', 'conversationId', 'messageType']);
  if (!['text', 'image'].includes(body.messageType)) {
    throw new ApiError('messageType must be text or image.', 400, '22023');
  }

  const client = createUserClient(authorization);
  await authenticate(client, authorization);
  await requireBusinessAccess(client, body.businessId);

  const context = await callRpc(client, 'communication_get_send_context', {
    p_conversation_id: body.conversationId,
  });
  const contextBusinessId = firstDefined(context?.business_id, context?.businessId);
  if (contextBusinessId !== body.businessId) {
    throw new ApiError('The conversation belongs to another business.', 403, '42501');
  }

  const optedOut = firstDefined(context?.opted_out, context?.optedOut) === true;
  if (optedOut) {
    throw new ApiError('This contact has opted out of WhatsApp messages.', 403, '403');
  }

  const connectionId = firstDefined(context?.connection_id, context?.connectionId);
  const connected = firstDefined(
    context?.connected,
    context?.is_connected,
    context?.isConnected,
  );
  const connectionStatus = trimValue(
    firstDefined(context?.connection_status, context?.connectionStatus) || '',
  ).toLowerCase();
  if (connected === false || connectionStatus !== 'connected' || !connectionId) {
    throw new ApiError('Connect this business to WhatsApp before sending.', 409, '409');
  }

  const templateRequired = firstDefined(
    context?.template_required,
    context?.templateRequired,
  ) === true;
  const templateName = trimValue(body.templateName);
  if (templateRequired && !templateName) {
    throw new ApiError('A template name is required outside the messaging window.', 422, '22023');
  }

  const clientRequestId = trimValue(body.clientRequestId) || crypto.randomUUID();
  const created = await callRpc(client, 'communication_create_outbound_message', {
    p_conversation_id: body.conversationId,
    p_message_type: body.messageType,
    p_text_content: trimValue(body.text) || null,
    p_media_asset_id: body.mediaAssetId || null,
    p_template_name: templateName || null,
    p_template_language: trimValue(body.templateLanguage) || null,
    p_client_request_id: clientRequestId,
  });

  const isDuplicate = firstDefined(created?.is_duplicate, created?.isDuplicate) === true;
  const message = created?.message ?? created ?? {};
  const messageId = firstDefined(message?.id, message?.message_id, message?.messageId);
  if (isDuplicate) {
    return jsonResponse({
      message: messageMetadata(message, { clientRequestId, duplicate: true }),
    });
  }
  if (!messageId) {
    throw new ApiError('The outbound message could not be created.', 500, '500');
  }

  const serviceClient = createServiceRoleClient();
  const channel = await callRpc(serviceClient, 'communication_get_channel_token', {
    p_connection_id: connectionId,
  });
  const accessToken = firstDefined(
    channel?.access_token,
    channel?.accessToken,
    channel?.token,
  );
  const phoneNumberId = firstDefined(
    channel?.phone_number_id,
    channel?.phoneNumberId,
  );

  if (!accessToken) {
    await markConnectionExpired(
      serviceClient,
      connectionId,
      'WhatsApp access token is missing or expired.',
    );
    throw new ApiError('The WhatsApp connection has expired. Reconnect before sending.', 401, '401');
  }
  if (!phoneNumberId) {
    throw new ApiError('The WhatsApp phone number is not configured for this business.', 409, '409');
  }

  let providerResult;
  try {
    providerResult = body.messageType === 'image'
      ? await sendImage(body, client, context, message, phoneNumberId, accessToken)
      : await sendTextOrTemplate(body, context, message, phoneNumberId, accessToken);
  } catch (error) {
    if ([401, 403].includes(error?.status)) {
      await markConnectionExpired(
        serviceClient,
        connectionId,
        'Meta rejected the WhatsApp access token.',
      );
    }
    await failMessage(client, messageId, error);
    throw error;
  }

  const providerMessageId = providerResult.providerMessageId
    ?? providerResult.result?.messages?.[0]?.id;
  if (!providerMessageId) {
    const error = missingProviderId('Meta accepted the request but did not return a message id.');
    await failMessage(client, messageId, error);
    throw error;
  }

  await callRpc(client, 'communication_finalize_outbound_message', {
    p_message_id: messageId,
    p_provider_message_id: providerMessageId,
    p_status: 'sent',
  });

  return jsonResponse({
    message: messageMetadata(message, {
      clientRequestId,
      providerMessageId,
      status: 'sent',
    }),
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return errorResponse(new ApiError('Method not allowed.', 405, '405'));
  }

  try {
    const authorization = request.headers.get('Authorization');
    let body = null;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Provide a valid JSON request body.', 400, '22023');
    }
    return await send(body, authorization);
  } catch (error) {
    return errorResponse(error);
  }
});
