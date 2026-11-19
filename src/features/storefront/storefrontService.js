import { getSupabaseClient } from '../../lib/supabase/client';
import mediaStorageManager from '../../services/mediaStorageManager';
import { resolveMediaUrls } from '../../services/media/resolveMediaUrls';

const PRODUCT_IMAGE_BUCKET = 'product-images';
const STORE_LOGO_BUCKET = 'store-logos';

const ERROR_MESSAGES = Object.freeze({
  '22023': 'Some of the submitted details are invalid. Review them and try again.',
  '23505': 'That value is already in use. Try a different one.',
  '28000': 'Sign in again and try once more.',
  '42501': 'You do not have permission to perform this action.',
  '22P02': 'One of the selected records is no longer available.',
  PGRST116: 'The requested record could not be found.',
});

export class StorefrontServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'StorefrontServiceError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toCheckoutItems(items = []) {
  return items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId || null,
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
  }));
}

export function toStorefrontServiceError(error) {
  if (error instanceof StorefrontServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (code === '22023' && error?.message) message = error.message;
  if (code === '23505' && /store link/i.test(error?.message ?? '')) {
    message = 'That store link is already taken.';
  }
  if (!message && /row-level security|permission denied|insufficient privilege/i.test(error?.message ?? '')) {
    message = ERROR_MESSAGES['42501'];
  }
  if (!message) {
    message = error?.message || 'The storefront request could not be completed.';
  }

  return new StorefrontServiceError(message, {
    cause: error,
    code,
    details: error?.details,
    hint: error?.hint,
  });
}

function getClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    throw toStorefrontServiceError(error);
  }
}

async function createSignedUrlMap(paths, bucket = PRODUCT_IMAGE_BUCKET) {
  return resolveMediaUrls(paths, { bucket });
}

export async function getPublicStore(storeSlug) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_public_store', {
    p_store_slug: storeSlug,
  });
  if (error) throw toStorefrontServiceError(error);

  const row = unwrapRpc(data);
  if (!row) throw new StorefrontServiceError('This online store is not available.');

  const logoPath = row.logo_path ?? null;
  const logoUrls = row.logo_url
    ? new Map([[logoPath, row.logo_url]])
    : await createSignedUrlMap([logoPath], STORE_LOGO_BUCKET);

  return {
    slug: row.store_slug,
    name: row.store_name,
    description: row.description ?? '',
    brandColor: row.brand_color || '#4f46e5',
    logoPath,
    logoUrl: logoPath ? logoUrls.get(logoPath) ?? null : null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    contactAddress: row.contact_address ?? null,
    currency: row.currency,
  };
}

export async function listStorefrontCategories(storeSlug) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('list_storefront_categories', {
    p_store_slug: storeSlug,
  });
  if (error) throw toStorefrontServiceError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    productCount: Number(row.product_count ?? 0),
  }));
}

export async function searchStorefrontProducts({
  storeSlug,
  search = '',
  categoryId = null,
  sort = 'featured',
  limit = 24,
  offset = 0,
} = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('search_storefront_products', {
    p_store_slug: storeSlug,
    p_search: toNullableText(search),
    p_category_id: categoryId || null,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw toStorefrontServiceError(error);

  const rows = data ?? [];
  const images = await createSignedUrlMap(
    rows.map((row) => row.primary_image_path),
  );

  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      price: Number(row.price ?? 0),
      currency: row.currency,
      categoryName: row.category_name ?? null,
      brandName: row.brand_name ?? null,
      availability: row.availability,
      hasVariants: Boolean(row.has_variants),
      priceFrom: Boolean(row.price_from),
      imagePath: row.primary_image_path ?? null,
      imageAlt: row.primary_image_alt ?? row.name,
      imageUrl: row.primary_image_url || (row.primary_image_path
        ? images.get(row.primary_image_path) ?? null
        : null),
    })),
    count: Number(rows[0]?.total_count ?? 0),
  };
}

