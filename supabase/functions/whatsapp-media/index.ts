import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class ApiError extends Error {
  constructor(message, status = 500, code = 'WHATSAPP_MEDIA_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
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
  const code = error instanceof ApiError ? error.code : 'WHATSAPP_MEDIA_ERROR';
  const message = error instanceof ApiError
    ? error.message
    : 'The WhatsApp media could not be loaded. Try again.';

  if (!(error instanceof ApiError)) {
    console.error('whatsapp-media error', error?.name || 'unknown');
  }
  return jsonResponse({ error: true, message, code, status }, status);
}

function requiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(`${name} is not configured.`, 503, '503');
  return value;
}

function graphApiVersion() {
  return Deno.env.get('META_GRAPH_API_VERSION') || 'v25.0';
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
  if (!token) throw new ApiError('Sign in again to load WhatsApp media.', 401, '28000');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('Sign in again to load WhatsApp media.', 401, '28000');
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
    throw new ApiError('You cannot load WhatsApp media for this business.', 403, '42501');
  }
}

function validateMedia(media, businessId) {
  if (!media) {
    throw new ApiError('The WhatsApp media was not found.', 404, '404');
  }

  const mediaBusinessId = firstDefined(media.business_id, media.businessId);
  if (mediaBusinessId !== businessId) {
    throw new ApiError('The WhatsApp media was not found.', 404, '404');
  }

  const status = trimValue(firstDefined(media.status, media.media_status, media.mediaStatus)).toLowerCase();
  if (['expired', 'gone'].includes(status)) {
    throw new ApiError('This WhatsApp media has expired.', 410, '410');
  }
  if (['unavailable', 'deleted', 'missing', 'removed'].includes(status)) {
    throw new ApiError('This WhatsApp media is no longer available.', 404, '404');
  }
  if (status && ![
    'available',
    'ready',
    'active',
    'stored',
    'current',
    'downloaded',
    'complete',
    'received',
  ].includes(status)) {
    throw new ApiError('This WhatsApp media is no longer available.', 410, '410');
  }

  const mediaProviderId = firstDefined(
    media.media_provider_id,
    media.mediaProviderId,
    media.provider_media_id,
    media.providerMediaId,
    media.media_id,
    media.mediaId,
  );
  if (!mediaProviderId) {
    throw new ApiError('This WhatsApp media is no longer available.', 404, '404');
  }

  return {
    mediaProviderId: String(mediaProviderId),
    connectionId: firstDefined(media.connection_id, media.connectionId) ?? null,
    mimeType: trimValue(firstDefined(
      media.mime_type,
      media.mimeType,
      media.content_type,
      media.contentType,
    )),
    filename: trimValue(firstDefined(
      media.file_name,
      media.fileName,
      media.filename,
      media.name,
    )),
  };
}

function safeFilename(filename, mimeType) {
  let name = filename.replace(/[\r\n"\\]/g, '').trim();
  name = name.split(/[\\/]/).pop() || '';
  name = name.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name || name === '.' || name === '..') {
    const extension = mimeType === 'image/png'
      ? '.png'
      : mimeType === 'image/jpeg'
        ? '.jpg'
        : mimeType === 'image/webp'
          ? '.webp'
          : mimeType === 'image/avif'
            ? '.avif'
            : mimeType === 'application/pdf'
              ? '.pdf'
              : mimeType === 'video/mp4'
                ? '.mp4'
                : mimeType === 'audio/ogg'
                  ? '.ogg'
                  : '';
    name = `whatsapp-media${extension}`;
  }
  return name.slice(0, 180);
}

async function loadMedia(body, authorization) {
  if (!authorization) {
    throw new ApiError('Sign in again to load WhatsApp media.', 401, '28000');
  }
  requireFields(body, ['businessId', 'messageId']);

  const client = createUserClient(authorization);
  await authenticate(client, authorization);
  await requireBusinessAccess(client, body.businessId);

  const media = await callRpc(client, 'communication_get_inbound_media', {
    p_message_id: body.messageId,
  });
  const details = validateMedia(media, body.businessId);

  if (!details.connectionId) {
    throw new ApiError('This WhatsApp media is no longer available.', 404, '404');
  }

  const serviceClient = createServiceRoleClient();
  const channel = await callRpc(serviceClient, 'communication_get_channel_token', {
    p_connection_id: details.connectionId,
  });
  const accessToken = firstDefined(
    channel?.access_token,
    channel?.accessToken,
    channel?.token,
  );
  if (!accessToken) {
    throw new ApiError('The WhatsApp connection has expired. Reconnect before loading media.', 401, '401');
  }

  const url = `https://graph.facebook.com/${graphApiVersion()}/${encodeURIComponent(details.mediaProviderId)}`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404 || response.status === 410) {
    throw new ApiError('This WhatsApp media has expired or is no longer available.', 410, '410');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError('The WhatsApp connection has expired. Reconnect before loading media.', 401, '401');
  }
  if (!response.ok) {
    throw new ApiError('Meta could not load the WhatsApp media.', 502, '502');
  }

  const contentType = response.headers.get('content-type') || details.mimeType || 'application/octet-stream';
  const filename = safeFilename(details.filename, contentType);
  const bytes = await response.arrayBuffer();

  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
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
    return await loadMedia(body, authorization);
  } catch (error) {
    return errorResponse(error);
  }
});
