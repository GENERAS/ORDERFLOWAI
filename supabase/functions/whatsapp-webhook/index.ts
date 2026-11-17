import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { verifyMetaSignature } from './signature.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class ApiError extends Error {
  constructor(message, status = 500, code = 'WHATSAPP_WEBHOOK_ERROR') {
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
  const code = error instanceof ApiError ? error.code : 'WHATSAPP_WEBHOOK_ERROR';
  const message = error instanceof ApiError
    ? error.message
    : 'The webhook could not be processed.';

  if (!(error instanceof ApiError)) {
    console.error('whatsapp-webhook error', error?.name || 'unknown');
  }
  return jsonResponse({ error: true, message, code, status }, status);
}

function requiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(`${name} is not configured.`, 503, '503');
  return value;
}

function createServiceRoleClient() {
  const url = requiredEnv('SUPABASE_URL');
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function callRpc(client, name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    throw new ApiError(error.message || 'The webhook could not be ingested.', 500, error.code || '500');
  }
  return Array.isArray(data) ? data[0] : data;
}

function verifyRequest(request) {
  const mode = request.searchParams.get('hub.mode');
  const token = request.searchParams.get('hub.verify_token');
  const challenge = request.searchParams.get('hub.challenge');
  const expected = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');

  if (mode !== 'subscribe' || !expected || token !== expected || challenge === null) {
    throw new ApiError('Webhook verification failed.', 403, '403');
  }
  return new Response(challenge, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function processWebhook(request) {
  const appSecret = requiredEnv('META_APP_SECRET');
  const signature = request.headers.get('X-Hub-Signature-256');
  if (!signature) {
    throw new ApiError('A valid webhook signature is required.', 401, '401');
  }

  const rawBody = await request.text();
  const isValid = await verifyMetaSignature(appSecret, rawBody, signature);
  if (!isValid) {
    throw new ApiError('A valid webhook signature is required.', 401, '401');
  }

  let payload = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ApiError('Provide a valid JSON request body.', 400, '22023');
  }
  if (payload?.object !== 'whatsapp_business_account') {
    throw new ApiError('Unexpected webhook payload.', 400, '22023');
  }

  const client = createServiceRoleClient();
  const result = await callRpc(client, 'communication_process_whatsapp_webhook', {
    p_payload: payload,
  });
  const resultFields = result && typeof result === 'object' && !Array.isArray(result)
    ? result
    : result === undefined
      ? {}
      : { result };

  return jsonResponse({ ...resultFields, ok: true });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    if (request.method === 'GET') {
      return verifyRequest(new URL(request.url));
    }
    if (request.method !== 'POST') {
      return errorResponse(new ApiError('Method not allowed.', 405, '405'));
    }
    return await processWebhook(request);
  } catch (error) {
    return errorResponse(error);
  }
});
