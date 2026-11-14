import { getSupabaseClient } from '../lib/supabase/client';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './baseService';

const PRODUCT_IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;

const IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
});

const ERROR_MESSAGES = Object.freeze({
  '23503': 'This item is still used by other records and cannot be deleted.',
  '23505': 'That name or code is already used in this workspace.',
  '42501': 'You do not have permission to change this catalogue.',
  '22023': 'Some catalogue values are invalid. Review the form and try again.',
  '22P02': 'One of the selected records is no longer available.',
  PGRST116: 'The record could not be found.',
});

export class CatalogueServiceError extends Error {
  constructor(message, { cause, code, details, hint } = {}) {
    super(message, { cause });
    this.name = 'CatalogueServiceError';
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function isPermissionError(error) {
  return /row-level security|permission denied|insufficient privilege/i.test(
    error?.message ?? '',
  );
}

function isStorageSizeError(error) {
  return /payload too large|exceeded the maximum allowed size|entity too large/i.test(
    error?.message ?? '',
  );
}

export function toCatalogueServiceError(error) {
  if (error instanceof CatalogueServiceError) return error;

  const code = String(error?.code ?? '');
  let message = ERROR_MESSAGES[code];

  if (!message && isPermissionError(error)) {
    message = 'You do not have permission to change this catalogue.';
  }
  if (!message && isStorageSizeError(error)) {
    message = 'Images must be 5 MB or smaller.';
  }
  if (!message) {
    message = error?.message || 'The catalogue request could not be completed.';
  }

  return new CatalogueServiceError(message, {
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
    throw toCatalogueServiceError(error);
  }
}

function clampPageSize(value) {
  return Math.min(
    Math.max(1, Math.floor(Number(value) || DEFAULT_PAGE_SIZE)),
    MAX_PAGE_SIZE,
  );
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toNullableNumber(value) {
  if (value === '' || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    parentId: row.parent_id ?? null,
    name: row.name,
    description: row.description ?? null,
    sortOrder: row.sort_order ?? 0,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBrand(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    description: row.description ?? null,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOption(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    attributeId: row.attribute_id,
    value: row.value,
    sortOrder: row.sort_order ?? 0,
  };
}

function mapAttribute(row, options = []) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    dataType: row.data_type,
    isVariantAttribute: Boolean(row.is_variant_attribute),
    isRequired: Boolean(row.is_required),
    unit: row.unit ?? null,
    sortOrder: row.sort_order ?? 0,
    usageCount: Number(row.usage_count ?? 0),
    options,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVariant(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    priceOverride:
      row.price_override == null ? null : Number(row.price_override),
    status: row.status,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    categoryId: row.category_id ?? null,
    brandId: row.brand_id ?? null,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    price: Number(row.price ?? 0),
    currency: row.currency,
    categoryName: row.category_name ?? null,
    brandName: row.brand_name ?? null,
    variantCount: Number(row.variant_count ?? 0),
    primaryImagePath: row.primary_image_path ?? null,
    primaryImageAlt: row.primary_image_alt ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImage(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    storagePath: row.storage_path,
    altText: row.alt_text ?? null,
    sortOrder: row.sort_order ?? 0,
    isPrimary: Boolean(row.is_primary),
    createdAt: row.created_at,
  };
}

function mapAttributeValue(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    attributeId: row.attribute_id,
    optionId: row.option_id ?? null,
    valueText: row.value_text ?? null,
    valueNumber: row.value_number == null ? null : Number(row.value_number),
    valueBoolean:
      row.value_boolean == null ? null : Boolean(row.value_boolean),
  };
}

function toAttributePayload(values = {}) {
  return Object.entries(values)
    .map(([attributeId, value]) => {
      if (!value || typeof value !== 'object') return null;

      const payload = {
        attribute_id: attributeId,
        option_id: value.optionId || null,
        value_text: toNullableText(value.valueText),
        value_number: toNullableNumber(value.valueNumber),
        value_boolean:
          value.valueBoolean === '' || value.valueBoolean == null
            ? null
            : value.valueBoolean === true || value.valueBoolean === 'true',
      };

      const hasValue =
        payload.option_id ||
        payload.value_text ||
        payload.value_number != null ||
        payload.value_boolean != null;

      return hasValue ? payload : null;
    })
    .filter(Boolean);
}

function toVariantPayload(variants = []) {
  return variants.map((variant, index) => ({
    id: variant.id || null,
    name: String(variant.name ?? '').trim(),
    sku: toNullableText(variant.sku),
    barcode: toNullableText(variant.barcode),
    price_override: toNullableNumber(variant.priceOverride),
    status: variant.status || 'active',
    sort_order: index,
    attributes: toAttributePayload(variant.attributes),
  }));
}

async function createSignedUrlMap(paths) {
  const uniquePaths = [...new Set((paths ?? []).filter(Boolean))];
  if (uniquePaths.length === 0) return new Map();

  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrls(uniquePaths, SIGNED_URL_SECONDS);

  if (error) return new Map();

  return new Map(
    (data ?? [])
      .filter((item) => item.signedUrl)
      .map((item) => [item.path, item.signedUrl]),
  );
}

export async function listProducts({
  businessId,
  search = '',
  categoryId = null,
  brandId = null,
  status = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (!businessId) throw new CatalogueServiceError('Select a workspace first.');

  const supabase = getClient();
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = clampPageSize(pageSize);
  const offset = (safePage - 1) * safePageSize;

  const { data, error } = await supabase.rpc('search_products', {
    p_business_id: businessId,
    p_search: toNullableText(search),
    p_category_id: categoryId || null,
    p_brand_id: brandId || null,
    p_status: status || null,
    p_limit: safePageSize,
    p_offset: offset,
  });

  if (error) throw toCatalogueServiceError(error);

  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  const products = rows.map(mapProduct);
  const signedUrls = await createSignedUrlMap(
    products.map((product) => product.primaryImagePath),
  );

  return {
    data: products.map((product) => ({
      ...product,
      primaryImageUrl: product.primaryImagePath
        ? signedUrls.get(product.primaryImagePath) ?? null
        : null,
    })),
    count: total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + products.length < total,
  };
}

export async function getProduct({ businessId, productId }) {
  if (!businessId || !productId) {
    throw new CatalogueServiceError('Product not found.');
  }

  const supabase = getClient();
  const [productResult, variantsResult, imagesResult, valuesResult] =
    await Promise.all([
      supabase
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .eq('id', productId)
        .maybeSingle(),
      supabase
        .from('product_variants')
        .select('*')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('product_images')
        .select('*')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('product_attribute_values')
        .select('*')
        .eq('business_id', businessId)
        .eq('product_id', productId),
    ]);

  const error =
    productResult.error ??
    variantsResult.error ??
    imagesResult.error ??
    valuesResult.error;

  if (error) throw toCatalogueServiceError(error);
  if (!productResult.data) throw new CatalogueServiceError('Product not found.');

  const images = imagesResult.data ?? [];
  const signedUrls = await createSignedUrlMap(
    images.map((image) => image.storage_path),
  );

  return {
    ...mapProduct(productResult.data),
    variants: (variantsResult.data ?? []).map(mapVariant),
    images: images.map((image) => ({
      ...mapImage(image),
      url: signedUrls.get(image.storage_path) ?? null,
    })),
    attributeValues: (valuesResult.data ?? []).map(mapAttributeValue),
  };
}

export async function createProduct({
  businessId,
  name,
  description,
  categoryId,
  brandId,
  sku,
  barcode,
  price,
  status,
  attributes,
  variants,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_product', {
    p_business_id: businessId,
    p_name: String(name ?? '').trim(),
    p_description: toNullableText(description),
    p_category_id: categoryId || null,
    p_brand_id: brandId || null,
    p_sku: toNullableText(sku),
    p_barcode: toNullableText(barcode),
    p_price: Number(price ?? 0),
    p_status: status || 'draft',
    p_attributes: toAttributePayload(attributes),
    p_variants: toVariantPayload(variants),
  });

  if (error) throw toCatalogueServiceError(error);
  return mapProduct(unwrapRpc(data));
}

export async function updateProduct({
  productId,
  name,
  description,
  categoryId,
  brandId,
  sku,
  barcode,
  price,
  status,
  attributes,
  variants,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('update_product', {
    p_product_id: productId,
    p_name: String(name ?? '').trim(),
    p_description: toNullableText(description),
    p_category_id: categoryId || null,
    p_brand_id: brandId || null,
    p_sku: toNullableText(sku),
    p_barcode: toNullableText(barcode),
    p_price: Number(price ?? 0),
    p_status: status || 'draft',
    p_attributes: toAttributePayload(attributes),
    p_variants: toVariantPayload(variants),
  });

  if (error) throw toCatalogueServiceError(error);
  return mapProduct(unwrapRpc(data));
}

export async function updateProductStatus({ businessId, productId, status }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .update({ status })
    .eq('business_id', businessId)
    .eq('id', productId)
    .select('*')
    .single();

  if (error) throw toCatalogueServiceError(error);
  return mapProduct(data);
}

async function withProductCounts(businessId, table, rows) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .select('category_id, brand_id')
    .eq('business_id', businessId);

  if (error) throw toCatalogueServiceError(error);

  const counts = new Map();
  for (const row of data ?? []) {
    const key = table === 'categories' ? row.category_id : row.brand_id;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    product_count: counts.get(row.id) ?? 0,
  }));
}

export async function listCategories(businessId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw toCatalogueServiceError(error);
  const rows = await withProductCounts(businessId, 'categories', data ?? []);
  return rows.map(mapCategory);
}

export async function saveCategory({
  id,
  businessId,
  name,
  description,
  parentId,
  sortOrder,
}) {
  const supabase = getClient();
  const payload = {
    business_id: businessId,
    name: String(name ?? '').trim(),
    description: toNullableText(description),
    parent_id: parentId || null,
    sort_order: Number(sortOrder ?? 0),
  };

  const query = id
    ? supabase.from('categories').update(payload).eq('id', id).eq('business_id', businessId)
    : supabase.from('categories').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) throw toCatalogueServiceError(error);
  return mapCategory(data);
}

export async function deleteCategory({ id, businessId }) {
  const supabase = getClient();
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);

  if (error) throw toCatalogueServiceError(error);
}

export async function listBrands(businessId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('business_id', businessId)
    .order('name', { ascending: true });

  if (error) throw toCatalogueServiceError(error);
  const rows = await withProductCounts(businessId, 'brands', data ?? []);
  return rows.map(mapBrand);
}

export async function saveBrand({ id, businessId, name, description }) {
  const supabase = getClient();
  const payload = {
    business_id: businessId,
    name: String(name ?? '').trim(),
    description: toNullableText(description),
  };

  const query = id
    ? supabase.from('brands').update(payload).eq('id', id).eq('business_id', businessId)
    : supabase.from('brands').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) throw toCatalogueServiceError(error);
  return mapBrand(data);
}

