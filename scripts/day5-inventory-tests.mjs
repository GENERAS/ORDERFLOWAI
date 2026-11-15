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
      '  node --env-file=.env.local scripts/day5-inventory-tests.mjs',
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
const emailPrefix = `day5-test-${runId}`;
const slugPrefix = `day5-${runId}`;
const password = 'Day5Test!Pass123';

const results = { checks: 0, failures: [] };

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

function checkRpcError(name, result, code) {
  check(name, Boolean(result.error), result.error?.message ?? 'expected an error');
  if (code) {
    checkEqual(`${name} error code`, result.error?.code, code);
  }
}

const db = new Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: databasePassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'orderflow-ai-day5-inventory-tests',
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
  await db.query('delete from public.businesses where slug like $1', [
    `${slugPrefix}%`,
  ]);
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
}

async function searchInventory(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_inventory', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_status: options.status ?? null,
    p_category_id: options.categoryId ?? null,
    p_inventory_item_id: options.inventoryItemId ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_sort: options.sort ?? 'name',
    p_direction: options.direction ?? 'asc',
  });
  return { rows: data ?? [], error };
}

async function stock(client, itemId, operation, quantityChange, options = {}) {
  const { data, error } = await client.rpc('record_stock_operation', {
    p_inventory_item_id: itemId,
    p_operation: operation,
    p_quantity_change: quantityChange,
    p_reason: options.reason ?? null,
    p_idempotency_key: options.key ?? randomUUID(),
  });
  return { movement: unwrapRpc(data), error };
}

async function overview(client, businessId) {
  const { data, error } = await client.rpc('get_inventory_overview', {
    p_business_id: businessId,
  });
  return { value: unwrapRpc(data), error };
}