export async function getStorefrontProduct({ storeSlug, productId }) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_storefront_product', {
    p_store_slug: storeSlug,
    p_product_id: productId,
  });
  if (error) throw toStorefrontServiceError(error);

  const row = unwrapRpc(data);
  if (!row) throw new StorefrontServiceError('This product is not available.');

  const imageRows = Array.isArray(row.images) ? row.images : [];
  const imageUrls = await createSignedUrlMap(
    imageRows.map((image) => image.path),
  );

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price ?? 0),
    currency: row.currency,
    categoryName: row.category_name ?? null,
    brandName: row.brand_name ?? null,
    availability: row.availability,
    hasVariants: Boolean(row.has_variants),
    priceFrom: Boolean(row.price_from),
    variants: (Array.isArray(row.variants) ? row.variants : []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku ?? null,
      price: Number(variant.price ?? 0),
      isTracked: Boolean(variant.isTracked),
      availableQuantity: variant.availableQuantity ?? null,
      inStock: Boolean(variant.inStock),
    })),
    images: imageRows.map((image) => ({
      path: image.path,
      alt: image.alt || row.name,
      url: image.url || (image.path ? imageUrls.get(image.path) ?? null : null),
    })),
  };
}

export async function createStorefrontCheckoutReference({
  storeSlug,
  items = [],
  channel = 'online_store',
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_storefront_checkout_reference', {
    p_store_slug: storeSlug,
    p_items: toCheckoutItems(items),
    p_channel: channel,
  });
  if (error) throw toStorefrontServiceError(error);

  const row = unwrapRpc(data);
  if (!row?.reference) {
    throw new StorefrontServiceError('A secure checkout link could not be created.');
  }

  return {
    reference: row.reference,
    checkoutPath: row.checkout_path,
    expiresAt: row.expires_at,
    itemCount: Number(row.item_count ?? items.length),
    currency: row.currency,
  };
}

export async function getStorefrontCheckoutReference({ storeSlug, reference }) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_storefront_checkout_reference', {
    p_store_slug: storeSlug,
    p_reference: reference,
  });
  if (error) throw toStorefrontServiceError(error);

  const row = unwrapRpc(data);
  if (!row) throw new StorefrontServiceError('This checkout link is no longer valid.');

  return {
    storeName: row.store_name,
    storeSlug: row.store_slug,
    currency: row.currency,
    items: (Array.isArray(row.items) ? row.items : []).map((item) => ({
      productId: item.productId,
      variantId: item.variantId || null,
      name: item.name,
      variantName: item.variantName ?? '',
      imageUrl: null,
      price: Number(item.unitPrice ?? 0),
      currency: row.currency,
      quantity: Number(item.quantity ?? 1),
      lineTotal: Number(item.lineTotal ?? 0),
    })),
    estimatedTotal: Number(row.estimated_total ?? 0),
    expiresAt: row.expires_at,
    channel: row.channel,
  };
}

export async function submitStorefrontOrder({
  storeSlug,
  customerName,
  phone,
  email = '',
  address = '',
  city = '',
  instructions = '',
  items = [],
  idempotencyKey = null,
  checkoutReference = null,
  channel = null,
}) {
  const supabase = getClient();
  const payload = {
    p_store_slug: storeSlug,
    p_customer_name: customerName,
    p_phone: phone,
    p_email: toNullableText(email),
    p_address: toNullableText(address),
    p_city: toNullableText(city),
    p_instructions: toNullableText(instructions),
    p_items: toCheckoutItems(items),
    p_idempotency_key: idempotencyKey,
  };

  const { data, error } = checkoutReference
    ? await supabase.rpc('submit_storefront_order', {
        ...payload,
        p_checkout_reference: checkoutReference,
        p_channel: channel || 'whatsapp',
      })
    : await supabase.rpc('submit_storefront_order', payload);
  if (error) throw toStorefrontServiceError(error);

  const row = unwrapRpc(data);
  if (!row) throw new StorefrontServiceError('The order could not be created.');

  return {
    orderNumber: row.order_number,
    status: row.status,
    total: Number(row.total ?? 0),
    currency: row.currency,
    createdAt: row.created_at,
    message: row.message,
  };
}

