import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class ApiError extends Error {
  constructor(message, status = 500, code = 'MEDIA_ERROR') {
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
  const code = error instanceof ApiError ? error.code : 'MEDIA_ERROR';
  const message = error instanceof ApiError
    ? error.message
    : 'The media service could not complete the request.';

  if (!(error instanceof ApiError)) console.error('media-manager error', error);
  return jsonResponse({ error: true, message, code, status }, status);
}

function requiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError(`${name} is not configured.`, 503, '503');
  return value;
}

function createUserClient(authorization) {
  const url = requiredEnv('SUPABASE_URL');
  const key = requiredEnv('SUPABASE_ANON_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

async function authenticate(client, authorization) {
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('Sign in again to manage media.', 401, '28000');
  }
  return data.user;
}

async function callRpc(client, name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error) {
    throw new ApiError(error.message || 'The media request failed.', 400, error.code || '400');
  }
  return Array.isArray(data) ? data[0] : data;
}

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signCloudinaryParams(params, secret) {
  const serialized = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return sha1Hex(`${serialized}${secret}`);
}

function cloudinarySecrets() {
  return {
    cloudName: requiredEnv('CLOUDINARY_CLOUD_NAME'),
    apiKey: requiredEnv('CLOUDINARY_API_KEY'),
    apiSecret: requiredEnv('CLOUDINARY_API_SECRET'),
  };
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError('The image provider timed out. Try again.', 504, '504');
    }
    throw new ApiError('The image service could not be reached. Check your connection and try again.', 502, '502');
  } finally {
    clearTimeout(timer);
  }
}

async function getMediaAuthorization(client, mediaAssetId) {
  if (!mediaAssetId) throw new ApiError('The media asset is missing.', 400, '22023');
  const authorization = await callRpc(client, 'media_get_upload_authorization', {
    p_media_asset_id: mediaAssetId,
  });

  if (!authorization || authorization.provider !== 'cloudinary') {
    throw new ApiError('This image does not use Cloudinary.', 409, '22023');
  }
  if (authorization.currentProvider !== 'cloudinary') {
    throw new ApiError('The media provider changed. Refresh and try again.', 409, '22023');
  }
  if (authorization.status !== 'pending') {
    throw new ApiError('This media upload is no longer pending.', 409, '22023');
  }

  return authorization;
}

async function destroyCloudinaryAsset(authorization, secrets) {
  const params = {
    public_id: authorization.providerFileId,
    timestamp: Math.floor(Date.now() / 1000),
    invalidate: 'true',
  };
  const signature = await signCloudinaryParams(params, secrets.apiSecret);
  const form = new FormData();
  form.append('api_key', secrets.apiKey);
  form.append('signature', signature);
  for (const [key, value] of Object.entries(params)) form.append(key, String(value));

  const response = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${secrets.cloudName}/image/destroy`,
    { method: 'POST', body: form },
  );

  if (!response.ok) {
    throw new ApiError('Cloudinary could not delete the image.', 502, '502');
  }

  const result = await response.json();
  if (!['ok', 'not found'].includes(result?.result)) {
    throw new ApiError('Cloudinary could not delete the image.', 502, '502');
  }
  return result;
}

async function signUpload(client, body) {
  const authorization = await getMediaAuthorization(client, body.mediaAssetId);
  const secrets = cloudinarySecrets();
  const configuredCloud = authorization.cloudName || authorization.metadata?.cloud_name;

  if (configuredCloud && configuredCloud !== secrets.cloudName) {
    throw new ApiError('The Cloudinary configuration changed. Refresh and try again.', 409, '22023');
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(authorization.mimeType)) {
    throw new ApiError('Use a JPEG, PNG, WebP or AVIF image.', 400, '22023');
  }
  if (Number(authorization.fileSize) > Number(authorization.maxFileBytes)) {
    throw new ApiError('The image is larger than the configured upload limit.', 400, '22023');
  }

  const params = {
    public_id: authorization.providerFileId,
    timestamp: Math.floor(Date.now() / 1000),
    overwrite: 'false',
    invalidate: 'true',
  };
  const signature = await signCloudinaryParams(params, secrets.apiSecret);

  return jsonResponse({
    uploadUrl: `https://api.cloudinary.com/v1_1/${secrets.cloudName}/image/upload`,
    fields: {
      api_key: secrets.apiKey,
      signature,
      ...params,
    },
    timeoutMs: 30000,
  });
}

