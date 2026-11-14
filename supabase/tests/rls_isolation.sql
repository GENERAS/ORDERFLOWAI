-- Two-tenant isolation and role-escalation test.
-- Runs entirely inside a transaction and rolls back; no test data persists.
-- Usage:
--   . .\scripts\load-supabase-db-password.ps1
--   node scripts/db-query.mjs supabase/tests/rls_isolation.sql

begin;

do $$
declare
  user_a uuid := '11111111-1111-1111-1111-111111111111';
  user_b uuid := '22222222-2222-2222-2222-222222222222';
  user_c uuid := '33333333-3333-3333-3333-333333333333';
  user_d uuid := '44444444-4444-4444-4444-444444444444';
  user_e uuid := '55555555-5555-5555-5555-555555555555';
  business_a uuid;
  business_b uuid;
  visible_count integer;
  updated_count integer;
  created public.businesses;
begin
  insert into auth.users (
    id,
    email,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values
    (user_a, 'rls-test-a@example.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant A Owner"}'::jsonb, now(), now()),
    (user_b, 'rls-test-b@example.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant B Owner"}'::jsonb, now(), now()),
    (user_c, 'rls-test-c@example.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant A Staff"}'::jsonb, now(), now()),
    (user_d, 'rls-test-d@example.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant A Admin"}'::jsonb, now(), now()),
    (user_e, 'rls-test-e@example.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Tenant A Added Staff"}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name)
  values
    (user_a, 'Tenant A Owner'),
    (user_b, 'Tenant B Owner'),
    (user_c, 'Tenant A Staff'),
    (user_d, 'Tenant A Admin'),
    (user_e, 'Tenant A Added Staff')
  on conflict (id) do nothing;

  -- Tenant A creates Business A.
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select * into created
  from public.create_business(
    'Tenant A Business',
    'tenant-a-business',
    'Retail',
    'RW',
    'RWF',
    'Africa/Kigali'
  );
  business_a := created.id;

  select count(*) into visible_count from public.businesses;
  if visible_count <> 1 then
    raise exception 'Tenant A expected 1 business, saw %', visible_count;
  end if;

  select count(*) into visible_count
  from public.business_members
  where role = 'owner' and status = 'active';
  if visible_count <> 1 then
    raise exception 'Tenant A expected 1 active owner membership, saw %', visible_count;
  end if;

  begin
    perform public.create_business('Invalid Slug', 'Invalid Slug');
    raise exception 'Invalid slug unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.create_business(
      'Invalid Timezone',
      'invalid-timezone',
      null,
      'RW',
      'RWF',
      'Mars/Olympus'
    );
    raise exception 'Invalid timezone unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  insert into public.business_members (business_id, user_id, role)
  values (business_a, user_c, 'staff');

  insert into public.business_members (business_id, user_id, role)
  values (business_a, user_d, 'admin');

  -- Tenant B creates Business B.
  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated')::text,
    true
  );

  select * into created
  from public.create_business(
    'Tenant B Business',
    'tenant-b-business',
    'Services',
    'RW',
    'RWF',
    'Africa/Kigali'
  );
  business_b := created.id;

  select count(*) into visible_count from public.businesses;
  if visible_count <> 1 then
    raise exception 'Tenant B expected 1 business, saw %', visible_count;
  end if;

  select count(*) into visible_count
  from public.businesses
  where id = business_a;
  if visible_count <> 0 then
    raise exception 'Tenant B can see Tenant A business';
  end if;

  select count(*) into visible_count
  from public.business_members
  where business_id = business_a;
  if visible_count <> 0 then
    raise exception 'Tenant B can see Tenant A memberships';
  end if;

  select count(*) into visible_count
  from public.profiles
  where id = user_a;
  if visible_count <> 0 then
    raise exception 'Tenant B can see Tenant A profile';
  end if;

  update public.businesses
  set name = 'Hijacked by Tenant B'
  where id = business_a;
  get diagnostics updated_count = row_count;
  if updated_count <> 0 then
    raise exception 'Tenant B updated Tenant A business';
  end if;

  begin
    insert into public.business_members (business_id, user_id, role)
    values (business_a, user_e, 'staff');
    raise exception 'Cross-tenant membership insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.create_business(
      'Duplicate Slug',
      'tenant-a-business'
    );
    raise exception 'Duplicate slug unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;

  -- Staff C can access Business A but cannot access Business B or escalate.
  perform set_config('request.jwt.claim.sub', user_c::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_c, 'role', 'authenticated')::text,
    true
  );

  select count(*) into visible_count
  from public.businesses
  where id = business_a;
  if visible_count <> 1 then
    raise exception 'Staff C cannot access Business A';
  end if;

  select count(*) into visible_count
  from public.businesses
  where id = business_b;
  if visible_count <> 0 then
    raise exception 'Staff C can access Business B';
  end if;

  begin
    update public.business_members
    set role = 'owner'
    where business_id = business_a and user_id = user_c;
    raise exception 'Staff C escalated their own role';
  exception
    when insufficient_privilege then null;
  end;

  update public.businesses
  set name = 'Renamed by Staff C'
  where id = business_a;
  get diagnostics updated_count = row_count;
  if updated_count <> 0 then
    raise exception 'Staff C updated Business A settings';
  end if;

  begin
    insert into public.business_members (business_id, user_id, role)
    values (business_a, user_e, 'staff');
    raise exception 'Staff C inserted a membership';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.business_members (business_id, user_id, role)
    values (business_b, user_c, 'staff');
    raise exception 'Staff C inserted a cross-tenant membership';
  exception
    when insufficient_privilege then null;
  end;

  -- Admin D can manage Business A but cannot assign owner.
  perform set_config('request.jwt.claim.sub', user_d::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_d, 'role', 'authenticated')::text,
    true
  );

  select count(*) into visible_count
  from public.businesses
  where id = business_a;
  if visible_count <> 1 then
    raise exception 'Admin D cannot access Business A';
  end if;

  begin
    update public.business_members
    set role = 'owner'
    where business_id = business_a and user_id = user_d;
    raise exception 'Admin D escalated their own role';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.business_members (business_id, user_id, role)
    values (business_a, user_e, 'owner');
    raise exception 'Admin D assigned owner role';
  exception
    when insufficient_privilege then null;
  end;

  insert into public.business_members (business_id, user_id, role)
  values (business_a, user_e, 'staff');

  select count(*) into visible_count
  from public.business_members
  where business_id = business_a and user_id = user_e and status = 'active';
  if visible_count <> 1 then
    raise exception 'Admin D could not add staff membership';
  end if;

  update public.businesses
  set industry = 'Retail and wholesale'
  where id = business_a;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'Admin D could not update Business A';
  end if;

  -- Added staff E can access Business A but not Business B.
  perform set_config('request.jwt.claim.sub', user_e::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_e, 'role', 'authenticated')::text,
    true
  );

  select count(*) into visible_count
  from public.businesses
  where id = business_a;
  if visible_count <> 1 then
    raise exception 'Added staff E cannot access Business A';
  end if;

  select count(*) into visible_count
  from public.businesses
  where id = business_b;
  if visible_count <> 0 then
    raise exception 'Added staff E can access Business B';
  end if;

  -- Suspended memberships lose access.
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', user_c::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_c, 'role', 'authenticated')::text,
    true
  );
  update public.business_members
  set status = 'suspended'
  where business_id = business_a and user_id = user_c;

  execute 'set local role authenticated';

  select count(*) into visible_count
  from public.businesses
  where id = business_a;
  if visible_count <> 0 then
    raise exception 'Suspended staff C can still access Business A';
  end if;

  select count(*) into visible_count
  from public.business_members
  where business_id = business_a;
  if visible_count <> 0 then
    raise exception 'Suspended staff C can still see Business A memberships';
  end if;

  -- Unauthenticated requests cannot read private records or create businesses.
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  begin
    perform count(*) from public.businesses;
    raise exception 'Anon read businesses unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.profiles;
    raise exception 'Anon read profiles unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.business_members;
    raise exception 'Anon read memberships unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.create_business('Anon Business', 'anon-business');
    raise exception 'Anon create_business unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  execute 'reset role';
end;
$$;

select 'RLS isolation and role escalation tests passed' as result;

rollback;
