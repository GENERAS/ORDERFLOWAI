alter table public.super_admin_actions
add column if not exists permission text,
add column if not exists entity_type text,
add column if not exists entity_id uuid,
add column if not exists justification text,
add column if not exists request_id uuid;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.super_admin_actions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%action%'
  loop
    execute format(
      'alter table public.super_admin_actions drop constraint %I',
      constraint_row.conname
    );
  end loop;
end $$;

alter table public.super_admin_actions
add constraint super_admin_actions_action_check
check (
  action in (
    'grant',
    'revoke',
    'list_businesses',
    'platform_grant',
    'platform_revoke',
    'support_session_start',
    'support_session_end',
    'sensitive_read',
    'business_status_change',
    'business_update',
    'user_status_change',
    'role_change',
    'ai_config_change',
    'integration_config_change',
    'payment_investigation',
    'storefront_status_change',
    'audit_read'
  )
);

do $$
begin
  alter table public.super_admin_actions
  add constraint super_admin_actions_justification_check
  check (
    justification is null
    or char_length(btrim(justification)) between 1 and 500
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.platform_permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_.]{2,80}$'),
  label text not null,
  category text not null check (
    category in (
      'platform',
      'businesses',
      'users',
      'storefronts',
      'orders',
      'payments',
      'ai',
      'communications',
      'subscriptions',
      'integrations',
      'storage',
      'system',
      'support',
      'security',
      'audit'
    )
  ),
  sensitive boolean not null default false
);

create table if not exists public.platform_roles (
  code text primary key check (
    code in (
      'super_admin',
      'platform_operations',
      'support_agent',
      'billing_administrator',
      'security_administrator'
    )
  ),
  label text not null,
  description text not null
);

create table if not exists public.platform_role_permissions (
  role_code text not null references public.platform_roles(code) on delete cascade,
  permission_code text not null references public.platform_permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists public.platform_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_code text references public.platform_permissions(code) on delete cascade,
  role_code text references public.platform_roles(code) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  constraint platform_grants_target_check check (
    permission_code is not null or role_code is not null
  ),
  constraint platform_grants_expiry_check check (
    expires_at is null or expires_at > created_at
  ),
  constraint platform_grants_revocation_check check (
    revoked_at is null or revoked_by is not null
  )
);

create table if not exists public.platform_support_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  purpose text not null check (char_length(btrim(purpose)) between 3 and 500),
  permissions text[] not null default array[
    'platform.businesses.read',
    'platform.orders.read',
    'platform.storefronts.read',
    'platform.users.read'
  ]::text[],
  business_roles text[] not null default '{}'::text[],
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  request_id uuid,
  constraint platform_support_sessions_window_check check (expires_at > started_at),
  constraint platform_support_sessions_roles_check check (
    business_roles <@ array['owner', 'admin', 'manager', 'staff']::text[]
  )
);

create index if not exists platform_grants_user_active_idx
on public.platform_grants (user_id)
where revoked_at is null;

create index if not exists platform_support_sessions_active_idx
on public.platform_support_sessions (actor_user_id, business_id)
where ended_at is null;

create index if not exists super_admin_actions_created_idx
on public.super_admin_actions (created_at desc);

alter table public.platform_permissions enable row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.platform_grants enable row level security;
alter table public.platform_support_sessions enable row level security;

revoke all on public.platform_permissions from anon, authenticated;
revoke all on public.platform_roles from anon, authenticated;
revoke all on public.platform_role_permissions from anon, authenticated;
revoke all on public.platform_grants from anon, authenticated;
revoke all on public.platform_support_sessions from anon, authenticated;

