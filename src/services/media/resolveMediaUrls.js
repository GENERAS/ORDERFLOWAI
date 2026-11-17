import { getSupabaseClient } from '../../lib/supabase/client';

export async function resolveMediaUrls(paths, { bucket = 'product-images', width = null } = {}) {
  const uniquePaths = [...new Set((paths ?? []).filter(Boolean))];
  if (uniquePaths.length === 0) return new Map();

  const supabase = getSupabaseClient();
  const urls = new Map();

  const { data: resolved, error: resolveError } = await supabase.rpc('media_resolve_image_urls', {
    p_paths: uniquePaths,
    p_width: width || null,
  });

  if (!resolveError) {
    for (const [path, url] of Object.entries(resolved ?? {})) {
      if (url) urls.set(path, url);
    }
  }

  const pathsToSign = uniquePaths.filter((path) => !urls.has(path) && !String(path).startsWith('cloudinary:'));
  if (pathsToSign.length > 0) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrls(pathsToSign, 60 * 60);

    if (!signedError) {
      for (const item of signed ?? []) {
        if (item.signedUrl) urls.set(item.path, item.signedUrl);
      }
    }
  }

  return urls;
}

export function firstResolvedUrl(urls, path) {
  return path ? urls.get(path) ?? null : null;
}
