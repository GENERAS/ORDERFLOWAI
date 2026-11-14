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
      '  node --env-file=.env.local scripts/day4-catalogue-tests.mjs',
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
const emailPrefix = `day4-test-${runId}`;
const slugPrefix = `day4-${runId}`;
const password = 'Day4Test!Pass123';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0sAAAAASUVORK5CYII=',
  'base64',
);

const results = { checks: 0, failures: [] };
const storagePaths = [];
let ownerClient = null;

function check(name, condition, details = '') {
  results.checks += 1;
  if (condition) {
    console.log(`PASS  ${name}`);
    return;
  }
  const message = details ? `${name} — ${details}` : name;
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
  application_name: 'orderflow-ai-day4-catalogue-tests',
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
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
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

async function cleanup() {
  if (ownerClient) {
    for (const storagePath of storagePaths) {
      await ownerClient.storage
        .from('product-images')
        .remove([storagePath])
        .catch(() => {});
    }
  }

  await db.query('delete from public.businesses where slug like $1', [
    `${slugPrefix}%`,
  ]);
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
}

let businessA;
let businessB;

try {
  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const managerEmail = `${emailPrefix}-manager@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const intruderEmail = `${emailPrefix}-intruder@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Four Owner');
  const managerId = await createAuthUser(managerEmail, 'Day Four Manager');
  const staffId = await createAuthUser(staffEmail, 'Day Four Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Four Intruder');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Four Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Four Business B',
    slug: `${slugPrefix}-b`,
    currency: 'USD',
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, managerId, 'manager');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, intruderId, 'owner');

  const owner = await signIn(ownerEmail);
  const manager = await signIn(managerEmail);
  const staff = await signIn(staffEmail);
  const intruder = await signIn(intruderEmail);
  ownerClient = owner.client;

  check('owner, manager, staff and intruder can sign in', true);

  const bucketResult = await db.query(
    `select public, file_size_limit, allowed_mime_types
     from storage.buckets
     where id = 'product-images'`,
  );
  const bucket = bucketResult.rows[0];
  check(
    'product-images bucket is private and limited to supported image types',
    Boolean(bucket) &&
      bucket.public === false &&
      Number(bucket.file_size_limit) === 5242880 &&
      bucket.allowed_mime_types.length === 4,
  );

  const anonProducts = await anon.from('products').select('id').limit(1);
  check(
    'unauthenticated users cannot read catalogue products',
    Boolean(anonProducts.error),
  );

  const ownerCategory = await owner.client
    .from('categories')
    .insert({ business_id: businessA, name: 'Day Four Category' })
    .select('*')
    .single();
  check(
    'owner can create a category',
    !ownerCategory.error && Boolean(ownerCategory.data?.id),
    ownerCategory.error?.message,
  );
  const categoryId = ownerCategory.data?.id;

  const managerCategory = await manager.client
    .from('categories')
    .insert({ business_id: businessA, name: 'Manager Category' })
    .select('*')
    .single();
  check(
    'manager can create a category',
    !managerCategory.error && Boolean(managerCategory.data?.id),
    managerCategory.error?.message,
  );

  const staffCategory = await staff.client
    .from('categories')
    .insert({ business_id: businessA, name: 'Staff Category' })
    .select('*')
    .single();
  check(
    'staff cannot create taxonomy categories',
    Boolean(staffCategory.error),
    staffCategory.error?.message,
  );

  const childCategory = await owner.client
    .from('categories')
    .insert({
      business_id: businessA,
      parent_id: categoryId,
      name: 'Day Four Child Category',
    })
    .select('*')
    .single();
  check(
    'a category can have a parent in the same business',
    !childCategory.error && Boolean(childCategory.data?.id),
    childCategory.error?.message,
  );

  const cycleUpdate = await owner.client
    .from('categories')
    .update({ parent_id: childCategory.data?.id })
    .eq('id', categoryId)
    .eq('business_id', businessA)
    .select('id');
  check(
    'category cycles are prevented',
    Boolean(cycleUpdate.error),
    cycleUpdate.error?.message,
  );
  checkEqual(
    'category cycle error is reported as invalid data',
    cycleUpdate.error?.code,
    '22023',
  );

  const ownerBrand = await owner.client
    .from('brands')
    .insert({ business_id: businessA, name: 'Day Four Brand' })
    .select('*')
    .single();
  check(
    'owner can create a brand',
    !ownerBrand.error && Boolean(ownerBrand.data?.id),
    ownerBrand.error?.message,
  );
  const brandId = ownerBrand.data?.id;

  const staffBrand = await staff.client
    .from('brands')
    .insert({ business_id: businessA, name: 'Staff Brand' })
    .select('*')
    .single();
  check(
    'staff cannot create brands',
    Boolean(staffBrand.error),
    staffBrand.error?.message,
  );

  const materialRpc = await owner.client.rpc('create_product_attribute', {
    p_business_id: businessA,
    p_name: 'Material',
    p_data_type: 'select',
    p_is_variant_attribute: false,
    p_options: ['Cotton', 'Wool'],
  });
  const material = unwrapRpc(materialRpc.data);
  check(
    'owner can create a product attribute with options',
    !materialRpc.error && Boolean(material?.id),
    materialRpc.error?.message,
  );

  const sizeRpc = await owner.client.rpc('create_product_attribute', {
    p_business_id: businessA,
    p_name: 'Size',
    p_data_type: 'select',
    p_is_variant_attribute: true,
    p_options: ['Small', 'Large'],
  });
  const size = unwrapRpc(sizeRpc.data);
  check(
    'owner can create a variant attribute',
    !sizeRpc.error && Boolean(size?.id),
    sizeRpc.error?.message,
  );

  const staffAttribute = await staff.client.rpc('create_product_attribute', {
    p_business_id: businessA,
    p_name: 'Staff Attribute',
    p_data_type: 'text',
  });
  check(
    'staff cannot create product attributes',
    Boolean(staffAttribute.error),
    staffAttribute.error?.message,
  );
  checkEqual(
    'staff attribute creation is denied with a permission error',
    staffAttribute.error?.code,
    '42501',
  );

  const managerAttribute = await manager.client.rpc('create_product_attribute', {
    p_business_id: businessA,
    p_name: 'Finish',
    p_data_type: 'text',
  });
  check(
    'manager can create product attributes',
    !managerAttribute.error,
    managerAttribute.error?.message,
  );

  const optionsResult = await owner.client
    .from('product_attribute_options')
    .select('id, attribute_id, value')
    .eq('business_id', businessA)
    .in('attribute_id', [material?.id, size?.id]);
  const materialOptions = (optionsResult.data ?? []).filter(
    (option) => option.attribute_id === material?.id,
  );
  const sizeOptions = (optionsResult.data ?? []).filter(
    (option) => option.attribute_id === size?.id,
  );
  const cottonId = materialOptions.find((option) => option.value === 'Cotton')?.id;
  const smallId = sizeOptions.find((option) => option.value === 'Small')?.id;
  const largeId = sizeOptions.find((option) => option.value === 'Large')?.id;
  check(
    'attribute options are readable and belong to the right attributes',
    materialOptions.length === 2 && sizeOptions.length === 2,
    optionsResult.error?.message,
  );

  const productSku = `${runId}-prod`;
  const createProductRpc = await staff.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Day Four Basket',
    p_description: 'Handwoven storage basket',
    p_category_id: categoryId,
    p_brand_id: brandId,
    p_sku: productSku,
    p_barcode: `${runId}-barcode`,
    p_price: 1200,
    p_status: 'active',
    p_attributes: [{ attribute_id: material?.id, option_id: cottonId }],
    p_variants: [
      {
        name: 'Small',
        sku: `${runId}-small`,
        price_override: '1000',
        status: 'active',
        sort_order: 0,
        attributes: [{ attribute_id: size?.id, option_id: smallId }],
      },
      {
        name: 'Large',
        sku: `${runId}-large`,
        price_override: '1400',
        status: 'active',
        sort_order: 1,
        attributes: [{ attribute_id: size?.id, option_id: largeId }],
      },
    ],
  });
  const product = unwrapRpc(createProductRpc.data);
  check(
    'staff can create a product with attributes and variants',
    !createProductRpc.error && Boolean(product?.id),
    createProductRpc.error?.message,
  );
  checkEqual(
    'product currency is inherited from the business',
    product?.currency,
    'RWF',
  );
  checkEqual(
    'product SKU is normalised to uppercase',
    product?.sku,
    productSku.toUpperCase(),
  );
  if (!product?.id) {
    throw new Error('Cannot continue without a created product');
  }

  const variantsResult = await staff.client
    .from('product_variants')
    .select('*')
    .eq('business_id', businessA)
    .eq('product_id', product?.id)
    .order('sort_order', { ascending: true });
  check(
    'create_product stores both variants as active',
    !variantsResult.error &&
      variantsResult.data.length === 2 &&
      variantsResult.data.every((variant) => variant.status === 'active'),
    variantsResult.error?.message,
  );
  const firstVariant = variantsResult.data?.[0];
  const secondVariant = variantsResult.data?.[1];

  const searchRpc = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: runId,
    p_status: 'active',
    p_limit: 20,
    p_offset: 0,
  });
  const searchRow = searchRpc.data?.[0];
  check(
    'search_products finds the new product',
    !searchRpc.error && searchRpc.data?.length === 1,
    searchRpc.error?.message,
  );
  checkEqual('search result includes the category name', searchRow?.category_name, 'Day Four Category');
  checkEqual('search result includes the brand name', searchRow?.brand_name, 'Day Four Brand');
  checkEqual('search result counts active variants', Number(searchRow?.variant_count), 2);
  checkEqual('search result includes the total count', Number(searchRow?.total_count), 1);

  const updateRpc = await staff.client.rpc('update_product', {
    p_product_id: product?.id,
    p_name: 'Day Four Basket Updated',
    p_description: 'Updated basket description',
    p_category_id: categoryId,
    p_brand_id: brandId,
    p_sku: productSku,
    p_barcode: `${runId}-barcode`,
    p_price: 1300,
    p_status: 'active',
    p_attributes: [{ attribute_id: material?.id, option_id: cottonId }],
    p_variants: [
      {
        id: firstVariant?.id,
        name: firstVariant?.name,
        sku: firstVariant?.sku,
        price_override: firstVariant?.price_override,
        status: 'active',
        sort_order: 0,
        attributes: [{ attribute_id: size?.id, option_id: smallId }],
      },
    ],
  });
  check(
    'staff can update a product',
    !updateRpc.error,
    updateRpc.error?.message,
  );

  const removedVariant = await staff.client
    .from('product_variants')
    .select('id, status')
    .eq('id', secondVariant?.id)
    .single();
  checkEqual(
    'removed variants are kept but marked inactive',
    removedVariant.data?.status,
    'inactive',
  );

  const searchAfterUpdate = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: 'Day Four Basket Updated',
    p_limit: 20,
    p_offset: 0,
  });
  checkEqual(
    'search only counts active variants after an update',
    Number(searchAfterUpdate.data?.[0]?.variant_count),
    1,
  );

  const paginationProductRpc = await staff.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Day Four Pagination Product',
    p_sku: `${runId}-page`,
    p_price: 500,
    p_status: 'active',
  });
  const searchPageOne = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: runId,
    p_limit: 1,
    p_offset: 0,
  });
  const searchPageTwo = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: runId,
    p_limit: 1,
    p_offset: 1,
  });
  check(
    'search_products paginates server-side with a stable total count',
    !paginationProductRpc.error &&
      !searchPageOne.error &&
      !searchPageTwo.error &&
      searchPageOne.data?.length === 1 &&
      searchPageTwo.data?.length === 1 &&
      searchPageOne.data?.[0]?.id !== searchPageTwo.data?.[0]?.id &&
      Number(searchPageOne.data?.[0]?.total_count) === 2 &&
      Number(searchPageTwo.data?.[0]?.total_count) === 2,
    paginationProductRpc.error?.message ??
      searchPageOne.error?.message ??
      searchPageTwo.error?.message,
  );

  const duplicateSkuRpc = await staff.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Duplicate SKU Product',
    p_sku: productSku.toUpperCase(),
    p_price: 100,
    p_status: 'draft',
  });
  check(
    'product SKUs are unique per business',
    Boolean(duplicateSkuRpc.error),
    duplicateSkuRpc.error?.message,
  );
  checkEqual(
    'duplicate product SKU returns a unique violation',
    duplicateSkuRpc.error?.code,
    '23505',
  );

  const crossTableSkuRpc = await staff.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Cross Table SKU Product',
    p_price: 100,
    p_status: 'draft',
    p_variants: [
      {
        name: 'Conflict',
        sku: productSku,
        status: 'active',
        attributes: [],
      },
    ],
  });
  check(
    'variant SKUs cannot reuse a product SKU',
    Boolean(crossTableSkuRpc.error),
    crossTableSkuRpc.error?.message,
  );
  checkEqual(
    'cross-table SKU conflict returns a unique violation',
    crossTableSkuRpc.error?.code,
    '23505',
  );

  const badCurrency = await staff.client
    .from('products')
    .insert({
      business_id: businessA,
      name: 'Wrong Currency Product',
      price: 100,
      currency: 'USD',
    })
    .select('id');
  check(
    'product currency must match the business currency',
    Boolean(badCurrency.error),
    badCurrency.error?.message,
  );
  checkEqual(
    'currency mismatch returns invalid data',
    badCurrency.error?.code,
    '22023',
  );

  const negativePriceRpc = await staff.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Negative Price Product',
    p_price: -1,
    p_status: 'draft',
  });
  check(
    'negative product prices are rejected',
    Boolean(negativePriceRpc.error),
    negativePriceRpc.error?.message,
  );
  checkEqual(
    'negative price returns invalid data',
    negativePriceRpc.error?.code,
    '22023',
  );

  const archiveUpdate = await staff.client
    .from('products')
    .update({ status: 'archived' })
    .eq('id', product?.id)
    .eq('business_id', businessA)
    .select('id, status')
    .single();
  check(
    'members can archive products',
    !archiveUpdate.error && archiveUpdate.data?.status === 'archived',
    archiveUpdate.error?.message,
  );

  const archivedSearch = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: 'Day Four Basket Updated',
    p_status: 'archived',
    p_limit: 20,
    p_offset: 0,
  });
  checkEqual(
    'archived products are discoverable through the archived filter',
    archivedSearch.data?.length,
    1,
  );

  const restoreProduct = await staff.client
    .from('products')
    .update({ status: 'active' })
    .eq('id', product?.id)
    .eq('business_id', businessA)
    .select('id')
    .single();
  check(
    'members can restore an archived product to active',
    !restoreProduct.error,
    restoreProduct.error?.message,
  );

  const productDelete = await staff.client
    .from('products')
    .delete()
    .eq('id', product?.id)
    .eq('business_id', businessA)
    .select('id');
  check(
    'products cannot be hard-deleted through the API',
    Boolean(productDelete.error),
    productDelete.error?.message,
  );

  const intruderSearch = await intruder.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: runId,
    p_limit: 20,
    p_offset: 0,
  });
  check(
    'non-members cannot search another business catalogue',
    Boolean(intruderSearch.error),
    intruderSearch.error?.message,
  );
  checkEqual(
    'cross-business search is denied with a permission error',
    intruderSearch.error?.code,
    '42501',
  );

  const intruderProductCreate = await intruder.client.rpc('create_product', {
    p_business_id: businessA,
    p_name: 'Intruder Product',
    p_price: 1,
    p_status: 'draft',
  });
  check(
    'non-members cannot create products in another business',
    Boolean(intruderProductCreate.error),
    intruderProductCreate.error?.message,
  );

  const intruderCategoryRead = await intruder.client
    .from('categories')
    .select('id')
    .eq('business_id', businessA);
  check(
    'non-members cannot read another business categories',
    !intruderCategoryRead.error && intruderCategoryRead.data.length === 0,
    intruderCategoryRead.error?.message,
  );

  const ownerOtherCategoryRead = await owner.client
    .from('categories')
    .select('id')
    .eq('business_id', businessB);
  check(
    'members cannot read categories from a business they do not belong to',
    !ownerOtherCategoryRead.error && ownerOtherCategoryRead.data.length === 0,
    ownerOtherCategoryRead.error?.message,
  );

  const categoryDelete = await owner.client
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('business_id', businessA)
    .select('id');
  check(
    'categories used by products cannot be deleted',
    Boolean(categoryDelete.error),
    categoryDelete.error?.message,
  );

  const brandDelete = await owner.client
    .from('brands')
    .delete()
    .eq('id', brandId)
    .eq('business_id', businessA)
    .select('id');
  check(
    'brands used by products cannot be deleted',
    Boolean(brandDelete.error),
    brandDelete.error?.message,
  );

  const imagePath = `${businessA}/${product?.id}/${randomUUID()}.png`;
  storagePaths.push(imagePath);

  const uploadResult = await staff.client.storage
    .from('product-images')
    .upload(imagePath, new Blob([pngBytes], { type: 'image/png' }), {
      contentType: 'image/png',
      upsert: false,
    });
  check(
    'staff can upload a product image to the private bucket',
    !uploadResult.error,
    uploadResult.error?.message,
  );

  const imageInsert = await staff.client
    .from('product_images')
    .insert({
      business_id: businessA,
      product_id: product?.id,
      storage_path: imagePath,
      alt_text: 'Woven basket on a table',
      is_primary: true,
    })
    .select('*')
    .single();
  check(
    'members can attach an uploaded image to a product',
    !imageInsert.error && Boolean(imageInsert.data?.id),
    imageInsert.error?.message,
  );

  const searchWithImage = await staff.client.rpc('search_products', {
    p_business_id: businessA,
    p_search: 'Day Four Basket Updated',
    p_limit: 20,
    p_offset: 0,
  });
  checkEqual(
    'search results include the primary image path',
    searchWithImage.data?.[0]?.primary_image_path,
    imagePath,
  );
  checkEqual(
    'search results include the primary image alt text',
    searchWithImage.data?.[0]?.primary_image_alt,
    'Woven basket on a table',
  );

  const signedUrl = await staff.client.storage
    .from('product-images')
    .createSignedUrl(imagePath, 60);
  check(
    'members can create signed URLs for private product images',
    !signedUrl.error && Boolean(signedUrl.data?.signedUrl),
    signedUrl.error?.message,
  );

  const intruderSignedUrl = await intruder.client.storage
    .from('product-images')
    .createSignedUrl(imagePath, 60);
  check(
    'non-members cannot create signed URLs for another business image',
    Boolean(intruderSignedUrl.error || !intruderSignedUrl.data?.signedUrl),
    intruderSignedUrl.error?.message,
  );

  const intruderImagePath = `${businessA}/${product?.id}/${randomUUID()}.png`;
  const intruderUpload = await intruder.client.storage
    .from('product-images')
    .upload(
      intruderImagePath,
      new Blob([pngBytes], { type: 'image/png' }),
      { contentType: 'image/png', upsert: false },
    );
  check(
    'non-members cannot upload into another business image folder',
    Boolean(intruderUpload.error),
    intruderUpload.error?.message,
  );

  const crossBusinessImagePath = `${businessB}/${product?.id}/${randomUUID()}.png`;
  const crossBusinessUpload = await staff.client.storage
    .from('product-images')
    .upload(
      crossBusinessImagePath,
      new Blob([pngBytes], { type: 'image/png' }),
      { contentType: 'image/png', upsert: false },
    );
  check(
    'members cannot upload into a different business image folder',
    Boolean(crossBusinessUpload.error),
    crossBusinessUpload.error?.message,
  );

  const disallowedMimePath = `${businessA}/${product?.id}/${randomUUID()}.txt`;
  const disallowedMimeUpload = await staff.client.storage
    .from('product-images')
    .upload(disallowedMimePath, new Blob(['not an image'], { type: 'text/plain' }), {
      contentType: 'text/plain',
      upsert: false,
    });
  check(
    'the storage bucket rejects unsupported image types',
    Boolean(disallowedMimeUpload.error),
    disallowedMimeUpload.error?.message,
  );

  const invalidImageRow = await staff.client
    .from('product_images')
    .insert({
      business_id: businessA,
      product_id: product?.id,
      storage_path: `${businessA}/${randomUUID()}/${randomUUID()}.png`,
      alt_text: 'Wrong product path',
    })
    .select('id');
  check(
    'product image rows must use the business and product path',
    Boolean(invalidImageRow.error),
    invalidImageRow.error?.message,
  );

  const imageDelete = await staff.client
    .from('product_images')
    .delete()
    .eq('id', imageInsert.data?.id)
    .eq('business_id', businessA)
    .select('id');
  check(
    'members can remove product image records',
    !imageDelete.error,
    imageDelete.error?.message,
  );
} catch (error) {
  results.failures.push(`Unexpected error: ${error.message}`);
  console.error(error);
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    results.failures.push(`Cleanup failed: ${cleanupError.message}`);
    console.error(cleanupError);
  }
  await db.end();
}

if (results.failures.length > 0) {
  console.error(`\n${results.failures.length} of ${results.checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nDay 4 catalogue and security tests passed (${results.checks} checks).`);
}
