import { randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { toHex, verifyMetaSignature } from '../supabase/functions/whatsapp-webhook/signature.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const projectRoot = path.resolve(import.meta.dirname, '..');
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const databasePassword = process.env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !supabaseKey || !databasePassword) {
  console.error(
    'Missing configuration. Load the database password and pass .env.local to Node:\n' +
      '  . .\\scripts\\load-supabase-db-password.ps1\n' +
      '  node --env-file=.env.local scripts/day11-communication-tests.mjs',
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
const emailPrefix = `day11-test-${runId}`;
const slugPrefix = `day11-${runId}`;
const password = 'Day11Test!Pass123';
const simulatedToken = `simulated-meta-token-${runId}`;

const results = { checks: 0, failures: [] };
let businessA;
let businessB;
let ownerA;
let ownerB;
let staffA;

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
  application_name: 'orderflow-ai-day11-communication-tests',
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
  return { client, user: data.user };
}

async function insertBusiness({ id, name, slug }) {
  await db.query(
    `insert into public.businesses (id, name, slug, currency, country, timezone)
     values ($1, $2, $3, 'RWF', 'RW', 'Africa/Kigali')`,
    [id, name, slug],
  );
}

async function addMember(businessId, userId, role) {
  await db.query(
    `insert into public.business_members (business_id, user_id, role, status)
     values ($1, $2, $3, 'active')`,
    [businessId, userId, role],
  );
}

async function createCustomer(businessId, phone, fullName) {
  const { rows } = await db.query(
    `insert into public.customers (
       business_id, full_name, phone, phone_normalized, email, created_at, updated_at
     )
     values ($1, $2, $3, public.communication_normalize_phone($3), $4, now(), now())
     returning id`,
    [businessId, fullName, phone, `${emailPrefix}-${randomUUID().slice(0, 8)}@example.test`],
  );
  return rows[0].id;
}

async function createWhatsAppConnection({ businessId, phoneNumberId, wabaId, connectedBy }) {
  const { rows } = await db.query(
    `insert into public.business_channel_connections (
       business_id, channel, provider, external_account_id, external_phone_number_id,
       display_phone_number, verified_name, business_portfolio_id, status, scopes,
       last_health_check_at, metadata, connected_by, connected_at, created_at, updated_at
     )
     values (
       $1, 'whatsapp', 'meta', $2, $3, '+15550000000', 'OrderFlow Test',
       $4, 'connected', ARRAY['whatsapp_business_messaging','whatsapp_business_management']::text[],
       now(), '{"source":"day11-test"}'::jsonb, $5, now(), now(), now()
     )
     returning id`,
    [businessId, wabaId, phoneNumberId, `${wabaId}-portfolio`, connectedBy],
  );
  const connectionId = rows[0].id;
  await db.query(
    `insert into private.channel_credentials (
       connection_id, access_token, token_type, scopes, expires_at, refreshed_at, created_at, updated_at
     )
     values (
       $1, $2, 'bearer',
       ARRAY['whatsapp_business_messaging','whatsapp_business_management']::text[],
       null, now(), now(), now()
     )`,
    [connectionId, simulatedToken],
  );
  return connectionId;
}

async function createReadyMediaAsset(businessId, filename) {
  const { rows } = await db.query(
    `insert into public.media_assets (
       business_id, provider, provider_file_id, bucket, asset_category, original_filename,
       mime_type, file_size, status, client_request_id, metadata, completed_at, created_at, updated_at
     )
     values (
       $1, 'supabase', $2, 'product-images', 'product_image', $3,
       'image/jpeg', 2048, 'ready', $4, '{}'::jsonb, now(), now(), now()
     )
     returning id, provider_file_id`,
    [businessId, `day11-${runId}-${randomUUID()}.jpg`, filename, randomUUID()],
  );
  return rows[0];
}

function makeIncomingPayload({
  phoneId,
  wabaId,
  from,
  messageId,
  text,
  timestamp,
  name = 'Day Eleven Customer',
  includeUserId = false,
}) {
  const message = {
    from,
    id: messageId,
    timestamp: String(timestamp),
    type: 'text',
    text: { body: text },
  };
  if (includeUserId) message.from_user_id = `US.${messageId}`;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15550000000',
                phone_number_id: phoneId,
              },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function makeStatusPayload({ phoneId, wabaId, messageId, status, timestamp, errors = [] }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15550000000',
                phone_number_id: phoneId,
              },
              statuses: [
                {
                  id: messageId,
                  status,
                  timestamp: String(timestamp),
                  recipient_id: '16505550001',
                  errors,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function processWebhook(payload) {
  const { rows } = await db.query(
    'select * from public.communication_process_whatsapp_webhook($1::jsonb)',
    [JSON.stringify(payload)],
  );
  return rows[0];
}

async function scalarNumber(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]?.value ?? 0);
}

async function scalarText(sql, params = []) {
  const { rows } = await db.query(sql, params);
  if (!rows.length) return null;
  return rows[0].value ?? Object.values(rows[0])[0] ?? null;
}

function rpc(client, name, params = {}) {
  return client.rpc(name, params);
}

async function makeSignature(secret, rawBody) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return `sha256=${toHex(signature)}`;
}