async function completeUpload(client, body) {
  const authorization = await getMediaAuthorization(client, body.mediaAssetId);
  const secrets = cloudinarySecrets();

  const resourceUrl = new URL(
    `https://api.cloudinary.com/v1_1/${secrets.cloudName}/image/resource`,
  );
  resourceUrl.searchParams.set('public_id', authorization.providerFileId);

  const resourceResponse = await fetchWithTimeout(resourceUrl.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${secrets.apiKey}:${secrets.apiSecret}`)}`,
    },
  });

  if (!resourceResponse.ok) {
    throw new ApiError('Cloudinary could not verify the upload.', 502, '502');
  }

  const resource = await resourceResponse.json();
  if (!resource?.secure_url || !String(resource.secure_url).startsWith('https://res.cloudinary.com/')) {
    throw new ApiError('Cloudinary did not return a valid image URL.', 502, '502');
  }
  if (Number(resource.bytes || 0) > Number(authorization.maxFileBytes)) {
    throw new ApiError('The uploaded image is larger than the configured upload limit.', 400, '22023');
  }

  const asset = await callRpc(client, 'media_complete_upload', {
    p_media_asset_id: body.mediaAssetId,
    p_provider_file_id: authorization.providerFileId,
    p_delivery_url: resource.secure_url,
    p_bytes: Number(resource.bytes || authorization.fileSize),
    p_width: Number(resource.width || 0) || null,
    p_height: Number(resource.height || 0) || null,
    p_metadata: {
      format: resource.format ?? null,
      cloudinaryVersion: resource.version ?? null,
    },
  });

  return jsonResponse({ asset });
}

async function deleteAsset(client, body) {
  const authorization = await callRpc(client, 'media_get_upload_authorization', {
    p_media_asset_id: body.mediaAssetId,
  });

  if (!authorization || authorization.provider !== 'cloudinary') {
    throw new ApiError('This image does not use Cloudinary.', 409, '22023');
  }

  const secrets = cloudinarySecrets();
  await destroyCloudinaryAsset(authorization, secrets);

  const asset = await callRpc(client, 'media_mark_deleted', {
    p_media_asset_id: body.mediaAssetId,
  });
  return jsonResponse({ asset });
}

async function cleanupAbandoned(client, body) {
  const seconds = Math.max(3600, Number(body.olderThanSeconds) || 86400);
  const abandoned = await client.rpc('media_list_abandoned', {
    p_older_than: `${Math.floor(seconds)} seconds`,
  });

  if (abandoned.error) {
    throw new ApiError(abandoned.error.message || 'Abandoned media cleanup failed.', 400, abandoned.error.code || '400');
  }

  let cleaned = 0;
  let failed = 0;

  for (const asset of abandoned.data ?? []) {
    try {
      if (asset.provider === 'cloudinary') {
        const secrets = cloudinarySecrets();
        await destroyCloudinaryAsset({ providerFileId: asset.provider_file_id }, secrets);
      } else if (asset.bucket && asset.provider_file_id) {
        const { error } = await client.storage
          .from(asset.bucket)
          .remove([asset.provider_file_id]);
        if (error) throw error;
      }

      await callRpc(client, 'media_fail_upload', {
        p_media_asset_id: asset.id,
        p_error_message: 'Cleaned up abandoned upload.',
      });
      await callRpc(client, 'media_mark_deleted', {
        p_media_asset_id: asset.id,
      });
      cleaned += 1;
    } catch {
      failed += 1;
    }
  }

  return jsonResponse({ cleaned, failed });
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
    if (!authorization) {
      throw new ApiError('Sign in again to manage media.', 401, '28000');
    }

    const body = await request.json();
    const client = createUserClient(authorization);
    await authenticate(client, authorization);

    switch (body?.action) {
      case 'cloudinary-sign':
        return await signUpload(client, body);
      case 'cloudinary-complete':
        return await completeUpload(client, body);
      case 'cloudinary-delete':
        return await deleteAsset(client, body);
      case 'cleanup-abandoned':
        return await cleanupAbandoned(client, body);
      default:
        throw new ApiError('Unknown media action.', 400, '22023');
    }
  } catch (error) {
    return errorResponse(error);
  }
});
