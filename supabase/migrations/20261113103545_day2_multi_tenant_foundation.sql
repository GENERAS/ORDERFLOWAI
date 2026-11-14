-- Day 2: secure multi-tenant database foundation.
-- Creates profiles, businesses, and business memberships, with RLS,
-- restricted helper functions, and an atomic business-creation RPC.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_check check (
    full_name is null or char_length(btrim(full_name)) between 1 and 160
  )
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  industry text,
  country text not null default 'RW',
  currency text not null default 'RWF',
  timezone text not null default 'Africa/Kigali',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_check check (
    char_length(btrim(name)) between 1 and 160
  ),
  constraint businesses_slug_check check (
    char_length(slug) between 2 and 80
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint businesses_industry_check check (
    industry is null or char_length(btrim(industry)) between 1 and 80
  ),
  constraint businesses_country_check check (
    country ~ '^[A-Z]{2}$'
  ),
  constraint businesses_currency_check check (
    currency ~ '^[A-Z]{3}$'
  ),
  constraint businesses_timezone_check check (
    char_length(btrim(timezone)) between 1 and 80
  ),
  constraint businesses_slug_key unique (slug)
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint business_members_role_check check (
    role in ('owner', 'admin', 'manager', 'staff')
  ),
  constraint business_members_status_check check (
    status in ('active', 'invited', 'suspended')
  ),
  constraint business_members_business_user_key unique (business_id, user_id)
);

create index business_members_user_id_idx
on public.business_members (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      160
    ),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, avatar_url)
select
  u.id,
  left(
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    160
  ),
  nullif(btrim(coalesce(u.raw_user_meta_data ->> 'avatar_url', '')), '')
from auth.users u
on conflict (id) do nothing;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
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
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and bm.role = any(allowed_roles)
  );
$$;

create or replace function public.shares_business_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_members me
    join public.business_members them
      on them.business_id = me.business_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and them.status = 'active'
      and them.user_id = target_user_id
  );
$$;

create or replace function public.create_business(
  business_name text,
  business_slug text,
  business_industry text default null,
  business_country text default 'RW',
  business_currency text default 'RWF',
  business_timezone text default 'Africa/Kigali'
)
returns public.businesses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := btrim(business_name);
  normalized_slug text := lower(btrim(business_slug));
  normalized_industry text := nullif(btrim(business_industry), '');
  normalized_country text := coalesce(nullif(upper(btrim(business_country)), ''), 'RW');
  normalized_currency text := coalesce(nullif(upper(btrim(business_currency)), ''), 'RWF');
  normalized_timezone text := coalesce(nullif(btrim(business_timezone), ''), 'Africa/Kigali');
  new_business public.businesses;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to create a business.'
      using errcode = '28000';
  end if;

  if normalized_name is null
     or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Business name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_slug is null
     or char_length(normalized_slug) not between 2 and 80
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Business slug must be 2-80 lowercase letters, numbers, or hyphens.'
      using errcode = '22023';
  end if;

  if normalized_industry is not null
     and char_length(normalized_industry) not between 1 and 80 then
    raise exception 'Business industry must be between 1 and 80 characters.'
      using errcode = '22023';
  end if;

  if normalized_country !~ '^[A-Z]{2}$' then
    raise exception 'Business country must be a two-letter ISO code.'
      using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency must be a three-letter ISO code.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from pg_timezone_names
    where name = normalized_timezone
  ) then
    raise exception 'Business timezone is not valid.'
      using errcode = '22023';
  end if;

  insert into public.businesses (
    name,
    slug,
    industry,
    country,
    currency,
    timezone
  )
  values (
    normalized_name,
    normalized_slug,
    normalized_industry,
    normalized_country,
    normalized_currency,
    normalized_timezone
  )
  returning * into new_business;

  insert into public.business_members (
    business_id,
    user_id,
    role,
    status
  )
  values (
    new_business.id,
    current_user_id,
    'owner',
    'active'
  );

  return new_business;
exception
  when unique_violation then
    raise exception 'That business slug is already taken.'
      using errcode = '23505';
end;
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_select_business_members
on public.profiles
for select
to authenticated
using (public.shares_business_with(id));

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy businesses_select_members
on public.businesses
for select
to authenticated
using (public.is_business_member(id));

create policy businesses_update_managers
on public.businesses
for update
to authenticated
using (public.has_business_role(id, array['owner', 'admin']))
with check (public.has_business_role(id, array['owner', 'admin']));

create policy business_members_select_own_businesses
on public.business_members
for select
to authenticated
using (public.is_business_member(business_id));

create policy business_members_insert_managers
on public.business_members
for insert
to authenticated
with check (
  public.has_business_role(business_id, array['owner', 'admin'])
  and user_id <> auth.uid()
  and (
    role in ('manager', 'staff')
    or public.has_business_role(business_id, array['owner'])
  )
);

revoke all on public.profiles from anon, authenticated;
revoke all on public.businesses from anon, authenticated;
revoke all on public.business_members from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

grant select on public.businesses to authenticated;
grant update (name, slug, industry, country, currency, timezone)
on public.businesses to authenticated;

grant select on public.business_members to authenticated;
grant insert (business_id, user_id, role, status)
on public.business_members to authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.is_business_member(uuid) from public;
revoke all on function public.has_business_role(uuid, text[]) from public;
revoke all on function public.shares_business_with(uuid) from public;
revoke all on function public.create_business(text, text, text, text, text, text) from public;

grant execute on function public.is_business_member(uuid)
to authenticated, service_role;

grant execute on function public.has_business_role(uuid, text[])
to authenticated, service_role;

grant execute on function public.shares_business_with(uuid)
to authenticated, service_role;

grant execute on function public.create_business(text, text, text, text, text, text)
to authenticated, service_role;