export async function deleteBrand({ id, businessId }) {
  const supabase = getClient();
  const { error } = await supabase
    .from('brands')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);

  if (error) throw toCatalogueServiceError(error);
}

export async function listAttributes(businessId) {
  const supabase = getClient();
  const [attributesResult, optionsResult, valuesResult] = await Promise.all([
    supabase
      .from('product_attributes')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('product_attribute_options')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('product_attribute_values')
      .select('attribute_id')
      .eq('business_id', businessId),
  ]);

  const error =
    attributesResult.error ?? optionsResult.error ?? valuesResult.error;
  if (error) throw toCatalogueServiceError(error);

  const optionsByAttribute = new Map();
  for (const option of optionsResult.data ?? []) {
    const list = optionsByAttribute.get(option.attribute_id) ?? [];
    list.push(mapOption(option));
    optionsByAttribute.set(option.attribute_id, list);
  }

  const usageByAttribute = new Map();
  for (const value of valuesResult.data ?? []) {
    usageByAttribute.set(
      value.attribute_id,
      (usageByAttribute.get(value.attribute_id) ?? 0) + 1,
    );
  }

  return (attributesResult.data ?? []).map((row) =>
    mapAttribute(
      { ...row, usage_count: usageByAttribute.get(row.id) ?? 0 },
      optionsByAttribute.get(row.id) ?? [],
    ),
  );
}

