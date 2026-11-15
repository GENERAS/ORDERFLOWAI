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
      '  node --env-file=.env.local scripts/day7-order-tests.mjs',
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
const emailPrefix = `day7-test-${runId}`;
const slugPrefix = `day7-${runId}`;
const password = 'Day7Test!Pass123';

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
  application_name: 'orderflow-ai-day7-order-tests',
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

async function createCustomer(client, businessId, payload) {
  const { data, error } = await client.rpc('create_customer', {
    p_business_id: businessId,
    p_full_name: payload.fullName,
    p_email: payload.email ?? null,
    p_phone: payload.phone ?? null,
    p_company_name: payload.companyName ?? null,
    p_notes: payload.notes ?? null,
  });
  return { customer: unwrapRpc(data), error };
}

async function updateCustomer(client, customerId, payload) {
  const { data, error } = await client.rpc('update_customer', {
    p_customer_id: customerId,
    p_full_name: payload.fullName,
    p_email: payload.email ?? null,
    p_phone: payload.phone ?? null,
    p_company_name: payload.companyName ?? null,
    p_notes: payload.notes ?? null,
  });
  return { customer: unwrapRpc(data), error };
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

async function enableTracking(client, productId, options = {}) {
  const { data, error } = await client.rpc('enable_inventory_tracking', {
    p_product_id: productId,
    p_variant_id: options.variantId ?? null,
    p_low_stock_threshold: options.lowStockThreshold ?? null,
  });
  return { item: unwrapRpc(data), error };
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

async function createOrder(client, businessId, customerId, items, notes = null) {
  const { data, error } = await client.rpc('create_order', {
    p_business_id: businessId,
    p_customer_id: customerId,
    p_notes: notes,
    p_items: items,
  });
  return { order: unwrapRpc(data), error };
}

async function updateOrder(client, orderId, customerId, items, notes = null) {
  const { data, error } = await client.rpc('update_order', {
    p_order_id: orderId,
    p_customer_id: customerId,
    p_notes: notes,
    p_items: items,
  });
  return { order: unwrapRpc(data), error };
}

async function setStatus(client, orderId, status) {
  const { data, error } = await client.rpc('update_order_status', {
    p_order_id: orderId,
    p_status: status,
  });
  return { order: unwrapRpc(data), error };
}

async function cancelOrder(client, orderId, reason) {
  const { data, error } = await client.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason,
  });
  return { order: unwrapRpc(data), error };
}

async function searchOrders(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_orders', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_status: options.status ?? null,
    p_customer_id: options.customerId ?? null,
    p_order_id: options.orderId ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_sort: options.sort ?? 'recent',
    p_direction: options.direction ?? 'desc',
  });
  return { rows: data ?? [], error };
}

async function searchCatalogue(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_order_catalogue', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function overview(client, businessId) {
  const { data, error } = await client.rpc('get_order_overview', {
    p_business_id: businessId,
  });
  return { value: unwrapRpc(data), error };
}

async function orderItems(orderId) {
  const result = await db.query(
    `select *
     from public.order_items
     where order_id = $1
     order by created_at, id`,
    [orderId],
  );
  return result.rows;
}

async function orderEvents(orderId) {
  const result = await db.query(
    `select *
     from public.order_events
     where order_id = $1
     order by created_at, id`,
    [orderId],
  );
  return result.rows;
}

async function inventoryRow(productId, variantId = null) {
  const result = await db.query(
    `select *
     from public.inventory_items
     where product_id = $1
       and variant_id is not distinct from $2`,
    [productId, variantId],
  );
  return result.rows[0] ?? null;
}

async function movementCount(businessId) {
  const result = await db.query(
    `select count(*)::int as count
     from public.stock_movements
     where business_id = $1`,
    [businessId],
  );
  return result.rows[0].count;
}

let businessA;
let businessB;

async function cleanup() {
  const ids = [businessA, businessB].filter(Boolean);
  if (ids.length === 0) return;

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
    'delete from public.businesses where id = any($1::uuid[])',
    [ids],
  );
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
}

