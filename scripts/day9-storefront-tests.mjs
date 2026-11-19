import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const projectRoot = path.resolve(import.meta.dirname, '..');
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const databasePassword = process.env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !supabaseKey || !databasePassword) {
  console.error(
    'Missing configuration. Load the database password and pass .env.local to Node:\n' +
      '  . .\\scripts\\load-supabase-db-password.ps1\n' +
      '  node --env-file=.env.local scripts/day9-storefront-tests.mjs',
  );
  process.exit(1);
}

async function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) {
    return process.env.SUPABASE_PROJECT_REF.trim();
  }
  return (
    await readFile(path.join(projectRoot, 'supabase', '.temp', 'project-ref'), 'utf8')
  ).trim();
}

const projectRef = await resolveProjectRef();
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailPrefix = `day9-test-${runId}`;
const slugPrefix = `day9-${runId}`;
const password = 'Day9Test!Pass123';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2h9sAAAAASUVORK5CYII=',
  'base64',
);

const results = { checks: 0, failures: [] };

function check(name, condition, details = '') {
  results.checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
    return;
  }
  const message = details ? `${name} - ${details}` : name;
  results.failures.push(message);
  console.error(`FAIL  ${message}`);
}

function checkEqual(name, actual, expected) {
  check(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function checkRpcError(name, result, code = null) {
  check(name, Boolean(result.error), result.error?.message ?? 'expected an error');
  if (code) {
    checkEqual(`${name} error code`, result.error?.code, code);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

const db = new Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: databasePassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'orderflow-ai-day9-storefront-tests',
});

function createTestClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

const anon = createTestClient();

async function createAuthUser(email, fullName) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      aud,
      role,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      phone_change,
      phone_change_token,
      reauthentication_token,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      $1,
      '00000000-0000-0000-0000-000000000000',
      $2,
      extensions.crypt($3, extensions.gen_salt('bf')),
      now(),
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', $4::text),
      now(),
      now()
    )`,
    [id, email, password, fullName],
  );
  return id;
}

async function signIn(email) {
  const client = createTestClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, user: data.user };
}

async function insertBusiness({ id, name, slug, currency }) {
  await db.query(
    `insert into public.businesses (id, name, slug, currency, country, timezone)
     values ($1, $2, $3, $4, 'RW', 'Africa/Kigali')`,
    [id, name, slug, currency],
  );
}

async function addMember(businessId, userId, role) {
  await db.query(
    `insert into public.business_members (business_id, user_id, role, status)
     values ($1, $2, $3, 'active')`,
    [businessId, userId, role],
  );
}

async function createCategory(businessId, name) {
  const { rows } = await db.query(
    `insert into public.categories (business_id, name)
     values ($1, $2)
     returning id`,
    [businessId, name],
  );
  return rows[0].id;
}

async function createProduct(client, businessId, payload) {
  const { data, error } = await client.rpc('create_product', {
    p_business_id: businessId,
    p_name: payload.name,
    p_description: payload.description ?? null,
    p_category_id: payload.categoryId ?? null,
    p_brand_id: null,
    p_sku: payload.sku,
    p_barcode: null,
    p_price: payload.price,
    p_status: payload.status ?? 'active',
    p_attributes: [],
    p_variants: payload.variants ?? [],
  });
  return { product: unwrapRpc(data), error };
}

async function getVariants(client, productId) {
  const { data, error } = await client
    .from('product_variants')
    .select('*')
    .eq('product_id', productId);
  return { rows: data ?? [], error };
}

async function enableTracking(client, productId, variantId = null) {
  const { data, error } = await client.rpc('enable_inventory_tracking', {
    p_product_id: productId,
    p_variant_id: variantId,
    p_low_stock_threshold: null,
  });
  return { item: unwrapRpc(data), error };
}

async function receiveStock(client, inventoryItemId, quantity) {
  const { data, error } = await client.rpc('record_stock_operation', {
    p_inventory_item_id: inventoryItemId,
    p_operation: 'receive',
    p_quantity_change: quantity,
    p_reason: 'Day 9 storefront test stock',
    p_idempotency_key: randomUUID(),
  });
  return { movement: unwrapRpc(data), error };
}

async function setVisibility(client, productId, visible) {
  const { data, error } = await client.rpc('set_storefront_product_visibility', {
    p_product_id: productId,
    p_visible: visible,
  });
  return { product: unwrapRpc(data), error };
}

async function updateStoreProfile(client, payload) {
  const { data, error } = await client.rpc('update_store_profile', {
    p_business_id: payload.businessId,
    p_slug: payload.slug,
    p_name: payload.name,
    p_description: payload.description ?? null,
    p_logo_path: payload.logoPath ?? null,
    p_contact_email: payload.contactEmail ?? null,
    p_contact_phone: payload.contactPhone ?? null,
    p_contact_address: payload.contactAddress ?? null,
    p_show_contact: payload.showContact ?? false,
    p_brand_color: payload.brandColor ?? '#4f46e5',
    p_status: payload.status ?? 'active',
  });
  return { store: unwrapRpc(data), error };
}

async function getStoreProfile(client, businessId) {
  const { data, error } = await client.rpc('get_store_profile', {
    p_business_id: businessId,
  });
  return { store: unwrapRpc(data), error };
}

async function getPublicStore(client, slug) {
  const { data, error } = await client.rpc('get_public_store', {
    p_store_slug: slug,
  });
  return { store: unwrapRpc(data), error };
}

async function searchPublicProducts(client, slug, options = {}) {
  const { data, error } = await client.rpc('search_storefront_products', {
    p_store_slug: slug,
    p_search: options.search ?? null,
    p_category_id: options.categoryId ?? null,
    p_sort: options.sort ?? 'featured',
    p_limit: options.limit ?? 24,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function getPublicProduct(client, slug, productId) {
  const { data, error } = await client.rpc('get_storefront_product', {
    p_store_slug: slug,
    p_product_id: productId,
  });
  return { product: unwrapRpc(data), error };
}

async function listPublicCategories(client, slug) {
  const { data, error } = await client.rpc('list_storefront_categories', {
    p_store_slug: slug,
  });
  return { rows: data ?? [], error };
}

async function searchManagementProducts(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_storefront_management_products', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_status: options.status ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function submitStorefrontOrder(client, payload) {
  const { data, error } = await client.rpc('submit_storefront_order', {
    p_store_slug: payload.storeSlug,
    p_customer_name: payload.customerName,
    p_phone: payload.phone,
    p_email: payload.email ?? null,
    p_address: payload.address ?? null,
    p_city: payload.city ?? null,
    p_instructions: payload.instructions ?? null,
    p_items: payload.items ?? [],
    p_idempotency_key: payload.idempotencyKey ?? null,
  });
  return { order: unwrapRpc(data), error };
}

async function createCustomer(client, businessId, payload) {
  const { data, error } = await client.rpc('create_customer', {
    p_business_id: businessId,
    p_full_name: payload.fullName,
    p_email: payload.email ?? null,
    p_phone: payload.phone ?? null,
    p_company_name: null,
    p_notes: null,
    p_status: 'active',
    p_tags: null,
    p_duplicate_override: false,
    p_duplicate_reason: null,
  });
  return { customer: unwrapRpc(data), error };
}

async function paymentSummary(client, orderId) {
  const { data, error } = await client.rpc('get_order_payment_summary', {
    p_order_id: orderId,
  });
  return { summary: unwrapRpc(data), error };
}

async function searchOrders(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_orders', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_status: options.status ?? null,
    p_customer_id: null,
    p_order_id: options.orderId ?? null,
    p_limit: 100,
    p_offset: 0,
    p_sort: 'recent',
    p_direction: 'desc',
    p_created_from: null,
    p_created_to: null,
  });
  return { rows: data ?? [], error };
}

const uploadedObjects = [];

async function uploadImage(client, bucket, objectPath) {
  const result = await client.storage.from(bucket).upload(
    objectPath,
    new Blob([pngBytes], { type: 'image/png' }),
    { contentType: 'image/png', upsert: false },
  );
  if (!result.error) {
    uploadedObjects.push({ client, bucket, objectPath });
  }
  return result;
}

async function signedUrl(client, bucket, objectPath) {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrls([objectPath], 60);
  return {
    url: data?.[0]?.signedUrl ?? null,
    error: error ?? data?.[0]?.error ?? null,
  };
}

async function scalarNumber(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.value ?? 0);
}

async function scalarBoolean(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return Boolean(rows[0]?.value);
}

async function storeForBusiness(businessId) {
  const { rows } = await db.query(
    'select * from public.stores where business_id = $1',
    [businessId],
  );
  return rows[0] ?? null;
}

async function orderByNumber(orderNumber) {
  const { rows } = await db.query(
    'select * from public.orders where order_number = $1 order by created_at desc limit 1',
    [orderNumber],
  );
  return rows[0] ?? null;
}

async function orderItemsFor(orderId) {
  const { rows } = await db.query(
    'select * from public.order_items where order_id = $1 order by created_at, id',
    [orderId],
  );
  return rows;
}

async function orderEventsFor(orderId) {
  const { rows } = await db.query(
    'select * from public.order_events where order_id = $1 order by created_at, id',
    [orderId],
  );
  return rows;
}

async function inventoryFor(productId, variantId = null) {
  const { rows } = await db.query(
    `select * from public.inventory_items
     where product_id = $1 and variant_id is not distinct from $2`,
    [productId, variantId],
  );
  return rows[0] ?? null;
}

async function stockMovementsFor(orderId) {
  const { rows } = await db.query(
    `select * from public.stock_movements
     where idempotency_key like $1
     order by created_at, id`,
    [`order:${orderId}:reserve:%`],
  );
  return rows;
}

async function orderCount(businessId) {
  return scalarNumber(
    'select count(*)::int as value from public.orders where business_id = $1',
    [businessId],
  );
}

async function paymentCount(businessId) {
  return scalarNumber(
    'select count(*)::int as value from public.payments where business_id = $1',
    [businessId],
  );
}

async function requestCount(businessId, idempotencyKey) {
  return scalarNumber(
    `select count(*)::int as value
     from public.storefront_order_requests
     where business_id = $1 and idempotency_key = $2`,
    [businessId, idempotencyKey],
  );
}

let businessA;
let businessB;

async function cleanup() {
  for (const bucket of ['product-images', 'store-logos']) {
    const bucketObjects = uploadedObjects.filter((object) => object.bucket === bucket);
    const paths = bucketObjects.map((object) => object.objectPath);
    if (bucketObjects[0]?.client && paths.length > 0) {
      await bucketObjects[0].client.storage.from(bucket).remove(paths);
    }
  }
  uploadedObjects.length = 0;

  const ids = [businessA, businessB].filter(Boolean);
  if (ids.length > 0) {
    await db.query(
      'delete from public.payment_events where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.payments where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.order_events where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.order_items where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.orders where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.order_counters where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.stock_movements where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.inventory_items where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.product_images where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.storefront_order_requests where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.products where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.categories where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.stores where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.customers where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.businesses where id = any($1::uuid[])',
      [ids],
    );
  }
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
}

try {
  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const intruderEmail = `${emailPrefix}-intruder@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Nine Owner');
  const staffId = await createAuthUser(staffEmail, 'Day Nine Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Nine Other Owner');

  businessA = randomUUID();
  businessB = randomUUID();
  const slugA = `${slugPrefix}-a`;
  const slugB = `${slugPrefix}-b`;

  await insertBusiness({
    id: businessA,
    name: 'Day Nine Business A',
    slug: slugA,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Nine Business B',
    slug: slugB,
    currency: 'USD',
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, intruderId, 'owner');

  const owner = await signIn(ownerEmail);
  const staff = await signIn(staffEmail);
  const intruder = await signIn(intruderEmail);

  const storeAInitial = await storeForBusiness(businessA);
  const storeBInitial = await storeForBusiness(businessB);
  check(
    'business creation automatically creates a store',
    Boolean(storeAInitial) && storeAInitial.slug === slugA && storeAInitial.status === 'active',
  );
  check(
    'each business gets exactly one store',
    Boolean(storeBInitial) && storeBInitial.slug === slugB,
  );

  const uniqueSlugResult = await db.query(
    'select public.unique_store_slug($1, $2::uuid) as slug',
    [slugA, randomUUID()],
  );
  check(
    'store slug generation avoids existing slugs',
    uniqueSlugResult.rows[0]?.slug !== slugA,
  );

  const categoryA = await createCategory(businessA, `Tools ${runId}`);
  const categoryB = await createCategory(businessB, `Other ${runId}`);
  check(Boolean(categoryA && categoryB), 'test categories were created');

  const simpleResult = await createProduct(owner.client, businessA, {
    name: `Day Nine Simple ${runId}`,
    sku: `${runId}-simple`,
    price: 1250,
    categoryId: categoryA,
  });
  const variantResult = await createProduct(owner.client, businessA, {
    name: `Day Nine Variant ${runId}`,
    sku: `${runId}-variant-base`,
    price: 1000,
    variants: [
      {
        name: 'Standard',
        sku: `${runId}-variant`,
        price_override: '1750',
        status: 'active',
        sort_order: 0,
      },
    ],
  });
  const hiddenResult = await createProduct(owner.client, businessA, {
    name: `Day Nine Hidden ${runId}`,
    sku: `${runId}-hidden`,
    price: 900,
  });
  const draftResult = await createProduct(owner.client, businessA, {
    name: `Day Nine Draft ${runId}`,
    sku: `${runId}-draft`,
    price: 700,
    status: 'draft',
  });
  const outOfStockResult = await createProduct(owner.client, businessA, {
    name: `Day Nine Out Of Stock ${runId}`,
    sku: `${runId}-out`,
    price: 400,
  });
  const otherResult = await createProduct(intruder.client, businessB, {
    name: `Day Nine Other Business ${runId}`,
    sku: `${runId}-other`,
    price: 500,
  });

  const simpleProduct = simpleResult.product;
  const variantProduct = variantResult.product;
  const hiddenProduct = hiddenResult.product;
  const draftProduct = draftResult.product;
  const outOfStockProduct = outOfStockResult.product;
  const otherProduct = otherResult.product;

  check(
    'all test products were created',
    Boolean(
      simpleProduct?.id &&
        variantProduct?.id &&
        hiddenProduct?.id &&
        draftProduct?.id &&
        outOfStockProduct?.id &&
        otherProduct?.id,
    ),
  );

  const variantsResult = await getVariants(owner.client, variantProduct.id);
  const variant = variantsResult.rows[0];
  check(
    'variant product has an active variant',
    !variantsResult.error && Boolean(variant?.id) && variant.status === 'active',
    variantsResult.error?.message,
  );

  const imagePath = `${businessA}/${simpleProduct.id}/${randomUUID()}.png`;
  const logoPath = `${businessA}/${randomUUID()}.png`;
  const uploadImageResult = await uploadImage(owner.client, 'product-images', imagePath);
  const uploadLogoResult = await uploadImage(owner.client, 'store-logos', logoPath);
  check(
    'owner can upload a product image to the private bucket',
    !uploadImageResult.error,
    uploadImageResult.error?.message,
  );
  check(
    'owner can upload a store logo to the private bucket',
    !uploadLogoResult.error,
    uploadLogoResult.error?.message,
  );

  await db.query(
    `insert into public.product_images
       (business_id, product_id, storage_path, alt_text, is_primary, sort_order)
     values ($1, $2, $3, $4, true, 0)`,
    [businessA, simpleProduct.id, imagePath, 'Day Nine test image'],
  );

  const imageHelperBefore = await scalarBoolean(
    'select public.is_public_product_image($1) as value',
    [imagePath],
  );
  checkEqual('hidden product image is not publicly readable', imageHelperBefore, false);

  const invalidLogoResult = await updateStoreProfile(owner.client, {
    businessId: businessA,
    slug: slugA,
    name: 'Day Nine Demo Store',
    logoPath: '../bad.png',
  });
  checkRpcError('store logo path rejects traversal segments', invalidLogoResult, '22023');

  const storeProfile = {
    businessId: businessA,
    slug: `${slugPrefix}-store`,
    name: 'Day Nine Demo Store',
    description: 'A real storefront backed by the shared catalogue.',
    logoPath,
    contactEmail: `store-${runId}@example.com`,
    contactPhone: '+250788900000',
    contactAddress: 'Kigali, Rwanda',
    showContact: false,
    brandColor: '#2563EB',
    status: 'active',
  };
  const profileResult = await updateStoreProfile(owner.client, storeProfile);
  check(
    'manager can update the store profile',
    !profileResult.error &&
      profileResult.store?.slug === `${slugPrefix}-store` &&
      profileResult.store?.brand_color === '#2563eb',
    profileResult.error?.message,
  );

  const storeSlug = profileResult.store?.slug ?? `${slugPrefix}-store`;
  const publicProfileBeforeContact = await getPublicStore(anon, storeSlug.toUpperCase());
  check(
    'public store lookup normalizes the slug',
    !publicProfileBeforeContact.error &&
      publicProfileBeforeContact.store?.store_slug === storeSlug,
    publicProfileBeforeContact.error?.message,
  );
  checkEqual(
    'hidden contact email is not exposed',
    publicProfileBeforeContact.store?.contact_email,
    null,
  );
  checkEqual(
    'hidden contact phone is not exposed',
    publicProfileBeforeContact.store?.contact_phone,
    null,
  );

  const contactProfileResult = await updateStoreProfile(owner.client, {
    ...storeProfile,
    slug: storeSlug,
    showContact: true,
  });
  check(
    'published contact information can be enabled',
    !contactProfileResult.error && contactProfileResult.store?.show_contact,
    contactProfileResult.error?.message,
  );

  const currentProfile = {
    ...storeProfile,
    slug: storeSlug,
    brandColor: '#2563eb',
    showContact: true,
  };
  const publicProfile = await getPublicStore(anon, storeSlug);
  check(
    'public store exposes published contact details',
    !publicProfile.error &&
      publicProfile.store?.contact_email === storeProfile.contactEmail &&
      publicProfile.store?.currency === 'RWF',
    publicProfile.error?.message,
  );

  const logoHelper = await scalarBoolean(
    'select public.is_public_store_logo($1) as value',
    [logoPath],
  );
  checkEqual('active store logo is publicly readable', logoHelper, true);
  const logoUrl = await signedUrl(anon, 'store-logos', logoPath);
  check(
    'anon can create a signed store logo URL',
    Boolean(logoUrl.url?.includes('token=')),
    typeof logoUrl.error === 'string' ? logoUrl.error : logoUrl.error?.message,
  );

  const ownerProfileResult = await getStoreProfile(owner.client, businessA);
  check(
    'owner can read the private store profile',
    !ownerProfileResult.error && ownerProfileResult.store?.id === storeAInitial.id,
    ownerProfileResult.error?.message,
  );
  const intruderProfileResult = await getStoreProfile(intruder.client, businessA);
  checkRpcError('cross-business store profile read is denied', intruderProfileResult, '42501');
  const anonProfileResult = await getStoreProfile(anon, businessA);
  checkRpcError('anonymous store profile read is denied', anonProfileResult);

  const anonStores = await anon.from('stores').select('id').eq('business_id', businessA);
  check(
    'anonymous users cannot directly read stores',
    Boolean(anonStores.error) || (anonStores.data?.length ?? 0) === 0,
    anonStores.error?.message,
  );
  const intruderStores = await intruder.client.from('stores').select('id, business_id');
  check(
    'authenticated store RLS only exposes the member business',
    !intruderStores.error &&
      (intruderStores.data ?? []).length > 0 &&
      intruderStores.data.every((row) => row.business_id === businessB),
    intruderStores.error?.message,
  );
  const anonRequests = await anon
    .from('storefront_order_requests')
    .select('id')
    .eq('business_id', businessA);
  check(
    'anonymous users cannot read idempotency records',
    Boolean(anonRequests.error) || (anonRequests.data?.length ?? 0) === 0,
    anonRequests.error?.message,
  );

  const anonUpdate = await updateStoreProfile(anon, currentProfile);
  checkRpcError('anonymous store updates are denied', anonUpdate);
  const staffUpdate = await updateStoreProfile(staff.client, currentProfile);
  checkRpcError('staff cannot update the store profile', staffUpdate, '42501');
  const intruderUpdate = await updateStoreProfile(intruder.client, currentProfile);
  checkRpcError('cross-business store updates are denied', intruderUpdate, '42501');
  const slugConflict = await updateStoreProfile(owner.client, {
    ...currentProfile,
    slug: slugB,
  });
  checkRpcError('store slug conflicts are rejected', slugConflict, '23505');

  const staffToggle = await setVisibility(staff.client, hiddenProduct.id, true);
  check(
    'staff can publish a catalogue product',
    !staffToggle.error && staffToggle.product?.storefront_visible,
    staffToggle.error?.message,
  );
  const hideAgain = await setVisibility(owner.client, hiddenProduct.id, false);
  check(
    'store manager can hide a catalogue product',
    !hideAgain.error && hideAgain.product?.storefront_visible === false,
    hideAgain.error?.message,
  );
  const intruderToggle = await setVisibility(intruder.client, simpleProduct.id, true);
  checkRpcError('cross-business product visibility changes are denied', intruderToggle, '42501');

  for (const product of [simpleProduct, variantProduct, outOfStockProduct]) {
    const visibility = await setVisibility(owner.client, product.id, true);
    check(
      `publishing ${product.sku} succeeds`,
      !visibility.error && visibility.product?.storefront_visible,
      visibility.error?.message,
    );
  }
  const draftVisibility = await setVisibility(owner.client, draftProduct.id, true);
  check(
    'draft products can be marked visible without becoming public',
    !draftVisibility.error && draftVisibility.product?.storefront_visible,
    draftVisibility.error?.message,
  );

  const managementRows = await searchManagementProducts(owner.client, businessA);
  check(
    'management catalogue lists all business products',
    !managementRows.error &&
      managementRows.rows.length === 5 &&
      Number(managementRows.rows[0]?.total_count) === 5,
    managementRows.error?.message,
  );
  const managementSearch = await searchManagementProducts(owner.client, businessA, {
    search: runId,
    status: 'draft',
  });
  check(
    'management catalogue filters by status and search',
    !managementSearch.error &&
      managementSearch.rows.length === 1 &&
      managementSearch.rows[0]?.id === draftProduct.id,
    managementSearch.error?.message,
  );
  const intruderManagement = await searchManagementProducts(intruder.client, businessA);
  checkRpcError(
    'cross-business management catalogue access is denied',
    intruderManagement,
    '42501',
  );

  const simpleInventory = await enableTracking(owner.client, simpleProduct.id);
  const variantInventory = await enableTracking(owner.client, variantProduct.id, variant.id);
  const outInventory = await enableTracking(owner.client, outOfStockProduct.id);
  check(
    'inventory tracking is enabled for public products',
    !simpleInventory.error && !variantInventory.error && !outInventory.error,
    simpleInventory.error?.message ?? variantInventory.error?.message ?? outInventory.error?.message,
  );
  const simpleReceive = await receiveStock(owner.client, simpleInventory.item.id, 5);
  const variantReceive = await receiveStock(owner.client, variantInventory.item.id, 2);
  check(
    'stock is received for public products',
    !simpleReceive.error && !variantReceive.error,
    simpleReceive.error?.message ?? variantReceive.error?.message,
  );

  const categories = await listPublicCategories(anon, storeSlug);
  check(
    'public category list only includes published products',
    !categories.error &&
      categories.rows.length === 1 &&
      categories.rows[0]?.id === categoryA &&
      Number(categories.rows[0]?.product_count) === 1,
    categories.error?.message,
  );
  const otherCategories = await listPublicCategories(anon, slugB);
  check(
    'other business products are not in the public category list',
    !otherCategories.error &&
      !otherCategories.rows.some((row) => row.id === categoryB),
    otherCategories.error?.message,
  );

  const publicRows = await searchPublicProducts(anon, storeSlug);
  check(
    'public catalogue returns only active visible products',
    !publicRows.error &&
      publicRows.rows.length === 3 &&
      Number(publicRows.rows[0]?.total_count) === 3 &&
      !publicRows.rows.some((row) => row.id === hiddenProduct.id) &&
      !publicRows.rows.some((row) => row.id === draftProduct.id) &&
      !publicRows.rows.some((row) => row.id === otherProduct.id),
    publicRows.error?.message,
  );
  const priceSortedRows = await searchPublicProducts(anon, storeSlug, {
    sort: 'price_asc',
  });
  checkEqual(
    'public catalogue sorts by price',
    priceSortedRows.rows[0]?.id,
    outOfStockProduct.id,
  );
  const searchedRows = await searchPublicProducts(anon, storeSlug, {
    search: `Simple ${runId}`,
  });
  check(
    'public catalogue search matches product names',
    !searchedRows.error &&
      searchedRows.rows.length === 1 &&
      searchedRows.rows[0]?.id === simpleProduct.id,
    searchedRows.error?.message,
  );
  const categoryRows = await searchPublicProducts(anon, storeSlug, {
    categoryId: categoryA,
  });
  check(
    'public catalogue filters by category',
    !categoryRows.error &&
      categoryRows.rows.length === 1 &&
      categoryRows.rows[0]?.id === simpleProduct.id,
    categoryRows.error?.message,
  );
  const simpleDetail = await getPublicProduct(anon, storeSlug, simpleProduct.id);
  check(
    'public product detail returns catalogue data',
    !simpleDetail.error &&
      simpleDetail.product?.id === simpleProduct.id &&
      simpleDetail.product?.availability === 'in_stock',
    simpleDetail.error?.message,
  );
  const variantDetail = await getPublicProduct(anon, storeSlug, variantProduct.id);
  check(
    'public product detail includes variants and server prices',
    !variantDetail.error &&
      variantDetail.product?.has_variants === true &&
      Number(variantDetail.product?.variants?.[0]?.price) === 1750,
    variantDetail.error?.message,
  );
  const hiddenDetail = await getPublicProduct(anon, storeSlug, hiddenProduct.id);
  checkRpcError('hidden product detail is denied', hiddenDetail, '22023');
  const otherDetail = await getPublicProduct(anon, storeSlug, otherProduct.id);
  checkRpcError('cross-store product detail is denied', otherDetail, '22023');

  const imageHelperAfter = await scalarBoolean(
    'select public.is_public_product_image($1) as value',
    [imagePath],
  );
  checkEqual('published product image is publicly readable', imageHelperAfter, true);
  const imageUrl = await signedUrl(anon, 'product-images', imagePath);
  check(
    'anon can create a signed published product image URL',
    Boolean(imageUrl.url?.includes('token=')),
    typeof imageUrl.error === 'string' ? imageUrl.error : imageUrl.error?.message,
  );
  const anonProducts = await anon
    .from('products')
    .select('id')
    .eq('id', simpleProduct.id);
  check(
    'anonymous users cannot directly read products',
    Boolean(anonProducts.error) || (anonProducts.data?.length ?? 0) === 0,
    anonProducts.error?.message,
  );

  const checkoutBase = {
    storeSlug,
    customerName: 'Online Buyer',
    phone: '+250788123456',
    email: `walkin-${runId}@example.com`,
    address: 'KG 123 Street',
    city: 'Kigali',
    instructions: 'Call on arrival',
  };
  const priceTamper = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: simpleProduct.id, quantity: 1, price: 1 }],
  });
  checkRpcError('client-supplied prices are rejected', priceTamper, '22023');
  const hiddenCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: hiddenProduct.id, quantity: 1 }],
  });
  checkRpcError('hidden products cannot be ordered', hiddenCheckout, '22023');
  const draftCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: draftProduct.id, quantity: 1 }],
  });
  checkRpcError('draft products cannot be ordered', draftCheckout, '22023');
  const outOfStockCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: outOfStockProduct.id, quantity: 1 }],
  });
  checkRpcError('out-of-stock products cannot be ordered', outOfStockCheckout, '22023');
  const missingVariantCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: variantProduct.id, quantity: 1 }],
  });
  checkRpcError('variant products require a variant selection', missingVariantCheckout, '22023');
  const unknownStoreCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    storeSlug: `${slugPrefix}-missing`,
    items: [{ product_id: simpleProduct.id, quantity: 1 }],
  });
  checkRpcError('unknown stores cannot receive orders', unknownStoreCheckout, '22023');

  const idempotencyKey = `${runId}-checkout-main`;
  const ordersBeforeCheckout = await orderCount(businessA);
  const firstCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [
      { product_id: simpleProduct.id, quantity: 2 },
      { product_id: variantProduct.id, variant_id: variant.id, quantity: 1 },
    ],
    idempotencyKey,
  });
  check(
    'anon can submit a real storefront order',
    !firstCheckout.error &&
      firstCheckout.order?.status === 'awaiting_business_approval' &&
      Number(firstCheckout.order?.total) === 4250 &&
      firstCheckout.order?.currency === 'RWF',
    firstCheckout.error?.message,
  );

  const createdOrder = await orderByNumber(firstCheckout.order.order_number);
  check(
    'storefront order is created in the shared order engine',
    Boolean(createdOrder) &&
      createdOrder.business_id === businessA &&
      createdOrder.status === 'awaiting_business_approval' &&
      createdOrder.stock_state === 'reserved' &&
      createdOrder.customer_id === null,
  );
  check(
    'delivery details are stored as order notes',
    createdOrder?.notes?.includes('Delivery address: KG 123 Street') &&
      createdOrder?.notes?.includes('City or location: Kigali') &&
      createdOrder?.notes?.includes('Customer instructions: Call on arrival'),
  );

  const createdItems = await orderItemsFor(createdOrder.id);
  checkEqual('storefront order creates two order items', createdItems.length, 2);
  check(
    'order items use server-authoritative prices',
    createdItems.some(
      (item) => item.product_id === simpleProduct.id && Number(item.unit_price) === 1250,
    ) &&
      createdItems.some(
        (item) => item.variant_id === variant.id && Number(item.unit_price) === 1750,
      ),
  );

  const simpleAfterCheckout = await inventoryFor(simpleProduct.id);
  const variantAfterCheckout = await inventoryFor(variantProduct.id, variant.id);
  check(
    'checkout reserves stock instead of reducing physical stock',
    Number(simpleAfterCheckout?.available_quantity) === 3 &&
      Number(simpleAfterCheckout?.reserved_quantity) === 2 &&
      Number(variantAfterCheckout?.available_quantity) === 1 &&
      Number(variantAfterCheckout?.reserved_quantity) === 1,
  );

  const movements = await stockMovementsFor(createdOrder.id);
  checkEqual('checkout records one stock movement per tracked item', movements.length, 2);
  check(
    'stock movements use the anonymous storefront actor',
    movements.every(
      (movement) =>
        movement.operation === 'reserve' &&
        movement.performed_by === '00000000-0000-0000-0000-000000000000' &&
        movement.performed_by_name === 'Online storefront' &&
        movement.idempotency_key.startsWith(`order:${createdOrder.id}:reserve:`),
    ),
  );

  const events = await orderEventsFor(createdOrder.id);
  checkEqual('checkout logs one order event', events.length, 1);
  check(
    'checkout event records the online store source',
    events[0]?.event_type === 'customer_confirmed' &&
      events[0]?.details?.source === 'online_store' &&
      events[0]?.actor_name === 'Online storefront',
  );

  const firstPaymentSummary = await paymentSummary(owner.client, createdOrder.id);
  checkEqual(
    'storefront orders are not treated as paid',
    firstPaymentSummary.summary?.payment_status,
    'pending',
  );
  checkEqual('storefront checkout creates no payment records', await paymentCount(businessA), 0);

  const retryCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [
      { product_id: simpleProduct.id, quantity: 2 },
      { product_id: variantProduct.id, variant_id: variant.id, quantity: 1 },
    ],
    idempotencyKey,
  });
  check(
    'idempotent checkout returns the first order',
    !retryCheckout.error &&
      retryCheckout.order?.order_number === createdOrder.order_number &&
      Number(retryCheckout.order?.total) === 4250,
    retryCheckout.error?.message,
  );
  checkEqual(
    'idempotent checkout does not create another order',
    await orderCount(businessA),
    ordersBeforeCheckout + 1,
  );
  checkEqual(
    'idempotent checkout does not reserve stock twice',
    Number((await inventoryFor(simpleProduct.id))?.reserved_quantity),
    2,
  );
  checkEqual('one idempotency record is stored', await requestCount(businessA, idempotencyKey), 1);
  const conflictingCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    customerName: 'Different Buyer',
    items: [{ product_id: simpleProduct.id, quantity: 1 }],
    idempotencyKey,
  });
  checkRpcError(
    'reusing an idempotency key with different details is rejected',
    conflictingCheckout,
    '23505',
  );

  const matchedEmail = `matched-${runId}@example.com`;
  const matchedPhone = '+250788555111';
  const customerResult = await createCustomer(owner.client, businessA, {
    fullName: 'Matched Customer',
    email: matchedEmail,
    phone: matchedPhone,
  });
  check(
    'existing customer was created for conservative matching',
    !customerResult.error && Boolean(customerResult.customer?.id),
    customerResult.error?.message,
  );
  const matchedCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    email: matchedEmail,
    phone: matchedPhone,
    items: [{ product_id: simpleProduct.id, quantity: 1 }],
    idempotencyKey: `${runId}-checkout-matched`,
  });
  const matchedOrder = await orderByNumber(matchedCheckout.order?.order_number);
  check(
    'matching email and phone links an existing customer',
    !matchedCheckout.error && matchedOrder?.customer_id === customerResult.customer.id,
    matchedCheckout.error?.message,
  );
  const unmatchedCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    email: `nomatch-${runId}@example.com`,
    phone: matchedPhone,
    items: [{ product_id: simpleProduct.id, quantity: 1 }],
    idempotencyKey: `${runId}-checkout-unmatched`,
  });
  const unmatchedOrder = await orderByNumber(unmatchedCheckout.order?.order_number);
  check(
    'partial customer details do not link a customer',
    !unmatchedCheckout.error && unmatchedOrder?.customer_id === null,
    unmatchedCheckout.error?.message,
  );

  const storefrontOrders = await searchOrders(owner.client, businessA, {
    status: 'awaiting_business_approval',
  });
  check(
    'business users can see storefront orders in the shared order list',
    !storefrontOrders.error &&
      [createdOrder.order_number, matchedOrder.order_number, unmatchedOrder.order_number].every(
        (number) => storefrontOrders.rows.some((row) => row.order_number === number),
      ),
    storefrontOrders.error?.message,
  );
  const anonOrders = await anon
    .from('orders')
    .select('id')
    .eq('order_number', createdOrder.order_number);
  check(
    'anonymous users cannot directly read storefront orders',
    Boolean(anonOrders.error) || (anonOrders.data?.length ?? 0) === 0,
    anonOrders.error?.message,
  );
  const anonReserve = await anon.rpc('reserve_storefront_order_stock', {
    p_order_id: createdOrder.id,
  });
  checkRpcError('anonymous users cannot call the internal stock reservation RPC', anonReserve);

  const inactiveProfileResult = await updateStoreProfile(owner.client, {
    ...currentProfile,
    status: 'inactive',
  });
  check(
    'store can be deactivated',
    !inactiveProfileResult.error && inactiveProfileResult.store?.status === 'inactive',
    inactiveProfileResult.error?.message,
  );
  const inactivePublicStore = await getPublicStore(anon, storeSlug);
  checkRpcError('inactive store is hidden from public lookup', inactivePublicStore, '22023');
  const inactiveProducts = await searchPublicProducts(anon, storeSlug);
  checkRpcError('inactive store catalogue is blocked', inactiveProducts, '22023');
  const inactiveCheckout = await submitStorefrontOrder(anon, {
    ...checkoutBase,
    items: [{ product_id: simpleProduct.id, quantity: 1 }],
    idempotencyKey: `${runId}-checkout-inactive`,
  });
  checkRpcError('inactive store cannot receive orders', inactiveCheckout, '22023');
  checkEqual(
    'inactive store logo is not publicly readable',
    await scalarBoolean('select public.is_public_store_logo($1) as value', [logoPath]),
    false,
  );
  checkEqual(
    'inactive store product image is not publicly readable',
    await scalarBoolean('select public.is_public_product_image($1) as value', [imagePath]),
    false,
  );

  const reactivateResult = await updateStoreProfile(owner.client, currentProfile);
  check(
    'store can be reactivated',
    !reactivateResult.error && reactivateResult.store?.status === 'active',
    reactivateResult.error?.message,
  );
  const finalPublicStore = await getPublicStore(anon, storeSlug);
  check(
    'reactivated store is publicly available again',
    !finalPublicStore.error && finalPublicStore.store?.store_slug === storeSlug,
    finalPublicStore.error?.message,
  );

  check(
    'all actor ids were created',
    Boolean(ownerId && staffId && intruderId),
  );
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}`);
  }
  await db.end();
}

console.log(`\n${results.checks} checks run; ${results.failures.length} failed.`);
if (results.failures.length > 0) {
  console.error('\nFailures:');
  for (const failure of results.failures) console.error(`- ${failure}`);
  process.exit(1);
}
