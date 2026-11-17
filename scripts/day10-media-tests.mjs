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
      '  node --env-file=.env.local scripts/day10-media-tests.mjs',
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
const emailPrefix = `day10-test-${runId}`;
const slugPrefix = `day10-${runId}`;
const password = 'Day10Test!Pass123';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2h9sAAAAASUVORK5CYII=',
  'base64',
);

const results = { checks: 0, failures: [] };
const uploadedObjects = [];
let businessA;
let businessB;

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
  if (code && result.error?.code !== code) {
    console.error(
      `DETAIL  ${name}: code=${result.error?.code ?? 'none'} message=${result.error?.message ?? 'none'}`,
    );
  }
  if (code) checkEqual(`${name} error code`, result.error?.code, code);
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
  application_name: 'orderflow-ai-day10-media-tests',
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

async function createProduct(client, businessId, sku) {
  const { data, error } = await client.rpc('create_product', {
    p_business_id: businessId,
    p_name: `Day Ten ${sku}`,
    p_description: 'Day 10 media lifecycle test product.',
    p_category_id: null,
    p_brand_id: null,
    p_sku: sku,
    p_barcode: null,
    p_price: 1500,
    p_status: 'active',
    p_attributes: [],
    p_variants: [],
  });
  return { product: unwrapRpc(data), error };
}

async function storeForBusiness(businessId) {
  const { rows } = await db.query(
    'select * from public.stores where business_id = $1',
    [businessId],
  );
  return rows[0] ?? null;
}

async function updateStore(client, businessId, patch = {}) {
  const current = await storeForBusiness(businessId);
  const { data, error } = await client.rpc('update_store_profile', {
    p_business_id: businessId,
    p_slug: patch.slug ?? current.slug,
    p_name: patch.name ?? current.name,
    p_description: patch.description ?? current.description,
    p_logo_path: patch.logoPath ?? null,
    p_logo_media_asset_id: patch.logoMediaAssetId ?? null,
    p_contact_email: patch.contactEmail ?? current.contact_email,
    p_contact_phone: patch.contactPhone ?? current.contact_phone,
    p_contact_address: patch.contactAddress ?? current.contact_address,
    p_show_contact: patch.showContact ?? current.show_contact,
    p_brand_color: patch.brandColor ?? current.brand_color,
    p_status: patch.status ?? current.status,
  });
  return { store: unwrapRpc(data), error };
}

async function startUpload(client, params) {
  const { data, error } = await client.rpc('media_start_upload', {
    p_business_id: params.businessId,
    p_client_request_id: params.requestId ?? randomUUID(),
    p_provider: params.provider,
    p_asset_category: params.category,
    p_original_filename: params.filename ?? 'pixel.png',
    p_mime_type: params.mimeType ?? 'image/png',
    p_file_size: params.fileSize ?? pngBytes.length,
    p_product_id: params.productId ?? null,
  });
  return { asset: unwrapRpc(data), error };
}

async function completeUpload(client, asset) {
  const { data, error } = await client.rpc('media_complete_upload', {
    p_media_asset_id: asset.id,
    p_provider_file_id: asset.provider_file_id,
    p_delivery_url: null,
    p_bytes: pngBytes.length,
    p_width: null,
    p_height: null,
    p_metadata: {},
  });
  return { asset: unwrapRpc(data), error };
}

async function uploadAsset(client, params) {
  const started = await startUpload(client, params);
  if (started.error) return { error: started.error, asset: started.asset };

  const signed = await client.storage
    .from(started.asset.bucket)
    .createSignedUploadUrl(started.asset.provider_file_id, { upsert: false });
  if (signed.error) return { error: signed.error, asset: started.asset };

  const response = await fetch(signed.data.signedUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'image/png',
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: pngBytes,
  });
  if (!response.ok) {
    return {
      error: new Error(`Signed upload returned ${response.status}`),
      asset: started.asset,
    };
  }

  uploadedObjects.push({
    bucket: started.asset.bucket,
    objectPath: started.asset.provider_file_id,
    client,
  });

  const completed = await completeUpload(client, started.asset);
  return { ...completed, started: started.asset };
}