insert into public.platform_permissions (code, label, category, sensitive) values
  ('platform.overview.read', 'View platform overview', 'platform', false),
  ('platform.businesses.read', 'View businesses', 'businesses', false),
  ('platform.businesses.manage', 'Manage businesses', 'businesses', true),
  ('platform.users.read', 'View users', 'users', true),
  ('platform.users.manage', 'Manage users', 'users', true),
  ('platform.roles.manage', 'Manage platform roles', 'security', true),
  ('platform.storefronts.read', 'View storefronts', 'storefronts', false),
  ('platform.storefronts.manage', 'Manage storefronts', 'storefronts', true),
  ('platform.orders.read', 'View orders', 'orders', true),
  ('platform.orders.manage', 'Manage orders', 'orders', true),
  ('platform.payments.read', 'View payments', 'payments', true),
  ('platform.payments.manage', 'Manage payments', 'payments', true),
  ('platform.ai.read', 'View AI usage', 'ai', true),
  ('platform.ai.manage', 'Manage AI configuration', 'ai', true),
  ('platform.communications.read', 'View communication health', 'communications', true),
  ('platform.communications.manage', 'Manage communication settings', 'communications', true),
  ('platform.subscriptions.read', 'View subscriptions', 'subscriptions', true),
  ('platform.subscriptions.manage', 'Manage subscriptions', 'subscriptions', true),
  ('platform.integrations.read', 'View integrations', 'integrations', true),
  ('platform.integrations.manage', 'Manage integrations', 'integrations', true),
  ('platform.storage.read', 'View storage usage', 'storage', false),
  ('platform.system.read', 'View system health', 'system', false),
  ('platform.support.access', 'Start support sessions', 'support', true),
  ('platform.support.sensitive_read', 'Read sensitive support data', 'support', true),
  ('platform.security.read', 'View security events', 'security', true),
  ('platform.security.manage', 'Manage security settings', 'security', true),
  ('platform.audit.read', 'Read audit logs', 'audit', true),
  ('platform.permissions.manage', 'Manage platform permissions', 'security', true)
on conflict (code) do nothing;

insert into public.platform_roles (code, label, description) values
  ('super_admin', 'Super Admin', 'Full platform stewardship with audited access.'),
  ('platform_operations', 'Platform Operations', 'Operational visibility across businesses and integrations.'),
  ('support_agent', 'Support Agent', 'Business support with scoped, time-limited access.'),
  ('billing_administrator', 'Billing Administrator', 'Subscription and payment operations.'),
  ('security_administrator', 'Security Administrator', 'Users, roles, permissions and security controls.')
on conflict (code) do nothing;

insert into public.platform_role_permissions (role_code, permission_code)
select 'super_admin', code
from public.platform_permissions
on conflict do nothing;

insert into public.platform_role_permissions (role_code, permission_code) values
  ('platform_operations', 'platform.overview.read'),
  ('platform_operations', 'platform.businesses.read'),
  ('platform_operations', 'platform.storefronts.read'),
  ('platform_operations', 'platform.orders.read'),
  ('platform_operations', 'platform.payments.read'),
  ('platform_operations', 'platform.ai.read'),
  ('platform_operations', 'platform.communications.read'),
  ('platform_operations', 'platform.storage.read'),
  ('platform_operations', 'platform.system.read'),
  ('platform_operations', 'platform.support.access'),
  ('platform_operations', 'platform.audit.read'),
  ('support_agent', 'platform.overview.read'),
  ('support_agent', 'platform.businesses.read'),
  ('support_agent', 'platform.users.read'),
  ('support_agent', 'platform.storefronts.read'),
  ('support_agent', 'platform.orders.read'),
  ('support_agent', 'platform.support.access'),
  ('support_agent', 'platform.audit.read'),
  ('billing_administrator', 'platform.overview.read'),
  ('billing_administrator', 'platform.businesses.read'),
  ('billing_administrator', 'platform.payments.read'),
  ('billing_administrator', 'platform.subscriptions.read'),
  ('billing_administrator', 'platform.subscriptions.manage'),
  ('billing_administrator', 'platform.audit.read'),
  ('security_administrator', 'platform.overview.read'),
  ('security_administrator', 'platform.users.read'),
  ('security_administrator', 'platform.users.manage'),
  ('security_administrator', 'platform.roles.manage'),
  ('security_administrator', 'platform.security.read'),
  ('security_administrator', 'platform.security.manage'),
  ('security_administrator', 'platform.audit.read'),
  ('security_administrator', 'platform.permissions.manage')
on conflict do nothing;

