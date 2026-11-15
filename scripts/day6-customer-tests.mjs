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
      '  node --env-file=.env.local scripts/day6-customer-tests.mjs',
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
const emailPrefix = `day6-test-${runId}`;
const slugPrefix = `day6-${runId}`;
const password = 'Day6Test!Pass123';

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
  application_name: 'orderflow-ai-day6-customer-tests',
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

async function cleanup() {
  await db.query('delete from public.businesses where slug like $1', [
    `${slugPrefix}%`,
  ]);
  await db.query('delete from auth.users where email like $1', [
    `${emailPrefix}-%`,
  ]);
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

async function searchCustomers(client, businessId, options = {}) {
  const { data, error } = await client.rpc('search_customers', {
    p_business_id: businessId,
    p_search: options.search ?? null,
    p_customer_id: options.customerId ?? null,
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_sort: options.sort ?? 'name',
    p_direction: options.direction ?? 'asc',
  });
  return { rows: data ?? [], error };
}

async function duplicateCheck(client, businessId, options = {}) {
  const { data, error } = await client.rpc('find_customer_duplicates', {
    p_business_id: businessId,
    p_full_name: options.fullName ?? null,
    p_email: options.email ?? null,
    p_phone: options.phone ?? null,
    p_exclude_customer_id: options.excludeCustomerId ?? null,
  });
  return { rows: data ?? [], error };
}

async function saveAddress(client, customerId, payload = {}) {
  const { data, error } = await client.rpc('save_customer_address', {
    p_customer_id: customerId,
    p_address_id: payload.addressId ?? null,
    p_label: payload.label ?? null,
    p_recipient_name: payload.recipientName ?? null,
    p_line1: payload.line1 ?? null,
    p_line2: payload.line2 ?? null,
    p_city: payload.city ?? null,
    p_region: payload.region ?? null,
    p_postal_code: payload.postalCode ?? null,
    p_country: payload.country ?? null,
    p_is_default: payload.isDefault ?? false,
  });
  return { address: unwrapRpc(data), error };
}

async function deleteAddress(client, addressId) {
  const { data, error } = await client.rpc('delete_customer_address', {
    p_address_id: addressId,
  });
  return { deleted: data, error };
}

async function addressRows(customerId) {
  const result = await db.query(
    `select id, label, line1, city, country, is_default
     from public.customer_addresses
     where customer_id = $1
     order by created_at, id`,
    [customerId],
  );
  return result.rows;
}

async function defaultAddressCount(customerId) {
  const result = await db.query(
    `select count(*)::int as count
     from public.customer_addresses
     where customer_id = $1 and is_default`,
    [customerId],
  );
  return result.rows[0].count;
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
  const secondOwnerEmail = `${emailPrefix}-second-owner@example.com`;

  const ownerId = await createAuthUser(ownerEmail, 'Day Six Owner');
  const managerId = await createAuthUser(managerEmail, 'Day Six Manager');
  const staffId = await createAuthUser(staffEmail, 'Day Six Staff');
  const intruderId = await createAuthUser(intruderEmail, 'Day Six Intruder');
  const secondOwnerId = await createAuthUser(secondOwnerEmail, 'Day Six Second Owner');

  businessA = randomUUID();
  businessB = randomUUID();

  await insertBusiness({
    id: businessA,
    name: 'Day Six Business A',
    slug: `${slugPrefix}-a`,
  });
  await insertBusiness({
    id: businessB,
    name: 'Day Six Business B',
    slug: `${slugPrefix}-b`,
  });

  await addMember(businessA, ownerId, 'owner');
  await addMember(businessA, managerId, 'manager');
  await addMember(businessA, staffId, 'staff');
  await addMember(businessB, secondOwnerId, 'owner');

  const owner = await signIn(ownerEmail);
  const manager = await signIn(managerEmail);
  const staff = await signIn(staffEmail);
  const intruder = await signIn(intruderEmail);
  const secondOwner = await signIn(secondOwnerEmail);

  check('owner, manager, staff and intruder can sign in', true);

  const aliceEmail = `alice-${runId}@example.com`;
  const bobEmail = `bob-${runId}@example.com`;
  const charlieEmail = `charlie-${runId}@example.com`;
  const aliceTwoEmail = `alice-two-${runId}@example.com`;
  const alicePhone = '+250 788 111 222';
  const bobPhone = '0788222333';
  const charliePhone = '+250788333444';
  const aliceTwoPhone = '0788444555';

  const anonRead = await anon.from('customers').select('id').limit(1);
  check('unauthenticated users cannot read customers', Boolean(anonRead.error));
  const anonAddressRead = await anon
    .from('customer_addresses')
    .select('id')
    .limit(1);
  check(
    'unauthenticated users cannot read customer addresses',
    Boolean(anonAddressRead.error),
  );
  const anonSearch = await searchCustomers(anon, businessA);
  checkRpcError('unauthenticated users cannot search customers', anonSearch, '42501');
  const anonDuplicates = await duplicateCheck(anon, businessA, {
    email: aliceEmail,
  });
  checkRpcError(
    'unauthenticated users cannot run duplicate detection',
    anonDuplicates,
    '42501',
  );
  const anonCreate = await createCustomer(anon, businessA, {
    fullName: 'Anonymous Customer',
    email: `anon-${runId}@example.com`,
  });
  checkRpcError('unauthenticated users cannot create customers', anonCreate, '42501');

  const aliceResult = await createCustomer(owner.client, businessA, {
    fullName: 'Alice Test',
    email: `ALICE-${runId}@EXAMPLE.COM`,
    phone: alicePhone,
    companyName: 'Kigali Fresh',
    notes: 'Prefers delivery in the afternoon.',
  });
  check('owner can create a customer', !aliceResult.error, aliceResult.error?.message);
  const alice = aliceResult.customer;

  checkEqual('customer email is normalised to lowercase', alice?.email, aliceEmail);
  checkEqual('customer phone is preserved for display', alice?.phone, alicePhone);
  checkEqual('customer company is stored', alice?.company_name, 'Kigali Fresh');
  checkEqual(
    'customer phone is normalised for duplicate checks',
    alice?.phone_normalized,
    '250788111222',
  );
  checkEqual('customer creator is recorded', alice?.created_by, ownerId);

  const bobResult = await createCustomer(manager.client, businessA, {
    fullName: 'Bob Test',
    email: bobEmail,
    phone: bobPhone,
    companyName: 'Bob Supplies',
  });
  check('manager can create a customer', !bobResult.error, bobResult.error?.message);
  const bob = bobResult.customer;

  const charlieResult = await createCustomer(staff.client, businessA, {
    fullName: 'Charlie Test',
    email: charlieEmail,
    phone: charliePhone,
    companyName: 'Charlie Traders',
  });
  check('staff can create a customer', !charlieResult.error, charlieResult.error?.message);
  const charlie = charlieResult.customer;

  const aliceTwoResult = await createCustomer(staff.client, businessA, {
    fullName: 'Alice Test',
    email: aliceTwoEmail,
    phone: aliceTwoPhone,
    companyName: 'Second Alice',
  });
  check(
    'same customer name is allowed with different contact details',
    !aliceTwoResult.error,
    aliceTwoResult.error?.message,
  );
  const aliceTwo = aliceTwoResult.customer;

  const secondCustomerResult = await createCustomer(secondOwner.client, businessB, {
    fullName: 'Alice Test',
    email: `ALICE-${runId}@EXAMPLE.COM`,
    phone: alicePhone,
    companyName: 'Business B Customer',
  });
  check(
    'the same email and phone are allowed in a different business',
    !secondCustomerResult.error,
    secondCustomerResult.error?.message,
  );
  const secondCustomer = secondCustomerResult.customer;

  const noContact = await createCustomer(owner.client, businessA, {
    fullName: 'No Contact',
  });
  checkRpcError('customers require an email or phone', noContact, '22023');

  const invalidEmail = await createCustomer(owner.client, businessA, {
    fullName: 'Invalid Email',
    email: 'not-an-email',
  });
  checkRpcError('invalid customer email is rejected', invalidEmail, '22023');

  const invalidPhone = await createCustomer(owner.client, businessA, {
    fullName: 'Invalid Phone',
    phone: '123',
  });
  checkRpcError('invalid customer phone is rejected', invalidPhone, '22023');

  const missingName = await createCustomer(owner.client, businessA, {
    fullName: '   ',
    email: `blank-name-${runId}@example.com`,
  });
  checkRpcError('blank customer name is rejected', missingName, '22023');

  const duplicateEmail = await createCustomer(owner.client, businessA, {
    fullName: 'Duplicate Email',
    email: `ALICE-${runId}@EXAMPLE.COM`,
  });
  checkRpcError('duplicate customer email is rejected', duplicateEmail, '23505');

  const duplicatePhone = await createCustomer(owner.client, businessA, {
    fullName: 'Duplicate Phone',
    phone: '0788111222',
  });
  checkRpcError('duplicate customer phone is rejected', duplicatePhone, '23505');

  const intruderCreate = await createCustomer(intruder.client, businessA, {
    fullName: 'Intruder Customer',
    email: `intruder-${runId}@example.com`,
  });
  checkRpcError(
    'non-members cannot create customers in another business',
    intruderCreate,
    '42501',
  );

  const aliceSearch = await searchCustomers(owner.client, businessA, {
    search: 'Alice',
  });
  check('customer search finds matching names', !aliceSearch.error && aliceSearch.rows.length === 2);
  checkEqual(
    'customer search reports the filtered total',
    aliceSearch.rows[0]?.total_count,
    2,
  );

  const unfilteredSearch = await searchCustomers(owner.client, businessA);
  checkEqual(
    'customer search reports the unfiltered workspace total',
    unfilteredSearch.rows[0]?.total_count,
    4,
  );

  const emailSearch = await searchCustomers(owner.client, businessA, {
    search: aliceEmail,
  });
  checkEqual('customer search matches email', emailSearch.rows.length, 1);
  checkEqual('email search returns the right customer', emailSearch.rows[0]?.id, alice.id);

  const companySearch = await searchCustomers(owner.client, businessA, {
    search: 'Kigali Fresh',
  });
  checkEqual('customer search matches company', companySearch.rows.length, 1);

  const localPhoneSearch = await searchCustomers(owner.client, businessA, {
    search: '0788111222',
  });
  checkEqual('customer search normalises local phone numbers', localPhoneSearch.rows.length, 1);

  const pageOne = await searchCustomers(owner.client, businessA, {
    limit: 2,
    offset: 0,
  });
  const pageTwo = await searchCustomers(owner.client, businessA, {
    limit: 2,
    offset: 2,
  });
  checkEqual('customer search paginates on the server', pageOne.rows.length, 2);
  checkEqual('customer search reports the full total', pageOne.rows[0]?.total_count, 4);
  check(
    'customer search returns different records for later pages',
    pageTwo.rows.length === 2 &&
      pageTwo.rows.every((row) => !pageOne.rows.some((first) => first.id === row.id)),
  );

  const nameDesc = await searchCustomers(owner.client, businessA, {
    sort: 'name',
    direction: 'desc',
  });
  check(
    'customer search sorts by name descending',
    nameDesc.rows[0]?.full_name?.toLowerCase() >=
      nameDesc.rows[nameDesc.rows.length - 1]?.full_name?.toLowerCase(),
  );

  const createdDesc = await searchCustomers(owner.client, businessA, {
    sort: 'created',
    direction: 'desc',
  });
  checkEqual(
    'customer search sorts by newest first',
    createdDesc.rows[0]?.id,
    aliceTwo.id,
  );

  const invalidSort = await searchCustomers(owner.client, businessA, {
    sort: 'unsupported',
  });
  checkRpcError('unsupported customer sort is rejected', invalidSort, '22023');

  const crossBusinessSearch = await searchCustomers(secondOwner.client, businessA);
  checkRpcError(
    'non-members cannot search another business customers',
    crossBusinessSearch,
    '42501',
  );

  const ownerDirectRead = await owner.client
    .from('customers')
    .select('id')
    .eq('business_id', businessA);
  checkEqual(
    'members can read their customer rows directly',
    ownerDirectRead.data?.length,
    4,
  );

  const secondDirectRead = await secondOwner.client
    .from('customers')
    .select('id')
    .eq('business_id', businessA);
  checkEqual(
    'row-level security hides another business customers',
    secondDirectRead.data?.length,
    0,
  );
  check(
    'row-level security does not leak another business customer ids',
    (secondDirectRead.data ?? []).every((row) => row.id !== alice.id),
  );

  const intruderDirectRead = await intruder.client
    .from('customers')
    .select('id')
    .eq('business_id', businessA);
  checkEqual(
    'non-members cannot read customers directly',
    intruderDirectRead.data?.length,
    0,
  );

  const directInsert = await owner.client.from('customers').insert({
    business_id: businessA,
    full_name: 'Direct Insert',
    email: `direct-${runId}@example.com`,
  });
  check('authenticated clients cannot insert customers directly', Boolean(directInsert.error));
  checkEqual('direct customer insert is denied', directInsert.error?.code, '42501');

  const directUpdate = await owner.client
    .from('customers')
    .update({ full_name: 'Changed' })
    .eq('id', alice.id);
  check('authenticated clients cannot update customers directly', Boolean(directUpdate.error));
  checkEqual('direct customer update is denied', directUpdate.error?.code, '42501');

  const directDelete = await owner.client
    .from('customers')
    .delete()
    .eq('id', alice.id);
  check('authenticated clients cannot delete customers directly', Boolean(directDelete.error));
  checkEqual('direct customer delete is denied', directDelete.error?.code, '42501');

  const emailDuplicates = await duplicateCheck(owner.client, businessA, {
    email: `ALICE-${runId}@EXAMPLE.COM`,
  });
  check('duplicate detection matches email case-insensitively', emailDuplicates.rows.length >= 1);
  check(
    'duplicate detection reports the email reason',
    emailDuplicates.rows.some((row) => row.match_reasons.includes('email')),
  );

  const phoneDuplicates = await duplicateCheck(owner.client, businessA, {
    phone: '0788111222',
  });
  check(
    'duplicate detection normalises local phone numbers',
    phoneDuplicates.rows.some((row) => row.id === alice.id),
  );
  check(
    'duplicate detection reports the phone reason',
    phoneDuplicates.rows.some((row) => row.match_reasons.includes('phone')),
  );

  const nameDuplicates = await duplicateCheck(owner.client, businessA, {
    fullName: 'alice test',
  });
  checkEqual('duplicate detection matches names case-insensitively', nameDuplicates.rows.length, 2);
  check(
    'duplicate detection reports the name reason',
    nameDuplicates.rows.every((row) => row.match_reasons.includes('name')),
  );

  const excludedDuplicates = await duplicateCheck(owner.client, businessA, {
    email: aliceEmail,
    excludeCustomerId: alice.id,
  });
  checkEqual(
    'duplicate detection can exclude the current customer',
    excludedDuplicates.rows.length,
    0,
  );

  const secondBusinessDuplicates = await duplicateCheck(secondOwner.client, businessB, {
    email: bobEmail,
  });
  checkEqual(
    'duplicate detection stays inside the business',
    secondBusinessDuplicates.rows.length,
    0,
  );

  const crossBusinessDuplicates = await duplicateCheck(secondOwner.client, businessA, {
    email: aliceEmail,
  });
  checkRpcError(
    'non-members cannot run duplicate detection in another business',
    crossBusinessDuplicates,
    '42501',
  );

  const aliceUpdate = await updateCustomer(owner.client, alice.id, {
    fullName: 'Alice Test',
    email: `ALICE-${runId}@EXAMPLE.COM`,
    phone: alicePhone,
    companyName: 'Kigali Fresh Ltd',
    notes: 'Now prefers morning delivery.',
  });
  check('owner can update a customer', !aliceUpdate.error, aliceUpdate.error?.message);
  checkEqual(
    'customer update saves company changes',
    aliceUpdate.customer?.company_name,
    'Kigali Fresh Ltd',
  );
  checkEqual(
    'customer update records the editor',
    aliceUpdate.customer?.updated_by,
    ownerId,
  );

  const staffUpdate = await updateCustomer(staff.client, bob.id, {
    fullName: 'Bob Test',
    email: bobEmail,
    phone: bobPhone,
    companyName: 'Bob Supplies Updated',
  });
  check('staff can update a customer', !staffUpdate.error, staffUpdate.error?.message);

  const conflictingUpdate = await updateCustomer(owner.client, charlie.id, {
    fullName: 'Charlie Test',
    email: aliceEmail,
    phone: charliePhone,
  });
  checkRpcError('customer update blocks duplicate email', conflictingUpdate, '23505');

  const conflictingPhoneUpdate = await updateCustomer(owner.client, charlie.id, {
    fullName: 'Charlie Test',
    email: charlieEmail,
    phone: '0788111222',
  });
  checkRpcError('customer update blocks duplicate phone', conflictingPhoneUpdate, '23505');

  const clearedContactUpdate = await updateCustomer(owner.client, charlie.id, {
    fullName: 'Charlie Test',
  });
  checkRpcError(
    'customer update requires at least one contact method',
    clearedContactUpdate,
    '22023',
  );

  const crossBusinessUpdate = await updateCustomer(secondOwner.client, alice.id, {
    fullName: 'Stolen Customer',
    email: `stolen-${runId}@example.com`,
  });
  checkRpcError(
    'non-members cannot update another business customer',
    crossBusinessUpdate,
    '42501',
  );

  const primaryAddress = await saveAddress(staff.client, alice.id, {
    label: 'Home',
    recipientName: 'Alice Test',
    line1: 'KG 11 Ave',
    city: 'Kigali',
    region: 'Kigali City',
  });
  check('staff can add a customer address', !primaryAddress.error, primaryAddress.error?.message);
  check('the first address becomes the default', Boolean(primaryAddress.address?.is_default));
  checkEqual(
    'the address inherits the business country',
    primaryAddress.address?.country,
    'RW',
  );

  const workAddress = await saveAddress(staff.client, alice.id, {
    label: 'Work',
    line1: 'KN 3 Rd',
    city: 'Kigali',
    isDefault: false,
  });
  check('a customer can have multiple addresses', !workAddress.error, workAddress.error?.message);
  check('a later address is not forced to default', !workAddress.address?.is_default);
  checkEqual(
    'only one address stays default after adding another',
    await defaultAddressCount(alice.id),
    1,
  );

  const billingAddress = await saveAddress(owner.client, alice.id, {
    label: 'Billing',
    line1: 'KG 7 Ave',
    city: 'Kigali',
    isDefault: true,
  });
  check('an address can be marked default', !billingAddress.error, billingAddress.error?.message);
  checkEqual('marking a default clears the previous default', await defaultAddressCount(alice.id), 1);

  const workAddressUpdate = await saveAddress(staff.client, alice.id, {
    addressId: workAddress.address.id,
    label: 'Work',
    line1: 'KN 3 Rd',
    city: 'Remera',
    region: 'Gasabo',
    isDefault: true,
  });
  check('an address can be updated', !workAddressUpdate.error, workAddressUpdate.error?.message);
  checkEqual('address updates save the city', workAddressUpdate.address?.city, 'Remera');
  check('the updated address becomes default', Boolean(workAddressUpdate.address?.is_default));
  checkEqual(
    'switching default leaves exactly one default',
    await defaultAddressCount(alice.id),
    1,
  );

  const addressSearch = await searchCustomers(owner.client, businessA, {
    search: 'Remera',
  });
  checkEqual('customer search matches an address', addressSearch.rows.length, 1);
  checkEqual(
    'customer search returns the primary address',
    addressSearch.rows[0]?.primary_address_city,
    'Remera',
  );
  checkEqual(
    'customer search counts all addresses',
    addressSearch.rows[0]?.address_count,
    3,
  );

  const invalidCountry = await saveAddress(owner.client, alice.id, {
    line1: 'Somewhere',
    country: 'Rwanda',
  });
  checkRpcError('invalid address country is rejected', invalidCountry, '22023');

  const missingLine = await saveAddress(owner.client, alice.id, {
    city: 'Kigali',
  });
  checkRpcError('address line 1 is required', missingLine, '22023');

  const crossBusinessAddress = await saveAddress(secondOwner.client, alice.id, {
    line1: 'Stolen Address',
  });
  checkRpcError(
    'non-members cannot add addresses to another business customer',
    crossBusinessAddress,
    '42501',
  );

  const intruderAddress = await saveAddress(intruder.client, alice.id, {
    line1: 'Intruder Address',
  });
  checkRpcError(
    'non-members cannot add addresses without membership',
    intruderAddress,
    '42501',
  );

  const missingCustomerAddress = await saveAddress(owner.client, randomUUID(), {
    line1: 'Missing Customer',
  });
  checkRpcError(
    'addresses cannot be added to a missing customer',
    missingCustomerAddress,
    '42501',
  );

  const directAddressInsert = await owner.client.from('customer_addresses').insert({
    business_id: businessA,
    customer_id: alice.id,
    line1: 'Direct Address',
    country: 'RW',
  });
  check(
    'authenticated clients cannot insert addresses directly',
    Boolean(directAddressInsert.error),
  );
  checkEqual(
    'direct address insert is denied',
    directAddressInsert.error?.code,
    '42501',
  );

  const directAddressUpdate = await owner.client
    .from('customer_addresses')
    .update({ city: 'Changed' })
    .eq('id', primaryAddress.address.id);
  check(
    'authenticated clients cannot update addresses directly',
    Boolean(directAddressUpdate.error),
  );
  checkEqual(
    'direct address update is denied',
    directAddressUpdate.error?.code,
    '42501',
  );

  const directAddressDelete = await owner.client
    .from('customer_addresses')
    .delete()
    .eq('id', primaryAddress.address.id);
  check(
    'authenticated clients cannot delete addresses directly',
    Boolean(directAddressDelete.error),
  );
  checkEqual(
    'direct address delete is denied',
    directAddressDelete.error?.code,
    '42501',
  );

  const secondAddressDirectRead = await secondOwner.client
    .from('customer_addresses')
    .select('id')
    .eq('customer_id', alice.id);
  checkEqual(
    'row-level security hides another business addresses',
    secondAddressDirectRead.data?.length,
    0,
  );

  const intruderAddressRead = await intruder.client
    .from('customer_addresses')
    .select('id')
    .eq('customer_id', alice.id);
  checkEqual(
    'non-members cannot read customer addresses',
    intruderAddressRead.data?.length,
    0,
  );

  const crossBusinessAddressUpdate = await saveAddress(secondOwner.client, alice.id, {
    addressId: primaryAddress.address.id,
    line1: 'Stolen Update',
  });
  checkRpcError(
    'non-members cannot update another business address',
    crossBusinessAddressUpdate,
    '42501',
  );

  const deleteNonDefault = await deleteAddress(staff.client, primaryAddress.address.id);
  check('staff can delete a customer address', !deleteNonDefault.error, deleteNonDefault.error?.message);
  checkEqual(
    'deleting a non-default address keeps the default',
    await defaultAddressCount(alice.id),
    1,
  );

  const deleteDefault = await deleteAddress(owner.client, workAddress.address.id);
  check('the default address can be deleted', !deleteDefault.error, deleteDefault.error?.message);
  checkEqual(
    'deleting the default promotes another address',
    await defaultAddressCount(alice.id),
    1,
  );

  const remainingAddresses = await addressRows(alice.id);
  checkEqual('one address remains after two deletions', remainingAddresses.length, 1);
  checkEqual(
    'the remaining address is promoted to default',
    remainingAddresses[0]?.id,
    billingAddress.address.id,
  );

  const crossBusinessDelete = await deleteAddress(secondOwner.client, billingAddress.address.id);
  checkRpcError(
    'non-members cannot delete another business address',
    crossBusinessDelete,
    '42501',
  );

  const deleteLast = await owner.client.rpc('delete_customer_address', {
    p_address_id: billingAddress.address.id,
  });
  check('the last address can be deleted', !deleteLast.error, deleteLast.error?.message);
  checkEqual('deleting all addresses leaves none', (await addressRows(alice.id)).length, 0);

  const missingAddressDelete = await deleteAddress(owner.client, randomUUID());
  checkRpcError(
    'deleting a missing address is denied',
    missingAddressDelete,
    '42501',
  );

  const finalAliceSearch = await searchCustomers(owner.client, businessA, {
    customerId: alice.id,
  });
  checkEqual('single customer lookup returns one row', finalAliceSearch.rows.length, 1);
  checkEqual(
    'single customer lookup returns no addresses after cleanup',
    finalAliceSearch.rows[0]?.address_count,
    0,
  );

  const finalDirectRead = await secondOwner.client
    .from('customers')
    .select('id')
    .eq('business_id', businessA);
  checkEqual(
    'cross-business customer reads remain hidden at the end',
    finalDirectRead.data?.length,
    0,
  );

  check('business B customer remains isolated', Boolean(secondCustomer?.id));
  checkEqual(
    'business B keeps its own customer total',
    (await searchCustomers(secondOwner.client, businessB)).rows[0]?.total_count,
    1,
  );

  await cleanup();

  const remainingCustomers = await db.query(
    `select count(*)::int as count
     from public.customers
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test customers are cleaned up', remainingCustomers.rows[0].count, 0);

  const remainingAddressRows = await db.query(
    `select count(*)::int as count
     from public.customer_addresses
     where business_id in ($1, $2)`,
    [businessA, businessB],
  );
  checkEqual('test addresses are cleaned up', remainingAddressRows.rows[0].count, 0);

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
    if (businessA || businessB) await cleanup();
  } catch (cleanupError) {
    console.error(cleanupError);
  }
  await db.end();
}

if (results.failures.length > 0) {
  console.error(`\n${results.failures.length} of ${results.checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nDay 6 customer management tests passed (${results.checks} checks).`);
}
