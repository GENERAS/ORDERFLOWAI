import { getSupabaseClient } from '../../lib/supabase/client';
import { MediaStorageError, toMediaStorageError } from './mediaErrors';

const FUNCTION_NAME = 'media-manager';
const DEFAULT_TIMEOUT_MS = 30000;

async function callMediaFunction(body) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });

  if (error) {
    const response = error.context;
    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.json();
        throw new MediaStorageError(
          payload?.message || payload?.error || 'The media service could not complete the request.',
          {
            code: payload?.code || null,
            status: payload?.status || response.status || null,
            cause: error,
          },
        );
      } catch (parseError) {
        if (parseError instanceof MediaStorageError) throw parseError;
      }
    }
    throw toMediaStorageError(error);
  }

  if (data?.error) {
    throw new MediaStorageError(
      data.message || data.error || 'The media service could not complete the request.',
      { code: data.code || null, status: data.status || null },
    );
  }

  return data;
}

function uploadForm(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  form.append('file', file, file.name);
  return form;
}

function postUpload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.timeout = DEFAULT_TIMEOUT_MS;

    if (typeof onProgress === 'function') {
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(
          new MediaStorageError('Cloudinary rejected the upload. Check the image and try again.', {
            status: request.status,
          }),
        );
        return;
      }

      try {
        resolve(JSON.parse(request.responseText));
      } catch {
        reject(new MediaStorageError('Cloudinary returned an unreadable upload response.'));
      }
    };

    request.onerror = () => {
      reject(new MediaStorageError('The Cloudinary upload could not be sent. Check your connection and try again.'));
    };
    request.ontimeout = () => {
      reject(new MediaStorageError('The Cloudinary upload timed out. Try again.', { status: 504 }));
    };

    request.send(form);
  });
}

export async function getUploadInstructions(mediaAssetId) {
  const result = await callMediaFunction({
    action: 'cloudinary-sign',
    mediaAssetId,
  });
  return result;
}

export async function uploadImage({ asset, file, onProgress }) {
  if (!asset?.id) throw new MediaStorageError('The media record is missing.');

  const instructions = await getUploadInstructions(asset.id);
  const form = uploadForm(instructions.fields, file);
  const uploaded = await postUpload(instructions.uploadUrl, form, onProgress);

  const result = await callMediaFunction({
    action: 'cloudinary-complete',
    mediaAssetId: asset.id,
    publicId: uploaded?.public_id || null,
  });

  if (typeof onProgress === 'function') onProgress(100);
  return result.asset;
}

export function buildCloudinaryUrl(asset, { width = null } = {}) {
  if (!asset) return null;

  const cloudName = asset.metadata?.cloud_name;
  const publicId = String(asset.providerFileId || '').replace(/^cloudinary:/, '');
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0
    ? Math.min(Math.max(Math.round(Number(width)), 16), 4096)
    : null;

  if (!cloudName || !publicId || !/^[A-Za-z0-9._/-]+$/.test(publicId) || publicId.includes('..')) {
    return asset.deliveryUrl ?? null;
  }

  if (!safeWidth && asset.deliveryUrl) return asset.deliveryUrl;

  const transformation = ['f_auto', 'q_auto'];
  if (safeWidth) transformation.push(`w_${safeWidth}`);

  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformation.join(',')}/${publicId}`;
}

export async function getImageUrl(asset, options = {}) {
  if (!asset) return null;
  return buildCloudinaryUrl(asset, options);
}

export async function deleteImage(asset) {
  if (!asset?.id) return null;
  const result = await callMediaFunction({
    action: 'cloudinary-delete',
    mediaAssetId: asset.id,
  });
  return result.asset;
}

export function getMetadata(asset) {
  return asset?.metadata ?? {};
}

export const cloudinaryAdapter = Object.freeze({
  uploadImage,
  getImageUrl,
  deleteImage,
  getMetadata,
  buildCloudinaryUrl,
});

export default cloudinaryAdapter;
