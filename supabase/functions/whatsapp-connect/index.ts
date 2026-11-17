import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REQUIRED_SCOPES = ['whatsapp_business_messaging', 'whatsapp_business_management'];
const CODE_EXCHANGE_TIMEOUT_MS = 30000;

class ApiError extends Error {
  constructor(message, status = 500, code = 'WHATSAPP_CONNECT_ERROR') {
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
  const code = error instanceof ApiError ? error.code : 'WHATSAPP_CONNECT_ERROR';
  const message = error instanceof ApiError
    ? error.message
    : 'WhatsApp could not be connected. Try again.';

  if (!(error instanceof ApiError)) {
    console.error('whatsapp-connect error', error?.name || 'unknown');
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
  if (!token) throw new ApiError('Sign in again to connect WhatsApp.', 401, '28000');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('Sign in again to connect WhatsApp.', 401, '28000');
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

async function fetchWithTimeout(
  url,
  init = {},
  timeoutMs = 20000,
  timeoutMessage = 'The provider took too long to respond.',
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError(timeoutMessage, 504, '504');
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

async function providerDetail(response, fallbackMessage) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const detail = payload?.error || {};
  return {
    message: typeof detail.message === 'string' && detail.message
      ? detail.message
      : fallbackMessage,
    code: typeof detail.code === 'string' && detail.code
      ? detail.code
      : 'META_API_ERROR',
  };
}

function providerStatus(status) {
  if ([400, 401, 403, 429].includes(status)) return status;
  return 502;
}

async function assertProviderSuccess(response, fallbackMessage) {
  if (response.ok) return;
  const detail = await providerDetail(response, fallbackMessage);
  throw new ApiError(detail.message, providerStatus(response.status), detail.code);
}

async function requireBusinessAccess(client, businessId) {
  const result = await callRpc(client, 'communication_can_manage_business', {
    p_business_id: businessId,
  });
  const allowed = typeof result === 'boolean'
    ? result
    : firstDefined(result?.allowed, result?.can_manage, result?.canManage);
  if (allowed !== true) {
    throw new ApiError('You cannot manage WhatsApp for this business.', 403, '42501');
  }
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!body || typeof body[field] !== 'string' || !body[field].trim()) {
      throw new ApiError(`${field} is required.`, 400, '22023');
    }
  }
}

async function exchangeAuthorizationCode(code, appId, appSecret) {
  const url = new URL(graphUrl('/oauth/access_token'));
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);

  const response = await fetchWithTimeout(
    url.toString(),
    { method: 'GET' },
    CODE_EXCHANGE_TIMEOUT_MS,
    'The authorization code expired before WhatsApp could be connected. Start the connection again.',
  );
  await assertProviderSuccess(response, 'Meta rejected the authorization code. Start the connection again.');

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!payload?.access_token) {
    throw new ApiError('Meta did not return an access token. Start the connection again.', 502, '502');
  }
  return payload.access_token;
}

async function inspectToken(accessToken, appId, appSecret) {
  const url = new URL(graphUrl('/debug_token'));
  url.searchParams.set('input_token', accessToken);
  url.searchParams.set('access_token', `${appId}|${appSecret}`);

  const response = await fetchWithTimeout(url.toString(), { method: 'GET' });
  if (!response.ok) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return payload?.data ?? null;
}

function collectScopes(debugToken) {
  const scopes = [];
  for (const value of [
    debugToken?.scopes,
    debugToken?.granted_scopes,
    debugToken?.grantedScopes,
  ]) {
    if (typeof value === 'string') scopes.push(...value.split(',').map((scope) => scope.trim()));
    if (Array.isArray(value)) scopes.push(...value.filter((scope) => typeof scope === 'string'));
  }
  const granular = debugToken?.granular_scopes ?? debugToken?.granularScopes;
  if (Array.isArray(granular)) {
    scopes.push(...granular.map((entry) => entry?.scope).filter((scope) => typeof scope === 'string'));
  }
  return scopes;
}

function deriveWabaId(debugToken) {
  const granular = debugToken?.granular_scopes ?? debugToken?.granularScopes;
  if (!Array.isArray(granular)) return null;

  for (const scope of REQUIRED_SCOPES) {
    const entry = granular.find((item) => item?.scope === scope);
    const target = firstDefined(
      entry?.target_ids?.[0],
      entry?.targetIds?.[0],
      entry?.target_id,
      entry?.targetId,
    );
    if (target) return String(target);
  }
  return null;
}

