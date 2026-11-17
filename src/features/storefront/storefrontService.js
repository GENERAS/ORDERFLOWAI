import { getSupabaseClient } from '../../lib/supabase/client';

const PRODUCT_IMAGE_BUCKET = 'product-images';
const STORE_LOGO_BUCKET = 'store-logos';
const SIGNED_URL_SECONDS = 60 * 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
});

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
  const uniquePaths = [...new Set((paths ?? []).filter(Boolean))];
  if (uniquePaths.length === 0) return new Map();

  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(uniquePaths, SIGNED_URL_SECONDS);

  if (error) return new Map();

  return new Map(
    (data ?? [])
      .filter((item) => item.signedUrl)
      .map((item) => [item.path, item.signedUrl]),
  );
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
  const logoUrls = await createSignedUrlMap([logoPath], STORE_LOGO_BUCKET);

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
      imageUrl: row.primary_image_path
        ? images.get(row.primary_image_path) ?? null
        : null,
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
      url: imageUrls.get(image.path) ?? null,
    })),
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
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('submit_storefront_order', {
    p_store_slug: storeSlug,
    p_customer_name: customerName,
    p_phone: phone,
    p_email: toNullableText(email),
    p_address: toNullableText(address),
    p_city: toNullableText(city),
    p_instructions: toNullableText(instructions),
    p_items: items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId || null,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    })),
    p_idempotency_key: idempotencyKey,
  });
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
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_store_profile', {
    p_business_id: businessId,
    p_slug: slug,
    p_name: name,
    p_description: toNullableText(description),
    p_logo_path: toNullableText(logoPath),
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
      imageUrl: row.primary_image_path
        ? images.get(row.primary_image_path) ?? null
        : null,
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

export async function uploadStoreLogo({ businessId, file }) {
  if (!file) throw new StorefrontServiceError('Choose a logo image.');
  if (!Object.hasOwn(IMAGE_EXTENSIONS, file.type)) {
    throw new StorefrontServiceError('Use a JPEG, PNG, WebP or AVIF image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new StorefrontServiceError('Store logos must be 5 MB or smaller.');
  }

  const extension = IMAGE_EXTENSIONS[file.type];
  const storagePath = `${businessId}/${crypto.randomUUID()}.${extension}`;
  const supabase = getClient();
  const { error } = await supabase.storage
    .from(STORE_LOGO_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) throw toStorefrontServiceError(error);
  return storagePath;
}

export async function deleteStoreLogo(logoPath) {
  if (!logoPath) return;
  const supabase = getClient();
  const { error } = await supabase.storage
    .from(STORE_LOGO_BUCKET)
    .remove([logoPath]);
  if (error) throw toStorefrontServiceError(error);
}