export async function createAttribute({
  businessId,
  name,
  dataType,
  isVariantAttribute,
  unit,
  options,
}) {
  const supabase = getClient();
  const { data, error } = await supabase.rpc('create_product_attribute', {
    p_business_id: businessId,
    p_name: String(name ?? '').trim(),
    p_data_type: dataType || 'text',
    p_is_variant_attribute: Boolean(isVariantAttribute),
    p_unit: toNullableText(unit),
    p_options: options ?? [],
  });

  if (error) throw toCatalogueServiceError(error);
  return mapAttribute(unwrapRpc(data));
}

export async function updateAttribute({
  id,
  businessId,
  name,
  unit,
  isRequired,
}) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('product_attributes')
    .update({
      name: String(name ?? '').trim(),
      unit: toNullableText(unit),
      is_required: Boolean(isRequired),
    })
    .eq('id', id)
    .eq('business_id', businessId)
    .select('*')
    .single();

  if (error) throw toCatalogueServiceError(error);
  return mapAttribute(data);
}

export async function deleteAttribute({ id, businessId }) {
  const supabase = getClient();
  const { error } = await supabase
    .from('product_attributes')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);

  if (error) throw toCatalogueServiceError(error);
}

export async function listProductImages({ businessId, productId }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('product_images')
    .select('*')
    .eq('business_id', businessId)
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw toCatalogueServiceError(error);

  const rows = data ?? [];
  const signedUrls = await createSignedUrlMap(
    rows.map((row) => row.storage_path),
  );

  return rows.map((row) => ({
    ...mapImage(row),
    url: signedUrls.get(row.storage_path) ?? null,
  }));
}