function toIsoExpiry(debugToken) {
  const seconds = Number(debugToken?.expires_at ?? debugToken?.expiresAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

async function fetchPhoneDetails(phoneNumberId, accessToken) {
  const url = new URL(graphUrl(`/${encodeURIComponent(phoneNumberId)}`));
  url.searchParams.set('fields', 'verified_name,display_phone_number,phone_number');

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await assertProviderSuccess(response, 'Meta could not load the WhatsApp phone number.');

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return payload ?? {};
}

async function registerPhone(phoneNumberId, accessToken) {
  const response = await fetchWithTimeout(
    graphUrl(`/${encodeURIComponent(phoneNumberId)}/register`),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp' }),
    },
  );
  await assertProviderSuccess(response, 'Meta could not register the WhatsApp phone number.');
}

async function subscribeApp(wabaId, accessToken) {
  const response = await fetchWithTimeout(
    graphUrl(`/${encodeURIComponent(wabaId)}/subscribed_apps`),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  await assertProviderSuccess(response, 'Meta could not subscribe the app to the WhatsApp business account.');
}

async function connect(body, authorization) {
  if (!authorization) {
    throw new ApiError('Sign in again to connect WhatsApp.', 401, '28000');
  }
  requireFields(body, ['businessId', 'code', 'phoneNumberId']);

  const startedAt = Date.now();
  const appId = requiredEnv('META_APP_ID');
  const appSecret = requiredEnv('META_APP_SECRET');
  const client = createUserClient(authorization);
  const user = await authenticate(client, authorization);
  await requireBusinessAccess(client, body.businessId);

  const accessToken = await exchangeAuthorizationCode(body.code, appId, appSecret);
  if (Date.now() - startedAt >= CODE_EXCHANGE_TIMEOUT_MS) {
    throw new ApiError(
      'The authorization code expired before WhatsApp could be connected. Start the connection again.',
      400,
      'WHATSAPP_CODE_EXPIRED',
    );
  }

  const debugToken = await inspectToken(accessToken, appId, appSecret);
  if (debugToken?.is_valid === false) {
    throw new ApiError('Meta rejected the WhatsApp access token. Connect again.', 401, '401');
  }

  const scopes = collectScopes(debugToken);
  if (scopes.length > 0) {
    const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      throw new ApiError(
        'Grant both WhatsApp messaging and management permissions to connect this account.',
        403,
        '403',
      );
    }
  }

  const wabaId = trimValue(body.wabaId) || deriveWabaId(debugToken);
  if (!wabaId) {
    throw new ApiError(
      'The WhatsApp business account could not be determined. Provide wabaId or grant management access.',
      422,
      '22023',
    );
  }

  const phoneDetails = await fetchPhoneDetails(body.phoneNumberId, accessToken);
  await registerPhone(body.phoneNumberId, accessToken);
  await subscribeApp(wabaId, accessToken);

  const displayPhoneNumber = firstDefined(
    trimValue(body.displayPhoneNumber),
    phoneDetails.display_phone_number,
  );
  const verifiedName = firstDefined(trimValue(body.verifiedName), phoneDetails.verified_name);
  const tokenExpiresAt = toIsoExpiry(debugToken);

  const serviceClient = createServiceRoleClient();
  const connection = await callRpc(serviceClient, 'communication_upsert_whatsapp_connection', {
    p_business_id: body.businessId,
    p_phone_number_id: body.phoneNumberId,
    p_waba_id: wabaId,
    p_business_portfolio_id: trimValue(body.businessPortfolioId) || null,
    p_display_phone_number: displayPhoneNumber || null,
    p_verified_name: verifiedName || null,
    p_access_token: accessToken,
    p_token_expires_at: tokenExpiresAt,
    p_scopes: scopes,
    p_connected_by: user.id,
  });

  const connectionMetadata = {
    id: connection?.connection_id ?? null,
    connection_id: connection?.connection_id ?? null,
    business_id: body.businessId,
    businessId: body.businessId,
    channel: 'whatsapp',
    status: connection?.status ?? 'connected',
    is_connected: true,
    isConnected: true,
    external_account_id: connection?.external_account_id ?? wabaId,
    waba_id: connection?.external_account_id ?? wabaId,
    wabaId: connection?.external_account_id ?? wabaId,
    external_phone_number_id: body.phoneNumberId,
    phone_number_id: body.phoneNumberId,
    phoneNumberId: body.phoneNumberId,
    business_portfolio_id: connection?.business_portfolio_id
      || trimValue(body.businessPortfolioId)
      || null,
    businessPortfolioId: connection?.business_portfolio_id
      || trimValue(body.businessPortfolioId)
      || null,
    display_phone_number: connection?.display_phone_number ?? displayPhoneNumber ?? null,
    displayPhoneNumber: connection?.display_phone_number ?? displayPhoneNumber ?? null,
    verified_name: connection?.verified_name ?? verifiedName ?? null,
    verifiedName: connection?.verified_name ?? verifiedName ?? null,
    phoneNumber: phoneDetails.phone_number ?? null,
    token_expires_at: connection?.token_expires_at ?? tokenExpiresAt,
    tokenExpiresAt: connection?.token_expires_at ?? tokenExpiresAt,
    connected_at: connection?.connected_at ?? null,
    connectedAt: connection?.connected_at ?? null,
    created_at: connection?.created_at ?? null,
    createdAt: connection?.created_at ?? null,
    updated_at: connection?.updated_at ?? null,
    updatedAt: connection?.updated_at ?? null,
  };

  return jsonResponse({ connection: connectionMetadata });
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
    return await connect(body, authorization);
  } catch (error) {
    return errorResponse(error);
  }
});
