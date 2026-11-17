import { getSupabaseClient } from '../../lib/supabase/client';
import { MediaStorageError, toMediaStorageError } from './mediaErrors';

const DEFAULT_SIGNED_URL_SECONDS = 60 * 60;

function putUpload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.timeout = 30000;
    request.setRequestHeader('content-type', file.type);
    request.setRequestHeader('cache-control', 'max-age=3600');
    request.setRequestHeader('x-upsert', 'false');

    if (typeof onProgress === 'function') {
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new MediaStorageError('Supabase Storage rejected the upload. Try again.', {
        status: request.status,
      }));
    };
    request.onerror = () => {
      reject(new MediaStorageError('The storage upload could not be sent. Check your connection and try again.'));
    };
    request.ontimeout = () => {
      reject(new MediaStorageError('The storage upload timed out. Try again.', { status: 504 }));
    };

    request.send(file);
  });
}

export async function uploadImage({ asset, file, onProgress }) {
  if (!asset?.bucket || !asset?.providerFileId) {
    throw new MediaStorageError('The storage path is missing.');
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(asset.bucket)
    .createSignedUploadUrl(asset.providerFileId, { upsert: false });

  if (error) throw toMediaStorageError(error);
  await putUpload(data.signedUrl, file, onProgress);
  if (typeof onProgress === 'function') onProgress(100);
  return asset;
}

export async function getImageUrl(asset, { expiresIn = DEFAULT_SIGNED_URL_SECONDS } = {}) {
  if (!asset?.bucket || !asset?.providerFileId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.providerFileId, Math.max(60, Number(expiresIn) || DEFAULT_SIGNED_URL_SECONDS));

  if (error) throw toMediaStorageError(error);
  return data?.signedUrl ?? null;
}

export async function deleteImage(asset) {
  if (!asset?.bucket || !asset?.providerFileId) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.storage
    .from(asset.bucket)
    .remove([asset.providerFileId]);

  if (error) throw toMediaStorageError(error);
}

export function getMetadata(asset) {
  return asset?.metadata ?? {};
}

export const supabaseStorageAdapter = Object.freeze({
  uploadImage,
  getImageUrl,
  deleteImage,
  getMetadata,
});

export default supabaseStorageAdapter;