async function movementHistory(client, businessId, options = {}) {
  const { data, error } = await client.rpc('list_stock_movements', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_operation: options.operation ?? null,
    p_inventory_item_id: options.inventoryItemId ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function createProduct(client, businessId, payload) {
  const { data, error } = await client.rpc('create_product', {
    p_business_id: businessId,
    p_name: payload.name,
    p_description: payload.description ?? null,
    p_category_id: payload.categoryId ?? null,
    p_brand_id: null,
    p_sku: payload.sku,
    p_barcode: payload.barcode ?? null,
    p_price: payload.price ?? 0,
    p_status: payload.status ?? 'active',
    p_attributes: [],
    p_variants: payload.variants ?? [],
  });
  return { product: unwrapRpc(data), error };
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

  const ownerId = await createAuthUser(ownerEmail, 'Day Five Owner');
  const managerId = await createAuthUser(managerEmail, 'Day Five Manager');
  const staffId = await createAuthUser(staffEmail, 'Day Five Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Five Intruder');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Five Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Five Business B',
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

  check('owner, manager, staff and intruder can sign in', true);

  const categoryResult = await owner.client
    .from('categories')
    .insert({ business_id: businessA, name: 'Day Five Category' })
    .select('*')
    .single();
  check(
    'owner can create a catalogue category',
    !categoryResult.error && Boolean(categoryResult.data?.id),
    categoryResult.error?.message,
  );
  const categoryId = categoryResult.data?.id;

  const simpleResult = await createProduct(owner.client, businessA, {
    name: 'Simple Widget',
    categoryId,
    sku: `${runId}-simple`,
    barcode: `${runId}-simple-barcode`,
    price: 1000,
  });
  check(
    'owner creates a product without variants',
    !simpleResult.error && Boolean(simpleResult.product?.id),
    simpleResult.error?.message,
  );

  const variantResult = await createProduct(owner.client, businessA, {
    name: 'Variant Shirt',
    categoryId,
    sku: `${runId}-shirt`,
    price: 2000,
    variants: [
      {
        name: 'Small',
        sku: `${runId}-shirt-small`,
        status: 'active',
        sort_order: 0,
        attributes: [],
      },
      {
        name: 'Large',
        sku: `${runId}-shirt-large`,
        status: 'active',
        sort_order: 1,
        attributes: [],
      },
    ],
  });
  check(
    'owner creates a product with variants',
    !variantResult.error && Boolean(variantResult.product?.id),
    variantResult.error?.message,
  );

  const zeroResult = await createProduct(owner.client, businessA, {
    name: 'Zero Target',
    sku: `${runId}-zero`,
    price: 500,
  });
  check(
    'owner creates a second simple product',
    !zeroResult.error && Boolean(zeroResult.product?.id),
    zeroResult.error?.message,
  );

  const scopeResult = await createProduct(owner.client, businessA, {
    name: 'Scope Product',
    sku: `${runId}-scope`,
    price: 500,
  });
  check(
    'owner creates a product for inventory scope checks',
    !scopeResult.error && Boolean(scopeResult.product?.id),
    scopeResult.error?.message,
  );

  const concurrencyResult = await createProduct(owner.client, businessA, {
    name: 'Concurrency Product',
    sku: `${runId}-concurrency`,
    price: 500,
  });
  check(
    'owner creates a product for concurrency checks',
    !concurrencyResult.error && Boolean(concurrencyResult.product?.id),
    concurrencyResult.error?.message,
  );

  const otherResult = await createProduct(intruder.client, businessB, {
    name: 'Other Business Product',
    sku: `${runId}-other`,
    price: 500,
  });
  check(
    'second business creates its own product',
    !otherResult.error && Boolean(otherResult.product?.id),
    otherResult.error?.message,
  );

  const simple = simpleResult.product;
  const variantProduct = variantResult.product;
  const zeroProduct = zeroResult.product;
  const scopeProduct = scopeResult.product;
  const concurrencyProduct = concurrencyResult.product;

  if (
    !simple?.id ||
    !variantProduct?.id ||
    !zeroProduct?.id ||
    !scopeProduct?.id ||
    !concurrencyProduct?.id
  ) {
    throw new Error('Cannot continue without created products.');
  }

  const variantsResult = await owner.client
    .from('product_variants')
    .select('*')
    .eq('business_id', businessA)
    .eq('product_id', variantProduct.id)
    .order('sort_order', { ascending: true });
  check(
    'variant product has two active variants',
    !variantsResult.error &&
      variantsResult.data?.length === 2 &&
      variantsResult.data.every((variant) => variant.status === 'active'),
    variantsResult.error?.message,
  );
  const [smallVariant, largeVariant] = variantsResult.data ?? [];

  const anonItems = await anon.from('inventory_items').select('id').limit(1);
  check('unauthenticated users cannot read inventory items', Boolean(anonItems.error));
  const anonMovements = await anon
    .from('stock_movements')
    .select('id')
    .limit(1);
  check(
    'unauthenticated users cannot read stock movements',
    Boolean(anonMovements.error),
  );
  const anonSearch = await searchInventory(anon, businessA);
  checkRpcError('unauthenticated users cannot search inventory', anonSearch, '42501');

  const initialSearch = await searchInventory(staff.client, businessA);
  check(
    'inventory search returns one row per product or variant',
    !initialSearch.error && initialSearch.rows.length === 6,
    initialSearch.error?.message,
  );
  checkEqual(
    'inventory search totals product and variant units',
    Number(initialSearch.rows[0]?.total_count),
    6,
  );
  check(
    'new catalogue units start untracked',
    initialSearch.rows.every((row) => row.inventory_status === 'untracked'),
  );

  const initialOverview = await overview(manager.client, businessA);
  check(
    'inventory overview returns real initial metrics',
    !initialOverview.error &&
      Number(initialOverview.value?.total_units) === 6 &&
      Number(initialOverview.value?.tracked_units) === 0 &&
      Number(initialOverview.value?.untracked_units) === 6 &&
      Number(initialOverview.value?.total_physical) === 0,
    initialOverview.error?.message,
  );

  const categorySearch = await searchInventory(owner.client, businessA, {
    categoryId,
  });
  check(
    'inventory search filters by category',
    !categorySearch.error && categorySearch.rows.length === 3,
    categorySearch.error?.message,
  );

  const pageSearch = await searchInventory(owner.client, businessA, {
    limit: 2,
    offset: 0,
  });
  check(
    'inventory search paginates on the server',
    !pageSearch.error &&
      pageSearch.rows.length === 2 &&
      Number(pageSearch.rows[0]?.total_count) === 6,
    pageSearch.error?.message,
  );

  const directInsert = await owner.client
    .from('inventory_items')
    .insert({ business_id: businessA, product_id: simple.id })
    .select('id');
  check(
    'authenticated clients cannot write inventory balances directly',
    Boolean(directInsert.error),
  );

  const staffEnable = await staff.client.rpc('enable_inventory_tracking', {
    p_product_id: simple.id,
    p_low_stock_threshold: 5,
  });
  checkRpcError(
    'staff cannot change inventory tracking settings',
    staffEnable,
    '42501',
  );

  const simpleEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: simple.id,
    p_low_stock_threshold: 5,
  });
  const simpleItem = unwrapRpc(simpleEnable.data);
  check(
    'manager enables stock tracking for a simple product',
    !simpleEnable.error &&
      Boolean(simpleItem?.id) &&
      simpleItem?.is_tracked === true,
    simpleEnable.error?.message,
  );
  if (!simpleItem?.id) throw new Error('Cannot continue without inventory item.');

  const trackedSearch = await searchInventory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
  });
  check(
    'newly tracked stock starts out of stock',
    !trackedSearch.error &&
      trackedSearch.rows[0]?.inventory_status === 'out_of_stock' &&
      Number(trackedSearch.rows[0]?.available_quantity) === 0,
    trackedSearch.error?.message,
  );

  const directUpdate = await owner.client
    .from('inventory_items')
    .update({ physical_quantity: 999 })
    .eq('id', simpleItem.id)
    .select('id');
  check(
    'authenticated clients cannot update inventory balances directly',
    Boolean(directUpdate.error),
  );

  const receive = await stock(staff.client, simpleItem.id, 'receive', 100, {
    reason: 'Opening stock',
  });
  check(
    'staff can receive stock',
    !receive.error &&
      receive.movement?.operation === 'receive' &&
      receive.movement?.quantity_change === 100 &&
      receive.movement?.new_physical === 100,
    receive.error?.message,
  );

  const afterReceive = await searchInventory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
  });
  check(
    'receiving stock updates physical and available quantities',
    !afterReceive.error &&
      Number(afterReceive.rows[0]?.physical_quantity) === 100 &&
      Number(afterReceive.rows[0]?.reserved_quantity) === 0 &&
      Number(afterReceive.rows[0]?.available_quantity) === 100 &&
      afterReceive.rows[0]?.inventory_status === 'in_stock',
    afterReceive.error?.message,
  );

  const reserve = await stock(staff.client, simpleItem.id, 'reserve', 15, {
    reason: 'Customer hold',
  });
  check(
    'staff can reserve stock',
    !reserve.error &&
      reserve.movement?.new_physical === 100 &&
      reserve.movement?.new_reserved === 15,
    reserve.error?.message,
  );

  const afterReserve = await searchInventory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
  });
  checkEqual(
    'available stock excludes reservations',
    Number(afterReserve.rows[0]?.available_quantity),
    85,
  );

  const overReserve = await stock(staff.client, simpleItem.id, 'reserve', 90);
  checkRpcError('reservations cannot exceed available stock', overReserve, '22023');

  const release = await stock(staff.client, simpleItem.id, 'release', -15, {
    reason: 'Customer hold released',
  });
  check(
    'staff can release reserved stock',
    !release.error &&
      release.movement?.new_physical === 100 &&
      release.movement?.new_reserved === 0,
    release.error?.message,
  );

  const reduce = await stock(staff.client, simpleItem.id, 'reduce', -20, {
    reason: 'Stock sold',
  });
  check(
    'staff can reduce stock',
    !reduce.error && reduce.movement?.new_physical === 80,
    reduce.error?.message,
  );

  const overReduce = await stock(staff.client, simpleItem.id, 'reduce', -90);
  checkRpcError('stock cannot be reduced below zero', overReduce, '22023');

  const damage = await stock(staff.client, simpleItem.id, 'damage', -5, {
    reason: 'Damaged in storage',
  });
  check(
    'damaged stock reduces physical quantity',
    !damage.error && damage.movement?.new_physical === 75,
    damage.error?.message,
  );

  const loss = await stock(staff.client, simpleItem.id, 'loss', -5, {
    reason: 'Missing item',
  });
  check(
    'lost stock reduces physical quantity',
    !loss.error && loss.movement?.new_physical === 70,
    loss.error?.message,
  );

  const returned = await stock(staff.client, simpleItem.id, 'return', 10, {
    reason: 'Customer return',
  });
  check(
    'returned stock increases physical quantity',
    !returned.error && returned.movement?.new_physical === 80,
    returned.error?.message,
  );

  const positiveAdjustment = await stock(
    staff.client,
    simpleItem.id,
    'adjustment',
    5,
    { reason: 'Count correction' },
  );
  check(
    'positive stock adjustment changes the balance',
    !positiveAdjustment.error && positiveAdjustment.movement?.new_physical === 85,
    positiveAdjustment.error?.message,
  );

  const negativeAdjustment = await stock(
    staff.client,
    simpleItem.id,
    'adjustment',
    -10,
    { reason: 'Count correction' },
  );
  check(
    'negative stock adjustment changes the balance',
    !negativeAdjustment.error && negativeAdjustment.movement?.new_physical === 75,
    negativeAdjustment.error?.message,
  );

  const missingReason = await stock(
    staff.client,
    simpleItem.id,
    'adjustment',
    -1,
    { key: randomUUID() },
  );
  checkRpcError('adjustments require a reason', missingReason, '22023');

  const idempotentKey = `idempotent-${runId}`;
  const idempotentFirst = await stock(
    staff.client,
    simpleItem.id,
    'receive',
    25,
    { key: idempotentKey },
  );
  const idempotentSecond = await stock(
    staff.client,
    simpleItem.id,
    'receive',
    25,
    { key: idempotentKey },
  );
  check(
    'duplicate idempotent stock requests return the original movement',
    !idempotentFirst.error &&
      !idempotentSecond.error &&
      idempotentFirst.movement?.id === idempotentSecond.movement?.id,
    idempotentSecond.error?.message,
  );

  const afterIdempotent = await searchInventory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
  });
  checkEqual(
    'duplicate idempotent stock requests apply the quantity once',
    Number(afterIdempotent.rows[0]?.physical_quantity),
    100,
  );

  const reusedKey = await stock(staff.client, simpleItem.id, 'reduce', -1, {
    key: idempotentKey,
  });
  checkRpcError(
    'idempotency keys cannot be reused for a different operation',
    reusedKey,
    '23505',
  );

  const staffThreshold = await staff.client.rpc('update_inventory_threshold', {
    p_inventory_item_id: simpleItem.id,
    p_low_stock_threshold: 2,
  });
  checkRpcError(
    'staff cannot change low-stock thresholds',
    staffThreshold,
    '42501',
  );

  const highThreshold = await manager.client.rpc('update_inventory_threshold', {
    p_inventory_item_id: simpleItem.id,
    p_low_stock_threshold: 200,
  });
  check(
    'manager can update the low-stock threshold',
    !highThreshold.error,
    highThreshold.error?.message,
  );

  const lowSearch = await searchInventory(staff.client, businessA, {
    status: 'low_stock',
    inventoryItemId: simpleItem.id,
  });
  check(
    'low-stock filtering uses the configured threshold',
    !lowSearch.error && lowSearch.rows[0]?.inventory_status === 'low_stock',
    lowSearch.error?.message,
  );

  await manager.client.rpc('update_inventory_threshold', {
    p_inventory_item_id: simpleItem.id,
    p_low_stock_threshold: 5,
  });

  const renameRpc = await owner.client.rpc('update_product', {
    p_product_id: simple.id,
    p_name: 'Simple Widget Renamed',
    p_description: null,
    p_category_id: categoryId,
    p_brand_id: null,
    p_sku: simple.sku,
    p_barcode: simple.barcode,
    p_price: Number(simple.price),
    p_status: 'active',
    p_attributes: [],
    p_variants: [],
  });
  check(
    'renaming a tracked product is allowed',
    !renameRpc.error,
    renameRpc.error?.message,
  );

  const snapshotHistory = await movementHistory(staff.client, businessA, {
    search: 'Simple Widget',
    inventoryItemId: simpleItem.id,
  });
  check(
    'movement history preserves product names after catalogue edits',
    !snapshotHistory.error &&
      snapshotHistory.rows.length > 0 &&
      snapshotHistory.rows.every(
        (movement) => movement.product_name === 'Simple Widget',
      ),
    snapshotHistory.error?.message,
  );

  const disableWithStock = await manager.client.rpc(
    'disable_inventory_tracking',
    { p_inventory_item_id: simpleItem.id },
  );
  checkRpcError(
    'tracking cannot be disabled while stock remains',
    disableWithStock,
    '22023',
  );

  const staffDisable = await staff.client.rpc('disable_inventory_tracking', {
    p_inventory_item_id: simpleItem.id,
  });
  checkRpcError(
    'staff cannot disable stock tracking',
    staffDisable,
    '42501',
  );

  const reserveAll = await stock(staff.client, simpleItem.id, 'reserve', 100, {
    reason: 'All stock held',
  });
  check(
    'all available stock can be reserved',
    !reserveAll.error && reserveAll.movement?.new_reserved === 100,
    reserveAll.error?.message,
  );

  const outOfStockSearch = await searchInventory(staff.client, businessA, {
    status: 'out_of_stock',
    inventoryItemId: simpleItem.id,
  });
  check(
    'fully reserved stock is out of stock',
    !outOfStockSearch.error &&
      outOfStockSearch.rows[0]?.inventory_status === 'out_of_stock',
    outOfStockSearch.error?.message,
  );

  await stock(staff.client, simpleItem.id, 'release', -100, {
    reason: 'Hold released',
  });
  await stock(staff.client, simpleItem.id, 'reduce', -95, {
    reason: 'Stock sold',
  });

  const lowAgain = await searchInventory(staff.client, businessA, {
    status: 'low_stock',
    inventoryItemId: simpleItem.id,
  });
  check(
    'low-stock status appears when available reaches the threshold',
    !lowAgain.error &&
      Number(lowAgain.rows[0]?.available_quantity) === 5 &&
      lowAgain.rows[0]?.inventory_status === 'low_stock',
    lowAgain.error?.message,
  );

  await stock(staff.client, simpleItem.id, 'reduce', -5, {
    reason: 'Final stock sold',
  });

  const simpleDisable = await manager.client.rpc('disable_inventory_tracking', {
    p_inventory_item_id: simpleItem.id,
  });
  check(
    'manager disables tracking after stock reaches zero',
    !simpleDisable.error,
    simpleDisable.error?.message,
  );

  const disabledSearch = await searchInventory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
  });
  check(
    'disabled tracking remains visible as untracked with history',
    !disabledSearch.error &&
      disabledSearch.rows[0]?.inventory_status === 'untracked' &&
      disabledSearch.rows[0]?.inventory_item_id === simpleItem.id,
    disabledSearch.error?.message,
  );

  const disabledOperation = await stock(
    staff.client,
    simpleItem.id,
    'receive',
    1,
  );
  checkRpcError(
    'disabled tracking blocks stock operations',
    disabledOperation,
    '22023',
  );

  const reenable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: simple.id,
  });
  check(
    'manager can re-enable tracking with existing history',
    !reenable.error && unwrapRpc(reenable.data)?.is_tracked === true,
    reenable.error?.message,
  );
  await manager.client.rpc('disable_inventory_tracking', {
    p_inventory_item_id: simpleItem.id,
  });

  const zeroEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: zeroProduct.id,
  });
  const zeroItem = unwrapRpc(zeroEnable.data);
  check(
    'manager enables tracking on an untracked simple product',
    !zeroEnable.error && Boolean(zeroItem?.id),
    zeroEnable.error?.message,
  );
  const zeroDisable = await manager.client.rpc('disable_inventory_tracking', {
    p_inventory_item_id: zeroItem?.id,
  });
  check(
    'tracking without movement history can be disabled cleanly',
    !zeroDisable.error,
    zeroDisable.error?.message,
  );
  const zeroRows = await owner.client
    .from('inventory_items')
    .select('id')
    .eq('product_id', zeroProduct.id);
  check(
    'disabling unused tracking removes the empty inventory record',
    !zeroRows.error && zeroRows.data?.length === 0,
    zeroRows.error?.message,
  );

  const scopeEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: scopeProduct.id,
  });
  check(
    'manager enables product-level tracking for scope checks',
    !scopeEnable.error,
    scopeEnable.error?.message,
  );

  const addVariantToTrackedProduct = await owner.client.rpc('update_product', {
    p_product_id: scopeProduct.id,
    p_name: scopeProduct.name,
    p_description: null,
    p_category_id: null,
    p_brand_id: null,
    p_sku: scopeProduct.sku,
    p_barcode: null,
    p_price: Number(scopeProduct.price),
    p_status: 'draft',
    p_attributes: [],
    p_variants: [
      {
        name: 'Forbidden Variant',
        sku: `${runId}-scope-variant`,
        status: 'active',
        sort_order: 0,
        attributes: [],
      },
    ],
  });
  checkRpcError(
    'a product-level inventory record blocks adding variants',
    addVariantToTrackedProduct,
    '22023',
  );

  const productLevelForVariants = await manager.client.rpc(
    'enable_inventory_tracking',
    { p_product_id: variantProduct.id },
  );
  checkRpcError(
    'variant products cannot use product-level tracking',
    productLevelForVariants,
    '22023',
  );

  const smallEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: variantProduct.id,
    p_variant_id: smallVariant?.id,
  });
  const largeEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: variantProduct.id,
    p_variant_id: largeVariant?.id,
  });
  const smallItem = unwrapRpc(smallEnable.data);
  const largeItem = unwrapRpc(largeEnable.data);
  check(
    'manager enables tracking for each variant separately',
    !smallEnable.error &&
      !largeEnable.error &&
      Boolean(smallItem?.id) &&
      Boolean(largeItem?.id) &&
      smallItem?.id !== largeItem?.id,
    smallEnable.error?.message ?? largeEnable.error?.message,
  );

  await stock(staff.client, smallItem.id, 'receive', 10);
  await stock(staff.client, largeItem.id, 'receive', 20);

  const variantRows = await searchInventory(owner.client, businessA, {
    search: 'Variant Shirt',
  });
  check(
    'variant inventory rows keep independent balances',
    !variantRows.error &&
      variantRows.rows.length === 2 &&
      Number(variantRows.rows.find((row) => row.variant_id === smallItem.variant_id)?.physical_quantity) === 10 &&
      Number(variantRows.rows.find((row) => row.variant_id === largeItem.variant_id)?.physical_quantity) === 20,
    variantRows.error?.message,
  );

  const variantOverReserve = await stock(
    staff.client,
    smallItem.id,
    'reserve',
    11,
  );
  checkRpcError(
    'variant reservations cannot exceed that variant stock',
    variantOverReserve,
    '22023',
  );

  const concurrencyEnable = await manager.client.rpc(
    'enable_inventory_tracking',
    { p_product_id: concurrencyProduct.id },
  );
  const concurrencyItem = unwrapRpc(concurrencyEnable.data);
  check(
    'manager enables tracking for concurrency checks',
    !concurrencyEnable.error && Boolean(concurrencyItem?.id),
    concurrencyEnable.error?.message,
  );

  await stock(staff.client, concurrencyItem.id, 'receive', 100, {
    key: `concurrency-base-${runId}`,
  });

  const duplicateKey = `concurrency-duplicate-${runId}`;
  const [duplicateOne, duplicateTwo] = await Promise.all([
    stock(staff.client, concurrencyItem.id, 'receive', 10, {
      key: duplicateKey,
    }),
    stock(staff.client, concurrencyItem.id, 'receive', 10, {
      key: duplicateKey,
    }),
  ]);
  check(
    'concurrent duplicate requests resolve to one movement',
    !duplicateOne.error &&
      !duplicateTwo.error &&
      duplicateOne.movement?.id === duplicateTwo.movement?.id,
    duplicateOne.error?.message ?? duplicateTwo.error?.message,
  );

  const concurrentItemRows = await searchInventory(staff.client, businessA, {
    inventoryItemId: concurrencyItem.id,
  });
  checkEqual(
    'concurrent duplicate requests apply once',
    Number(concurrentItemRows.rows[0]?.physical_quantity),
    110,
  );

  const [reserveOne, reserveTwo] = await Promise.all([
    stock(staff.client, concurrencyItem.id, 'reserve', 60, {
      key: `concurrency-reserve-a-${runId}`,
    }),
    stock(staff.client, concurrencyItem.id, 'reserve', 60, {
      key: `concurrency-reserve-b-${runId}`,
    }),
  ]);
  check(
    'concurrent reservations cannot oversell stock',
    Number(Boolean(reserveOne.error)) + Number(Boolean(reserveTwo.error)) === 1,
    reserveOne.error?.message ?? reserveTwo.error?.message,
  );

  const concurrentAfterReserve = await searchInventory(
    staff.client,
    businessA,
    { inventoryItemId: concurrencyItem.id },
  );
  checkEqual(
    'one concurrent reservation is applied',
    Number(concurrentAfterReserve.rows[0]?.reserved_quantity),
    60,
  );

  const concurrentRelease = await stock(
    staff.client,
    concurrencyItem.id,
    'release',
    -60,
    { key: `concurrency-release-${runId}` },
  );
  check(
    'concurrent reservation can be released',
    !concurrentRelease.error,
    concurrentRelease.error?.message,
  );

  const intruderSearch = await searchInventory(intruder.client, businessA);
  checkRpcError(
    'another business cannot search this inventory',
    intruderSearch,
    '42501',
  );

  const intruderOperation = await stock(
    intruder.client,
    simpleItem.id,
    'receive',
    1,
  );
  checkRpcError(
    'another business cannot change this stock',
    intruderOperation,
    '42501',
  );

  const intruderRows = await intruder.client
    .from('inventory_items')
    .select('id')
    .eq('business_id', businessA);
  check(
    'row-level security hides inventory rows from another business',
    !intruderRows.error && intruderRows.data?.length === 0,
    intruderRows.error?.message,
  );

  const intruderHistory = await movementHistory(intruder.client, businessA);
  checkRpcError(
    'another business cannot read this movement history',
    intruderHistory,
    '42501',
  );

  const movementUpdate = await owner.client
    .from('stock_movements')
    .update({ reason: 'Tampered' })
    .eq('id', receive.movement?.id)
    .select('id');
  check(
    'authenticated clients cannot edit stock movements',
    Boolean(movementUpdate.error),
  );

  const receiveHistory = await movementHistory(staff.client, businessA, {
    operation: 'receive',
    limit: 100,
  });
  check(
    'movement history filters by operation',
    !receiveHistory.error &&
      receiveHistory.rows.length > 0 &&
      receiveHistory.rows.every((movement) => movement.operation === 'receive'),
    receiveHistory.error?.message,
  );

  const itemHistory = await movementHistory(staff.client, businessA, {
    inventoryItemId: simpleItem.id,
    limit: 2,
    offset: 0,
  });
  check(
    'movement history paginates and reports totals',
    !itemHistory.error &&
      itemHistory.rows.length === 2 &&
      Number(itemHistory.rows[0]?.total_count) > 2,
    itemHistory.error?.message,
  );

  const otherHistory = await movementHistory(intruder.client, businessB);
  check(
    'a business with no movements gets an empty history',
    !otherHistory.error && otherHistory.rows.length === 0,
    otherHistory.error?.message,
  );

  const statusCounts = await Promise.all([
    searchInventory(owner.client, businessA, { status: 'tracked' }),
    searchInventory(owner.client, businessA, { status: 'untracked' }),
    searchInventory(owner.client, businessA, { status: 'out_of_stock' }),
  ]);
  check(
    'inventory status filters separate tracked, untracked and out of stock',
    !statusCounts[0].error &&
      statusCounts[0].rows.length === 4 &&
      !statusCounts[1].error &&
      statusCounts[1].rows.length === 2 &&
      !statusCounts[2].error &&
      statusCounts[2].rows.length === 1,
    statusCounts.find((result) => result.error)?.error?.message,
  );

  const sortedSearch = await searchInventory(owner.client, businessA, {
    sort: 'available',
    direction: 'desc',
  });
  check(
    'inventory search sorts by available quantity',
    !sortedSearch.error &&
      Number(sortedSearch.rows[0]?.available_quantity) === 110,
    sortedSearch.error?.message,
  );

  const finalOverview = await overview(manager.client, businessA);
  check(
    'inventory overview reflects final balances',
    !finalOverview.error &&
      Number(finalOverview.value?.total_units) === 6 &&
      Number(finalOverview.value?.tracked_units) === 4 &&
      Number(finalOverview.value?.untracked_units) === 2 &&
      Number(finalOverview.value?.total_physical) === 140 &&
      Number(finalOverview.value?.total_reserved) === 0 &&
      Number(finalOverview.value?.total_available) === 140 &&
      Number(finalOverview.value?.out_of_stock_units) === 1 &&
      Number(finalOverview.value?.movement_count) > 0,
    finalOverview.error?.message ||
      JSON.stringify(finalOverview.value),
  );
} catch (error) {
  results.failures.push(error.message);
  console.error(`FAIL  ${error.message}`);
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    results.failures.push(`Cleanup failed: ${cleanupError.message}`);
    console.error(`FAIL  Cleanup failed: ${cleanupError.message}`);
  }
  await db.end();

  const passed = results.checks - results.failures.length;
  console.log(
    `\n${passed}/${results.checks} Day 5 inventory checks passed.`,
  );
  if (results.failures.length > 0) {
    process.exitCode = 1;
  }
}
