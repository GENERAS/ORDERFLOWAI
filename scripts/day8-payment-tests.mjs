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
      '  node --env-file=.env.local scripts/day8-payment-tests.mjs',
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
const emailPrefix = `day8-test-${runId}`;
const slugPrefix = `day8-${runId}`;
const password = 'Day8Test!Pass123';

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
  application_name: 'orderflow-ai-day8-payment-tests',
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

async function createProduct(client, businessId, payload) {
  const { data, error } = await client.rpc('create_product', {
    p_business_id: businessId,
    p_name: payload.name,
    p_description: null,
    p_category_id: null,
    p_brand_id: null,
    p_sku: payload.sku,
    p_barcode: null,
    p_price: payload.price,
    p_status: 'active',
    p_attributes: [],
    p_variants: [],
  });
  return { product: unwrapRpc(data), error };
}

async function createGuestOrder(client, businessId, productId, guestName) {
  const { data, error } = await client.rpc('create_order', {
    p_business_id: businessId,
    p_customer_id: null,
    p_guest_name: guestName,
    p_guest_phone: '+250788800111',
    p_guest_email: null,
    p_notes: null,
    p_items: [
      {
        product_id: productId,
        variant_id: null,
        quantity: 1,
      },
    ],
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

async function listMethods(client, businessId) {
  const { data, error } = await client.rpc('list_payment_methods', {
    p_business_id: businessId,
  });
  return { rows: data ?? [], error };
}

async function paymentSummary(client, orderId) {
  const { data, error } = await client.rpc('get_order_payment_summary', {
    p_order_id: orderId,
  });
  return { summary: unwrapRpc(data) ?? null, rows: data ?? [], error };
}

async function paymentOverview(client, businessId) {
  const { data, error } = await client.rpc('get_payment_overview', {
    p_business_id: businessId,
  });
  return { overview: unwrapRpc(data) ?? null, error };
}

async function payableOrders(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_payable_orders', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function searchPayments(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_payments', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_status: options.status ?? null,
    p_method_code: options.methodCode ?? null,
    p_order_id: options.orderId ?? null,
    p_date_from: options.dateFrom ?? null,
    p_date_to: options.dateTo ?? null,
    p_sort: options.sort ?? 'recent',
    p_direction: options.direction ?? 'desc',
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
  });
  return { rows: data ?? [], error };
}

async function getPaymentRow(client, paymentId) {
  const { data, error } = await client.rpc('get_payment', {
    p_payment_id: paymentId,
  });
  return { payment: unwrapRpc(data) ?? null, rows: data ?? [], error };
}

async function recordPayment(client, orderId, amount, options = {}) {
  const { data, error } = await client.rpc('record_payment', {
    p_order_id: orderId,
    p_amount: amount,
    p_method_code: options.methodCode ?? 'cash',
    p_payment_date: options.paymentDate ?? null,
    p_transaction_reference: options.reference ?? null,
    p_notes: options.notes ?? null,
    p_provider_key: options.providerKey ?? null,
    p_provider_transaction_id: options.providerTransactionId ?? null,
    p_provider_event_id: options.providerEventId ?? null,
    p_idempotency_key: options.idempotencyKey ?? null,
  });
  return { payment: unwrapRpc(data), error };
}

async function verifyPayment(client, paymentId, note = null) {
  const { data, error } = await client.rpc('verify_payment', {
    p_payment_id: paymentId,
    p_note: note,
  });
  return { payment: unwrapRpc(data), error };
}

async function rejectPayment(client, paymentId, reason) {
  const { data, error } = await client.rpc('reject_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  return { payment: unwrapRpc(data), error };
}

async function failPayment(client, paymentId, reason) {
  const { data, error } = await client.rpc('fail_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  return { payment: unwrapRpc(data), error };
}

async function requestRefund(client, paymentId, amount, options = {}) {
  const { data, error } = await client.rpc('request_refund', {
    p_payment_id: paymentId,
    p_amount: amount,
    p_reason: options.reason ?? 'Customer refund request.',
    p_reference: options.reference ?? null,
    p_idempotency_key: options.idempotencyKey ?? null,
  });
  return { refund: unwrapRpc(data), error };
}

async function completeRefund(client, refundId, reference = null) {
  const { data, error } = await client.rpc('complete_refund', {
    p_refund_id: refundId,
    p_reference: reference,
  });
  return { refund: unwrapRpc(data), error };
}

async function rejectRefund(client, refundId, reason) {
  const { data, error } = await client.rpc('reject_refund', {
    p_refund_id: refundId,
    p_reason: reason,
  });
  return { refund: unwrapRpc(data), error };
}

async function paymentEvents(paymentId) {
  const result = await db.query(
    `select *
     from public.payment_events
     where payment_id = $1
     order by created_at, id`,
    [paymentId],
  );
  return result.rows;
}

async function paymentRefundRows(paymentId) {
  const result = await db.query(
    `select *
     from public.payment_refunds
     where payment_id = $1
     order by created_at, id`,
    [paymentId],
  );
  return result.rows;
}

let businessA;
let businessB;

async function cleanup() {
  const ids = [businessA, businessB].filter(Boolean);
  if (ids.length === 0) return;

  await db.query(
    'delete from public.payment_events where business_id = any($1::uuid[])',
    [ids],
  );
  await db.query(
    'delete from public.payment_refunds where business_id = any($1::uuid[])',
    [ids],
  );
  await db.query(
    'delete from public.payments where business_id = any($1::uuid[])',
    [ids],
  );
  await db.query(
    'delete from public.payment_counters where business_id = any($1::uuid[])',
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
    'delete from public.businesses where id = any($1::uuid[])',
    [ids],
  );
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
}

async function confirmOrder(client, order) {
  await setStatus(client, order.id, 'awaiting_confirmation');
  await setStatus(client, order.id, 'awaiting_business_approval');
  const confirmed = await setStatus(client, order.id, 'confirmed');
  if (confirmed.error) {
    throw new Error(`Could not confirm order: ${confirmed.error.message}`);
  }
  return confirmed.order;
}

try {
  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const managerEmail = `${emailPrefix}-manager@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const intruderEmail = `${emailPrefix}-intruder@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Eight Owner');
  const managerId = await createAuthUser(managerEmail, 'Day Eight Manager');
  const staffId = await createAuthUser(staffEmail, 'Day Eight Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Eight Other Owner');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Eight Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Eight Business B',
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

  check('owner, manager, staff and second-business owner can sign in', true);

  const productA = await createProduct(owner.client, businessA, {
    name: 'Payment Service A',
    sku: `${runId}-service-a`,
    price: 1000,
  });
  const productB = await createProduct(intruder.client, businessB, {
    name: 'Payment Service B',
    sku: `${runId}-service-b`,
    price: 500,
  });
  check(
    'each business creates its own payable product',
    !productA.error && !productB.error && productA.product?.id && productB.product?.id,
    productA.error?.message ?? productB.error?.message,
  );
  if (!productA.product?.id || !productB.product?.id) {
    throw new Error('Cannot continue without payable products.');
  }

  const methodsA = await listMethods(owner.client, businessA);
  check(
    'business payment methods are seeded automatically',
    !methodsA.error &&
      methodsA.rows.length === 5 &&
      methodsA.rows[0]?.code === 'cash' &&
      methodsA.rows.at(-1)?.code === 'other',
    methodsA.error?.message,
  );
  const methodsB = await listMethods(intruder.client, businessB);
  check(
    'payment methods are isolated per business',
    !methodsB.error &&
      methodsB.rows.length === 5 &&
      methodsB.rows.every((row) => row.code !== undefined),
    methodsB.error?.message,
  );
  const anonMethods = await listMethods(anon, businessA);
  checkRpcError('unauthenticated users cannot list payment methods', anonMethods, '42501');
  const crossMethods = await listMethods(intruder.client, businessA);
  checkRpcError('other businesses cannot list payment methods', crossMethods, '42501');

  const draftResult = await createGuestOrder(
    owner.client,
    businessA,
    productA.product.id,
    'Payment Draft Guest',
  );
  const draft = draftResult.order;
  check('owner creates a draft order', !draftResult.error, draftResult.error?.message);
  if (!draft?.id) throw new Error('Cannot continue without a draft order.');

  const orderOneResult = await createGuestOrder(
    owner.client,
    businessA,
    productA.product.id,
    'Payment Guest One',
  );
  const orderTwoResult = await createGuestOrder(
    owner.client,
    businessA,
    productA.product.id,
    'Payment Guest Two',
  );
  const orderThreeResult = await createGuestOrder(
    owner.client,
    businessA,
    productA.product.id,
    'Payment Guest Three',
  );
  const orderFourResult = await createGuestOrder(
    owner.client,
    businessA,
    productA.product.id,
    'Payment Guest Four',
  );
  check(
    'owner creates four payable orders',
    !orderOneResult.error &&
      !orderTwoResult.error &&
      !orderThreeResult.error &&
      !orderFourResult.error,
    orderOneResult.error?.message ??
      orderTwoResult.error?.message ??
      orderThreeResult.error?.message ??
      orderFourResult.error?.message,
  );

  const [orderOne, orderTwo, orderThree, orderFour] = [
    orderOneResult.order,
    orderTwoResult.order,
    orderThreeResult.order,
    orderFourResult.order,
  ];
  if (!orderOne?.id || !orderTwo?.id || !orderThree?.id || !orderFour?.id) {
    throw new Error('Cannot continue without payable orders.');
  }

  await confirmOrder(owner.client, orderOne);
  await confirmOrder(owner.client, orderTwo);
  await confirmOrder(owner.client, orderThree);
  await confirmOrder(owner.client, orderFour);
  await setStatus(owner.client, orderFour.id, 'processing');
  await setStatus(owner.client, orderFour.id, 'ready');
  const completedOrderFour = await setStatus(
    owner.client,
    orderFour.id,
    'completed',
  );
  checkEqual(
    'the fourth order is completed before payment',
    completedOrderFour.order?.status,
    'completed',
  );

  const otherOrderResult = await createGuestOrder(
    intruder.client,
    businessB,
    productB.product.id,
    'Other Business Guest',
  );
  const otherOrder = otherOrderResult.order;
  check(
    'the second business creates a payable order',
    !otherOrderResult.error,
    otherOrderResult.error?.message,
  );
  if (!otherOrder?.id) throw new Error('Cannot continue without the other order.');
  await confirmOrder(intruder.client, otherOrder);

  const initialMethodsAnon = await anon.from('payment_methods').select('id').limit(1);
  check(
    'unauthenticated users cannot read payment methods directly',
    Boolean(initialMethodsAnon.error),
  );
  const anonPayments = await anon.from('payments').select('id').limit(1);
  check(
    'unauthenticated users cannot read payments directly',
    Boolean(anonPayments.error),
  );
  const anonRefunds = await anon.from('payment_refunds').select('id').limit(1);
  check(
    'unauthenticated users cannot read payment refunds directly',
    Boolean(anonRefunds.error),
  );
  const anonEvents = await anon.from('payment_events').select('id').limit(1);
  check(
    'unauthenticated users cannot read payment events directly',
    Boolean(anonEvents.error),
  );
  const anonCounters = await anon.from('payment_counters').select('*').limit(1);
  check(
    'unauthenticated users cannot read payment counters',
    Boolean(anonCounters.error),
  );

  const anonOverview = await paymentOverview(anon, businessA);
  checkRpcError('unauthenticated users cannot read payment metrics', anonOverview, '42501');
  const anonSearch = await searchPayments(anon, businessA);
  checkRpcError('unauthenticated users cannot search payments', anonSearch, '42501');
  const anonPayable = await payableOrders(anon, businessA);
  checkRpcError('unauthenticated users cannot search payable orders', anonPayable, '42501');
  const anonRecord = await recordPayment(anon, orderOne.id, 100);
  checkRpcError('unauthenticated users cannot record payments', anonRecord, '42501');

  const initialSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'new orders start with no verified payment',
    !initialSummary.error &&
      Number(initialSummary.summary?.order_total) === 1000 &&
      Number(initialSummary.summary?.net_paid) === 0 &&
      Number(initialSummary.summary?.balance_due) === 1000,
    initialSummary.error?.message,
  );
  checkEqual(
    'new orders start with a pending payment status',
    initialSummary.summary?.payment_status,
    'pending',
  );

  const missingSummary = await paymentSummary(owner.client, randomUUID());
  check(
    'payment summaries only return existing orders',
    !missingSummary.error && missingSummary.rows.length === 0,
    missingSummary.error?.message,
  );
  const crossSummary = await paymentSummary(owner.client, otherOrder.id);
  check(
    'payment summaries respect tenant isolation',
    !crossSummary.error && crossSummary.rows.length === 0,
    crossSummary.error?.message,
  );

  const draftPayment = await recordPayment(owner.client, draft.id, 100);
  checkRpcError('draft orders cannot receive payments', draftPayment, '22023');
  const cancelledDraft = await cancelOrder(
    owner.client,
    draft.id,
    'Draft is no longer needed.',
  );
  check('draft orders can be cancelled', !cancelledDraft.error, cancelledDraft.error?.message);
  const cancelledPayment = await recordPayment(owner.client, draft.id, 100);
  checkRpcError('cancelled orders cannot receive payments', cancelledPayment, '22023');
  const crossRecord = await recordPayment(owner.client, otherOrder.id, 100);
  checkRpcError('payments cannot be recorded across businesses', crossRecord, '42501');

  const zeroPayment = await recordPayment(owner.client, orderOne.id, 0);
  checkRpcError('payment amounts must be positive', zeroPayment, '22023');
  const negativePayment = await recordPayment(owner.client, orderOne.id, -10);
  checkRpcError('payment amounts cannot be negative', negativePayment, '22023');
  const fractionPayment = await recordPayment(owner.client, orderOne.id, 10.123);
  checkRpcError('payment amounts are limited to two decimals', fractionPayment, '22023');
  const futurePayment = await recordPayment(owner.client, orderOne.id, 100, {
    paymentDate: '2999-01-01',
  });
  checkRpcError('payment dates cannot be in the future', futurePayment, '22023');
  const unknownMethod = await recordPayment(owner.client, orderOne.id, 100, {
    methodCode: 'crypto',
  });
  checkRpcError('unknown payment methods are rejected', unknownMethod, '22023');
  const longNotes = await recordPayment(owner.client, orderOne.id, 100, {
    notes: 'x'.repeat(1001),
  });
  checkRpcError('payment notes are limited to 1000 characters', longNotes, '22023');
  const longReference = await recordPayment(owner.client, orderOne.id, 100, {
    reference: 'x'.repeat(121),
  });
  checkRpcError(
    'payment references are limited to 120 characters',
    longReference,
    '22023',
  );

  const idemOne = `idem-${runId}-one`;
  const firstPaymentResult = await recordPayment(staff.client, orderOne.id, 300, {
    reference: 'TXN-ONE-300',
    notes: 'First installment',
    idempotencyKey: idemOne,
  });
  const firstPayment = firstPaymentResult.payment;
  check(
    'staff can record a pending payment',
    !firstPaymentResult.error &&
      firstPayment?.status === 'pending' &&
      Number(firstPayment?.amount) === 300,
    firstPaymentResult.error?.message,
  );
  checkEqual('payment numbers start the business sequence', firstPayment?.payment_number, 'PAY-00001');
  checkEqual('payments use the order currency', firstPayment?.currency, 'RWF');
  checkEqual('payments snapshot the method label', firstPayment?.method_label_snapshot, 'Cash');
  checkEqual('payments record the staff actor', firstPayment?.recorded_by_name, 'Day Eight Staff');

  const idempotentRepeat = await recordPayment(staff.client, orderOne.id, 300, {
    reference: 'TXN-ONE-300',
    idempotencyKey: idemOne,
  });
  check(
    'repeating an idempotency key returns the original payment',
    !idempotentRepeat.error && idempotentRepeat.payment?.id === firstPayment?.id,
    idempotentRepeat.error?.message,
  );
  const idempotencyCount = await db.query(
    `select count(*)::int as count
     from public.payments
     where business_id = $1 and idempotency_key = $2`,
    [businessA, idemOne],
  );
  checkEqual(
    'an idempotent repeat does not create a second payment',
    idempotencyCount.rows[0].count,
    1,
  );
  const conflictingIdempotency = await recordPayment(staff.client, orderOne.id, 200, {
    idempotencyKey: idemOne,
  });
  checkRpcError(
    'idempotency keys cannot be reused for a different payment',
    conflictingIdempotency,
    '22023',
  );

  const providerProviderKey = `provider-${runId}`;
  const providerEventId = `event-${runId}`;
  const providerDuplicate = await recordPayment(staff.client, orderOne.id, 50, {
    providerKey: providerProviderKey,
    providerEventId,
    providerTransactionId: `provider-txn-${runId}`,
    idempotencyKey: `idem-${runId}-provider`,
  });
  check(
    'provider references can be recorded',
    !providerDuplicate.error &&
      providerDuplicate.payment?.provider_key === providerProviderKey &&
      providerDuplicate.payment?.provider_transaction_id === `provider-txn-${runId}`,
    providerDuplicate.error?.message,
  );
  const providerRepeat = await recordPayment(staff.client, orderOne.id, 50, {
    providerKey: providerProviderKey,
    providerEventId,
    idempotencyKey: `idem-${runId}-provider-repeat`,
  });
  checkRpcError(
    'provider events cannot be recorded twice',
    providerRepeat,
    '23505',
  );

  const afterPendingSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'pending payments do not reduce the order balance',
    !afterPendingSummary.error &&
      Number(afterPendingSummary.summary?.verified_amount) === 0 &&
      Number(afterPendingSummary.summary?.net_paid) === 0 &&
      Number(afterPendingSummary.summary?.balance_due) === 1000,
    afterPendingSummary.error?.message,
  );
  checkEqual(
    'pending payments are reported separately',
    Number(afterPendingSummary.summary?.pending_amount),
    350,
  );
  checkEqual(
    'pending payments count the pending records',
    Number(afterPendingSummary.summary?.pending_count),
    2,
  );

  const staffVerify = await verifyPayment(staff.client, firstPayment.id);
  checkRpcError('staff cannot verify payments', staffVerify, '42501');
  const managerVerify = await verifyPayment(
    manager.client,
    firstPayment.id,
    'Confirmed in bank statement.',
  );
  check(
    'managers can verify payments',
    !managerVerify.error &&
      managerVerify.payment?.status === 'verified' &&
      managerVerify.payment?.verified_by_name === 'Day Eight Manager',
    managerVerify.error?.message,
  );
  const verifiedAgain = await verifyPayment(manager.client, firstPayment.id);
  check(
    'verifying an already verified payment is idempotent',
    !verifiedAgain.error && verifiedAgain.payment?.id === firstPayment.id,
    verifiedAgain.error?.message,
  );
  const orderAfterVerify = await searchOrders(owner.client, businessA, {
    orderId: orderOne.id,
  });
  checkEqual(
    'verifying a payment does not change fulfilment status',
    orderAfterVerify.rows[0]?.status,
    'confirmed',
  );

  const staffReject = await rejectPayment(
    staff.client,
    providerDuplicate.payment.id,
    'Cannot confirm this provider event.',
  );
  checkRpcError('staff cannot reject payments', staffReject, '42501');
  const managerReject = await rejectPayment(
    manager.client,
    providerDuplicate.payment.id,
    'Duplicate provider event.',
  );
  check(
    'managers can reject pending payments',
    !managerReject.error && managerReject.payment?.status === 'rejected',
    managerReject.error?.message,
  );
  const rejectedAgain = await rejectPayment(
    manager.client,
    providerDuplicate.payment.id,
    'Duplicate provider event.',
  );
  check(
    'rejecting an already rejected payment is idempotent',
    !rejectedAgain.error && rejectedAgain.payment?.status === 'rejected',
    rejectedAgain.error?.message,
  );
  const rejectVerified = await rejectPayment(
    manager.client,
    firstPayment.id,
    'This was already verified.',
  );
  checkRpcError('verified payments cannot be rejected', rejectVerified, '22023');

  const partialSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'verified payments reduce the order balance',
    Number(partialSummary.summary?.net_paid) === 300 &&
      Number(partialSummary.summary?.balance_due) === 700,
    partialSummary.error?.message,
  );
  checkEqual(
    'partially verified orders are partially paid',
    partialSummary.summary?.payment_status,
    'partially_paid',
  );
  checkEqual(
    'rejected payments do not count as pending',
    Number(partialSummary.summary?.pending_amount),
    0,
  );

  const secondInstallment = await recordPayment(owner.client, orderOne.id, 700, {
    reference: 'TXN-ONE-700',
  });
  check(
    'the remaining balance can be recorded',
    !secondInstallment.error && Number(secondInstallment.payment?.amount) === 700,
    secondInstallment.error?.message,
  );
  const verifySecondInstallment = await verifyPayment(
    owner.client,
    secondInstallment.payment.id,
  );
  check(
    'owners can verify payments',
    !verifySecondInstallment.error &&
      verifySecondInstallment.payment?.status === 'verified',
    verifySecondInstallment.error?.message,
  );
  const paidSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'fully verified orders have no balance',
    Number(paidSummary.summary?.net_paid) === 1000 &&
      Number(paidSummary.summary?.balance_due) === 0,
    paidSummary.error?.message,
  );
  checkEqual(
    'fully verified orders are marked paid',
    paidSummary.summary?.payment_status,
    'paid',
  );
  const fullyPaidRecord = await recordPayment(owner.client, orderOne.id, 1);
  checkRpcError('fully paid orders reject additional payments', fullyPaidRecord, '22023');

  const overReserveFirst = await recordPayment(owner.client, orderTwo.id, 600, {
    idempotencyKey: `idem-${runId}-over-one`,
  });
  const overReserveSecond = await recordPayment(owner.client, orderTwo.id, 600, {
    idempotencyKey: `idem-${runId}-over-two`,
  });
  check(
    'pending payments can reserve amounts up to the order total',
    !overReserveFirst.error && !overReserveSecond.error,
    overReserveFirst.error?.message ?? overReserveSecond.error?.message,
  );
  const verifyFirstOverReserve = await verifyPayment(
    owner.client,
    overReserveFirst.payment.id,
  );
  check(
    'the first reserved payment verifies',
    !verifyFirstOverReserve.error,
    verifyFirstOverReserve.error?.message,
  );
  const verifySecondOverReserve = await verifyPayment(
    owner.client,
    overReserveSecond.payment.id,
  );
  checkRpcError(
    'verification cannot exceed the outstanding balance',
    verifySecondOverReserve,
    '22023',
  );
  const pendingRefundAttempt = await requestRefund(
    staff.client,
    overReserveSecond.payment.id,
    100,
  );
  checkRpcError(
    'refunds cannot be requested for pending payments',
    pendingRefundAttempt,
    '22023',
  );
  const rejectOverReserve = await rejectPayment(
    manager.client,
    overReserveSecond.payment.id,
    'This payment would overpay the order.',
  );
  check(
    'the second reserved payment can be rejected',
    !rejectOverReserve.error && rejectOverReserve.payment?.status === 'rejected',
    rejectOverReserve.error?.message,
  );
  const finishOrderTwo = await recordPayment(owner.client, orderTwo.id, 400, {
    idempotencyKey: `idem-${runId}-finish-two`,
  });
  const verifyFinishOrderTwo = await verifyPayment(
    owner.client,
    finishOrderTwo.payment.id,
  );
  check(
    'a replacement payment completes the order balance',
    !verifyFinishOrderTwo.error &&
      Number(verifyFinishOrderTwo.payment?.amount) === 400,
    verifyFinishOrderTwo.error?.message,
  );
  const orderTwoSummary = await paymentSummary(owner.client, orderTwo.id);
  checkEqual('the second order is fully paid', orderTwoSummary.summary?.payment_status, 'paid');

  const failedCandidate = await recordPayment(staff.client, orderThree.id, 100, {
    reference: 'CARD-DECLINED',
  });
  check(
    'a staff member can record a payment that later fails',
    !failedCandidate.error && failedCandidate.payment?.status === 'pending',
    failedCandidate.error?.message,
  );
  const staffFail = await failPayment(
    staff.client,
    failedCandidate.payment.id,
    'The card was declined.',
  );
  checkRpcError('staff cannot mark payments as failed', staffFail, '42501');
  const managerFail = await failPayment(
    manager.client,
    failedCandidate.payment.id,
    'The card was declined.',
  );
  check(
    'managers can mark pending payments as failed',
    !managerFail.error && managerFail.payment?.status === 'failed',
    managerFail.error?.message,
  );
  const failedAgain = await failPayment(
    manager.client,
    failedCandidate.payment.id,
    'The card was declined.',
  );
  check(
    'failing an already failed payment is idempotent',
    !failedAgain.error && failedAgain.payment?.status === 'failed',
    failedAgain.error?.message,
  );
  const rejectFailed = await rejectPayment(
    manager.client,
    failedCandidate.payment.id,
    'Already failed.',
  );
  checkRpcError('failed payments cannot be rejected', rejectFailed, '22023');
  const failedSummary = await paymentSummary(owner.client, orderThree.id);
  check(
    'failed payments do not reduce the order balance',
    Number(failedSummary.summary?.net_paid) === 0 &&
      Number(failedSummary.summary?.balance_due) === 1000,
    failedSummary.error?.message,
  );
  checkEqual(
    'orders with only failed payments are marked failed',
    failedSummary.summary?.payment_status,
    'failed',
  );
  const pendingOrderThree = await recordPayment(owner.client, orderThree.id, 250, {
    reference: 'CASH-PARTIAL-THREE',
  });
  check(
    'a pending payment can follow a failed payment',
    !pendingOrderThree.error && pendingOrderThree.payment?.status === 'pending',
    pendingOrderThree.error?.message,
  );

  const orderFourPayment = await recordPayment(owner.client, orderFour.id, 1000, {
    reference: 'COMPLETED-ORDER-PAYMENT',
  });
  const verifyOrderFour = await verifyPayment(
    owner.client,
    orderFourPayment.payment.id,
  );
  const orderFourPaymentDetail = await getPaymentRow(
    owner.client,
    orderFourPayment.payment.id,
  );
  check(
    'completed orders can be paid without changing fulfilment',
    !verifyOrderFour.error &&
      verifyOrderFour.payment?.status === 'verified' &&
      orderFourPaymentDetail.payment?.order_status === 'completed',
    verifyOrderFour.error?.message ?? orderFourPaymentDetail.error?.message,
  );
  const orderFourSummaryPaid = await paymentSummary(owner.client, orderFour.id);
  checkEqual(
    'a completed and paid order remains paid',
    orderFourSummaryPaid.summary?.payment_status,
    'paid',
  );

  const initialPayable = await payableOrders(manager.client, businessA);
  check(
    'payable orders include only orders with a balance',
    !initialPayable.error &&
      initialPayable.rows.length === 1 &&
      initialPayable.rows.every((row) => Number(row.balance_due) > 0),
    initialPayable.error?.message,
  );
  const payableSearch = await payableOrders(manager.client, businessA, {
    search: orderThree.order_number,
  });
  check(
    'payable order search matches order numbers',
    !payableSearch.error &&
      payableSearch.rows.length === 1 &&
      payableSearch.rows[0]?.order_id === orderThree.id,
    payableSearch.error?.message,
  );
  const payablePage = await payableOrders(manager.client, businessA, {
    limit: 1,
  });
  check(
    'payable orders report their total count for pagination',
    !payablePage.error &&
      payablePage.rows.length === 1 &&
      Number(payablePage.rows[0]?.total_count) === 1,
    payablePage.error?.message,
  );

  const staffRefundRequest = await requestRefund(
    staff.client,
    secondInstallment.payment.id,
    400,
    {
      reason: 'Customer returned part of the order.',
      idempotencyKey: `refund-${runId}-one`,
    },
  );
  const partialRefund = staffRefundRequest.refund;
  check(
    'staff can request a refund',
    !staffRefundRequest.error &&
      partialRefund?.status === 'requested' &&
      Number(partialRefund?.amount) === 400,
    staffRefundRequest.error?.message,
  );
  const requestedSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'requested refunds reserve value without reducing net paid',
    Number(requestedSummary.summary?.net_paid) === 1000 &&
      Number(requestedSummary.summary?.requested_refund_amount) === 400,
    requestedSummary.error?.message,
  );
  checkEqual(
    'requested refunds do not change the payment status',
    requestedSummary.summary?.payment_status,
    'paid',
  );
  const paymentWithRequestedRefund = await getPaymentRow(
    owner.client,
    secondInstallment.payment.id,
  );
  check(
    'payment details report requested and refundable amounts',
    Number(paymentWithRequestedRefund.payment?.requested_refund_amount) === 400 &&
      Number(paymentWithRequestedRefund.payment?.refundable_amount) === 300,
    paymentWithRequestedRefund.error?.message,
  );
  const refundRepeat = await requestRefund(
    staff.client,
    secondInstallment.payment.id,
    400,
    {
      reason: 'Customer returned part of the order.',
      idempotencyKey: `refund-${runId}-one`,
    },
  );
  check(
    'repeating a refund idempotency key returns the original refund',
    !refundRepeat.error && refundRepeat.refund?.id === partialRefund.id,
    refundRepeat.error?.message,
  );
  const refundOverRequest = await requestRefund(
    manager.client,
    secondInstallment.payment.id,
    301,
    { reason: 'Attempt to over-refund the payment.' },
  );
  checkRpcError(
    'refund requests cannot exceed the refundable balance',
    refundOverRequest,
    '22023',
  );
  const refundPendingAttempt = await requestRefund(
    staff.client,
    pendingOrderThree.payment.id,
    50,
  );
  checkRpcError(
    'pending payments cannot be refunded',
    refundPendingAttempt,
    '22023',
  );
  const refundFailedAttempt = await requestRefund(
    staff.client,
    failedCandidate.payment.id,
    50,
  );
  checkRpcError(
    'failed payments cannot be refunded',
    refundFailedAttempt,
    '22023',
  );

  const extraRefundRequest = await requestRefund(
    manager.client,
    secondInstallment.payment.id,
    100,
    {
      reason: 'Goodwill adjustment requested.',
      idempotencyKey: `refund-${runId}-two`,
    },
  );
  check(
    'a second refund request can be made against the remaining balance',
    !extraRefundRequest.error && extraRefundRequest.refund?.status === 'requested',
    extraRefundRequest.error?.message,
  );
  const staffRejectRefund = await rejectRefund(
    staff.client,
    extraRefundRequest.refund.id,
    'Staff cannot reject refunds.',
  );
  checkRpcError('staff cannot reject refunds', staffRejectRefund, '42501');
  const managerRejectRefund = await rejectRefund(
    manager.client,
    extraRefundRequest.refund.id,
    'The adjustment was not approved.',
  );
  check(
    'managers can reject refund requests',
    !managerRejectRefund.error &&
      managerRejectRefund.refund?.status === 'rejected',
    managerRejectRefund.error?.message,
  );
  const rejectRefundAgain = await rejectRefund(
    manager.client,
    extraRefundRequest.refund.id,
    'The adjustment was not approved.',
  );
  check(
    'rejecting an already rejected refund is idempotent',
    !rejectRefundAgain.error && rejectRefundAgain.refund?.status === 'rejected',
    rejectRefundAgain.error?.message,
  );
  const completeRejectedRefund = await completeRefund(
    manager.client,
    extraRefundRequest.refund.id,
  );
  checkRpcError('rejected refunds cannot be completed', completeRejectedRefund, '22023');
  const afterRejectedRefundSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'rejected refund requests release their reserved amount',
    Number(afterRejectedRefundSummary.summary?.requested_refund_amount) === 400 &&
      Number(afterRejectedRefundSummary.summary?.net_paid) === 1000,
    afterRejectedRefundSummary.error?.message,
  );

  const staffCompleteRefund = await completeRefund(
    staff.client,
    partialRefund.id,
    'REFUND-TXN-400',
  );
  checkRpcError('staff cannot complete refunds', staffCompleteRefund, '42501');
  const managerCompleteRefund = await completeRefund(
    manager.client,
    partialRefund.id,
    'REFUND-TXN-400',
  );
  check(
    'managers can complete refunds',
    !managerCompleteRefund.error &&
      managerCompleteRefund.refund?.status === 'completed' &&
      managerCompleteRefund.refund?.reference === 'REFUND-TXN-400',
    managerCompleteRefund.error?.message,
  );
  const completeRefundAgain = await completeRefund(
    manager.client,
    partialRefund.id,
    'REFUND-TXN-400',
  );
  check(
    'completing an already completed refund is idempotent',
    !completeRefundAgain.error && completeRefundAgain.refund?.status === 'completed',
    completeRefundAgain.error?.message,
  );
  const refundedSummary = await paymentSummary(owner.client, orderOne.id);
  check(
    'completed refunds reduce net paid',
    Number(refundedSummary.summary?.net_paid) === 600 &&
      Number(refundedSummary.summary?.balance_due) === 400 &&
      Number(refundedSummary.summary?.refunded_amount) === 400,
    refundedSummary.error?.message,
  );
  checkEqual(
    'partial refunds mark the order partially refunded',
    refundedSummary.summary?.payment_status,
    'partially_refunded',
  );
  const paymentAfterRefund = await getPaymentRow(
    owner.client,
    secondInstallment.payment.id,
  );
  check(
    'payment details report completed refunds',
    Number(paymentAfterRefund.payment?.refunded_amount) === 400 &&
      Number(paymentAfterRefund.payment?.refundable_amount) === 300,
    paymentAfterRefund.error?.message,
  );
  const refundOverAfterComplete = await requestRefund(
    manager.client,
    secondInstallment.payment.id,
    301,
    { reason: 'Another attempt after a completed refund.' },
  );
  checkRpcError(
    'completed refunds still reserve refundable value',
    refundOverAfterComplete,
    '22023',
  );

  const fullRefundRequest = await requestRefund(
    manager.client,
    orderFourPayment.payment.id,
    1000,
    {
      reason: 'Customer order was fully reversed.',
      idempotencyKey: `refund-${runId}-full`,
    },
  );
  check(
    'a full refund can be requested',
    !fullRefundRequest.error && Number(fullRefundRequest.refund?.amount) === 1000,
    fullRefundRequest.error?.message,
  );
  const fullRefundComplete = await completeRefund(
    owner.client,
    fullRefundRequest.refund.id,
    'REFUND-TXN-1000',
  );
  check(
    'owners can complete a full refund',
    !fullRefundComplete.error && fullRefundComplete.refund?.status === 'completed',
    fullRefundComplete.error?.message,
  );
  const orderFourRefundedSummary = await paymentSummary(owner.client, orderFour.id);
  check(
    'a full refund removes net paid',
    Number(orderFourRefundedSummary.summary?.net_paid) === 0 &&
      Number(orderFourRefundedSummary.summary?.refunded_amount) === 1000,
    orderFourRefundedSummary.error?.message,
  );
  checkEqual(
    'a fully refunded order is marked refunded',
    orderFourRefundedSummary.summary?.payment_status,
    'refunded',
  );
  const refundFullAgainAttempt = await requestRefund(
    manager.client,
    orderFourPayment.payment.id,
    1,
  );
  checkRpcError(
    'fully refunded payments cannot be refunded again',
    refundFullAgainAttempt,
    '22023',
  );

  const updateOrderAfterPayments = await searchOrders(owner.client, businessA, {
    orderId: orderFour.id,
  });
  checkEqual(
    'refunds do not change order fulfilment status',
    updateOrderAfterPayments.rows[0]?.status,
    'completed',
  );

  const otherPayment = await recordPayment(intruder.client, otherOrder.id, 100, {
    idempotencyKey: `other-${runId}-payment`,
  });
  const otherVerified = await verifyPayment(
    intruder.client,
    otherPayment.payment.id,
  );
  check(
    'the second business can record and verify its own payments',
    !otherPayment.error &&
      !otherVerified.error &&
      otherVerified.payment?.status === 'verified',
    otherPayment.error?.message ?? otherVerified.error?.message,
  );
  checkEqual(
    'payment numbering restarts for each business',
    otherPayment.payment?.payment_number,
    'PAY-00001',
  );
  checkEqual('payments use each business currency', otherPayment.payment?.currency, 'USD');

  const crossPaymentRead = await getPaymentRow(
    owner.client,
    otherPayment.payment.id,
  );
  check(
    'payment detail reads respect tenant isolation',
    !crossPaymentRead.error && crossPaymentRead.rows.length === 0,
    crossPaymentRead.error?.message,
  );
  const crossPaymentsTable = await owner.client
    .from('payments')
    .select('id')
    .eq('business_id', businessB);
  check(
    'payment table reads respect tenant isolation',
    !crossPaymentsTable.error && crossPaymentsTable.data?.length === 0,
    crossPaymentsTable.error?.message,
  );
  const crossOverview = await paymentOverview(owner.client, businessB);
  checkRpcError(
    'payment metrics cannot be read across businesses',
    crossOverview,
    '42501',
  );
  const crossPayable = await payableOrders(owner.client, businessB);
  checkRpcError(
    'payable orders cannot be read across businesses',
    crossPayable,
    '42501',
  );

  const directPaymentInsert = await owner.client.from('payments').insert({
    business_id: businessA,
    order_id: orderOne.id,
    payment_number: `DIRECT-${runId}`,
    amount: 1,
    currency: 'RWF',
    method_code: 'cash',
    method_label_snapshot: 'Cash',
    status: 'verified',
    recorded_by_name: 'Direct',
    verified_by_name: 'Direct',
    verified_at: new Date().toISOString(),
  });
  check(
    'clients cannot insert payments directly',
    Boolean(directPaymentInsert.error),
  );
  const directPaymentUpdate = await owner.client
    .from('payments')
    .update({ status: 'verified' })
    .eq('id', pendingOrderThree.payment.id);
  check(
    'clients cannot change payment status directly',
    Boolean(directPaymentUpdate.error),
  );
  const directRefundInsert = await owner.client.from('payment_refunds').insert({
    business_id: businessA,
    payment_id: secondInstallment.payment.id,
    amount: 1,
    status: 'completed',
    reason: 'Direct refund',
    requested_by_name: 'Direct',
    completed_by_name: 'Direct',
    completed_at: new Date().toISOString(),
  });
  check(
    'clients cannot insert refunds directly',
    Boolean(directRefundInsert.error),
  );
  const directEventInsert = await owner.client.from('payment_events').insert({
    business_id: businessA,
    payment_id: firstPayment.id,
    event_type: 'verified',
    summary: 'Direct event',
    actor_name: 'Direct',
  });
  check(
    'clients cannot insert payment events directly',
    Boolean(directEventInsert.error),
  );
  const directCounterUpdate = await owner.client
    .from('payment_counters')
    .update({ last_number: 999 })
    .eq('business_id', businessA);
  check(
    'clients cannot alter payment counters directly',
    Boolean(directCounterUpdate.error),
  );
  let eventImmutableError;
  try {
    await db.query(
      'update public.payment_events set summary = $1 where id = $2',
      ['Tampered', (await paymentEvents(firstPayment.id))[0]?.id],
    );
  } catch (error) {
    eventImmutableError = error;
  }
  checkEqual(
    'payment history is immutable at the database layer',
    eventImmutableError?.code,
    '42501',
  );

  const firstPaymentEvents = await paymentEvents(firstPayment.id);
  checkEqual(
    'recording and verifying a payment creates history entries',
    firstPaymentEvents.map((event) => event.event_type).sort().join(','),
    'created,verified',
  );
  checkEqual(
    'payment history records the staff creator',
    firstPaymentEvents.find((event) => event.event_type === 'created')
      ?.actor_name,
    'Day Eight Staff',
  );
  const secondPaymentEvents = await paymentEvents(secondInstallment.payment.id);
  check(
    'refund history is attached to the payment',
    secondPaymentEvents.some((event) => event.event_type === 'refund_requested') &&
      secondPaymentEvents.some((event) => event.event_type === 'refund_completed'),
  );
  const secondPaymentRefunds = await paymentRefundRows(secondInstallment.payment.id);
  checkEqual(
    'both refund records are retained for the payment',
    secondPaymentRefunds.length,
    2,
  );
  check(
    'refund history retains completed and rejected states',
    secondPaymentRefunds.some((refund) => refund.status === 'completed') &&
      secondPaymentRefunds.some((refund) => refund.status === 'rejected'),
  );

  const paymentSearch = await searchPayments(staff.client, businessA, {
    search: 'PAY-00001',
  });
  check(
    'payment search matches payment numbers',
    !paymentSearch.error &&
      paymentSearch.rows.length === 1 &&
      paymentSearch.rows[0]?.id === firstPayment.id,
    paymentSearch.error?.message,
  );
  const referenceSearch = await searchPayments(staff.client, businessA, {
    search: 'TXN-ONE-300',
  });
  check(
    'payment search matches transaction references',
    !referenceSearch.error &&
      referenceSearch.rows.length === 1 &&
      referenceSearch.rows[0]?.id === firstPayment.id,
    referenceSearch.error?.message,
  );
  const orderPaymentSearch = await searchPayments(staff.client, businessA, {
    orderId: orderOne.id,
  });
  check(
    'payment search filters by order',
    !orderPaymentSearch.error && orderPaymentSearch.rows.length === 3,
    orderPaymentSearch.error?.message,
  );
  const verifiedSearch = await searchPayments(staff.client, businessA, {
    status: 'verified',
  });
  check(
    'payment search filters by status',
    !verifiedSearch.error &&
      verifiedSearch.rows.length === 5 &&
      verifiedSearch.rows.every((row) => row.status === 'verified'),
    verifiedSearch.error?.message,
  );
  const rejectedSearch = await searchPayments(staff.client, businessA, {
    status: 'rejected',
  });
  check(
    'payment search returns rejected records',
    !rejectedSearch.error && rejectedSearch.rows.length === 2,
    rejectedSearch.error?.message,
  );
  const allStatusSearch = await searchPayments(staff.client, businessA, {
    status: 'all',
  });
  check(
    'the all-status payment filter returns every record',
    !allStatusSearch.error && allStatusSearch.rows.length === 9,
    allStatusSearch.error?.message,
  );
  const methodSearch = await searchPayments(staff.client, businessA, {
    methodCode: 'cash',
  });
  check(
    'payment search filters by method',
    !methodSearch.error && methodSearch.rows.length === 9,
    methodSearch.error?.message,
  );
  const emptyMethodSearch = await searchPayments(staff.client, businessA, {
    methodCode: 'card',
  });
  check(
    'payment search excludes unused methods',
    !emptyMethodSearch.error && emptyMethodSearch.rows.length === 0,
    emptyMethodSearch.error?.message,
  );
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const todaySearch = await searchPayments(staff.client, businessA, {
    dateFrom: today,
    dateTo: today,
  });
  check(
    'payment search filters by payment date',
    !todaySearch.error &&
      todaySearch.rows.length === 9 &&
      todaySearch.rows.every((row) => row.payment_date === today),
    todaySearch.error?.message,
  );
  const pastSearch = await searchPayments(staff.client, businessA, {
    dateTo: yesterday,
  });
  check(
    'payment search excludes older payment dates',
    !pastSearch.error && pastSearch.rows.length === 0,
    pastSearch.error?.message,
  );
  const amountSort = await searchPayments(staff.client, businessA, {
    sort: 'amount',
    direction: 'desc',
  });
  check(
    'payment search sorts by amount',
    !amountSort.error && Number(amountSort.rows[0]?.amount) === 1000,
    amountSort.error?.message,
  );
  const pagedPayments = await searchPayments(staff.client, businessA, {
    sort: 'number',
    direction: 'asc',
    limit: 3,
    offset: 0,
  });
  check(
    'payment search paginates on the server',
    !pagedPayments.error &&
      pagedPayments.rows.length === 3 &&
      Number(pagedPayments.rows[0]?.total_count) === 9 &&
      pagedPayments.rows[0]?.payment_number === 'PAY-00001',
    pagedPayments.error?.message,
  );
  const invalidStatusSearch = await searchPayments(staff.client, businessA, {
    status: 'unknown',
  });
  checkRpcError('invalid payment status filters are rejected', invalidStatusSearch, '22023');
  const invalidSortSearch = await searchPayments(staff.client, businessA, {
    sort: 'unknown',
  });
  checkRpcError('invalid payment sort options are rejected', invalidSortSearch, '22023');
  const invalidDirectionSearch = await searchPayments(staff.client, businessA, {
    direction: 'sideways',
  });
  checkRpcError(
    'invalid payment sort directions are rejected',
    invalidDirectionSearch,
    '22023',
  );
  const invalidDateSearch = await searchPayments(staff.client, businessA, {
    dateFrom: today,
    dateTo: yesterday,
  });
  checkRpcError(
    'reversed payment date ranges are rejected',
    invalidDateSearch,
    '22023',
  );

  const finalOverview = await paymentOverview(manager.client, businessA);
  check(
    'payment overview aggregates record counts',
    !finalOverview.error &&
      Number(finalOverview.overview?.total_payments) === 9 &&
      Number(finalOverview.overview?.pending_count) === 1 &&
      Number(finalOverview.overview?.failed_count) === 1,
    finalOverview.error?.message,
  );
  check(
    'payment overview aggregates verified and rejected amounts',
    Number(finalOverview.overview?.verified_count) === 5 &&
      Number(finalOverview.overview?.verified_amount) === 3000 &&
      Number(finalOverview.overview?.rejected_count) === 2 &&
      Number(finalOverview.overview?.rejected_amount) === 650,
    finalOverview.error?.message,
  );
  check(
    'payment overview aggregates pending and failed amounts',
    Number(finalOverview.overview?.pending_amount) === 250 &&
      Number(finalOverview.overview?.failed_amount) === 100,
    finalOverview.error?.message,
  );
  check(
    'payment overview aggregates refunds',
    Number(finalOverview.overview?.refunded_amount) === 1400 &&
      Number(finalOverview.overview?.requested_refund_amount) === 0,
    finalOverview.error?.message,
  );
  check(
    'payment overview reports order balances',
    Number(finalOverview.overview?.outstanding_amount) === 2400 &&
      Number(finalOverview.overview?.orders_with_balance) === 3,
    finalOverview.error?.message,
  );
  checkEqual('payment overview reports the business currency', finalOverview.overview?.currency, 'RWF');
  const otherOverview = await paymentOverview(intruder.client, businessB);
  check(
    'payment overview keeps currencies separate',
    !otherOverview.error &&
      otherOverview.overview?.currency === 'USD' &&
      Number(otherOverview.overview?.verified_amount) === 100 &&
      Number(otherOverview.overview?.outstanding_amount) === 400,
    otherOverview.error?.message,
  );

  const finalPayable = await payableOrders(manager.client, businessA);
  check(
    'fully paid orders leave the payable list',
    !finalPayable.error &&
      finalPayable.rows.length === 3 &&
      !finalPayable.rows.some((row) => row.order_id === orderTwo.id),
    finalPayable.error?.message,
  );
  check(
    'refunded balances return to the payable list',
    finalPayable.rows.some((row) => row.order_id === orderFour.id) &&
      finalPayable.rows.some((row) => row.order_id === orderOne.id),
  );
  const pendingPayable = finalPayable.rows.find((row) => row.order_id === orderThree.id);
  check(
    'payable orders exclude pending and failed payments from net paid',
    Number(pendingPayable?.net_paid) === 0 &&
      Number(pendingPayable?.pending_amount) === 250 &&
      Number(pendingPayable?.failed_amount) === 100,
  );

  const orderTwoFinal = await paymentSummary(owner.client, orderTwo.id);
  checkEqual(
    'payment status stays independent of order status',
    orderTwoFinal.summary?.payment_status,
    'paid',
  );
  const orderTwoRow = await searchOrders(owner.client, businessA, {
    orderId: orderTwo.id,
  });
  checkEqual(
    'a paid order is still not automatically fulfilled',
    orderTwoRow.rows[0]?.status,
    'confirmed',
  );

  const paymentDetail = await getPaymentRow(manager.client, firstPayment.id);
  check(
    'payment detail exposes the recorded metadata',
    !paymentDetail.error &&
      paymentDetail.payment?.transaction_reference === 'TXN-ONE-300' &&
      paymentDetail.payment?.notes === 'First installment' &&
      paymentDetail.payment?.order_number === orderOne.order_number,
    paymentDetail.error?.message,
  );
  const missingPayment = await getPaymentRow(owner.client, randomUUID());
  check(
    'missing payment details return no row',
    !missingPayment.error && missingPayment.rows.length === 0,
    missingPayment.error?.message,
  );

  check('all actor ids were created', Boolean(ownerId && managerId && staffId && intruderId));
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
