import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {
  AIProviderError,
  createAIProvider,
  estimateCostUsd,
  isProviderConfigured,
  readProviderConfig,
} from '../supabase/functions/_shared/ai-provider.js';
import {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  buildSystemPrompt,
  detectLanguage,
  parseAssistantOutput,
  resolveLanguage,
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
      '  node --env-file=.env.local scripts/day12-ai-commerce-tests.mjs',
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
const emailPrefix = `day12-test-${runId}`;
const slugPrefix = `day12-${runId}`;
const password = 'Day12Test!Pass123';

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

async function checkRejects(name, callback, expectedCode = null) {
  try {
    await callback();
    check(name, false, 'expected a rejection');
  } catch (error) {
    check(name, true);
    if (expectedCode) checkEqual(`${name} error code`, error?.code, expectedCode);
  }
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

function mockFetch(payload, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

const db = new Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: databasePassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'orderflow-ai-day12-tests',
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
    p_description: 'A verified Day 12 test product.',
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
  const product = unwrapRpc(data);
  await db.query(
    'update public.products set storefront_visible = true where id = $1',
    [product.id],
  );
  return product;
}

async function completeRequest(requestId, response) {
  await db.query(
    `select public.ai_complete_assistant_request(
      $1::uuid, $2::text, $3::integer, $4::integer, $5::numeric, $6::integer,
      $7::jsonb, $8::jsonb, $9::text, $10::text, $11::text
    )`,
    [
      requestId,
      'completed',
      12,
      8,
      0.0001,
      50,
      JSON.stringify(response),
      JSON.stringify(['search_products']),
      'en',
      null,
      null,
    ],
  );
}

async function cleanup() {
  try {
    if (businessA || businessB) {
      await db.query(
        'delete from public.businesses where id = any($1::uuid[])',
        [[businessA, businessB].filter(Boolean)],
      );
    }
    await db.query('delete from auth.users where email like $1', [`${emailPrefix}%`]);
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}`);
  }
}

try {
  const defaultConfig = readProviderConfig({});
  checkEqual('provider defaults to none', defaultConfig.provider, 'none');
  check('unconfigured provider is not active', !isProviderConfigured(defaultConfig));

  const configured = readProviderConfig({
    AI_PROVIDER: 'openai_compatible',
    AI_API_KEY: 'test-key',
    AI_BASE_URL: 'https://api.example.test/v1',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: '1200',
    AI_COST_PER_MILLION_INPUT_TOKENS: '1',
    AI_COST_PER_MILLION_OUTPUT_TOKENS: '2',
  });
  check('configured provider is active', isProviderConfigured(configured));
  checkEqual('timeout configuration is parsed', configured.timeoutMs, 1200);

  const unconfiguredProvider = createAIProvider(defaultConfig);
  check('unconfigured provider reports itself as inactive', !unconfiguredProvider.configured);
  await checkRejects(
    'unconfigured provider chat fails clearly',
    () => unconfiguredProvider.chat({ messages: [] }),
    'PROVIDER_NOT_CONFIGURED',
  );

  const mockProvider = createAIProvider(configured, mockFetch({
    id: 'resp-1',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: '',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'search_products',
            arguments: JSON.stringify({ query: 'shoes', limit: 3 }),
          },
        }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }));
  const mockResult = await mockProvider.chat({
    messages: [{ role: 'user', content: 'show shoes' }],
    tools: TOOL_DEFINITIONS,
    toolChoice: 'required',
  });
  checkEqual('mock provider returns one tool call', mockResult.toolCalls.length, 1);
  checkEqual('mock provider parses tool arguments', mockResult.toolCalls[0].arguments.query, 'shoes');
  checkEqual('mock provider normalizes usage', mockResult.usage.totalTokens, 15);

  const rateLimitedProvider = createAIProvider(configured, mockFetch({
    error: { message: 'rate limit reached' },
  }, 429));
  await checkRejects(
    'provider maps HTTP 429 to a rate-limit error',
    () => rateLimitedProvider.chat({ messages: [] }),
    'PROVIDER_RATE_LIMITED',
  );

  const timeoutProvider = createAIProvider(configured, async (_url, init) => new Promise(
    (_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    },
  ));
  await checkRejects(
    'provider maps aborts to timeout errors',
    () => timeoutProvider.chat({ messages: [] }),
    'PROVIDER_TIMEOUT',
  );

  checkEqual(
    'cost estimate uses configured rates',
    estimateCostUsd(configured, { inputTokens: 1000000, outputTokens: 1000000 }),
    3,
  );
  check('cost estimate is omitted when rates are absent', estimateCostUsd(defaultConfig, {}) === null);
  check('provider errors carry a stable code', new AIProviderError('X', 'x').code === 'X');

  checkEqual('tool allowlist is populated', TOOL_NAMES.length >= 7, true);
  checkEqual('tool definitions match allowlist', TOOL_DEFINITIONS.length, TOOL_NAMES.length);
  const validTool = validateToolCall({
    name: 'search_products',
    arguments: { query: 'blue shoes', limit: 5 },
  });
  check('valid tool call is accepted', validTool.ok);
  check(
    'unknown tool is rejected',
    !validateToolCall({ name: 'delete_order', arguments: {} }).ok,
  );
  check(
    'unsafe tool arguments are rejected',
    !validateToolCall({
      name: 'get_product_details',
      arguments: { product_id: 'not-a-uuid' },
    }).ok,
  );

  const detected = detectLanguage('Ese ufite ibicuruzwa nshaka kumenya igiciro');
  checkEqual('Kinyarwanda is detected', detected.language, 'rw');
  checkEqual('language preference resolves', resolveLanguage('auto', 'fr'), 'fr');
  const systemPrompt = buildSystemPrompt({
    businessName: 'Test Shop',
    supportedLanguages: ['en', 'rw'],
    language: 'en',
    extraPrompt: 'Answer concisely.',
  });
  check('system prompt contains grounding rule', systemPrompt.includes('verified records'));
  check('system prompt contains confirmation safety rule', systemPrompt.includes('explicit confirmation'));
  check('system prompt contains workspace instruction', systemPrompt.includes('Answer concisely.'));

  const parsed = parseAssistantOutput(
    JSON.stringify({
      answer: 'We have two verified products.',
      language: 'en',
      needsClarification: false,
      sourceIds: ['allowed-1', 'forged'],
    }),
    ['allowed-1'],
  );
  checkEqual('assistant answer is parsed', parsed.answer, 'We have two verified products.');
  checkEqual('forged source ids are removed', parsed.sourceIds.length, 1);
  await checkRejects(
    'non-JSON assistant output is rejected',
    async () => parseAssistantOutput('not json', []),
  );

  console.log('NOTE  provider checks used local mocks. No real AI provider was called.');

  await db.connect();
  await cleanup();

  const ownerEmail = `${emailPrefix}-owner@example.com`;
  const staffEmail = `${emailPrefix}-staff@example.com`;
  const ownerBEmail = `${emailPrefix}-owner-b@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Twelve Owner');
  const staffId = await createAuthUser(staffEmail, 'Day Twelve Staff');
  const ownerBId = await createAuthUser(ownerBEmail, 'Day Twelve Business B Owner');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Twelve Business A',
    slug: `${slugPrefix}-a`,
    currency: 'RWF',
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Twelve Business B',
    slug: `${slugPrefix}-b`,
    currency: 'USD',
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, ownerBId, 'owner');

  const ownerA = await signIn(ownerEmail);
  const staffA = await signIn(staffEmail);
  const ownerB = await signIn(ownerBEmail);

  const initialAccess = await rpc(ownerA, 'ai_get_assistant_access', { p_business_id: businessA });
  check('owner receives assistant access', initialAccess.data?.allowed === true);
  checkEqual('assistant is enabled by default', initialAccess.data?.enabled, true);
  checkEqual(
    'default language list is present',
    Array.isArray(initialAccess.data?.supportedLanguages),
    true,
  );

  const intruderAccess = await rpc(ownerB, 'ai_get_assistant_access', { p_business_id: businessA });
  checkRpcError('cross-business assistant access is denied', intruderAccess, '42501');
  const anonAccess = await rpc(anon, 'ai_get_assistant_access', { p_business_id: businessA });
  check('anonymous assistant access is denied', Boolean(anonAccess.error));

  const settings = await rpc(ownerA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_enabled: true,
    p_supported_languages: ['en', 'rw'],
    p_daily_request_limit: 100,
    p_daily_token_limit: 200000,
    p_max_output_tokens: 700,
    p_system_prompt_extra: 'Prefer concise answers.',
  });
  check('owner can upsert assistant settings', settings.data?.allowed === true);
  checkEqual('custom prompt is saved', settings.data?.systemPromptExtra, 'Prefer concise answers.');

  const staffSettings = await rpc(staffA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_enabled: false,
  });
  checkRpcError('staff cannot change assistant settings', staffSettings, '42501');

  const invalidLanguages = await rpc(ownerA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_supported_languages: ['xx'],
  });
  check('unsupported assistant languages are rejected', Boolean(invalidLanguages.error));

  const policy = await rpc(ownerA, 'ai_upsert_business_policy', {
    p_business_id: businessA,
    p_category: 'delivery',
    p_title: 'Kigali delivery',
    p_content: 'Delivery is available in Kigali.',
    p_is_active: true,
    p_sort_order: 1,
  });
  check('owner can save a business policy', policy.data?.saved === true);

  const policies = await rpc(ownerA, 'ai_get_business_policies', { p_business_id: businessA });
  checkEqual('business policy is returned', policies.data?.totalCount, 1);
  const crossPolicies = await rpc(ownerB, 'ai_get_business_policies', { p_business_id: businessA });
  checkRpcError('cross-business policies are denied', crossPolicies, '42501');

  const info = await rpc(ownerA, 'ai_get_business_information', { p_business_id: businessA });
  checkEqual('business information is grounded', info.data?.businessId, businessA);
  checkEqual('business name is grounded', info.data?.businessName, 'Day Twelve Business A');

  const product = await createProduct(ownerA, businessA, `Day12 Test Product ${runId}`, `DAY12-${runId}`, 15000);
  check('test product was created', Boolean(product.id));

  const search = await rpc(ownerA, 'ai_search_products', {
    p_business_id: businessA,
    p_query: `Day12 Test Product ${runId}`,
    p_limit: 5,
  });
  check('product search returns verified catalogue data', search.data?.products?.length >= 1);
  checkEqual('product price is grounded', Number(search.data?.products?.[0]?.price), 15000);

  const priceSearch = await rpc(ownerA, 'ai_search_products', {
    p_business_id: businessA,
    p_query: `under 20000 ${runId}`,
    p_limit: 5,
  });
  check('price-limited search works', priceSearch.data?.products?.length >= 1);

  const crossSearch = await rpc(ownerB, 'ai_search_products', {
    p_business_id: businessA,
    p_query: `Day12 Test Product ${runId}`,
  });
  checkRpcError('cross-business catalogue access is denied', crossSearch, '42501');

  const detail = await rpc(ownerA, 'ai_get_product_details', {
    p_business_id: businessA,
    p_product_id: product.id,
  });
  checkEqual('product detail is found', detail.data?.found, true);

  const availability = await rpc(ownerA, 'ai_check_product_availability', {
    p_business_id: businessA,
    p_product_id: product.id,
  });
  checkEqual('availability lookup is found', availability.data?.found, true);
  checkEqual(
    'untracked product availability is reported honestly',
    availability.data?.availability,
    'untracked',
  );

  const variants = await rpc(ownerA, 'ai_get_product_variants', {
    p_business_id: businessA,
    p_product_id: product.id,
  });
  checkEqual('variant lookup is found', variants.data?.found, true);

  const conversationId = await rpc(ownerA, 'ai_ensure_test_conversation', {
    p_business_id: businessA,
  });
  check('assistant conversation id is returned', typeof conversationId.data === 'string');

  const { rows: conversationRows } = await db.query(
    `select channel, status from public.communication_conversations where id = $1`,
    [conversationId.data],
  );
  checkEqual('assistant conversation uses internal channel', conversationRows[0]?.channel, 'ai_assistant');

  const context = await rpc(ownerA, 'ai_get_conversation_context', {
    p_business_id: businessA,
    p_conversation_id: conversationId.data,
    p_limit: 8,
  });
  checkEqual(
    'conversation context is found',
    context.data?.found,
    true,
  );
  if (context.error) console.error(`DETAIL  conversation context: ${context.error.message}`);
  checkEqual('assistant may respond initially', context.data?.aiMayRespond, true);

  await db.query(
    `update public.communication_conversations
     set status = 'assigned', assigned_to = $1
     where id = $2`,
    [ownerId, conversationId.data],
  );
  const handoverContext = await rpc(ownerA, 'ai_get_conversation_context', {
    p_business_id: businessA,
    p_conversation_id: conversationId.data,
    p_limit: 8,
  });
  checkEqual('handover pauses AI responses', handoverContext.data?.aiMayRespond, false);
  if (handoverContext.error) {
    console.error(`DETAIL  handover context: ${handoverContext.error.message}`);
  }

  const blockedTurn = await rpc(ownerA, 'ai_record_assistant_turn', {
    p_business_id: businessA,
    p_conversation_id: conversationId.data,
    p_user_message: 'Any update?',
    p_assistant_message: 'I cannot answer while this conversation is assigned.',
    p_language: 'en',
  });
  check('assistant turn is blocked during handover', Boolean(blockedTurn.error));

  await db.query(
    `update public.communication_conversations
     set status = 'open', assigned_to = null
     where id = $1`,
    [conversationId.data],
  );
  const turn = await rpc(ownerA, 'ai_record_assistant_turn', {
    p_business_id: businessA,
    p_conversation_id: conversationId.data,
    p_user_message: 'What products do you have?',
    p_assistant_message: 'I found one verified product.',
    p_sources: [{ type: 'product', id: product.id, label: product.name }],
    p_usage: { inputTokens: 10, outputTokens: 8 },
    p_language: 'en',
  });
  check('assistant turn is saved', Boolean(turn.data?.userMessageId && turn.data?.assistantMessageId));

  const storedContext = await rpc(ownerA, 'ai_get_conversation_context', {
    p_business_id: businessA,
    p_conversation_id: conversationId.data,
    p_limit: 8,
  });
  check(
    'assistant turn appears in conversation history',
    storedContext.data?.messages?.length >= 2,
    storedContext.error?.message ?? `messages=${storedContext.data?.messages?.length}`,
  );

  const requestKey = `day12-${runId}-request`;
  const begin = await rpc(ownerA, 'ai_begin_assistant_request', {
    p_business_id: businessA,
    p_request_key: requestKey,
    p_input_chars: 24,
    p_model: 'test-model',
    p_provider: 'openai_compatible',
  });
  check('assistant request is started', begin.data?.allowed === true);
  check('usage request id is returned', Boolean(begin.data?.requestId));

  const duplicate = await rpc(ownerA, 'ai_begin_assistant_request', {
    p_business_id: businessA,
    p_request_key: requestKey,
    p_input_chars: 24,
    p_model: 'test-model',
    p_provider: 'openai_compatible',
  });
  checkEqual('duplicate request is detected', duplicate.data?.reason, 'duplicate');

  await completeRequest(begin.data.requestId, {
    answer: 'I found one verified product.',
    language: 'en',
    sourceIds: [product.id],
  });

  const storedRequest = await rpc(ownerA, 'ai_get_assistant_request', {
    p_business_id: businessA,
    p_request_key: requestKey,
  });
  checkEqual('completed request status is stored', storedRequest.data?.status, 'completed');
  checkEqual('input tokens are stored', storedRequest.data?.inputTokens, 12);
  checkEqual('output tokens are stored', storedRequest.data?.outputTokens, 8);

  await rpc(ownerA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_enabled: true,
    p_daily_request_limit: 1,
    p_supported_languages: ['en', 'rw'],
    p_max_output_tokens: 700,
    p_system_prompt_extra: 'Prefer concise answers.',
  });
  const rateLimited = await rpc(ownerA, 'ai_begin_assistant_request', {
    p_business_id: businessA,
    p_request_key: `${requestKey}-limited`,
    p_input_chars: 24,
    p_model: 'test-model',
    p_provider: 'openai_compatible',
  });
  checkEqual('daily request limit is enforced', rateLimited.data?.reason, 'rate_limited');

  await rpc(ownerA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_enabled: false,
    p_daily_request_limit: 100,
  });
  const disabled = await rpc(ownerA, 'ai_begin_assistant_request', {
    p_business_id: businessA,
    p_request_key: `${requestKey}-disabled`,
    p_input_chars: 24,
    p_model: 'test-model',
    p_provider: 'openai_compatible',
  });
  checkEqual('disabled assistant blocks requests', disabled.data?.reason, 'disabled');

  await rpc(ownerA, 'ai_upsert_assistant_settings', {
    p_business_id: businessA,
    p_enabled: true,
    p_daily_request_limit: 100,
  });

  const ownSettingsRows = await ownerA
    .from('ai_assistant_settings')
    .select('business_id')
    .eq('business_id', businessA);
  check('member can read own assistant settings', (ownSettingsRows.data ?? []).length === 1);

  const crossSettingsRows = await ownerA
    .from('ai_assistant_settings')
    .select('business_id')
    .eq('business_id', businessB);
  check('member cannot read another workspace settings', (crossSettingsRows.data ?? []).length === 0);

  const ownPolicyRows = await ownerA
    .from('ai_business_policies')
    .select('id')
    .eq('business_id', businessA);
  check('member can read own policies', (ownPolicyRows.data ?? []).length === 1);

  const crossPolicyRows = await ownerB
    .from('ai_business_policies')
    .select('id')
    .eq('business_id', businessA);
  check('cross-business policy rows are hidden', (crossPolicyRows.data ?? []).length === 0);

  const ownRequestRows = await ownerA
    .from('ai_assistant_requests')
    .select('id')
    .eq('business_id', businessA);
  check('member can read own usage records', (ownRequestRows.data ?? []).length >= 1);

  console.log('NOTE  no production AI provider was called; all provider responses were local fixtures.');
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
