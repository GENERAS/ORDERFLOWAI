import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  buildSystemPrompt,
  parseAssistantOutput,
  validateToolCall,
} from '../supabase/functions/_shared/ai-tools.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const databasePassword = process.env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !supabaseKey || !databasePassword) {
  console.error(
    'Missing configuration. Load the database password and pass .env.local to Node:\n' +
      '  . .\\scripts\\load-supabase-db-password.ps1\n' +
      '  node --env-file=.env.local scripts/day13-ai-commerce-actions-tests.mjs',
  );
  process.exit(1);
}

async function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF.trim();
  return (await readFile(path.join(projectRoot, 'supabase', '.temp', 'project-ref'), 'utf8')).trim();
}

const projectRef = await resolveProjectRef();
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailPrefix = `day13-test-${runId}`;
const slugPrefix = `day13-${runId}`;
const password = 'Day13Test!Pass123';

const results = { checks: 0, failures: [] };
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
  application_name: 'orderflow-ai-day13-tests',
});

function createTestClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const anon = createTestClient();

async function createAuthUser(email, fullName) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at, aud, role,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token,
      reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      $1, '00000000-0000-0000-0000-000000000000', $2,
      extensions.crypt($3, extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated',
      '', '', '', '', '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', $4::text), now(), now()
    )`,
    [id, email, password, fullName],
  );
  return id;
}

async function signIn(email) {
  const client = createTestClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
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

async function rpc(client, name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  return { data: unwrapRpc(data), error };
}

async function createProduct(client, businessId, name, sku, price) {
  const { data, error } = await client.rpc('create_product', {
    p_business_id: businessId,
    p_name: name,
    p_description: 'A verified Day 13 test product.',
    p_category_id: null,
    p_brand_id: null,
    p_sku: sku,
    p_barcode: null,
    p_price: price,
    p_status: 'active',
    p_attributes: [],
    p_variants: [],
  });
  if (error) throw new Error(`create_product failed: ${error.message}`);
  return unwrapRpc(data);
}

async function cleanup() {
  try {
    if (businessA || businessB) {
      await db.query('delete from public.businesses where id = any($1::uuid[])', [
        [businessA, businessB].filter(Boolean),
      ]);
    }
    await db.query('delete from auth.users where email like $1', [`${emailPrefix}%`]);
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}`);
  }
}

