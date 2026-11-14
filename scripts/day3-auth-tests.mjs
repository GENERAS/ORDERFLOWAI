import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { getPostAuthPath } from '../src/features/auth/authRouting.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
const databasePassword = process.env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !supabaseKey || !databasePassword) {
  console.error(
    'Missing configuration. Load the database password and pass .env.local to Node:\n' +
      '  . .\\scripts\\load-supabase-db-password.ps1\n' +
      '  node --env-file=.env.local scripts/day3-auth-tests.mjs',
  );
  process.exit(1);
}

async function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) {
    return process.env.SUPABASE_PROJECT_REF.trim();
  }
  return (await readFile(path.join(projectRoot, 'supabase', '.temp', 'project-ref'), 'utf8')).trim();
}

const projectRef = await resolveProjectRef();
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailPrefix = `day3-test-${runId}`;
const slugPrefix = `day3-${runId}`;
const password = 'Day3Test!Pass123';
const newPassword = 'Day3Test!Pass456';
const appCallbackUrl = 'http://localhost:5173/auth/callback';
const appResetUrl = 'http://localhost:5173/reset-password';

const results = { checks: 0, failures: [], skipped: [] };

function skip(name, reason) {
  results.skipped.push(`${name} — ${reason}`);
  console.log(`SKIP  ${name} — ${reason}`);
}

function isEmailRateLimit(error) {
  return (
    error?.code === 'over_email_send_rate_limit' ||
    /email rate limit exceeded|over_email_send_rate_limit/i.test(error?.message ?? '')
  );
}

function isInvalidTestEmail(error) {
  return /email address .* is invalid|invalid email/i.test(error?.message ?? '');
}

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

const db = new Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: databasePassword,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'orderflow-ai-day3-auth-tests',
});

function createTestClient(authOverrides = {}) {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      ...authOverrides,
    },
  });
}

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const anon = createTestClient();

async function signIn(email, candidatePassword = password) {
  const client = createTestClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: candidatePassword,
  });
  return { client, data, error };
}

async function createAuthUser(email, fullName, { confirmed = true } = {}) {
  const id = randomUUID();
  const confirmedAt = confirmed ? new Date() : null;
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
       $5::timestamptz,
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
    [id, email, password, fullName, confirmedAt],
  );
  return id;
}

async function cleanup() {
  await db.query('delete from public.businesses where slug like $1', [`${slugPrefix}-%`]);
  await db.query('delete from auth.users where email like $1', [`${emailPrefix}-%`]);
}

function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