export async function uploadProductImage({
  businessId,
  productId,
  file,
  isPrimary = false,
}) {
  if (!file) throw new CatalogueServiceError('Choose an image to upload.');

  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension) {
    throw new CatalogueServiceError(
      'Use a JPEG, PNG, WebP or AVIF image.',
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new CatalogueServiceError('Images must be 5 MB or smaller.');
  }

  const supabase = getClient();
  const storagePath = `${businessId}/${productId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw toCatalogueServiceError(uploadError);

  const { data: existing, error: existingError } = await supabase
    .from('product_images')
    .select('id, sort_order, is_primary')
    .eq('business_id', businessId)
    .eq('product_id', productId)
    .order('sort_order', { ascending: false });

  if (existingError) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
    throw toCatalogueServiceError(existingError);
  }

  const shouldBePrimary = isPrimary || (existing ?? []).length === 0;
  if (shouldBePrimary && (existing ?? []).some((image) => image.is_primary)) {
    const { error: clearError } = await supabase
      .from('product_images')
      .update({ is_primary: false })
      .eq('business_id', businessId)
      .eq('product_id', productId);

    if (clearError) {
      await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
      throw toCatalogueServiceError(clearError);
    }
  }

  const nextSortOrder =
    (existing ?? []).reduce(
      (maximum, image) => Math.max(maximum, image.sort_order ?? 0),
      -1,
    ) + 1;

  const { data, error } = await supabase
    .from('product_images')
    .insert({
      business_id: businessId,
      product_id: productId,
      storage_path: storagePath,
      sort_order: nextSortOrder,
      is_primary: shouldBePrimary,
    })
    .select('*')
    .single();

  if (error) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
    throw toCatalogueServiceError(error);
  }

  const signedUrls = await createSignedUrlMap([storagePath]);
  return {
    ...mapImage(data),
    url: signedUrls.get(storagePath) ?? null,
  };
}

export async function updateProductImage({
  businessId,
  productId,
  imageId,
  altText,
  isPrimary,
  sortOrder,
}) {
  const supabase = getClient();

  if (isPrimary) {
    const { error: clearError } = await supabase
      .from('product_images')
      .update({ is_primary: false })
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .neq('id', imageId);

    if (clearError) throw toCatalogueServiceError(clearError);
  }

  const payload = {};
  if (altText !== undefined) payload.alt_text = toNullableText(altText);
  if (isPrimary !== undefined) payload.is_primary = Boolean(isPrimary);
  if (sortOrder !== undefined) payload.sort_order = Number(sortOrder);

  const { data, error } = await supabase
    .from('product_images')
    .update(payload)
    .eq('business_id', businessId)
    .eq('product_id', productId)
    .eq('id', imageId)
    .select('*')
    .single();

  if (error) throw toCatalogueServiceError(error);

  const signedUrls = await createSignedUrlMap([data.storage_path]);
  return {
    ...mapImage(data),
    url: signedUrls.get(data.storage_path) ?? null,
  };
}

export async function deleteProductImage({ businessId, productId, image }) {
  const supabase = getClient();
  const { error } = await supabase
    .from('product_images')
    .delete()
    .eq('business_id', businessId)
    .eq('product_id', productId)
    .eq('id', image.id);

  if (error) throw toCatalogueServiceError(error);

  const { error: storageError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .remove([image.storagePath]);

  if (storageError) throw toCatalogueServiceError(storageError);
}

export async function loadCatalogueMeta(businessId) {
  const [categories, brands, attributes] = await Promise.all([
    listCategories(businessId),
    listBrands(businessId),
    listAttributes(businessId),
  ]);

  return { categories, brands, attributes };
}
