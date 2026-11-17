import { getSupabaseClient } from '../lib/supabase/client';
import { cloudinaryAdapter } from './media/cloudinaryAdapter';
import { MediaStorageError, formatMediaBytes, toMediaStorageError } from './media/mediaErrors';
import { supabaseStorageAdapter } from './media/supabaseStorageAdapter';

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider,
    providerFileId: row.provider_file_id,
    bucket: row.bucket ?? null,
    assetCategory: row.asset_category,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    deliveryUrl: row.delivery_url ?? null,
    status: row.status,
    error: row.error_message ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

function getAdapter(provider) {
  if (provider === 'cloudinary') return cloudinaryAdapter;
  if (provider === 'supabase') return supabaseStorageAdapter;
  throw new MediaStorageError('The selected media provider is not supported.');
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toMediaStorageError(error);
  }
}

export async function getProviderConfig() {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('media_get_provider_config');
  if (error) throw toMediaStorageError(error);

  const row = unwrapRpc(data);
  if (!row) throw new MediaStorageError('Media provider configuration is unavailable.');

  return {
    provider: row.provider,
    cloudName: row.cloud_name ?? null,
    maxFileBytes: Number(row.max_file_bytes ?? 0),
    allowedMimeTypes: Array.isArray(row.allowed_mime_types) ? row.allowed_mime_types : [],
  };
}

function validateFile(file, config) {
  if (!file) throw new MediaStorageError('Choose an image to upload.');
  if (!config.allowedMimeTypes.includes(file.type)) {
    throw new MediaStorageError('Use a JPEG, PNG, WebP or AVIF image.');
  }
  if (file.size <= 0 || file.size > config.maxFileBytes) {
    throw new MediaStorageError(`Images must be ${formatMediaBytes(config.maxFileBytes)} or smaller.`);
  }
}

async function startUpload({ businessId, productId, category, file, clientRequestId }) {
  const config = await getProviderConfig();
  validateFile(file, config);

  const supabase = getClient();
  const { data, error } = await supabase.rpc('media_start_upload', {
    p_business_id: businessId,
    p_client_request_id: clientRequestId,
    p_provider: config.provider,
    p_asset_category: category,
    p_original_filename: file.name || 'image',
    p_mime_type: file.type,
    p_file_size: file.size,
    p_product_id: productId || null,
  });

  if (error) throw toMediaStorageError(error);
  return mapAsset(unwrapRpc(data));
}

async function failUpload(asset, error) {
  if (!asset?.id) return;
  const supabase = getClient();
  await supabase.rpc('media_fail_upload', {
    p_media_asset_id: asset.id,
    p_error_message: error instanceof Error ? error.message : String(error),
  });
}

export async function uploadImage({
  businessId,
  productId = null,
  category,
  file,
  clientRequestId = newRequestId(),
  onProgress,
}) {
  if (!businessId) throw new MediaStorageError('Select a workspace first.');

  const asset = await startUpload({
    businessId,
    productId,
    category,
    file,
    clientRequestId,
  });

  if (!asset) throw new MediaStorageError('The media upload could not be started.');
  if (asset.status === 'ready') return asset;

  try {
    const adapter = getAdapter(asset.provider);
    await adapter.uploadImage({ asset, file, onProgress });

    const supabase = getClient();
    const { data, error } = await supabase.rpc('media_complete_upload', {
      p_media_asset_id: asset.id,
      p_provider_file_id: asset.providerFileId,
      p_delivery_url: null,
      p_bytes: file.size,
      p_width: null,
      p_height: null,
      p_metadata: {},
    });

    if (error) throw toMediaStorageError(error);
    return mapAsset(unwrapRpc(data)) ?? asset;
  } catch (error) {
    await failUpload(asset, error);
    throw toMediaStorageError(error);
  }
}

export async function getAssetById(mediaAssetId) {
  if (!mediaAssetId) return null;
  const supabase = getClient();
  const { data, error } = await supabase
    .from('media_assets')
    .select('*')
    .eq('id', mediaAssetId)
    .maybeSingle();

  if (error) throw toMediaStorageError(error);
  return mapAsset(data);
}

async function resolveAsset(assetOrId) {
  if (typeof assetOrId === 'string') return getAssetById(assetOrId);
  return assetOrId ?? null;
}