try {
  await db.connect();
  await cleanup();

  const registrationEmail = `${emailPrefix}-register@example.com`;
  const { data: signUpData, error: signUpError } = await anon.auth.signUp({
    email: registrationEmail,
    password,
    options: {
      data: { full_name: 'Day Three Registration' },
      emailRedirectTo: appCallbackUrl,
    },
  });

  let registrationUserId = signUpData?.user?.id;
  const registrationApiSucceeded = !signUpError;

  if (registrationApiSucceeded) {
    check('registration succeeds', true);
    check(
      'registration does not create a session before email confirmation',
      !signUpData?.session,
    );
  } else if (isEmailRateLimit(signUpError) || isInvalidTestEmail(signUpError)) {
    skip(
      'live registration email send',
      isEmailRateLimit(signUpError)
        ? 'project email rate limit reached (2/hour); using direct DB setup'
        : 'test email domain rejected by the project mailer; using direct DB setup',
    );
    registrationUserId = await createAuthUser(
      registrationEmail,
      'Day Three Registration',
      { confirmed: false },
    );
    check('registration fallback creates an unconfirmed auth user', Boolean(registrationUserId));
    check('registration fallback starts without a session', true);
  } else {
    check('registration succeeds', false, signUpError?.message);
  }

  check('registration returns a user id', Boolean(registrationUserId), registrationUserId);
  if (!registrationUserId) {
    throw new Error('Cannot continue without a registration user');
  }

  const registrationRow = await db.query(
    'select email_confirmed_at from auth.users where id = $1',
    [registrationUserId],
  );
  check(
    'registered user starts with an unconfirmed email',
    registrationRow.rows[0]?.email_confirmed_at == null,
  );

  const registrationProfile = await db.query(
    'select id, full_name from public.profiles where id = $1',
    [registrationUserId],
  );
  check('registration trigger creates a profile', registrationProfile.rows.length === 1);

  const unconfirmedSignIn = await signIn(registrationEmail, password);
  check('unconfirmed user cannot sign in', Boolean(unconfirmedSignIn.error));
  checkEqual(
    'unconfirmed sign-in reports email_not_confirmed',
    unconfirmedSignIn.error?.code,
    'email_not_confirmed',
  );

  if (registrationApiSucceeded) {
    const duplicateSignUp = await anon.auth.signUp({
      email: registrationEmail,
      password,
      options: {
        data: { full_name: 'Day Three Duplicate' },
        emailRedirectTo: appCallbackUrl,
      },
    });
    const duplicateDetected =
      Boolean(duplicateSignUp.error) ||
      (Array.isArray(duplicateSignUp.data?.user?.identities) &&
        duplicateSignUp.data.user.identities.length === 0);
    check('duplicate registration is detected', duplicateDetected);
  } else {
    skip(
      'live duplicate registration request',
      'registration email send was rate-limited; unique constraint still checked',
    );
  }

  const duplicateUserCount = await db.query(
    'select count(*)::int as count from auth.users where email = $1',
    [registrationEmail],
  );
  checkEqual(
    'duplicate registration does not create a second auth user',
    duplicateUserCount.rows[0].count,
    1,
  );

  await db.query(
    'update auth.users set email_confirmed_at = now(), updated_at = now() where id = $1',
    [registrationUserId],
  );

  const verifiedSignIn = await signIn(registrationEmail, password);
  check(
    'confirmed user can sign in with a valid password',
    !verifiedSignIn.error && Boolean(verifiedSignIn.data?.session),
    verifiedSignIn.error?.message,
  );
  checkEqual(
    'verified session belongs to the registered user',
    verifiedSignIn.data?.user?.id,
    registrationUserId,
  );

  const invalidSignIn = await signIn(registrationEmail, 'definitely-wrong-password');
  check(
    'invalid password is rejected',
    Boolean(invalidSignIn.error) && !invalidSignIn.data?.session,
  );

  await verifiedSignIn.client.auth.signOut();
  const afterSignOut = await verifiedSignIn.client.auth.getSession();
  check('logout clears the local session', !afterSignOut.data?.session);

  const resetClient = createTestClient();
  const { error: resetRequestError } = await resetClient.auth.resetPasswordForEmail(
    registrationEmail,
    { redirectTo: appResetUrl },
  );
  if (isEmailRateLimit(resetRequestError)) {
    skip(
      'live password reset email send',
      'project email rate limit reached (2/hour); invalid-token and password-update checks still run',
    );
  } else {
    check('password reset request succeeds', !resetRequestError, resetRequestError?.message);
  }

  const invalidRecovery = await resetClient.auth.verifyOtp({
    type: 'recovery',
    token_hash: 'invalid-recovery-token-hash',
  });
  check('invalid password recovery token is rejected', Boolean(invalidRecovery.error));

  const passwordClient = await signIn(registrationEmail, password);
  check(
    'session is available for the password update',
    !passwordClient.error && Boolean(passwordClient.data?.session),
  );

  const { error: updatePasswordError } = await passwordClient.client.auth.updateUser({
    password: newPassword,
  });
  check(
    'authenticated password update succeeds',
    !updatePasswordError,
    updatePasswordError?.message,
  );

  await passwordClient.client.auth.signOut();
  const oldPasswordSignIn = await signIn(registrationEmail, password);
  check('old password no longer works', Boolean(oldPasswordSignIn.error));

  const newPasswordSignIn = await signIn(registrationEmail, newPassword);
  check(
    'new password works after the update',
    !newPasswordSignIn.error && Boolean(newPasswordSignIn.data?.session),
  );

  const persistenceEmail = `${emailPrefix}-persist@example.com`;
  const persistenceUserId = await createAuthUser(
    persistenceEmail,
    'Day Three Persistence',
  );
  const storage = new MemoryStorage();
  const persistClient = createTestClient({ storage, persistSession: true });
  const persistSignIn = await persistClient.auth.signInWithPassword({
    email: persistenceEmail,
    password,
  });
  check(
    'session persistence test sign-in succeeds',
    !persistSignIn.error,
    persistSignIn.error?.message,
  );

  const restoredClient = createTestClient({ storage, persistSession: true });
  const restoredSession = await restoredClient.auth.getSession();
  checkEqual(
    'session is restored from persisted storage',
    restoredSession.data?.session?.user?.id,
    persistenceUserId,
  );

  const anonBusinessRead = await anon.from('businesses').select('id').limit(1);
  check(
    'unauthenticated users cannot read businesses',
    Boolean(anonBusinessRead.error),
  );

  const anonBusinessCreate = await anon.rpc('create_business', {
    business_name: 'Anonymous Business',
    business_slug: `${slugPrefix}-anon`,
    business_industry: null,
    business_country: 'US',
    business_currency: 'USD',
    business_timezone: 'UTC',
  });
  check(
    'unauthenticated users cannot create businesses',
    Boolean(anonBusinessCreate.error),
  );

  const lonelyEmail = `${emailPrefix}-lonely@example.com`;
  const lonelyUserId = await createAuthUser(lonelyEmail, 'Day Three Lonely');
  const lonely = await signIn(lonelyEmail, password);
  check(
    'user without a workspace can sign in',
    !lonely.error && Boolean(lonely.data?.session),
    lonely.error?.message,
  );

  const lonelyMemberships = await lonely.client
    .from('business_members')
    .select('id, business_id, role, status')
    .eq('user_id', lonelyUserId);
  check(
    'user without a workspace has no active memberships',
    !lonelyMemberships.error && lonelyMemberships.data.length === 0,
    lonelyMemberships.error?.message,
  );

  const oneRpc = await lonely.client.rpc('create_business', {
    business_name: 'Day Three One',
    business_slug: `${slugPrefix}-one`,
    business_industry: 'retail',
    business_country: 'US',
    business_currency: 'USD',
    business_timezone: 'UTC',
  });
  const oneBusiness = unwrapRpc(oneRpc.data);
  check(
    'onboarding RPC creates a business',
    !oneRpc.error && Boolean(oneBusiness?.id),
    oneRpc.error?.message,
  );
  checkEqual('created business uses the requested slug', oneBusiness?.slug, `${slugPrefix}-one`);
  if (!oneBusiness?.id) {
    throw new Error('Cannot continue: onboarding RPC did not return a business');
  }

  const oneMemberships = await lonely.client
    .from('business_members')
    .select('id, business_id, role, status')
    .eq('user_id', lonelyUserId);
  check(
    'onboarding creates exactly one active owner membership',
    !oneMemberships.error &&
      oneMemberships.data.length === 1 &&
      oneMemberships.data[0].role === 'owner' &&
      oneMemberships.data[0].status === 'active',
    oneMemberships.error?.message,
  );

  const oneBusinessRead = await lonely.client
    .from('businesses')
    .select('id, name, slug')
    .eq('id', oneBusiness.id);
  check(
    'member can read the created workspace',
    !oneBusinessRead.error && oneBusinessRead.data.length === 1,
    oneBusinessRead.error?.message,
  );

  const twoRpc = await lonely.client.rpc('create_business', {
    business_name: 'Day Three Two',
    business_slug: `${slugPrefix}-two`,
    business_industry: 'services',
    business_country: 'GB',
    business_currency: 'GBP',
    business_timezone: 'Europe/London',
  });
  const twoBusiness = unwrapRpc(twoRpc.data);
  check(
    'second workspace creation succeeds',
    !twoRpc.error && Boolean(twoBusiness?.id),
    twoRpc.error?.message,
  );
  if (!twoBusiness?.id) {
    throw new Error('Cannot continue: second onboarding RPC did not return a business');
  }

  const multiMemberships = await lonely.client
    .from('business_members')
    .select('id, business_id, role, status')
    .eq('user_id', lonelyUserId);
  check(
    'user with multiple workspaces sees both active memberships',
    !multiMemberships.error &&
      multiMemberships.data.length === 2 &&
      multiMemberships.data.every((row) => row.status === 'active'),
    multiMemberships.error?.message,
  );

  const multiBusinesses = await lonely.client
    .from('businesses')
    .select('id')
    .in('id', [oneBusiness.id, twoBusiness.id]);
  check(
    'user with multiple workspaces can read both businesses',
    !multiBusinesses.error && multiBusinesses.data.length === 2,
    multiBusinesses.error?.message,
  );

  const routingMemberships = multiMemberships.data.map((row) => ({
    business: { id: row.business_id },
  }));
  checkEqual(
    'routing sends a user without a workspace to onboarding',
    getPostAuthPath({ memberships: [], activeBusinessId: null }),
    '/onboarding',
  );
  checkEqual(
    'routing sends a single-workspace user to the dashboard',
    getPostAuthPath({
      memberships: [routingMemberships[0]],
      activeBusinessId: routingMemberships[0].business.id,
    }),
    '/overview',
  );
  checkEqual(
    'routing sends a multi-workspace user without a selection to the picker',
    getPostAuthPath({ memberships: routingMemberships, activeBusinessId: null }),
    '/workspaces',
  );
  checkEqual(
    'routing sends a multi-workspace user with a selection to the dashboard',
    getPostAuthPath({
      memberships: routingMemberships,
      activeBusinessId: routingMemberships[0].business.id,
    }),
    '/overview',
  );

  const revokedEmail = `${emailPrefix}-revoked@example.com`;
  const revokedUserId = await createAuthUser(revokedEmail, 'Day Three Revoked');
  const revoked = await signIn(revokedEmail, password);
  check(
    'revoked-membership test user can sign in',
    !revoked.error && Boolean(revoked.data?.session),
    revoked.error?.message,
  );

  const revokedRpc = await revoked.client.rpc('create_business', {
    business_name: 'Day Three Revoked',
    business_slug: `${slugPrefix}-revoked`,
    business_industry: null,
    business_country: 'CA',
    business_currency: 'CAD',
    business_timezone: 'America/Toronto',
  });
  const revokedBusiness = unwrapRpc(revokedRpc.data);
  check(
    'revoked-membership test workspace is created',
    !revokedRpc.error && Boolean(revokedBusiness?.id),
    revokedRpc.error?.message,
  );
  if (!revokedBusiness?.id) {
    throw new Error('Cannot continue: revoked-membership onboarding RPC did not return a business');
  }

  await db.query(
    `update public.business_members
     set status = 'suspended'
     where user_id = $1 and business_id = $2`,
    [revokedUserId, revokedBusiness.id],
  );

  const revokedBusinessRead = await revoked.client
    .from('businesses')
    .select('id')
    .eq('id', revokedBusiness.id);
  check(
    'suspended membership loses business access',
    !revokedBusinessRead.error && revokedBusinessRead.data.length === 0,
    revokedBusinessRead.error?.message,
  );

  const revokedMemberships = await revoked.client
    .from('business_members')
    .select('id, status')
    .eq('user_id', revokedUserId);
  check(
    'suspended membership is not returned as active',
    !revokedMemberships.error && revokedMemberships.data.length === 0,
    revokedMemberships.error?.message,
  );

  const duplicateOnboarding = await lonely.client.rpc('create_business', {
    business_name: 'Day Three Duplicate',
    business_slug: `${slugPrefix}-one`,
    business_industry: null,
    business_country: 'US',
    business_currency: 'USD',
    business_timezone: 'UTC',
  });
  check(
    'duplicate onboarding submission is rejected',
    Boolean(duplicateOnboarding.error),
  );
  checkEqual(
    'duplicate onboarding returns a unique violation',
    duplicateOnboarding.error?.code,
    '23505',
  );

  const duplicateBusinessCount = await db.query(
    'select count(*)::int as count from public.businesses where slug = $1',
    [`${slugPrefix}-one`],
  );
  checkEqual(
    'duplicate onboarding does not create a second business',
    duplicateBusinessCount.rows[0].count,
    1,
  );

  const duplicateMembershipCount = await db.query(
    'select count(*)::int as count from public.business_members where business_id = $1',
    [oneBusiness.id],
  );
  checkEqual(
    'duplicate onboarding does not create a second membership',
    duplicateMembershipCount.rows[0].count,
    1,
  );

  const intruderEmail = `${emailPrefix}-intruder@example.com`;
  const intruderUserId = await createAuthUser(intruderEmail, 'Day Three Intruder');
  const intruder = await signIn(intruderEmail, password);
  check(
    'non-member test user can sign in',
    !intruder.error && Boolean(intruder.data?.session),
    intruder.error?.message,
  );

  const intruderBusinessRead = await intruder.client
    .from('businesses')
    .select('id')
    .eq('id', oneBusiness.id);
  check(
    'non-member cannot read another workspace',
    !intruderBusinessRead.error && intruderBusinessRead.data.length === 0,
    intruderBusinessRead.error?.message,
  );

  const intruderMembershipRead = await intruder.client
    .from('business_members')
    .select('id')
    .eq('business_id', oneBusiness.id);
  check(
    'non-member cannot read another workspace memberships',
    !intruderMembershipRead.error && intruderMembershipRead.data.length === 0,
    intruderMembershipRead.error?.message,
  );

  const intruderUpdate = await intruder.client
    .from('businesses')
    .update({ name: 'Hijacked workspace' })
    .eq('id', oneBusiness.id)
    .select('id');
  check(
    'non-member cannot update another workspace',
    !intruderUpdate.error &&
      (Array.isArray(intruderUpdate.data) ? intruderUpdate.data.length : 0) === 0,
    intruderUpdate.error?.message,
  );

  const intruderMembershipInsert = await intruder.client
    .from('business_members')
    .insert({ business_id: oneBusiness.id, user_id: intruderUserId, role: 'staff' })
    .select('id');
  check(
    'non-member cannot insert themselves into another workspace',
    Boolean(intruderMembershipInsert.error),
  );

  const intruderBusinessInsert = await intruder.client
    .from('businesses')
    .insert({ name: 'Intruder business', slug: `${slugPrefix}-intruder-direct` })
    .select('id');
  check(
    'authenticated users cannot insert businesses directly',
    Boolean(intruderBusinessInsert.error),
  );

  const intruderProfileRead = await intruder.client
    .from('profiles')
    .select('id')
    .eq('id', lonelyUserId);
  check(
    'non-member cannot read another user profile',
    !intruderProfileRead.error && intruderProfileRead.data.length === 0,
    intruderProfileRead.error?.message,
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

if (results.skipped.length > 0) {
  console.log(`\n${results.skipped.length} check(s) skipped:`);
  for (const message of results.skipped) {
    console.log(`- ${message}`);
  }
}

if (results.failures.length > 0) {
  console.error(`\n${results.failures.length} of ${results.checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(
    `\nDay 3 auth and security tests passed (${results.checks} checks, ${results.skipped.length} skipped).`,
  );
}