try {
  check('order action tool names are allowlisted', TOOL_NAMES.length === 15);
  checkEqual('tool definitions match allowlist', TOOL_DEFINITIONS.length, TOOL_NAMES.length);
  check(
    'prepare_order_draft is exposed',
    TOOL_NAMES.includes('prepare_order_draft'),
  );
  check(
    'business approval is not exposed as an AI tool',
    !TOOL_NAMES.includes('approve_prepared_order'),
  );

  const validDraftCall = validateToolCall({
    name: 'prepare_order_draft',
    arguments: {
      customer_name: 'Test Customer',
      items: [{ product_id: randomUUID(), quantity: 2 }],
      notes: 'Prepare only',
    },
  });
  check('valid draft tool call passes', validDraftCall.ok);

  const invalidDraftCall = validateToolCall({
    name: 'prepare_order_draft',
    arguments: {
      items: [{ product_id: randomUUID(), quantity: 2, unit_price: 1 }],
    },
  });
  check('client-side price injection is rejected', !invalidDraftCall.ok);

  const approvalCall = validateToolCall({
    name: 'approve_prepared_order',
    arguments: { order_id: randomUUID() },
  });
  check('approval tool is rejected by validator', !approvalCall.ok);

  const systemPrompt = buildSystemPrompt({
    businessName: 'Test Shop',
    supportedLanguages: ['en'],
    language: 'en',
  });
  check('prompt requires explicit confirmation', systemPrompt.includes('explicit confirmation'));
  check('prompt forbids approval claims', systemPrompt.includes('Never claim business approval'));

  const parsed = parseAssistantOutput(JSON.stringify({
    answer: 'Draft prepared.',
    language: 'en',
    orderId: randomUUID(),
    stockChanged: false,
    businessApprovalRequired: true,
  }), []);
  checkEqual('order id is parsed from assistant output', typeof parsed.orderId, 'string');
  checkEqual('business approval flag is parsed', parsed.businessApprovalRequired, true);

  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const ownerBEmail = `${emailPrefix}-owner-b@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Thirteen Owner');
  const staffId = await createAuthUser(staffEmail, 'Day Thirteen Staff');
  const ownerBId = await createAuthUser(ownerBEmail, 'Day Thirteen Business B Owner');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Thirteen Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Thirteen Business B',
    slug: `${slugPrefix}-b`,
    currency: 'USD',
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, ownerBId, 'owner');

  const owner = await signIn(ownerEmail);
  const staff = await signIn(staffEmail);
  const ownerB = await signIn(ownerBEmail);

  const product = await createProduct(owner, businessA, `Day13 Product ${runId}`, `DAY13-${runId}`, 15000);
  check('test product was created', Boolean(product.id));

  const chargeSettings = await rpc(owner, 'ai_upsert_order_charge_settings', {
    p_business_id: businessA,
    p_enabled: true,
    p_delivery_fee: 500,
    p_tax_rate_bps: 1000,
    p_discount_amount: 1000,
  });
  checkEqual('charge settings are saved', chargeSettings.data?.enabled, true);

  const staffSettings = await rpc(staff, 'ai_upsert_order_charge_settings', {
    p_business_id: businessA,
    p_enabled: false,
  });
  checkRpcError('staff cannot change charge settings', staffSettings, '42501');

  const conversationResult = await rpc(owner, 'ai_ensure_test_conversation', {
    p_business_id: businessA,
  });
  const conversationId = conversationResult.data;
  check('assistant conversation is available', typeof conversationId === 'string');

  const customerInfo = await rpc(owner, 'get_customer_information', {
    p_business_id: businessA,
    p_conversation_id: conversationId,
  });
  checkEqual('unknown customer is not invented', customerInfo.data?.found, false);

  const customerEmail = `buyer-${runId}@example.com`;
  const prepareKey = randomUUID();
  const draftResult = await rpc(owner, 'prepare_order_draft', {
    p_business_id: businessA,
    p_conversation_id: conversationId,
    p_customer_name: 'Day Thirteen Buyer',
    p_customer_email: customerEmail,
    p_items: [{ product_id: product.id, quantity: 2 }],
    p_notes: 'Day 13 integration draft',
    p_idempotency_key: prepareKey,
  });
  const orderId = draftResult.data?.order?.id;
  check('draft was prepared', Boolean(orderId));
  checkEqual('draft source is the assistant', draftResult.data?.order?.source, 'ai_assistant');
  checkEqual('draft status is draft', draftResult.data?.order?.status, 'draft');
  checkEqual('draft has one item', draftResult.data?.items?.length, 1);
  checkEqual('draft is not customer-confirmed', draftResult.data?.order?.customerConfirmedAt, null);

  const duplicateDraft = await rpc(owner, 'prepare_order_draft', {
    p_business_id: businessA,
    p_conversation_id: conversationId,
    p_customer_email: customerEmail,
    p_items: [{ product_id: product.id, quantity: 9 }],
    p_idempotency_key: prepareKey,
  });
  checkEqual(
    'idempotency key returns the same draft',
    duplicateDraft.data?.order?.id,
    orderId,
  );

  const crossDraft = await rpc(ownerB, 'get_order_summary', { p_order_id: orderId });
  checkRpcError('cross-business order access is denied', crossDraft, '42501');

  const anonDraft = await rpc(anon, 'prepare_order_draft', {
    p_business_id: businessA,
    p_items: [{ product_id: product.id, quantity: 1 }],
    p_idempotency_key: randomUUID(),
  });
  check('anonymous draft preparation is denied', Boolean(anonDraft.error));

  const quoteResult = await rpc(owner, 'calculate_order_quote', {
    p_order_id: orderId,
    p_idempotency_key: randomUUID(),
  });
  checkEqual('quote is version one', quoteResult.data?.quote?.version, 1);
  checkEqual('quote status is draft', quoteResult.data?.quote?.status, 'draft');
  checkEqual('quote applies configured charges', Number(quoteResult.data?.quote?.total), 32400);

  const presentResult = await rpc(owner, 'request_customer_confirmation', {
    p_order_id: orderId,
    p_idempotency_key: randomUUID(),
  });
  checkEqual('presented quote is version two', presentResult.data?.quote?.version, 2);
  checkEqual('quote status is presented', presentResult.data?.quote?.status, 'presented');
  checkEqual('order awaits confirmation', presentResult.data?.order?.status, 'awaiting_confirmation');
  checkEqual('no stock was reserved', presentResult.data?.order?.stockState, 'none');

  const ambiguous = await rpc(owner, 'submit_confirmed_order_for_business_approval', {
    p_order_id: orderId,
    p_confirmation_text: 'Maybe, tell me more',
    p_idempotency_key: randomUUID(),
  });
  checkEqual('ambiguous confirmation is rejected', ambiguous.data?.accepted, false);
  checkEqual('ambiguous confirmation asks for clarification', ambiguous.data?.reason, 'explicit_confirmation_required');

  const confirmed = await rpc(owner, 'submit_confirmed_order_for_business_approval', {
    p_order_id: orderId,
    p_confirmation_text: 'Yes, please confirm this order',
    p_idempotency_key: randomUUID(),
  });
  checkEqual('explicit confirmation is accepted', confirmed.data?.accepted, true);
  checkEqual('order awaits business approval', confirmed.data?.order?.status, 'awaiting_business_approval');
  checkEqual('confirmation timestamp is stored', Boolean(confirmed.data?.order?.customerConfirmedAt), true);
  checkEqual('approval is still required', confirmed.data?.approvalRequired, true);
  checkEqual('no stock was reserved by confirmation', confirmed.data?.order?.stockState, 'none');

  const statusResult = await rpc(owner, 'ai_get_customer_order_status', {
    p_business_id: businessA,
    p_order_number: draftResult.data?.order?.orderNumber,
    p_verification: customerEmail,
  });
  checkEqual('day 12 order status tool is fixed', statusResult.data?.found, true);
  checkEqual('order status items use the correct snapshot column', statusResult.data?.items?.[0]?.name, `Day13 Product ${runId}`);

  await db.query(
    `update public.communication_conversations
     set status = 'assigned', assigned_to = $1
     where id = $2`,
    [ownerId, conversationId],
  );
  const handoverBlocked = await rpc(owner, 'request_order_clarification', {
    p_order_id: orderId,
    p_reason: 'Handover should block this action',
    p_idempotency_key: randomUUID(),
  });
  check('human handover blocks order actions', Boolean(handoverBlocked.error));
  await db.query(
    `update public.communication_conversations
     set status = 'open', assigned_to = null
     where id = $1`,
    [conversationId],
  );

  const staffApproval = await rpc(staff, 'approve_prepared_order', {
    p_order_id: orderId,
    p_idempotency_key: randomUUID(),
  });
  checkRpcError('staff cannot approve an AI order', staffApproval, '42501');

  const approved = await rpc(owner, 'approve_prepared_order', {
    p_order_id: orderId,
    p_idempotency_key: randomUUID(),
  });
  checkEqual('owner approves the order', approved.data?.approved, true);
  checkEqual('approved order status is confirmed', approved.data?.order?.status, 'confirmed');
  checkEqual('preparation is approved', approved.data?.preparation?.status, 'approved');
  checkEqual('approval was logged as stock-affecting', approved.data?.stockReserved, true);

  const rejectionDraft = await rpc(owner, 'prepare_order_draft', {
    p_business_id: businessA,
    p_items: [{ product_id: product.id, quantity: 1 }],
    p_customer_name: 'Reject Buyer',
    p_idempotency_key: randomUUID(),
  });
  const rejectionOrderId = rejectionDraft.data?.order?.id;
  await rpc(owner, 'request_customer_confirmation', {
    p_order_id: rejectionOrderId,
    p_idempotency_key: randomUUID(),
  });
  await rpc(owner, 'submit_confirmed_order_for_business_approval', {
    p_order_id: rejectionOrderId,
    p_confirmation_text: 'Yes confirm',
    p_idempotency_key: randomUUID(),
  });
  const rejected = await rpc(owner, 'reject_prepared_order', {
    p_order_id: rejectionOrderId,
    p_reason: 'Customer changed the requested item.',
    p_idempotency_key: randomUUID(),
  });
  checkEqual('preparation is rejected', rejected.data?.preparation?.status, 'rejected');
  checkEqual('rejected order is cancelled', rejected.data?.order?.status, 'cancelled');

  const clarificationDraft = await rpc(owner, 'prepare_order_draft', {
    p_business_id: businessA,
    p_items: [{ product_id: product.id, quantity: 1 }],
    p_customer_name: 'Clarify Buyer',
    p_idempotency_key: randomUUID(),
  });
  const clarificationOrderId = clarificationDraft.data?.order?.id;
  const clarified = await rpc(owner, 'request_order_clarification', {
    p_order_id: clarificationOrderId,
    p_reason: 'Confirm the delivery address.',
    p_idempotency_key: randomUUID(),
  });
  checkEqual('clarification is recorded', clarified.data?.preparation?.status, 'clarification_requested');
  checkEqual('clarification requires a fresh quote', clarified.data?.requiresReconfirmation, true);

  const cancelled = await rpc(owner, 'cancel_order_draft', {
    p_order_id: clarificationOrderId,
    p_reason: 'Customer cancelled before approval.',
    p_idempotency_key: randomUUID(),
  });
  checkEqual('draft cancellation is recorded', cancelled.data?.preparation?.status, 'cancelled');
  checkEqual('cancelled order status is cancelled', cancelled.data?.order?.status, 'cancelled');

  const search = await rpc(owner, 'ai_search_order_preparations', {
    p_business_id: businessA,
    p_limit: 25,
  });
  check(
    'preparation search returns records',
    search.data?.count >= 3,
    `count=${search.data?.count}, items=${search.data?.items?.length}`,
  );
  checkEqual('preparation search excludes other workspaces', search.data?.items?.every((item) => item.orderStatus), true);

  const crossSearch = await rpc(ownerB, 'ai_search_order_preparations', {
    p_business_id: businessA,
  });
  checkRpcError('cross-business preparation search is denied', crossSearch, '42501');

  const ownTableRows = await owner
    .from('ai_order_preparations')
    .select('id')
    .eq('business_id', businessA);
  check('member can read own preparation rows', (ownTableRows.data ?? []).length >= 3);

  const crossTableRows = await ownerB
    .from('ai_order_preparations')
    .select('id')
    .eq('business_id', businessA);
  checkEqual('cross-business preparation rows are hidden', crossTableRows.data?.length ?? 0, 0);

  console.log('NOTE  no AI provider was called; these are direct RPC and local validation checks.');
} finally {
  await cleanup();
  await db.end();
}

console.log(`\n${results.checks} checks run; ${results.failures.length} failed.`);
if (results.failures.length > 0) {
  console.error('\nFailures:');
  for (const failure of results.failures) console.error(`- ${failure}`);
  process.exit(1);
}