async function usageFor(client, businessId) {
  const { data, error } = await client.rpc('get_business_media_usage', {
    p_business_id: businessId,
  });
  return { usage: unwrapRpc(data), error };
}

async function scalarNumber(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.value ?? 0);
}

async function scalarBoolean(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return Boolean(rows[0]?.value);
}

async function queryFails(name, sql, params, code) {
  try {
    await db.query(sql, params);
    check(name, false, 'expected the query to fail');
  } catch (error) {
    checkEqual(name, error.code, code);
  }
}

async function signedObjectAccessible(bucket, objectPath) {
  const { data, error } = await anon.storage.from(bucket).createSignedUrl(objectPath, 60);
  if (error || !data?.signedUrl) return false;
  const response = await fetch(data.signedUrl);
  return response.ok;
}

async function cleanup() {
  for (const bucket of ['product-images', 'store-logos']) {
    const objects = uploadedObjects.filter((object) => object.bucket === bucket);
    const paths = objects.map((object) => object.objectPath);
    if (objects[0]?.client && paths.length > 0) {
      await objects[0].client.storage.from(bucket).remove(paths);
    }
  }
  uploadedObjects.length = 0;

  const ids = [businessA, businessB].filter(Boolean);
  if (ids.length > 0) {
    await db.query(
      'delete from public.product_images where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'update public.stores set logo_media_asset_id = null where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.media_upload_limits where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query(
      'delete from public.media_assets where business_id = any($1::uuid[])',
      [ids],
    );
    await db.query('delete from public.stores where business_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.products where business_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.categories where business_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.business_members where business_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.businesses where id = any($1::uuid[])', [ids]);
  }
  await db.query('delete from auth.users where email like $1', [`${emailPrefix}-%`]);
}

try {
  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const intruderEmail = `${emailPrefix}-intruder@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Ten Owner');
  const staffId = await createAuthUser(staffEmail, 'Day Ten Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Ten Other Owner');

  businessA = randomUUID();
  businessB = randomUUID();
  const slugA = `${slugPrefix}-a`;
  const slugB = `${slugPrefix}-b`;

  await insertBusiness({
    id: businessA,
    name: 'Day Ten Business A',
    slug: slugA,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Ten Business B',
    slug: slugB,
    currency: 'USD',
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, intruderId, 'owner');

  const owner = await signIn(ownerEmail);
  const staff = await signIn(staffEmail);
  const intruder = await signIn(intruderEmail);

  const productResult = await createProduct(owner.client, businessA, `${runId}-MEDIA`);
  check('test product was created', !productResult.error && Boolean(productResult.product), productResult.error?.message);
  const product = productResult.product;

  const configResult = await owner.client.rpc('media_get_provider_config');
  const config = unwrapRpc(configResult.data);
  check('authenticated members can read the provider config', !configResult.error, configResult.error?.message);
  check(
    'configured provider is supported',
    ['supabase', 'cloudinary'].includes(config?.provider),
    config?.provider,
  );
  check('configured file limit is positive', Number(config?.max_file_bytes) > 0);
  check(
    'configured MIME types are image types',
    Array.isArray(config?.allowed_mime_types) &&
      config.allowed_mime_types.every((type) => type.startsWith('image/')),
  );
  checkEqual('supabase is the active provider for storage lifecycle tests', config.provider, 'supabase');

  const anonConfig = await anon.rpc('media_get_provider_config');
  checkRpcError('anonymous users cannot read the provider config', anonConfig);

  const ownerConfigChange = await owner.client.rpc('set_media_provider_config', {
    p_provider: 'supabase',
  });
  checkRpcError('workspace owners cannot change the media provider', ownerConfigChange, '42501');

  const baseParams = {
    businessId: businessA,
    provider: config.provider,
    category: 'product_image',
    productId: product.id,
  };

  const invalidCategory = await startUpload(owner.client, {
    ...baseParams,
    category: 'document',
  });
  checkRpcError('unsupported media categories are rejected', invalidCategory, '22023');

  const invalidMime = await startUpload(owner.client, {
    ...baseParams,
    mimeType: 'image/gif',
  });
  checkRpcError('unsupported image types are rejected', invalidMime, '22023');

  const tooLarge = await startUpload(owner.client, {
    ...baseParams,
    fileSize: Number(config.max_file_bytes) + 1,
  });
  checkRpcError('oversized uploads are rejected', tooLarge, '22023');

  const invalidProduct = await startUpload(owner.client, {
    ...baseParams,
    productId: randomUUID(),
  });
  checkRpcError('product uploads require a valid product', invalidProduct, '22023');

  const anonStart = await startUpload(anon, baseParams);
  checkRpcError('anonymous users cannot start uploads', anonStart, '42501');

  const intruderStart = await startUpload(intruder.client, baseParams);
  checkRpcError('cross-business uploads are denied', intruderStart, '42501');

  const requestId = randomUUID();
  const started = await startUpload(owner.client, { ...baseParams, requestId });
  check('owner can start a product image upload', !started.error && started.asset?.status === 'pending', started.error?.message);
  if (started.error) throw new Error(`Upload start failed: ${JSON.stringify(started.error)}`);
  check('started upload uses the configured provider', started.asset?.provider === config.provider);
  check('started upload uses the product image bucket', started.asset?.bucket === 'product-images');
  check(
    'started product image path includes business and product',
    started.asset?.provider_file_id?.startsWith(`${businessA}/${product.id}/`),
  );

  const duplicate = await startUpload(owner.client, { ...baseParams, requestId });
  checkEqual('upload start is idempotent by client request id', duplicate.asset?.id, started.asset.id);

  const ownerRows = await owner.client
    .from('media_assets')
    .select('id')
    .eq('id', started.asset.id);
  checkEqual('owner can read its media asset', ownerRows.data?.length ?? 0, 1);

  const intruderRows = await intruder.client
    .from('media_assets')
    .select('id')
    .eq('id', started.asset.id);
  check(
    'non-members cannot read another business media asset',
    Boolean(intruderRows.error) || (intruderRows.data?.length ?? 0) === 0,
  );

  const anonRows = await anon.from('media_assets').select('id').eq('id', started.asset.id);
  check(
    'anonymous users cannot read media assets',
    Boolean(anonRows.error) || (anonRows.data?.length ?? 0) === 0,
  );

  const authorization = await owner.client.rpc('media_get_upload_authorization', {
    p_media_asset_id: started.asset.id,
  });
  const authRow = unwrapRpc(authorization.data);
  check('owner can read upload authorization', !authorization.error, authorization.error?.message);
  checkEqual('authorization refers to the pending asset', authRow?.status, 'pending');
  checkEqual('authorization preserves the private file path', authRow?.providerFileId, started.asset.provider_file_id);

  const intruderAuth = await intruder.client.rpc('media_get_upload_authorization', {
    p_media_asset_id: started.asset.id,
  });
  checkRpcError('cross-business upload authorization is denied', intruderAuth, '42501');

  const usageBefore = await usageFor(owner.client, businessA);
  check('owner can read media usage', !usageBefore.error, usageBefore.error?.message);

  const uploaded = await uploadAsset(owner.client, { ...baseParams, requestId });
  check('signed storage upload and completion succeed', !uploaded.error, uploaded.error?.message);
  checkEqual('completed asset is ready', uploaded.asset?.status, 'ready');
  check('private assets have no public delivery URL', uploaded.asset?.delivery_url == null);
  check('completion records the uploaded byte count', Number(uploaded.asset?.file_size) === pngBytes.length);

  const attach = await owner.client.rpc('media_attach_product_image', {
    p_media_asset_id: started.asset.id,
    p_product_id: product.id,
    p_alt_text: 'Day 10 pixel',
    p_is_primary: true,
  });
  const imageRow = unwrapRpc(attach.data);
  check('completed asset can be attached to a product', !attach.error, attach.error?.message);
  checkEqual('attachment records the media asset', imageRow?.media_asset_id, started.asset.id);
  checkEqual('attachment uses the private storage path', imageRow?.storage_path, started.asset.provider_file_id);

  const attachedCount = await scalarNumber(
    'select count(*)::int as value from public.product_images where media_asset_id = $1',
    [started.asset.id],
  );
  checkEqual('the media asset is linked to one product image', attachedCount, 1);

  const directInvalidPath = await db.query(
    `insert into public.product_images (business_id, product_id, storage_path)
     values ($1, $2, '../invalid.png')`,
    [businessA, product.id],
  ).catch((error) => error);
  check('product image path traversal is rejected', directInvalidPath instanceof Error && directInvalidPath.code === '22023');

  const inUseDelete = await owner.client.rpc('media_mark_deleted', {
    p_media_asset_id: started.asset.id,
  });
  checkRpcError('an attached media asset cannot be marked deleted', inUseDelete, '23503');

  const resolver = await anon.rpc('media_resolve_image_urls', {
    p_paths: [started.asset.provider_file_id],
    p_width: null,
  });
  check('anonymous callers can resolve media URLs', !resolver.error, resolver.error?.message);
  check(
    'private storage paths are not converted to Cloudinary URLs',
    resolver.data?.[started.asset.provider_file_id] == null,
  );

  const unknownCloudinary = await anon.rpc('media_resolve_image_urls', {
    p_paths: ['cloudinary:unknown/image'],
    p_width: null,
  });
  check(
    'unknown Cloudinary references are not given fabricated URLs',
    !unknownCloudinary.error && unknownCloudinary.data?.['cloudinary:unknown/image'] == null,
  );

  const visibility = await owner.client.rpc('set_storefront_product_visibility', {
    p_product_id: product.id,
    p_visible: true,
  });
  check('product can be published to the storefront', !visibility.error, visibility.error?.message);

  const publicProduct = await anon.rpc('get_storefront_product', {
    p_store_slug: slugA,
    p_product_id: product.id,
  });
  const productRow = unwrapRpc(publicProduct.data);
  check('public product detail resolves the attached image', !publicProduct.error, publicProduct.error?.message);
  check(
    'public product detail includes the private image path',
    productRow?.images?.some((row) => row.path === started.asset.provider_file_id),
  );
  checkEqual(
    'attached image is publicly readable',
    await scalarBoolean('select public.is_public_product_image($1) as value', [started.asset.provider_file_id]),
    true,
  );
  check('published image can be fetched through an anon signed URL', await signedObjectAccessible('product-images', started.asset.provider_file_id));

  const failedStart = await startUpload(owner.client, {
    ...baseParams,
    category: 'store_logo',
    productId: null,
  });
  const failedMark = await owner.client.rpc('media_fail_upload', {
    p_media_asset_id: failedStart.asset.id,
    p_error_message: 'Day 10 simulated client failure.',
  });
  check('an upload can be marked failed', !failedMark.error, failedMark.error?.message);
  checkEqual('failed asset status', unwrapRpc(failedMark.data)?.status, 'failed');
  const failedComplete = await completeUpload(owner.client, failedStart.asset);
  checkRpcError('failed uploads cannot be completed', failedComplete, '22023');

  const logoUpload = await uploadAsset(owner.client, {
    businessId: businessA,
    provider: config.provider,
    category: 'store_logo',
    productId: null,
    filename: 'logo.png',
  });
  check('store logo upload succeeds', !logoUpload.error, logoUpload.error?.message);

  await queryFails(
    'store logo path traversal is rejected',
    'update public.stores set logo_path = $2 where business_id = $1',
    [businessA, '../invalid.png'],
    '22023',
  );

  const logoUpdate = await updateStore(owner.client, businessA, {
    logoPath: logoUpload.asset.provider_file_id,
    logoMediaAssetId: logoUpload.asset.id,
  });
  check('ready logo asset can be attached to the store', !logoUpdate.error, logoUpdate.error?.message);
  checkEqual('store records the logo media asset', logoUpdate.store?.logo_media_asset_id, logoUpload.asset.id);
  checkEqual('store records the private logo path', logoUpdate.store?.logo_path, logoUpload.asset.provider_file_id);

  const ownerProfile = await owner.client.rpc('get_store_profile', {
    p_business_id: businessA,
  });
  check('owner can read the store profile with media fields', !ownerProfile.error, ownerProfile.error?.message);
  checkEqual(
    'store profile exposes the logo media asset id',
    unwrapRpc(ownerProfile.data)?.logo_media_asset_id,
    logoUpload.asset.id,
  );

  const publicStore = await anon.rpc('get_public_store', { p_store_slug: slugA });
  check('public store lookup includes the logo path', !publicStore.error, publicStore.error?.message);
  checkEqual(
    'public store exposes the private logo path',
    unwrapRpc(publicStore.data)?.logo_path,
    logoUpload.asset.provider_file_id,
  );
  checkEqual(
    'store logo is publicly readable',
    await scalarBoolean('select public.is_public_store_logo($1) as value', [logoUpload.asset.provider_file_id]),
    true,
  );
  check('published logo can be fetched through an anon signed URL', await signedObjectAccessible('store-logos', logoUpload.asset.provider_file_id));

  const intruderLogoUpdate = await updateStore(intruder.client, businessA, {
    logoMediaAssetId: logoUpload.asset.id,
  });
  checkRpcError('cross-business logo attachment is denied', intruderLogoUpdate, '42501');

  const usageAfter = await usageFor(owner.client, businessA);
  check('usage remains readable after uploads', !usageAfter.error, usageAfter.error?.message);
  checkEqual(
    'ready file count increased by the two completed uploads',
    Number(usageAfter.usage?.readyFiles) - Number(usageBefore.usage?.readyFiles),
    2,
  );
  checkEqual(
    'image file count increased by the two completed uploads',
    Number(usageAfter.usage?.imageFiles) - Number(usageBefore.usage?.imageFiles),
    2,
  );
  checkEqual(
    'storage usage increased by the uploaded byte count',
    Number(usageAfter.usage?.totalBytes) - Number(usageBefore.usage?.totalBytes),
    pngBytes.length * 2,
  );

  await db.query(
    'insert into public.platform_admins (user_id) values ($1)',
    [ownerId],
  );

  const adminConfigChange = await owner.client.rpc('set_media_provider_config', {
    p_provider: 'supabase',
  });
  check('platform admins can read and confirm provider config', !adminConfigChange.error, adminConfigChange.error?.message);

  const invalidConfigChange = await owner.client.rpc('set_media_provider_config', {
    p_provider: 'unsupported',
  });
  checkRpcError('unsupported providers are rejected', invalidConfigChange, '22023');

  const limitResult = await owner.client.rpc('set_business_media_limits', {
    p_business_id: businessA,
    p_max_files: Number(usageAfter.usage.readyFiles),
    p_max_total_bytes: null,
  });
  check('platform admins can configure business media limits', !limitResult.error, limitResult.error?.message);

  const limitedUsage = await usageFor(owner.client, businessA);
  checkEqual(
    'usage reports the configured file limit',
    Number(limitedUsage.usage?.maxFiles),
    Number(usageAfter.usage.readyFiles),
  );

  const blockedByLimit = await startUpload(owner.client, {
    ...baseParams,
    category: 'store_logo',
    productId: null,
  });
  checkRpcError('media file limits block new uploads', blockedByLimit, '22023');

  const resetLimits = await owner.client.rpc('set_business_media_limits', {
    p_business_id: businessA,
    p_max_files: null,
    p_max_total_bytes: null,
  });
  check('media limits can be cleared', !resetLimits.error, resetLimits.error?.message);

  const logoRemoval = await updateStore(owner.client, businessA, {
    logoPath: null,
    logoMediaAssetId: null,
  });
  check('store logo can be removed', !logoRemoval.error, logoRemoval.error?.message);
  check('removed logo has no path', logoRemoval.store?.logo_path == null);
  check('removed logo has no media asset reference', logoRemoval.store?.logo_media_asset_id == null);

  const logoObjectRemoval = await owner.client.storage
    .from('store-logos')
    .remove([logoUpload.asset.provider_file_id]);
  check('removed logo object can be deleted from storage', !logoObjectRemoval.error, logoObjectRemoval.error?.message);
  uploadedObjects.splice(
    uploadedObjects.findIndex((object) => object.objectPath === logoUpload.asset.provider_file_id),
    1,
  );

  const logoMarkDeleted = await owner.client.rpc('media_mark_deleted', {
    p_media_asset_id: logoUpload.asset.id,
  });
  check('unreferenced logo asset can be marked deleted', !logoMarkDeleted.error, logoMarkDeleted.error?.message);
  checkEqual('deleted logo asset status', unwrapRpc(logoMarkDeleted.data)?.status, 'deleted');
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