create or replace function public.has_platform_permission(
  p_permission text,
  p_business_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text := lower(btrim(coalesce(p_permission, '')));
begin
  if auth.uid() is null then
    return coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  end if;

  if public.is_super_admin() then
    return exists (
      select 1
      from public.platform_permissions pp
      where pp.code = v_permission
    );
  end if;

  return exists (
    select 1
    from public.platform_grants g
    where g.user_id = auth.uid()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (g.business_id is null or g.business_id = p_business_id)
      and g.permission_code = v_permission
    union
    select 1
    from public.platform_grants g
    join public.platform_role_permissions rp on rp.role_code = g.role_code
    where g.user_id = auth.uid()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (g.business_id is null or g.business_id = p_business_id)
      and rp.permission_code = v_permission
    union
    select 1
    from public.platform_support_sessions s
    where s.actor_user_id = auth.uid()
      and s.business_id = p_business_id
      and s.ended_at is null
      and s.expires_at > now()
      and v_permission = any(s.permissions)
  );
end;
$$;

create or replace function public.super_admin_can_manage()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.is_super_admin()
    or public.has_platform_permission('platform.permissions.manage');
$$;

create or replace function public.log_platform_action(
  p_action text,
  p_permission text default null,
  p_target_user_id uuid default null,
  p_business_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_justification text default null,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.super_admin_can_manage()
     and not public.has_platform_permission(p_permission, p_business_id) then
    raise exception 'You do not have permission to write platform audit logs.'
      using errcode = '42501';
  end if;

  insert into public.super_admin_actions (
    actor_user_id,
    action,
    permission,
    target_user_id,
    target_business_id,
    entity_type,
    entity_id,
    metadata,
    justification,
    request_id
  )
  values (
    auth.uid(),
    p_action,
    nullif(lower(btrim(coalesce(p_permission, ''))), ''),
    p_target_user_id,
    p_business_id,
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb),
    nullif(btrim(coalesce(p_justification, '')), ''),
    p_request_id
  );
end;
$$;

create or replace function public.platform_get_context()
returns table (
  is_super_admin boolean,
  is_platform_admin boolean,
  permissions text[],
  roles text[],
  support_business_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return query
    select false, false, '{}'::text[], '{}'::text[], '{}'::uuid[];
    return;
  end if;

  return query
  select
    public.is_super_admin(),
    public.is_platform_admin(),
    coalesce((
      select array_agg(distinct code)
      from (
        select pp.code
        from public.platform_permissions pp
        where public.is_super_admin()
        union
        select g.permission_code
        from public.platform_grants g
        where g.user_id = auth.uid()
          and g.permission_code is not null
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
        union
        select rp.permission_code
        from public.platform_grants g
        join public.platform_role_permissions rp on rp.role_code = g.role_code
        where g.user_id = auth.uid()
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
        union
        select distinct unnest(s.permissions)
        from public.platform_support_sessions s
        where s.actor_user_id = auth.uid()
          and s.ended_at is null
          and s.expires_at > now()
      ) permissions_query
    ), '{}'::text[]),
    coalesce((
      select array_agg(distinct role_code)
      from (
        select 'super_admin'::text as role_code
        where public.is_super_admin()
        union
        select g.role_code
        from public.platform_grants g
        where g.user_id = auth.uid()
          and g.role_code is not null
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
        union
        select 'platform_admin'::text
        where public.is_platform_admin()
      ) roles_query
    ), '{}'::text[]),
    coalesce((
      select array_agg(distinct s.business_id)
      from public.platform_support_sessions s
      where s.actor_user_id = auth.uid()
        and s.ended_at is null
        and s.expires_at > now()
    ), '{}'::uuid[]);
end;
$$;

create or replace function public.platform_overview()
returns table (
  total_businesses bigint,
  active_businesses bigint,
  total_users bigint,
  total_orders bigint,
  pending_orders bigint,
  verified_payments bigint,
  ai_requests bigint,
  ai_estimated_cost_usd numeric,
  storage_bytes bigint,
  platform_revenue_amount numeric,
  platform_revenue_note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.overview.read') then
    raise exception 'You do not have permission to view the platform overview.'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.businesses),
    (
      select count(*)
      from public.businesses b
      where exists (
        select 1
        from public.stores s
        where s.business_id = b.id
          and s.status = 'active'
      )
    ),
    (select count(*) from public.profiles),
    (select count(*) from public.orders),
    (
      select count(*)
      from public.orders o
      where o.status = 'awaiting_business_approval'
    ),
    (
      select count(*)
      from public.payments p
      where p.status = 'verified'
    ),
    (select count(*) from public.ai_assistant_requests),
    coalesce((select sum(ar.estimated_cost_usd) from public.ai_assistant_requests ar), 0),
    coalesce((
      select sum(ma.file_size)::bigint
      from public.media_assets ma
      where ma.status <> 'deleted'
    ), 0),
    null::numeric,
    'Platform billing is not configured; merchant sales volume is not platform revenue.'::text;
end;
$$;

create or replace function public.platform_list_businesses(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  slug text,
  country text,
  currency text,
  created_at timestamptz,
  storefront_status text,
  owner_email text,
  product_count bigint,
  order_count bigint,
  whatsapp_connected boolean,
  ai_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if not public.has_platform_permission('platform.businesses.read') then
    raise exception 'You do not have permission to view businesses.'
      using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    b.slug,
    b.country,
    b.currency,
    b.created_at,
    coalesce((
      select s.status
      from public.stores s
      where s.business_id = b.id
    ), 'missing'),
    case
      when owner.email is null then null
      when strpos(owner.email, '@') > 0
        then left(split_part(owner.email, '@', 1), 2)
          || '***@' || split_part(owner.email, '@', 2)
      else '***'
    end,
    (select count(*) from public.products p where p.business_id = b.id),
    (select count(*) from public.orders o where o.business_id = b.id),
    exists (
      select 1
      from public.business_channel_connections c
      where c.business_id = b.id
        and c.channel = 'whatsapp'
        and c.status = 'connected'
    ),
    exists (
      select 1
      from public.ai_assistant_settings a
      where a.business_id = b.id
        and a.enabled
    )
  from public.businesses b
  left join lateral (
    select u.email
    from public.business_members bm
    join auth.users u on u.id = bm.user_id
    where bm.business_id = b.id
      and bm.role = 'owner'
    order by bm.created_at asc
    limit 1
  ) owner on true
  where v_search is null
    or lower(b.name) like '%' || v_search || '%'
    or lower(b.slug) like '%' || v_search || '%'
    or lower(b.country) like '%' || v_search || '%'
    or b.id::text like '%' || v_search || '%'
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.platform_start_support_session(
  p_business_id uuid,
  p_purpose text,
  p_permissions text[] default null,
  p_business_roles text[] default '{}'::text[],
  p_duration_minutes integer default 30,
  p_request_id uuid default null
)
returns public.platform_support_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permissions text[];
  v_permission text;
  v_session public.platform_support_sessions;
  v_expires_at timestamptz;
begin
  if not public.has_platform_permission('platform.support.access', p_business_id) then
    raise exception 'You do not have permission to start a support session for this business.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Business not found.'
      using errcode = '22023';
  end if;

  if p_duration_minutes is null or p_duration_minutes not between 1 and 120 then
    raise exception 'Support sessions must last between 1 and 120 minutes.'
      using errcode = '22023';
  end if;

  v_permissions := coalesce(
    p_permissions,
    array[
      'platform.businesses.read',
      'platform.orders.read',
      'platform.storefronts.read',
      'platform.users.read'
    ]::text[]
  );

  foreach v_permission in array v_permissions loop
    if not public.has_platform_permission(lower(btrim(v_permission)), p_business_id) then
      raise exception 'Support session requested an unauthorised permission.'
        using errcode = '42501';
    end if;
  end loop;

  if coalesce(cardinality(p_business_roles), 0) > 0
     and not public.has_platform_permission('platform.businesses.manage', p_business_id) then
    raise exception 'You do not have permission to grant a business role during support access.'
      using errcode = '42501';
  end if;

  v_expires_at := now() + make_interval(mins => p_duration_minutes);

  insert into public.platform_support_sessions (
    actor_user_id,
    business_id,
    purpose,
    permissions,
    business_roles,
    expires_at,
    request_id
  )
  values (
    auth.uid(),
    p_business_id,
    btrim(p_purpose),
    v_permissions,
    coalesce(p_business_roles, '{}'::text[]),
    v_expires_at,
    p_request_id
  )
  returning * into v_session;

  perform public.log_platform_action(
    'support_session_start',
    'platform.support.access',
    null,
    p_business_id,
    'support_session',
    v_session.id,
    jsonb_build_object(
      'permissions', v_permissions,
      'business_roles', coalesce(p_business_roles, '{}'::text[]),
      'expires_at', v_expires_at
    ),
    p_purpose,
    p_request_id
  );

  return v_session;
end;
$$;

create or replace function public.platform_end_support_session(
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.platform_support_sessions;
begin
  select * into v_session
  from public.platform_support_sessions
  where id = p_session_id
  for update;

  if not found then
    return false;
  end if;

  if v_session.actor_user_id is distinct from auth.uid()
     and not public.super_admin_can_manage() then
    raise exception 'You do not have permission to end this support session.'
      using errcode = '42501';
  end if;

  update public.platform_support_sessions
  set ended_at = now(),
      ended_by = auth.uid()
  where id = p_session_id
    and ended_at is null;

  if found then
    perform public.log_platform_action(
      'support_session_end',
      'platform.support.access',
      null,
      v_session.business_id,
      'support_session',
      v_session.id,
      '{}'::jsonb,
      null,
      v_session.request_id
    );
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.platform_grant_permission(
  p_email text,
  p_permission text,
  p_business_id uuid default null,
  p_reason text default null,
  p_expires_at timestamptz default null
)
returns public.platform_grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_permission text := lower(btrim(coalesce(p_permission, '')));
  v_user_id uuid;
  v_grant public.platform_grants;
begin
  if not public.has_platform_permission('platform.permissions.manage') then
    raise exception 'You do not have permission to manage platform permissions.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.platform_permissions pp where pp.code = v_permission) then
    raise exception 'Unknown platform permission.'
      using errcode = '22023';
  end if;

  if p_business_id is not null
     and not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Business not found.'
      using errcode = '22023';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email;

  if v_user_id is null then
    raise exception 'No account exists for that email address.'
      using errcode = '22023';
  end if;

  insert into public.platform_grants (
    user_id,
    permission_code,
    business_id,
    reason,
    granted_by,
    expires_at
  )
  values (
    v_user_id,
    v_permission,
    p_business_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    auth.uid(),
    p_expires_at
  )
  returning * into v_grant;

  perform public.log_platform_action(
    'platform_grant',
    'platform.permissions.manage',
    v_user_id,
    p_business_id,
    'platform_grant',
    v_grant.id,
    jsonb_build_object('permission', v_permission, 'email', v_email),
    p_reason
  );

  return v_grant;
end;
$$;

create or replace function public.platform_revoke_permission(
  p_grant_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.platform_grants;
begin
  if not public.has_platform_permission('platform.permissions.manage') then
    raise exception 'You do not have permission to manage platform permissions.'
      using errcode = '42501';
  end if;

  select * into v_grant
  from public.platform_grants
  where id = p_grant_id
  for update;

  if not found or v_grant.revoked_at is not null then
    return false;
  end if;

  update public.platform_grants
  set revoked_at = now(),
      revoked_by = auth.uid()
  where id = p_grant_id;

  perform public.log_platform_action(
    'platform_revoke',
    'platform.permissions.manage',
    v_grant.user_id,
    v_grant.business_id,
    'platform_grant',
    v_grant.id,
    '{}'::jsonb,
    p_reason
  );

  return true;
end;
$$;

create or replace function public.platform_list_audit(
  p_limit integer default 50
)
returns table (
  id uuid,
  actor_user_id uuid,
  action text,
  permission text,
  target_user_id uuid,
  business_id uuid,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  justification text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.audit.read') then
    raise exception 'You do not have permission to read the platform audit log.'
      using errcode = '42501';
  end if;

  return query
  select
    sa.id,
    sa.actor_user_id,
    sa.action,
    sa.permission,
    sa.target_user_id,
    sa.target_business_id,
    sa.entity_type,
    sa.entity_id,
    sa.metadata,
    sa.justification,
    sa.created_at
  from public.super_admin_actions sa
  order by sa.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.business_members bm
      where bm.business_id = target_business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
    )
    or exists (
      select 1
      from public.platform_support_sessions s
      where s.actor_user_id = auth.uid()
        and s.business_id = target_business_id
        and s.ended_at is null
        and s.expires_at > now()
        and 'platform.businesses.read' = any(s.permissions)
    )
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.business_members bm
      where bm.business_id = target_business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
        and bm.role = any(allowed_roles)
    )
    or exists (
      select 1
      from public.platform_support_sessions s
      where s.actor_user_id = auth.uid()
        and s.business_id = target_business_id
        and s.ended_at is null
        and s.expires_at > now()
        and s.business_roles && coalesce(allowed_roles, '{}'::text[])
    )
  );
$$;

create or replace function public.ai_order_actor_role(p_business_id uuid)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      return 'service_role';
    end if;
    raise exception 'Sign in to prepare orders.'
      using errcode = '28000';
  end if;

  select unnest(s.business_roles) into v_role
  from public.platform_support_sessions s
  where s.actor_user_id = auth.uid()
    and s.business_id = p_business_id
    and s.ended_at is null
    and s.expires_at > now()
  order by array_position(
    array['owner', 'admin', 'manager', 'staff']::text[],
    unnest(s.business_roles)
  )
  limit 1;

  if v_role is not null then
    return v_role;
  end if;

  select m.role into v_role
  from public.business_members m
  where m.business_id = p_business_id
    and m.user_id = auth.uid();

  if v_role is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.super_admin_list_businesses()
returns table (
  id uuid,
  name text,
  slug text,
  industry text,
  country text,
  currency text,
  timezone text,
  created_at timestamptz,
  updated_at timestamptz,
  user_id uuid,
  role text,
  status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.businesses.read') then
    raise exception 'You do not have permission to list all businesses.'
      using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    b.slug,
    b.industry,
    b.country,
    b.currency,
    b.timezone,
    b.created_at,
    b.updated_at,
    auth.uid() as user_id,
    'platform_support'::text as role,
    'active'::text as status
  from public.businesses b
  order by b.created_at asc;
end;
$$;

revoke all on function public.has_platform_permission(text, uuid) from public, anon, authenticated;
revoke all on function public.super_admin_can_manage() from public, anon, authenticated;
revoke all on function public.log_platform_action(text, text, uuid, uuid, text, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.platform_get_context() from public, anon, authenticated;
revoke all on function public.platform_overview() from public, anon, authenticated;
revoke all on function public.platform_list_businesses(text, integer, integer) from public, anon, authenticated;
revoke all on function public.platform_start_support_session(uuid, text, text[], text[], integer, uuid) from public, anon, authenticated;
revoke all on function public.platform_end_support_session(uuid) from public, anon, authenticated;
revoke all on function public.platform_grant_permission(text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.platform_revoke_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.platform_list_audit(integer) from public, anon, authenticated;

grant execute on function public.has_platform_permission(text, uuid) to authenticated, service_role;
grant execute on function public.super_admin_can_manage() to authenticated, service_role;
grant execute on function public.log_platform_action(text, text, uuid, uuid, text, uuid, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.platform_get_context() to authenticated, service_role;
grant execute on function public.platform_overview() to authenticated, service_role;
grant execute on function public.platform_list_businesses(text, integer, integer) to authenticated, service_role;
grant execute on function public.platform_start_support_session(uuid, text, text[], text[], integer, uuid) to authenticated, service_role;
grant execute on function public.platform_end_support_session(uuid) to authenticated, service_role;
grant execute on function public.platform_grant_permission(text, text, uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.platform_revoke_permission(uuid, text) to authenticated, service_role;
grant execute on function public.platform_list_audit(integer) to authenticated, service_role;
