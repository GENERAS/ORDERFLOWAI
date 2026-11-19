create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  notes text check (
    notes is null
    or char_length(btrim(notes)) between 1 and 240
  )
);

create table if not exists public.super_admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (
    action in ('grant', 'revoke', 'list_businesses')
  ),
  target_user_id uuid references auth.users(id) on delete set null,
  target_business_id uuid references public.businesses(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists super_admin_actions_actor_created_idx
on public.super_admin_actions (actor_user_id, created_at desc);

create index if not exists super_admin_actions_target_user_idx
on public.super_admin_actions (target_user_id);

alter table public.super_admins enable row level security;
alter table public.super_admin_actions enable row level security;

revoke all on public.super_admins from anon, authenticated;
revoke all on public.super_admin_actions from anon, authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.super_admins sa
      where sa.user_id = auth.uid()
    );
$$;

create or replace function public.super_admin_can_manage()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.is_super_admin();
$$;

create or replace function public.log_super_admin_action(
  p_action text,
  p_target_user_id uuid default null,
  p_target_business_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.super_admin_can_manage() then
    raise exception 'Only super administrators can write super admin audit logs.'
      using errcode = '42501';
  end if;

  insert into public.super_admin_actions (
    actor_user_id,
    action,
    target_user_id,
    target_business_id,
    metadata
  )
  values (
    auth.uid(),
    p_action,
    p_target_user_id,
    p_target_business_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
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
  if not public.is_super_admin() then
    raise exception 'Only super administrators can list all businesses.'
      using errcode = '42501';
  end if;

  perform public.log_super_admin_action(
    'list_businesses',
    null,
    null,
    jsonb_build_object('scope', 'all_businesses')
  );

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
    'owner'::text as role,
    'active'::text as status
  from public.businesses b
  order by b.created_at asc;
end;
$$;

create or replace function public.super_admin_grant(
  p_email text,
  p_notes text default null
)
returns public.super_admins
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
  v_row public.super_admins;
begin
  if not public.super_admin_can_manage() then
    raise exception 'Only super administrators can grant super admin access.'
      using errcode = '42501';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.'
      using errcode = '22023';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email;

  if v_user_id is null then
    raise exception 'No account exists for that email address.'
      using errcode = '22023';
  end if;

  insert into public.super_admins (user_id, created_by, notes)
  values (
    v_user_id,
    auth.uid(),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (user_id) do update
  set notes = coalesce(public.super_admins.notes, excluded.notes)
  returning * into v_row;

  perform public.log_super_admin_action(
    'grant',
    v_user_id,
    null,
    jsonb_build_object('email', v_email)
  );

  return v_row;
end;
$$;

create or replace function public.super_admin_revoke(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
  v_super_admin_count integer;
begin
  if not public.super_admin_can_manage() then
    raise exception 'Only super administrators can revoke super admin access.'
      using errcode = '42501';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email;

  if v_user_id is null then
    return false;
  end if;

  select count(*) into v_super_admin_count
  from public.super_admins;

  if v_user_id = auth.uid() and v_super_admin_count <= 1 then
    raise exception 'You cannot revoke the last super administrator.'
      using errcode = '42501';
  end if;

  delete from public.super_admins sa
  where sa.user_id = v_user_id;

  if found then
    perform public.log_super_admin_action(
      'revoke',
      v_user_id,
      null,
      jsonb_build_object('email', v_email)
    );
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.super_admin_list_actions(p_limit integer default 50)
returns table (
  id uuid,
  actor_user_id uuid,
  action text,
  target_user_id uuid,
  target_business_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.super_admin_can_manage() then
    raise exception 'Only super administrators can read the super admin audit log.'
      using errcode = '42501';
  end if;

  return query
  select
    sa.id,
    sa.actor_user_id,
    sa.action,
    sa.target_user_id,
    sa.target_business_id,
    sa.metadata,
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
    (
      public.is_super_admin()
      and exists (
        select 1
        from public.businesses b
        where b.id = target_business_id
      )
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = target_business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
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
    (
      public.is_super_admin()
      and exists (
        select 1
        from public.businesses b
        where b.id = target_business_id
      )
      and coalesce(allowed_roles, '{}'::text[]) && array['owner', 'admin', 'manager', 'staff']::text[]
    )
    or exists (
      select 1
      from public.business_members bm
      where bm.business_id = target_business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
        and bm.role = any(allowed_roles)
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

  if public.is_super_admin() and exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
  ) then
    return 'owner';
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

revoke all on function public.is_super_admin() from public, anon, authenticated;
revoke all on function public.super_admin_can_manage() from public, anon, authenticated;
revoke all on function public.log_super_admin_action(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.super_admin_list_businesses() from public, anon, authenticated;
revoke all on function public.super_admin_grant(text, text) from public, anon, authenticated;
revoke all on function public.super_admin_revoke(text) from public, anon, authenticated;
revoke all on function public.super_admin_list_actions(integer) from public, anon, authenticated;

grant execute on function public.is_super_admin() to authenticated, service_role;
grant execute on function public.super_admin_can_manage() to authenticated, service_role;
grant execute on function public.log_super_admin_action(text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.super_admin_list_businesses() to authenticated, service_role;
grant execute on function public.super_admin_grant(text, text) to authenticated, service_role;
grant execute on function public.super_admin_revoke(text) to authenticated, service_role;
grant execute on function public.super_admin_list_actions(integer) to authenticated, service_role;