export async function getImageUrl(assetOrId, options = {}) {
  const asset = await resolveAsset(assetOrId);
  if (!asset) return null;
  return getAdapter(asset.provider).getImageUrl(asset, options);
}

export async function getMetadata(assetOrId) {
  const asset = await resolveAsset(assetOrId);
  if (!asset) return {};
  return getAdapter(asset.provider).getMetadata(asset);
}

async function isAssetInUse(asset) {
  const supabase = getClient();
  const [productResult, storeResult] = await Promise.all([
    supabase.from('product_images').select('id').eq('media_asset_id', asset.id).limit(1),
    supabase.from('stores').select('id').eq('logo_media_asset_id', asset.id).limit(1),
  ]);

  if (productResult.error) throw toMediaStorageError(productResult.error);
  if (storeResult.error) throw toMediaStorageError(storeResult.error);
  return (productResult.data?.length ?? 0) > 0 || (storeResult.data?.length ?? 0) > 0;
}

export async function deleteImage(assetOrId) {
  const asset = await resolveAsset(assetOrId);
  if (!asset || asset.status === 'deleted') return asset ?? null;

  if (await isAssetInUse(asset)) {
    throw new MediaStorageError('This image is still in use and cannot be deleted.');
  }

  const adapter = getAdapter(asset.provider);
  if (asset.provider === 'cloudinary') {
    return adapter.deleteImage(asset);
  }

  await adapter.deleteImage(asset);
  const supabase = getClient();
  const { data, error } = await supabase.rpc('media_mark_deleted', {
    p_media_asset_id: asset.id,
  });
  if (error) throw toMediaStorageError(error);
  return mapAsset(unwrapRpc(data)) ?? asset;
}

export async function markImageDeleted(assetOrId) {
  const asset = await resolveAsset(assetOrId);
  if (!asset || asset.status === 'deleted') return asset ?? null;

  const supabase = getClient();
  const { data, error } = await supabase.rpc('media_mark_deleted', {
    p_media_asset_id: asset.id,
  });
  if (error) throw toMediaStorageError(error);
  return mapAsset(unwrapRpc(data)) ?? asset;
}

export async function listAssets({
  businessId,
  category = null,
  status = null,
  limit = 100,
} = {}) {
  if (!businessId) throw new MediaStorageError('Select a workspace first.');

  const supabase = getClient();
  let query = supabase
    .from('media_assets')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 200));

  if (category) query = query.eq('asset_category', category);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw toMediaStorageError(error);
  return (data ?? []).map(mapAsset);
}

export async function getUsage(businessId) {
  if (!businessId) throw new MediaStorageError('Select a workspace first.');
  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_business_media_usage', {
    p_business_id: businessId,
  });
  if (error) throw toMediaStorageError(error);

  const row = unwrapRpc(data) ?? {};
  return {
    readyFiles: Number(row.readyFiles ?? 0),
    imageFiles: Number(row.imageFiles ?? 0),
    totalBytes: Number(row.totalBytes ?? 0),
    pendingFiles: Number(row.pendingFiles ?? 0),
    failedFiles: Number(row.failedFiles ?? 0),
    maxFiles: row.maxFiles == null ? null : Number(row.maxFiles),
    maxTotalBytes: row.maxTotalBytes == null ? null : Number(row.maxTotalBytes),
  };
}

export async function cleanupAbandoned({ olderThanSeconds = 86400 } = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.functions.invoke('media-manager', {
    body: {
      action: 'cleanup-abandoned',
      olderThanSeconds: Math.max(3600, Number(olderThanSeconds) || 86400),
    },
  });

  if (error) throw toMediaStorageError(error);
  if (data?.error) {
    throw new MediaStorageError(data.message || 'Abandoned media cleanup failed.', {
      code: data.code || null,
      status: data.status || null,
    });
  }

  return data;
}

export const mediaStorageManager = Object.freeze({
  getProviderConfig,
  uploadImage,
  getAssetById,
  getImageUrl,
  getMetadata,
  deleteImage,
  markImageDeleted,
  listAssets,
  getUsage,
  cleanupAbandoned,
});

export default mediaStorageManager;