try {
  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const managerEmail = `${emailPrefix}-manager@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const intruderEmail = `${emailPrefix}-intruder@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Seven Owner');
  const managerId = await createAuthUser(managerEmail, 'Day Seven Manager');
  const staffId = await createAuthUser(staffEmail, 'Day Seven Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Seven Intruder');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Seven Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Seven Business B',
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

  const aliceEmail = `alice-${runId}@example.com`;
  const bobEmail = `bob-${runId}@example.com`;
  const alicePhone = '+250 788 700 111';
  const bobPhone = '0788700222';

  const aliceResult = await createCustomer(owner.client, businessA, {
    fullName: 'Alice Order',
    email: aliceEmail,
    phone: alicePhone,
    companyName: 'Alice Trading',
  });
  const alice = aliceResult.customer;
  check('owner creates an order customer', !aliceResult.error, aliceResult.error?.message);

  const bobResult = await createCustomer(manager.client, businessA, {
    fullName: 'Bob Order',
    email: bobEmail,
    phone: bobPhone,
  });
  const bob = bobResult.customer;
  check('manager creates another order customer', !bobResult.error, bobResult.error?.message);

  const otherCustomerResult = await createCustomer(intruder.client, businessB, {
    fullName: 'Other Order Customer',
    email: `other-${runId}@example.com`,
    phone: '0788700333',
  });
  const otherCustomer = otherCustomerResult.customer;
  check(
    'second business creates its own order customer',
    !otherCustomerResult.error,
    otherCustomerResult.error?.message,
  );

  const categoryResult = await owner.client
    .from('categories')
    .insert({ business_id: businessA, name: 'Day Seven Category' })
    .select('id')
    .single();
  const categoryId = categoryResult.data?.id;

  const widgetResult = await createProduct(owner.client, businessA, {
    name: 'Order Widget',
    categoryId,
    sku: `${runId}-widget`,
    price: 1000,
  });
  const widget = widgetResult.product;
  check(
    'owner creates a simple order product',
    !widgetResult.error && Boolean(widget?.id),
    widgetResult.error?.message,
  );

  const shirtResult = await createProduct(owner.client, businessA, {
    name: 'Order Shirt',
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
  const shirt = shirtResult.product;
  check(
    'owner creates a variant order product',
    !shirtResult.error && Boolean(shirt?.id),
    shirtResult.error?.message,
  );

  const serviceResult = await createProduct(owner.client, businessA, {
    name: 'Order Service',
    sku: `${runId}-service`,
    price: 500,
  });
  const service = serviceResult.product;
  check(
    'owner creates an untracked order product',
    !serviceResult.error && Boolean(service?.id),
    serviceResult.error?.message,
  );

  const inactiveResult = await createProduct(owner.client, businessA, {
    name: 'Inactive Order Product',
    sku: `${runId}-inactive`,
    price: 700,
    status: 'archived',
  });
  const inactive = inactiveResult.product;
  check(
    'owner creates an inactive product',
    !inactiveResult.error && Boolean(inactive?.id),
    inactiveResult.error?.message,
  );

  const otherProductResult = await createProduct(intruder.client, businessB, {
    name: 'Other Order Product',
    sku: `${runId}-other`,
    price: 3000,
  });
  const otherProduct = otherProductResult.product;
  check(
    'second business creates its own order product',
    !otherProductResult.error && Boolean(otherProduct?.id),
    otherProductResult.error?.message,
  );

  if (!widget?.id || !shirt?.id || !service?.id || !inactive?.id || !otherProduct?.id) {
    throw new Error('Cannot continue without created products.');
  }

  const variantsResult = await owner.client
    .from('product_variants')
    .select('*')
    .eq('business_id', businessA)
    .eq('product_id', shirt.id)
    .order('sort_order', { ascending: true });
  const [smallVariant, largeVariant] = variantsResult.data ?? [];
  check(
    'variant order product has two active variants',
    variantsResult.data?.length === 2 &&
      variantsResult.data.every((variant) => variant.status === 'active'),
    variantsResult.error?.message,
  );

  const widgetEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: widget.id,
    p_low_stock_threshold: 5,
  });
  const widgetInventory = unwrapRpc(widgetEnable.data);
  const smallEnable = await manager.client.rpc('enable_inventory_tracking', {
    p_product_id: shirt.id,
    p_variant_id: smallVariant?.id,
    p_low_stock_threshold: 3,
  });
  const smallInventory = unwrapRpc(smallEnable.data);
  check(
    'manager enables tracking for the order products',
    !widgetEnable.error &&
      !smallEnable.error &&
      Boolean(widgetInventory?.id) &&
      Boolean(smallInventory?.id),
    widgetEnable.error?.message ?? smallEnable.error?.message,
  );

  const widgetReceive = await stock(
    staff.client,
    widgetInventory.id,
    'receive',
    50,
    { reason: 'Opening stock' },
  );
  const smallReceive = await stock(
    staff.client,
    smallInventory.id,
    'receive',
    10,
    { reason: 'Opening stock' },
  );
  check(
    'staff receives opening stock for tracked order units',
    !widgetReceive.error &&
      !smallReceive.error &&
      widgetReceive.movement?.new_physical === 50 &&
      smallReceive.movement?.new_physical === 10,
    widgetReceive.error?.message ?? smallReceive.error?.message,
  );

  const anonOrders = await anon.from('orders').select('id').limit(1);
  check('unauthenticated users cannot read orders', Boolean(anonOrders.error));
  const anonItems = await anon.from('order_items').select('id').limit(1);
  check('unauthenticated users cannot read order items', Boolean(anonItems.error));
  const anonEvents = await anon.from('order_events').select('id').limit(1);
  check('unauthenticated users cannot read order events', Boolean(anonEvents.error));
  const anonCounters = await anon.from('order_counters').select('*').limit(1);
  check('unauthenticated users cannot read order counters', Boolean(anonCounters.error));

  const anonSearch = await searchOrders(anon, businessA);
  checkRpcError('unauthenticated users cannot search orders', anonSearch, '42501');
  const anonCatalogue = await searchCatalogue(anon, businessA);
  checkRpcError(
    'unauthenticated users cannot search the order catalogue',
    anonCatalogue,
    '42501',
  );
  const anonOverview = await overview(anon, businessA);
  checkRpcError('unauthenticated users cannot read order metrics', anonOverview, '42501');
  const anonCreate = await createOrder(anon, businessA, alice.id, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError('unauthenticated users cannot create orders', anonCreate, '42501');

  const catalogueResult = await searchCatalogue(staff.client, businessA);
  check(
    'order catalogue hides inactive products',
    !catalogueResult.error &&
      catalogueResult.rows.length === 4 &&
      catalogueResult.rows.every((row) => row.product_name !== 'Inactive Order Product'),
    catalogueResult.error?.message,
  );
  check(
    'order catalogue returns variants as separate units',
    catalogueResult.rows.filter((row) => row.product_id === shirt.id).length === 2,
  );
  checkEqual(
    'order catalogue reports tracked availability',
    catalogueResult.rows.find((row) => row.product_id === widget.id)
      ?.available_quantity,
    50,
  );
  checkEqual(
    'order catalogue reports inventory status',
    catalogueResult.rows.find((row) => row.product_id === widget.id)
      ?.inventory_status,
    'in_stock',
  );
  const catalogueSearch = await searchCatalogue(owner.client, businessA, {
    search: 'shirt',
  });
  check(
    'order catalogue search matches product and variant names',
    !catalogueSearch.error && catalogueSearch.rows.length === 2,
    catalogueSearch.error?.message,
  );

  const firstResult = await createOrder(
    owner.client,
    businessA,
    alice.id,
    [
      {
        product_id: widget.id,
        variant_id: null,
        quantity: 2,
        unit_price: 900,
      },
      {
        product_id: service.id,
        variant_id: null,
        quantity: 1,
        unit_price: null,
      },
    ],
    'Deliver after lunch.',
  );
  const first = firstResult.order;
  check('owner creates the first order', !firstResult.error, firstResult.error?.message);
  if (!first?.id) throw new Error('Cannot continue without the first order.');

  checkEqual('first order number starts the business sequence', first.order_number, 'ORD-00001');
  checkEqual('new orders start as draft', first.status, 'draft');
  checkEqual('new orders start with no stock movement', first.stock_state, 'none');
  checkEqual('order currency comes from the business', first.currency, 'RWF');
  checkEqual('order stores the customer name snapshot', first.customer_name_snapshot, 'Alice Order');
  checkEqual('order stores the customer phone snapshot', first.customer_phone_snapshot, alicePhone);
  checkEqual('order stores the customer email snapshot', first.customer_email_snapshot, aliceEmail);
  checkEqual('order stores notes', first.notes, 'Deliver after lunch.');
  checkEqual('order subtotal is calculated from items', Number(first.subtotal), 2300);
  checkEqual('order total is calculated from items', Number(first.total), 2300);
  checkEqual('order records its creator', first.created_by, ownerId);

  const firstItems = await orderItems(first.id);
  const firstWidgetItem = firstItems.find((item) => item.product_id === widget.id);
  const firstServiceItem = firstItems.find((item) => item.product_id === service.id);
  checkEqual('order stores both items', firstItems.length, 2);
  checkEqual('agreed price is preserved', Number(firstWidgetItem?.unit_price), 900);
  checkEqual(
    'catalogue price is copied when no agreed price is supplied',
    Number(firstServiceItem?.unit_price),
    500,
  );
  checkEqual('generated line total uses agreed price', Number(firstWidgetItem?.line_total), 1800);
  checkEqual(
    'item product name is snapshotted',
    firstWidgetItem?.product_name_snapshot,
    'Order Widget',
  );
  checkEqual(
    'untracked items start with no reserved quantity',
    firstServiceItem?.reserved_quantity,
    0,
  );

  const firstEvents = await orderEvents(first.id);
  checkEqual('order creation records one event', firstEvents.length, 1);
  checkEqual('order creation event type is stored', firstEvents[0]?.event_type, 'created');
  checkEqual('order creation event records the actor', firstEvents[0]?.actor_name, 'Day Seven Owner');

  await db.query('update public.products set price = 1200, name = $2 where id = $1', [
    widget.id,
    'Renamed Order Widget',
  ]);
  const preservedItems = await orderItems(first.id);
  const preservedWidgetItem = preservedItems.find(
    (item) => item.product_id === widget.id,
  );
  checkEqual(
    'changing the catalogue price does not change the agreed order price',
    Number(preservedWidgetItem?.unit_price),
    900,
  );
  checkEqual(
    'renaming the product does not change the item snapshot',
    preservedWidgetItem?.product_name_snapshot,
    'Order Widget',
  );

  const renameCustomer = await updateCustomer(owner.client, alice.id, {
    fullName: 'Alice Renamed',
    email: aliceEmail,
    phone: alicePhone,
    companyName: 'Alice Trading',
  });
  check(
    'customer can be renamed after an order is created',
    !renameCustomer.error,
    renameCustomer.error?.message,
  );
  const firstAfterRename = await searchOrders(owner.client, businessA, {
    orderId: first.id,
  });
  checkEqual(
    'renaming a customer does not rewrite the order snapshot',
    firstAfterRename.rows[0]?.customer_name,
    'Alice Order',
  );

  const updateFirst = await updateOrder(
    manager.client,
    first.id,
    bob.id,
    [
      {
        product_id: widget.id,
        variant_id: null,
        quantity: 3,
        unit_price: 800,
      },
      {
        product_id: service.id,
        variant_id: null,
        quantity: 1,
        unit_price: 450,
      },
    ],
    'Updated by manager.',
  );
  check('manager can edit a draft order', !updateFirst.error, updateFirst.error?.message);
  checkEqual(
    'editing a draft order updates the customer snapshot',
    updateFirst.order?.customer_name_snapshot,
    'Bob Order',
  );
  checkEqual(
    'editing a draft order recalculates totals',
    Number(updateFirst.order?.total),
    2850,
  );
  checkEqual(
    'editing a draft order replaces the item list',
    (await orderItems(first.id)).length,
    2,
  );
  const eventsAfterUpdate = await orderEvents(first.id);
  checkEqual('editing an order records another event', eventsAfterUpdate.length, 2);
  checkEqual('editing event type is stored', eventsAfterUpdate[1]?.event_type, 'updated');

  const secondResult = await createOrder(owner.client, businessA, bob.id, [
    {
      product_id: shirt.id,
      variant_id: smallVariant.id,
      quantity: 2,
      unit_price: 2500,
    },
    {
      product_id: service.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  const second = secondResult.order;
  check('owner creates a second order', !secondResult.error, secondResult.error?.message);
  if (!second?.id) throw new Error('Cannot continue without the second order.');
  checkEqual('order numbers increment per business', second.order_number, 'ORD-00002');
  checkEqual('variant order total includes both items', Number(second.total), 5500);
  const secondItems = await orderItems(second.id);
  const secondVariantItem = secondItems.find(
    (item) => item.product_id === shirt.id,
  );
  checkEqual(
    'variant item stores the variant snapshot',
    secondVariantItem?.variant_name_snapshot,
    'Small',
  );
  checkEqual(
    'variant item stores the variant sku snapshot',
    secondVariantItem?.sku_snapshot,
    `${runId}-shirt-small`.toUpperCase(),
  );

  const noItems = await createOrder(owner.client, businessA, bob.id, []);
  checkRpcError('orders require at least one item', noItems, '22023');
  const noCustomer = await createOrder(owner.client, businessA, null, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError('orders require a customer', noCustomer, '22023');
  const crossCustomer = await createOrder(owner.client, businessA, otherCustomer.id, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError(
    'orders cannot use a customer from another business',
    crossCustomer,
    '22023',
  );
  const crossProduct = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: otherProduct.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError(
    'orders cannot use a product from another business',
    crossProduct,
    '22023',
  );
  const inactiveItem = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: inactive.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError('inactive products cannot be ordered', inactiveItem, '22023');
  const zeroQuantity = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 0,
      unit_price: null,
    },
  ]);
  checkRpcError('order item quantities must be positive', zeroQuantity, '22023');
  const missingVariant = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: shirt.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError(
    'variant products require an explicit variant',
    missingVariant,
    '22023',
  );
  const duplicateItem = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 1,
      unit_price: null,
    },
  ]);
  checkRpcError(
    'each product or variant can only appear once in an order',
    duplicateItem,
    '22023',
  );
  const longNotes = await createOrder(
    owner.client,
    businessA,
    alice.id,
    [
      {
        product_id: service.id,
        variant_id: null,
        quantity: 1,
        unit_price: null,
      },
    ],
    'x'.repeat(2001),
  );
  checkRpcError('order notes are limited to 2000 characters', longNotes, '22023');

  const directOrderInsert = await owner.client.from('orders').insert({
    business_id: businessA,
    order_number: `DIRECT-${runId}`,
    customer_id: alice.id,
    customer_name_snapshot: 'Direct',
    currency: 'RWF',
  });
  check(
    'authenticated clients cannot insert orders directly',
    Boolean(directOrderInsert.error),
  );
  const directOrderUpdate = await owner.client
    .from('orders')
    .update({ notes: 'Direct update' })
    .eq('id', first.id);
  check(
    'authenticated clients cannot update orders directly',
    Boolean(directOrderUpdate.error),
  );
  const directOrderDelete = await owner.client
    .from('orders')
    .delete()
    .eq('id', first.id);
  check(
    'authenticated clients cannot delete orders directly',
    Boolean(directOrderDelete.error),
  );
  const directItemInsert = await owner.client.from('order_items').insert({
    business_id: businessA,
    order_id: first.id,
    product_id: service.id,
    product_name_snapshot: 'Direct Item',
    unit_price: 1,
    quantity: 1,
  });
  check(
    'authenticated clients cannot insert order items directly',
    Boolean(directItemInsert.error),
  );
  const directEventInsert = await owner.client.from('order_events').insert({
    business_id: businessA,
    order_id: first.id,
    event_type: 'updated',
    summary: 'Direct event',
    actor_name: 'Direct',
  });
  check(
    'authenticated clients cannot insert order events directly',
    Boolean(directEventInsert.error),
  );
  const directEventUpdate = await owner.client
    .from('order_events')
    .update({ summary: 'Tampered' })
    .eq('order_id', first.id);
  check(
    'authenticated clients cannot update order events directly',
    Boolean(directEventUpdate.error),
  );
  const directEventDelete = await owner.client
    .from('order_events')
    .delete()
    .eq('order_id', first.id);
  check(
    'authenticated clients cannot delete order events directly',
    Boolean(directEventDelete.error),
  );
  const directCounterWrite = await owner.client
    .from('order_counters')
    .update({ last_number: 999 })
    .eq('business_id', businessA);
  check(
    'authenticated clients cannot alter order counters directly',
    Boolean(directCounterWrite.error),
  );

  let eventImmutableError;
  try {
    await db.query(
      'update public.order_events set summary = $1 where order_id = $2',
      ['Tampered', first.id],
    );
  } catch (error) {
    eventImmutableError = error;
  }
  checkEqual(
    'order activity is immutable at the database layer',
    eventImmutableError?.code,
    '42501',
  );

  const directTransition = await setStatus(owner.client, first.id, 'confirmed');
  checkRpcError(
    'draft orders must be sent for confirmation first',
    directTransition,
    '22023',
  );
  const invalidStatus = await setStatus(owner.client, first.id, 'cancelled');
  checkRpcError('status changes cannot bypass cancellation', invalidStatus, '22023');
  const missingOrder = await setStatus(owner.client, randomUUID(), 'awaiting_confirmation');
  checkRpcError('missing orders cannot change status', missingOrder, '22023');

  const firstAwaiting = await setStatus(staff.client, first.id, 'awaiting_confirmation');
  check(
    'staff can send a draft order for confirmation',
    !firstAwaiting.error && firstAwaiting.order?.status === 'awaiting_confirmation',
    firstAwaiting.error?.message,
  );
  const sameStatus = await setStatus(staff.client, first.id, 'awaiting_confirmation');
  checkRpcError('orders cannot repeat their current status', sameStatus, '22023');
  const firstConfirmed = await setStatus(manager.client, first.id, 'confirmed');
  check(
    'manager can confirm an awaiting order',
    !firstConfirmed.error && firstConfirmed.order?.status === 'confirmed',
    firstConfirmed.error?.message,
  );
  checkEqual(
    'confirmation reserves stock',
    firstConfirmed.order?.stock_state,
    'reserved',
  );
  check(
    'confirmation records the confirmed timestamp',
    Boolean(firstConfirmed.order?.confirmed_at),
  );

  const reservedItems = await orderItems(first.id);
  const reservedWidgetItem = reservedItems.find(
    (item) => item.product_id === widget.id,
  );
  const reservedServiceItem = reservedItems.find(
    (item) => item.product_id === service.id,
  );
  checkEqual(
    'tracked item records its reserved quantity',
    reservedWidgetItem?.reserved_quantity,
    3,
  );
  checkEqual(
    'untracked item does not reserve stock',
    reservedServiceItem?.reserved_quantity,
    0,
  );
  const widgetAfterReserve = await inventoryRow(widget.id);
  checkEqual('confirmation increases reserved inventory', widgetAfterReserve.reserved_quantity, 3);
  checkEqual('confirmation lowers available inventory', widgetAfterReserve.available_quantity, 47);
  checkEqual('confirmation does not change physical inventory', widgetAfterReserve.physical_quantity, 50);

  const updateConfirmed = await updateOrder(
    manager.client,
    first.id,
    bob.id,
    [
      {
        product_id: widget.id,
        variant_id: null,
        quantity: 1,
        unit_price: 800,
      },
    ],
  );
  checkRpcError(
    'confirmed orders can no longer be edited',
    updateConfirmed,
    '22023',
  );

  const shortReason = await cancelOrder(owner.client, first.id, 'no');
  checkRpcError('cancellation requires a real reason', shortReason, '22023');
  const longReason = await cancelOrder(owner.client, first.id, 'x'.repeat(501));
  checkRpcError('cancellation reasons are limited to 500 characters', longReason, '22023');
  const cancelledFirst = await cancelOrder(
    owner.client,
    first.id,
    'Customer changed the delivery date.',
  );
  check(
    'owner can cancel a confirmed order',
    !cancelledFirst.error && cancelledFirst.order?.status === 'cancelled',
    cancelledFirst.error?.message,
  );
  checkEqual(
    'cancelling an order records the reason',
    cancelledFirst.order?.cancellation_reason,
    'Customer changed the delivery date.',
  );
  checkEqual(
    'cancelling an order marks stock released',
    cancelledFirst.order?.stock_state,
    'released',
  );
  check(
    'cancelling records the cancelled timestamp',
    Boolean(cancelledFirst.order?.cancelled_at),
  );
  const widgetAfterCancel = await inventoryRow(widget.id);
  checkEqual('cancellation releases reserved inventory', widgetAfterCancel.reserved_quantity, 0);
  checkEqual('cancellation restores available inventory', widgetAfterCancel.available_quantity, 50);
  const itemsAfterCancel = await orderItems(first.id);
  checkEqual(
    'cancellation clears item reserved quantities',
    itemsAfterCancel.find((item) => item.product_id === widget.id)
      ?.reserved_quantity,
    0,
  );
  const cancelAgain = await cancelOrder(owner.client, first.id, 'Try cancelling twice.');
  checkRpcError('cancelled orders cannot be cancelled again', cancelAgain, '22023');
  const eventsAfterCancel = await orderEvents(first.id);
  checkEqual(
    'cancellation records an activity event',
    eventsAfterCancel[eventsAfterCancel.length - 1]?.event_type,
    'cancelled',
  );
  checkEqual(
    'status changes are recorded in activity',
    eventsAfterCancel.filter((event) => event.event_type === 'status_changed').length,
    2,
  );

  const confirmSecond = await setStatus(owner.client, second.id, 'awaiting_confirmation');
  check('owner can move an order to awaiting confirmation', !confirmSecond.error);
  const secondConfirmed = await setStatus(owner.client, second.id, 'confirmed');
  check('owner can confirm the variant order', !secondConfirmed.error, secondConfirmed.error?.message);
  const smallAfterReserve = await inventoryRow(shirt.id, smallVariant.id);
  checkEqual('variant confirmation reserves variant stock', smallAfterReserve.reserved_quantity, 2);
  checkEqual('variant confirmation lowers available stock', smallAfterReserve.available_quantity, 8);
  const largeAfterReserve = await inventoryRow(shirt.id, largeVariant.id);
  checkEqual('other variants are not reserved', largeAfterReserve, null);

  const skipProcessing = await setStatus(owner.client, second.id, 'ready');
  checkRpcError('orders must move through each status in order', skipProcessing, '22023');
  const processing = await setStatus(owner.client, second.id, 'processing');
  check('confirmed orders move to processing', !processing.error, processing.error?.message);
  const ready = await setStatus(staff.client, second.id, 'ready');
  check('staff can mark an order ready', !ready.error, ready.error?.message);
  const completed = await setStatus(owner.client, second.id, 'completed');
  check(
    'ready orders can be completed',
    !completed.error && completed.order?.status === 'completed',
    completed.error?.message,
  );
  checkEqual('completion marks stock consumed', completed.order?.stock_state, 'consumed');
  check(
    'completion records the completed timestamp',
    Boolean(completed.order?.completed_at),
  );
  const smallAfterComplete = await inventoryRow(shirt.id, smallVariant.id);
  checkEqual('completion reduces physical inventory', smallAfterComplete.physical_quantity, 8);
  checkEqual('completion clears reserved inventory', smallAfterComplete.reserved_quantity, 0);
  checkEqual('completion leaves only sold stock available', smallAfterComplete.available_quantity, 8);
  const itemsAfterComplete = await orderItems(second.id);
  checkEqual(
    'completion clears the item reserved quantity',
    itemsAfterComplete.find((item) => item.product_id === shirt.id)
      ?.reserved_quantity,
    0,
  );
  const cancelCompleted = await cancelOrder(owner.client, second.id, 'Too late now.');
  checkRpcError('completed orders cannot be cancelled', cancelCompleted, '22023');

  const otherOrderResult = await createOrder(intruder.client, businessB, otherCustomer.id, [
    {
      product_id: otherProduct.id,
      variant_id: null,
      quantity: 2,
      unit_price: 2800,
    },
  ]);
  check(
    'second business creates its own order',
    !otherOrderResult.error,
    otherOrderResult.error?.message,
  );
  checkEqual(
    'order numbering restarts for each business',
    otherOrderResult.order?.order_number,
    'ORD-00001',
  );
  checkEqual(
    'second business uses its own currency',
    otherOrderResult.order?.currency,
    'USD',
  );

  const concurrentResults = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createOrder(
        index % 2 === 0 ? owner.client : manager.client,
        businessA,
        alice.id,
        [
          {
            product_id: service.id,
            variant_id: null,
            quantity: 1,
            unit_price: 500,
          },
        ],
      ),
    ),
  );
  check(
    'concurrent orders all succeed',
    concurrentResults.every((result) => !result.error),
    concurrentResults.find((result) => result.error)?.error?.message,
  );
  const concurrentNumbers = concurrentResults
    .map((result) => result.order?.order_number)
    .filter(Boolean);
  checkEqual('concurrent orders create four numbers', concurrentNumbers.length, 4);
  checkEqual(
    'concurrent order numbers are unique',
    new Set(concurrentNumbers).size,
    4,
  );
  check(
    'concurrent order numbers continue the business sequence',
    concurrentNumbers.every((number) =>
      ['ORD-00003', 'ORD-00004', 'ORD-00005', 'ORD-00006'].includes(number),
    ),
    concurrentNumbers.join(', '),
  );

  const oversellResult = await createOrder(owner.client, businessA, alice.id, [
    {
      product_id: widget.id,
      variant_id: null,
      quantity: 100,
      unit_price: 1200,
    },
  ]);
  const oversellOrder = oversellResult.order;
  check(
    'orders can be drafted above available stock',
    !oversellResult.error,
    oversellResult.error?.message,
  );
  checkEqual(
    'the oversell check continues the order sequence',
    oversellOrder?.order_number,
    'ORD-00007',
  );
  const oversellAwaiting = await setStatus(
    owner.client,
    oversellOrder.id,
    'awaiting_confirmation',
  );
  check('the oversell order can await confirmation', !oversellAwaiting.error);
  const oversellConfirm = await setStatus(
    owner.client,
    oversellOrder.id,
    'confirmed',
  );
  checkRpcError(
    'confirmation fails when tracked stock is insufficient',
    oversellConfirm,
    '22023',
  );
  const oversellAfterFailure = await searchOrders(owner.client, businessA, {
    orderId: oversellOrder.id,
  });
  checkEqual(
    'a failed confirmation leaves the order awaiting confirmation',
    oversellAfterFailure.rows[0]?.status,
    'awaiting_confirmation',
  );
  checkEqual(
    'a failed confirmation leaves stock untouched',
    oversellAfterFailure.rows[0]?.stock_state,
    'none',
  );
  const widgetAfterOversell = await inventoryRow(widget.id);
  checkEqual(
    'a failed confirmation does not reserve stock',
    widgetAfterOversell.reserved_quantity,
    0,
  );
  checkEqual(
    'a failed confirmation leaves available stock unchanged',
    widgetAfterOversell.available_quantity,
    50,
  );
  const oversellItems = await orderItems(oversellOrder.id);
  checkEqual(
    'a failed confirmation does not mark item reservations',
    oversellItems[0]?.reserved_quantity,
    0,
  );
  const oversellCancel = await cancelOrder(
    owner.client,
    oversellOrder.id,
    'Stock was not available for this order.',
  );
  check(
    'an awaiting order with no reservation can be cancelled',
    !oversellCancel.error && oversellCancel.order?.status === 'cancelled',
    oversellCancel.error?.message,
  );
  checkEqual(
    'cancelling an unconfirmed order leaves stock state unchanged',
    oversellCancel.order?.stock_state,
    'none',
  );

  const searchNumber = await searchOrders(staff.client, businessA, {
    search: 'ord-00002',
  });
  check(
    'order search is case-insensitive by number',
    !searchNumber.error && searchNumber.rows[0]?.id === second.id,
    searchNumber.error?.message,
  );
  const searchCustomer = await searchOrders(staff.client, businessA, {
    customerId: bob.id,
  });
  checkEqual(
    'order search filters by customer',
    searchCustomer.rows.length,
    2,
  );
  const searchStatus = await searchOrders(staff.client, businessA, {
    status: 'completed',
  });
  checkEqual('order search filters by status', searchStatus.rows.length, 1);
  checkEqual(
    'order search only returns completed orders in that filter',
    searchStatus.rows[0]?.status,
    'completed',
  );
  const sortedOrders = await searchOrders(owner.client, businessA, {
    sort: 'total',
    direction: 'desc',
  });
  check(
    'order search sorts by total',
    !sortedOrders.error &&
      sortedOrders.rows[0]?.id === oversellOrder.id &&
      Number(sortedOrders.rows[0]?.total) === 120000,
    sortedOrders.error?.message,
  );
  checkEqual(
    'order search orders remaining totals after the largest',
    Number(sortedOrders.rows[1]?.total),
    5500,
  );
  const pagedOrders = await searchOrders(owner.client, businessA, {
    limit: 2,
    offset: 0,
    sort: 'number',
    direction: 'asc',
  });
  check(
    'order search paginates on the server',
    !pagedOrders.error &&
      pagedOrders.rows.length === 2 &&
      Number(pagedOrders.rows[0]?.total_count) === 7,
    pagedOrders.error?.message,
  );
  checkEqual(
    'order pagination starts with the oldest number',
    pagedOrders.rows[0]?.order_number,
    'ORD-00001',
  );
  const invalidStatusSearch = await searchOrders(owner.client, businessA, {
    status: 'unknown',
  });
  checkRpcError('invalid order status filters are rejected', invalidStatusSearch, '22023');
  const invalidSortSearch = await searchOrders(owner.client, businessA, {
    sort: 'unknown',
  });
  checkRpcError('invalid order sort options are rejected', invalidSortSearch, '22023');

  const metrics = await overview(manager.client, businessA);
  check(
    'order overview returns live metrics',
    !metrics.error &&
      Number(metrics.value?.total_orders) === 7 &&
      Number(metrics.value?.completed_count) === 1 &&
      Number(metrics.value?.cancelled_count) === 2 &&
      Number(metrics.value?.draft_count) === 4,
    metrics.error?.message,
  );
  checkEqual(
    'order overview totals open value',
    Number(metrics.value?.open_value),
    2000,
  );
  checkEqual(
    'order overview totals completed value',
    Number(metrics.value?.completed_value),
    5500,
  );
  checkEqual(
    'order overview counts orders created today',
    Number(metrics.value?.orders_today),
    7,
  );

  const crossBusinessSearch = await searchOrders(intruder.client, businessA);
  checkRpcError(
    'non-members cannot search another business orders',
    crossBusinessSearch,
    '42501',
  );
  const crossBusinessOverview = await overview(intruder.client, businessA);
  checkRpcError(
    'non-members cannot read another business order metrics',
    crossBusinessOverview,
    '42501',
  );
  const crossBusinessCatalogue = await searchCatalogue(intruder.client, businessA);
  checkRpcError(
    'non-members cannot search another business order catalogue',
    crossBusinessCatalogue,
    '42501',
  );
  const crossBusinessUpdate = await updateOrder(intruder.client, second.id, bob.id, [
    {
      product_id: service.id,
      variant_id: null,
      quantity: 1,
      unit_price: 500,
    },
  ]);
  checkRpcError(
    'non-members cannot edit another business order',
    crossBusinessUpdate,
    '42501',
  );
  const crossBusinessStatus = await setStatus(intruder.client, second.id, 'processing');
  checkRpcError(
    'non-members cannot change another business order status',
    crossBusinessStatus,
    '42501',
  );
  const crossBusinessCancel = await cancelOrder(intruder.client, second.id, 'Not my order.');
  checkRpcError(
    'non-members cannot cancel another business order',
    crossBusinessCancel,
    '42501',
  );

  const crossDirectRead = await intruder.client
    .from('orders')
    .select('id')
    .eq('business_id', businessA);
  checkEqual(
    'cross-business order reads are hidden by row level security',
    crossDirectRead.data?.length ?? 0,
    0,
  );
  const ownDirectRead = await intruder.client
    .from('orders')
    .select('id')
    .eq('business_id', businessB);
  checkEqual(
    'each business can read its own orders',
    ownDirectRead.data?.length,
    1,
  );

  const businessBCatalogue = await searchCatalogue(intruder.client, businessB);
  checkEqual(
    'order catalogue is scoped to one business',
    businessBCatalogue.rows.length,
    1,
  );
  const businessBMetrics = await overview(intruder.client, businessB);
  checkEqual(
    'order metrics are scoped to one business',
    Number(businessBMetrics.value?.total_orders),
    1,
  );

  const movementsBeforeCleanup = await movementCount(businessA);
  checkEqual(
    'stock movements are recorded for reservations and completions',
    movementsBeforeCleanup,
    7,
  );

  await cleanup();

  const remainingOrders = await db.query(
    `select count(*)::int as count
     from public.orders
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test orders are cleaned up', remainingOrders.rows[0].count, 0);

  const remainingItems = await db.query(
    `select count(*)::int as count
     from public.order_items
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test order items are cleaned up', remainingItems.rows[0].count, 0);

  const remainingEvents = await db.query(
    `select count(*)::int as count
     from public.order_events
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test order activity is cleaned up', remainingEvents.rows[0].count, 0);

  const remainingCounters = await db.query(
    `select count(*)::int as count
     from public.order_counters
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test order counters are cleaned up', remainingCounters.rows[0].count, 0);

  const remainingUsers = await db.query(
    'select count(*)::int as count from auth.users where email like $1',
    [`${emailPrefix}-%`],
  );
  checkEqual('test auth users are cleaned up', remainingUsers.rows[0].count, 0);
} catch (error) {
  results.failures.push(`Unexpected test error - ${error.message}`);
  console.error(error);
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(cleanupError);
  }
  await db.end();
}

if (results.failures.length > 0) {
  console.error(`\n${results.failures.length} of ${results.checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nDay 7 order management tests passed (${results.checks} checks).`);
}