export function mapStoreProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    logoPath: row.logo_path ?? null,
    logoMediaAssetId: row.logo_media_asset_id ?? null,
    logoUrl: row.logo_url ?? null,
    contactEmail: row.contact_email ?? '',
    contactPhone: row.contact_phone ?? '',
    contactAddress: row.contact_address ?? '',
    showContact: Boolean(row.show_contact),
    brandColor: row.brand_color || '#4f46e5',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getStoreProfile(businessId) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('get_store_profile', {
    p_business_id: businessId,
  });
  if (error) throw toStorefrontServiceError(error);
  return mapStoreProfile(unwrapRpc(data));
}

export async function updateStoreProfile({
  businessId,
  slug,
  name,
  description = '',
  logoPath = '',
  contactEmail = '',
  contactPhone = '',
  contactAddress = '',
  showContact = false,
  brandColor = '#4f46e5',
  status = 'active',
  logoMediaAssetId = null,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_store_profile', {
    p_business_id: businessId,
    p_slug: slug,
    p_name: name,
    p_description: toNullableText(description),
    p_logo_path: toNullableText(logoPath),
    p_logo_media_asset_id: logoMediaAssetId || null,
    p_contact_email: toNullableText(contactEmail),
    p_contact_phone: toNullableText(contactPhone),
    p_contact_address: toNullableText(contactAddress),
    p_show_contact: showContact,
    p_brand_color: brandColor,
    p_status: status,
  });
  if (error) throw toStorefrontServiceError(error);
  return mapStoreProfile(unwrapRpc(data));
}

export async function searchStorefrontManagementProducts({
  businessId,
  search = '',
  status = '',
  limit = 50,
  offset = 0,
} = {}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc(
    'search_storefront_management_products',
    {
      p_business_id: businessId,
      p_search: toNullableText(search),
      p_status: toNullableText(status),
      p_limit: limit,
      p_offset: offset,
    },
  );
  if (error) throw toStorefrontServiceError(error);

  const rows = data ?? [];
  const images = await createSignedUrlMap(
    rows.map((row) => row.primary_image_path),
  );

  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      sku: row.sku ?? null,
      price: Number(row.price ?? 0),
      currency: row.currency,
      categoryName: row.category_name ?? null,
      storefrontVisible: Boolean(row.storefront_visible),
      imagePath: row.primary_image_path ?? null,
      imageUrl: row.primary_image_url || (row.primary_image_path
        ? images.get(row.primary_image_path) ?? null
        : null),
    })),
    count: Number(rows[0]?.total_count ?? 0),
  };
}

export async function setStorefrontProductVisibility(productId, visible) {
  const supabase = getClient();
  const { error } = await supabase.rpc('set_storefront_product_visibility', {
    p_product_id: productId,
    p_visible: Boolean(visible),
  });
  if (error) throw toStorefrontServiceError(error);
}

export async function getStoreLogoUrl(logoPath) {
  const urls = await createSignedUrlMap([logoPath], STORE_LOGO_BUCKET);
  return logoPath ? urls.get(logoPath) ?? null : null;
}

export async function uploadStoreLogo({ businessId, file, onProgress }) {
  const asset = await mediaStorageManager.uploadImage({
    businessId,
    category: 'store_logo',
    file,
    onProgress,
  });
  return {
    logoPath: asset.providerFileId,
    mediaAssetId: asset.id,
    asset,
  };
}

export async function deleteStoreLogo(logoPath, mediaAssetId = null) {
  if (mediaAssetId) {
    await mediaStorageManager.deleteImage(mediaAssetId);
    return;
  }
  if (!logoPath) return;

  const supabase = getClient();
  const { error } = await supabase.storage
    .from(STORE_LOGO_BUCKET)
    .remove([logoPath]);
  if (error) throw toStorefrontServiceError(error);
}