async function cleanup() {
  try {
    if (businessA || businessB) {
      await db.query(
        `delete from public.communication_webhook_events
         where business_id = any($1::uuid[]) or event_key like '%' || $2 || '%'`,
        [[businessA, businessB].filter(Boolean), runId],
      );
      await db.query(
        'delete from public.communication_audit_log where business_id = any($1::uuid[])',
        [[businessA, businessB].filter(Boolean)],
      );
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
  await db.connect();

  const rawBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const validSignature = await makeSignature('day11-app-secret', rawBody);
  check(
    'valid Meta signature is accepted',
    await verifyMetaSignature('day11-app-secret', rawBody, validSignature),
  );
  check(
    'invalid Meta signature is rejected',
    !(await verifyMetaSignature('day11-app-secret', `${rawBody} `, validSignature)),
  );
  check(
    'malformed Meta signature is rejected',
    !(await verifyMetaSignature('day11-app-secret', rawBody, 'sha256=not-hex')),
  );
  check(
    'missing Meta signature secret is rejected',
    !(await verifyMetaSignature('', rawBody, validSignature)),
  );
  console.log('NOTE  webhook signature checks use local HMAC fixtures, not a real Meta delivery.');

  const ownerAId = await createAuthUser(`${emailPrefix}-owner-a@example.test`, 'Owner A');
  const staffAId = await createAuthUser(`${emailPrefix}-staff-a@example.test`, 'Staff A');
  const ownerBId = await createAuthUser(`${emailPrefix}-owner-b@example.test`, 'Owner B');
  businessA = randomUUID();
  businessB = randomUUID();
  await insertBusiness({ id: businessA, name: 'Day Eleven A', slug: `${slugPrefix}-a` });
  await insertBusiness({ id: businessB, name: 'Day Eleven B', slug: `${slugPrefix}-b` });
  await addMember(businessA, ownerAId, 'owner');
  await addMember(businessA, staffAId, 'staff');
  await addMember(businessB, ownerBId, 'owner');

  const signedA = await signIn(`${emailPrefix}-owner-a@example.test`);
  const signedB = await signIn(`${emailPrefix}-owner-b@example.test`);
  const signedStaffA = await signIn(`${emailPrefix}-staff-a@example.test`);
  ownerA = signedA.client;
  ownerB = signedB.client;
  staffA = signedStaffA.client;

  const anonChannels = await rpc(anon, 'communication_list_channels', { p_business_id: businessA });
  checkRpcError('anonymous users cannot list channels', anonChannels);

  const disconnected = await rpc(ownerA, 'communication_list_channels', {
    p_business_id: businessA,
  });
  check('business starts with a WhatsApp channel row', disconnected.data?.length === 4);
  const whatsappBefore = disconnected.data?.find((row) => row.code === 'whatsapp');
  checkEqual('WhatsApp channel exists', whatsappBefore?.code, 'whatsapp');
  checkEqual('WhatsApp starts with no connection row', whatsappBefore?.connection_id, null);
  check(
    'channel list contains no credential material',
    !JSON.stringify(disconnected.data ?? {}).includes('access_token'),
  );
  checkEqual(
    'unavailable channels are visible as coming soon',
    disconnected.data?.find((row) => row.code === 'instagram')?.channel_status,
    'coming_soon',
  );

  const phoneIdA = `phone${runId}A`;
  const phoneIdB = `phone${runId}B`;
  const wabaIdA = `waba${runId}A`;
  const wabaIdB = `waba${runId}B`;
  const connectionA = await createWhatsAppConnection({
    businessId: businessA,
    phoneNumberId: phoneIdA,
    wabaId: wabaIdA,
    connectedBy: ownerAId,
  });
  const connectionB = await createWhatsAppConnection({
    businessId: businessB,
    phoneNumberId: phoneIdB,
    wabaId: wabaIdB,
    connectedBy: ownerBId,
  });

  check(
    'two businesses can hold separate server-side connections',
    connectionA !== connectionB,
  );

  const connectedChannels = await rpc(ownerA, 'communication_list_channels', {
    p_business_id: businessA,
  });
  const whatsappConnected = connectedChannels.data?.find((row) => row.code === 'whatsapp');
  checkEqual('WhatsApp connection status is visible', whatsappConnected?.connection_status, 'connected');
  checkEqual('connected phone number is visible', whatsappConnected?.external_phone_number_id, phoneIdA);
  check(
    'connection metadata contains no access token',
    !JSON.stringify(whatsappConnected ?? {}).includes(simulatedToken),
  );

  const crossBusinessChannels = await rpc(ownerB, 'communication_list_channels', {
    p_business_id: businessA,
  });
  checkRpcError('owner cannot read another business channels', crossBusinessChannels, '42501');

  const tokenThroughClient = await rpc(ownerA, 'communication_get_channel_token', {
    p_connection_id: connectionA,
  });
  checkRpcError('authenticated users cannot read provider tokens', tokenThroughClient);

  const { rows: tokenRows } = await db.query(
    'select access_token from public.communication_get_channel_token($1)',
    [connectionA],
  );
  checkEqual('server-side token lookup works for webhooks', tokenRows[0]?.access_token, simulatedToken);

  const customerA = await createCustomer(businessA, '+16505550001', 'Matched Customer');
  const customerB = await createCustomer(businessB, '+16505550002', 'Other Business Customer');
  const now = Math.floor(Date.now() / 1000);
  const messageId1 = `wamid.${runId}.1`;
  const firstPayload = makeIncomingPayload({
    phoneId: phoneIdA,
    wabaId: wabaIdA,
    from: '+16505550001',
    messageId: messageId1,
    text: 'Hello from a customer',
    timestamp: now,
    includeUserId: true,
  });

  const firstResult = await processWebhook(firstPayload);
  checkEqual('webhook processing status', firstResult?.status, 'completed');
  checkEqual('webhook processed one message', Number(firstResult?.processed), 1);
  checkEqual('webhook belongs to the correct business', firstResult?.business_id, businessA);

  const conversationRows = await rpc(ownerA, 'communication_list_conversations', {
    p_business_id: businessA,
  });
  checkEqual('one conversation was created', conversationRows.data?.length, 1);
  const conversation = unwrapRpc(conversationRows.data);
  checkEqual('conversation is scoped to business A', conversation?.business_id, businessA);
  checkEqual('conversation uses WhatsApp channel', conversation?.channel, 'whatsapp');
  checkEqual('conversation customer was matched by phone', conversation?.customer_id, customerA);
  checkEqual('conversation has one unread message', Number(conversation?.unread_count), 1);
  checkEqual(
    'conversation external id is the stable sender id',
    conversation?.external_customer_id?.startsWith('US.') ?? false,
    true,
  );

  const inboundCount = await scalarNumber(
    `select count(*)::text as value from public.communication_messages
     where business_id = $1 and direction = 'inbound'`,
    [businessA],
  );
  checkEqual('one inbound message was stored', inboundCount, 1);

  const duplicateResult = await processWebhook(firstPayload);
  checkEqual('duplicate webhook is detected', Number(duplicateResult?.duplicates), 1);
  const duplicateCount = await scalarNumber(
    `select count(*)::text as value from public.communication_messages
     where business_id = $1 and direction = 'inbound'`,
    [businessA],
  );
  checkEqual('duplicate webhook did not create a second message', duplicateCount, 1);

  const unknownResult = await processWebhook(
    makeIncomingPayload({
      phoneId: `unknown-${runId}`,
      wabaId: `unknown-${runId}`,
      from: '+16505550999',
      messageId: `wamid.${runId}.unknown`,
      text: 'Unknown channel',
      timestamp: now,
    }),
  );
  checkEqual('unmapped webhook is ignored', Number(unknownResult?.ignored), 1);
  const businessBConversationCount = await scalarNumber(
    'select count(*)::text as value from public.communication_conversations where business_id = $1',
    [businessB],
  );
  checkEqual('unmapped webhook was not assigned to another business', businessBConversationCount, 0);

  const nameOnlyResult = await processWebhook(
    makeIncomingPayload({
      phoneId: phoneIdA,
      wabaId: wabaIdA,
      from: '+16505550777',
      messageId: `wamid.${runId}.nameonly`,
      text: 'Different person',
      timestamp: now,
      name: 'Matched Customer',
    }),
  );
  checkEqual('name-only webhook was processed', Number(nameOnlyResult?.processed), 1);
  const nameOnlyConversation = await scalarText(
    `select c.customer_id::text as value
     from public.communication_conversations c
     where c.business_id = $1 and c.external_customer_id = $2`,
    [businessA, '+16505550777'],
  );
  checkEqual('matching only by name did not merge customers', nameOnlyConversation, null);

  const sendContext = await rpc(ownerA, 'communication_get_send_context', {
    p_conversation_id: conversation.id,
  });
  const sendContextRow = unwrapRpc(sendContext.data);
  checkEqual('send context recipient is correct', sendContextRow?.recipient, conversation.external_customer_id);
  checkEqual('service window is open after incoming message', sendContextRow?.service_window_open, true);
  checkEqual('template is not required inside window', sendContextRow?.template_required, false);
  checkEqual('connected channel can send', sendContextRow?.can_send, true);
  checkEqual('send context has no token', sendContextRow?.access_token, undefined);

  const clientRequestId = randomUUID();
  const outbound = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Thanks for reaching out.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: clientRequestId,
  });
  checkEqual('outbound text message was queued', outbound.data?.[0]?.status, 'queued');
  checkEqual('outbound message is not duplicate', outbound.data?.[0]?.is_duplicate, false);

  const duplicateOutbound = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Thanks for reaching out.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: clientRequestId,
  });
  checkEqual('duplicate send request is idempotent', duplicateOutbound.data?.[0]?.is_duplicate, true);
  checkEqual(
    'duplicate send request returns the same message',
    duplicateOutbound.data?.[0]?.id,
    outbound.data?.[0]?.id,
  );

  const providerMessageId = `wamout.${runId}.1`;
  const finalized = await rpc(ownerA, 'communication_finalize_outbound_message', {
    p_message_id: outbound.data[0].id,
    p_provider_message_id: providerMessageId,
    p_status: 'sent',
    p_metadata: { source: 'day11-test' },
  });
  checkEqual('provider response was stored', finalized.data, true);

  const deliveredResult = await processWebhook(
    makeStatusPayload({
      phoneId: phoneIdA,
      wabaId: wabaIdA,
      messageId: providerMessageId,
      status: 'delivered',
      timestamp: now + 1,
    }),
  );
  checkEqual('delivery webhook was processed', Number(deliveredResult?.processed), 1);
  checkEqual(
    'delivery status came from webhook, not API acceptance',
    await scalarText(
      'select status from public.communication_messages where id = $1',
      [outbound.data[0].id],
    ),
    'delivered',
  );
  check(
    'delivered timestamp was recorded',
    (await scalarText(
      'select delivered_at is not null::text from public.communication_messages where id = $1',
      [outbound.data[0].id],
    )) === 'true',
  );

  const duplicateStatusResult = await processWebhook(
    makeStatusPayload({
      phoneId: phoneIdA,
      wabaId: wabaIdA,
      messageId: providerMessageId,
      status: 'delivered',
      timestamp: now + 1,
    }),
  );
  checkEqual('duplicate delivery webhook is ignored', Number(duplicateStatusResult?.duplicates), 1);

  const readResult = await processWebhook(
    makeStatusPayload({
      phoneId: phoneIdA,
      wabaId: wabaIdA,
      messageId: providerMessageId,
      status: 'read',
      timestamp: now + 2,
    }),
  );
  checkEqual('read webhook was processed', Number(readResult?.processed), 1);
  checkEqual(
    'read status was recorded',
    await scalarText(
      'select status from public.communication_messages where id = $1',
      [outbound.data[0].id],
    ),
    'read',
  );

  const failedProviderId = `wamout.${runId}.failed`;
  const failedOutbound = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'This one will fail.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  await rpc(ownerA, 'communication_finalize_outbound_message', {
    p_message_id: failedOutbound.data[0].id,
    p_provider_message_id: failedProviderId,
    p_status: 'sent',
    p_metadata: {},
  });
  const failedResult = await processWebhook(
    makeStatusPayload({
      phoneId: phoneIdA,
      wabaId: wabaIdA,
      messageId: failedProviderId,
      status: 'failed',
      timestamp: now + 3,
      errors: [{ code: 131047, title: 'Re-engagement message' }],
    }),
  );
  checkEqual('failed webhook was processed', Number(failedResult?.processed), 1);
  checkEqual(
    'failed status was recorded',
    await scalarText(
      'select status from public.communication_messages where id = $1',
      [failedOutbound.data[0].id],
    ),
    'failed',
  );
  checkEqual(
    'failure code was recorded',
    await scalarText(
      'select error_code from public.communication_messages where id = $1',
      [failedOutbound.data[0].id],
    ),
    '131047',
  );

  await db.query(
    `update public.communication_conversations
     set last_incoming_at = now() - interval '25 hours', last_message_at = now() - interval '25 hours'
     where id = $1`,
    [conversation.id],
  );
  const outsideWindowContext = await rpc(ownerA, 'communication_get_send_context', {
    p_conversation_id: conversation.id,
  });
  const outsideWindowContextRow = unwrapRpc(outsideWindowContext.data);
  checkEqual('service window is closed after 24 hours', outsideWindowContextRow?.service_window_open, false);
  checkEqual('template is required outside window', outsideWindowContextRow?.template_required, true);

  const templateRequiredError = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Outside the window.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  checkRpcError('free-form send is blocked outside window', templateRequiredError, '22023');

  const templateMessage = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Template body supplied by Meta.',
    p_media_asset_id: null,
    p_template_name: 'customer_service_window_closure',
    p_template_language: 'en',
    p_client_request_id: randomUUID(),
  });
  checkEqual(
    'template message can be queued outside window',
    templateMessage.data?.[0]?.template_name,
    'customer_service_window_closure',
  );
  checkEqual(
    'template approval was not fabricated',
    templateMessage.data?.[0]?.provider_status ?? null,
    null,
  );

  await db.query(
    `update public.communication_conversations
     set last_incoming_at = now(), last_message_at = now()
     where id = $1`,
    [conversation.id],
  );

  const optOutSet = await rpc(ownerA, 'communication_set_opt_out', {
    p_business_id: businessA,
    p_external_customer_id: conversation.external_customer_id,
    p_opted_out: true,
    p_reason: 'customer request',
  });
  checkEqual('opt-out was recorded', optOutSet.data, true);
  const optedOutContext = await rpc(ownerA, 'communication_get_send_context', {
    p_conversation_id: conversation.id,
  });
  const optedOutContextRow = unwrapRpc(optedOutContext.data);
  checkEqual('send context reports opt-out', optedOutContextRow?.opted_out, true);
  checkEqual('opted-out customer cannot receive messages', optedOutContextRow?.can_send, false);

  const optOutSend = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Should be blocked.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  checkRpcError('opt-out blocks outbound creation', optOutSend, '22023');

  await rpc(ownerA, 'communication_set_opt_out', {
    p_business_id: businessA,
    p_external_customer_id: conversation.external_customer_id,
    p_opted_out: false,
    p_reason: 'test restored',
  });

  const imageA = await createReadyMediaAsset(businessA, 'valid-image.jpg');
  const imageB = await createReadyMediaAsset(businessB, 'other-business-image.jpg');
  const imageMessage = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'image',
    p_text_content: 'Here is a real image.',
    p_media_asset_id: imageA.id,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  checkEqual('outbound image uses a real business asset', imageMessage.data?.[0]?.media_asset_id, imageA.id);
  checkEqual(
    'outbound image resolves provider file id',
    imageMessage.data?.[0]?.media_provider_file_id,
    imageA.provider_file_id,
  );

  const crossBusinessImage = await rpc(ownerA, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'image',
    p_text_content: 'Stolen image.',
    p_media_asset_id: imageB.id,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  checkRpcError('cross-business image is rejected', crossBusinessImage, '22023');

  const businessImages = await rpc(ownerA, 'communication_list_business_images', {
    p_business_id: businessA,
  });
  check(
    'business image list contains the ready asset',
    (businessImages.data ?? []).some((row) => row.media_asset_id === imageA.id),
  );
  check(
    'business image list does not contain another business asset',
    !(businessImages.data ?? []).some((row) => row.media_asset_id === imageB.id),
  );

  const assignResult = await rpc(ownerA, 'communication_assign_conversation', {
    p_conversation_id: conversation.id,
    p_assignee_id: staffAId,
  });
  checkEqual('conversation can be assigned to staff', assignResult.data, true);
  const assignedConversation = unwrapRpc(
    (await rpc(ownerA, 'communication_get_conversation', {
      p_conversation_id: conversation.id,
    })).data,
  );
  checkEqual('assignment is visible', assignedConversation?.assigned_to, staffAId);
  checkEqual('assignment sets human handover status', assignedConversation?.status, 'assigned');
  checkEqual(
    'assignment audit was recorded',
    await scalarNumber(
      `select count(*)::text as value from public.communication_audit_log
       where business_id = $1 and action = 'conversation_assigned'`,
      [businessA],
    ),
    1,
  );

  const resolved = await rpc(staffA, 'communication_set_conversation_status', {
    p_conversation_id: conversation.id,
    p_status: 'resolved',
  });
  checkEqual('staff can resolve a conversation', resolved.data, true);
  const reopened = await rpc(ownerA, 'communication_set_conversation_status', {
    p_conversation_id: conversation.id,
    p_status: 'open',
  });
  checkEqual('conversation can be reopened', reopened.data, true);

  const crossAssign = await rpc(ownerB, 'communication_assign_conversation', {
    p_conversation_id: conversation.id,
    p_assignee_id: ownerBId,
  });
  checkRpcError('cross-business assignment is denied', crossAssign, '42501');

  const crossConversation = await rpc(ownerB, 'communication_get_conversation', {
    p_conversation_id: conversation.id,
  });
  checkRpcError('cross-business conversation read is denied', crossConversation, '42501');

  const crossMessages = await rpc(ownerB, 'communication_list_messages', {
    p_conversation_id: conversation.id,
  });
  checkRpcError('cross-business message history is denied', crossMessages, '42501');

  const crossSend = await rpc(ownerB, 'communication_create_outbound_message', {
    p_conversation_id: conversation.id,
    p_message_type: 'text',
    p_text_content: 'Cross-business send.',
    p_media_asset_id: null,
    p_template_name: null,
    p_template_language: null,
    p_client_request_id: randomUUID(),
  });
  checkRpcError('cross-business send is denied', crossSend, '42501');

  const crossOptOut = await rpc(ownerB, 'communication_set_opt_out', {
    p_business_id: businessA,
    p_external_customer_id: conversation.external_customer_id,
    p_opted_out: true,
    p_reason: 'cross-business',
  });
  checkRpcError('cross-business opt-out change is denied', crossOptOut, '42501');

  const customerBConversation = await scalarNumber(
    'select count(*)::text as value from public.communication_conversations where business_id = $1',
    [businessB],
  );
  checkEqual('business B still has no conversations', customerBConversation, 0);
  check(
    'business B customer was not matched into business A',
    conversation.customer_id !== customerB,
  );

  for (const index of [4, 5, 6]) {
    const result = await processWebhook(
      makeIncomingPayload({
        phoneId: phoneIdA,
        wabaId: wabaIdA,
        from: '+16505550001',
        messageId: `wamid.${runId}.${index}`,
        text: `History message ${index}`,
        timestamp: now + index,
      }),
    );
    checkEqual(`history webhook ${index} processed`, Number(result?.processed), 1);
    await db.query(
      `update public.communication_messages
       set created_at = now() + ($2 * interval '1 second'), occurred_at = now() + ($2 * interval '1 second')
       where provider_message_id = $1`,
      [`wamid.${runId}.${index}`, index],
    );
  }

  const firstPage = await rpc(ownerA, 'communication_list_messages', {
    p_conversation_id: conversation.id,
    p_limit: 2,
  });
  checkEqual('message history page one has two records', firstPage.data?.length, 2);
  checkEqual('message history reports more records', firstPage.data?.[0]?.has_more, true);

  const secondPage = await rpc(ownerA, 'communication_list_messages', {
    p_conversation_id: conversation.id,
    p_before: firstPage.data?.[firstPage.data.length - 1]?.created_at,
    p_limit: 2,
  });
  check('message history page two loads older records', (secondPage.data ?? []).length > 0);
  check(
    'message history pages do not overlap',
    !(secondPage.data ?? []).some((row) =>
      (firstPage.data ?? []).some((first) => first.id === row.id),
    ),
  );

  const inboundMediaId = `media.${runId}.image`;
  const inboundMediaWebhook = await processWebhook({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: wabaIdA,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+15550000000', phone_number_id: phoneIdA },
              contacts: [{ wa_id: '+16505550001', profile: { name: 'Matched Customer' } }],
              messages: [
                {
                  from: '+16505550001',
                  id: `wamid.${runId}.image`,
                  timestamp: String(now + 20),
                  type: 'image',
                  image: { id: inboundMediaId, mime_type: 'image/jpeg', caption: 'A customer photo' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  checkEqual('inbound image webhook was processed', Number(inboundMediaWebhook?.processed), 1);
  const { rows: inboundMediaRows } = await db.query(
    `select id, media_provider_id from public.communication_messages
     where business_id = $1 and provider_message_id = $2`,
    [businessA, `wamid.${runId}.image`],
  );
  const inboundMediaMessage = inboundMediaRows[0];
  checkEqual('inbound image provider media id was stored', inboundMediaMessage?.media_provider_id, inboundMediaId);
  const inboundMedia = await rpc(ownerA, 'communication_get_inbound_media', {
    p_message_id: inboundMediaMessage.id,
  });
  checkEqual('authorized media lookup works', inboundMedia.data?.[0]?.media_provider_id, inboundMediaId);
  const crossMedia = await rpc(ownerB, 'communication_get_inbound_media', {
    p_message_id: inboundMediaMessage.id,
  });
  checkEqual('cross-business media retrieval returns no rows', crossMedia.data?.length, 0);

  const auditCount = await scalarNumber(
    'select count(*)::text as value from public.communication_audit_log where business_id = $1',
    [businessA],
  );
  check('important actions produced audit records', auditCount >= 4, `count=${auditCount}`);

  const webhookEventCount = await scalarNumber(
    'select count(*)::text as value from public.communication_webhook_events where business_id = $1',
    [businessA],
  );
  check('provider event identifiers were stored', webhookEventCount >= 8, `count=${webhookEventCount}`);

  console.log(
    '\nNOTE  All Meta payloads were locally constructed. No real WhatsApp message was sent or received.',
  );
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
