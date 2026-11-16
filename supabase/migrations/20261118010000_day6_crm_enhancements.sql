-- Day 6 CRM enhancements: customer status, tags, note history, activity timeline,
-- directory filters and audited duplicate overrides.

alter table public.customers
  add column status text not null default 'active',
  add column tags text[] not null default '{}'::text[];

alter table public.customers
  add constraint customers_status_check check (
    status in ('active', 'inactive', 'archived')
  ),
  add constraint customers_tags_count_check check (
    cardinality(tags) <= 20
  );

drop index if exists public.customers_business_email_key;
drop index if exists public.customers_business_phone_key;

create index customers_business_email_idx
on public.customers (business_id, lower(btrim(email)))
where email is not null;

create index customers_business_phone_idx
on public.customers (business_id, phone_normalized)
where phone_normalized is not null;

create index customers_business_status_idx
on public.customers (business_id, status);

create index customers_tags_idx
on public.customers using gin (tags);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  body text not null,
  author_name text not null default 'Team member',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_notes_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete cascade,
  constraint customer_notes_body_check check (
    char_length(btrim(body)) between 1 and 2000
  ),
  constraint customer_notes_author_check check (
    char_length(btrim(author_name)) between 1 and 160
  )
);

create index customer_notes_customer_idx
on public.customer_notes (business_id, customer_id, created_at desc);

create table public.customer_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  event_type text not null,
  description text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  created_at timestamptz not null default now(),
  constraint customer_events_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete cascade,
  constraint customer_events_type_check check (
    event_type in (
      'customer_created',
      'customer_updated',
      'status_changed',
      'tags_updated',
      'note_added',
      'address_added',
      'address_updated',
      'address_deleted',
      'duplicate_override'
    )
  ),
  constraint customer_events_description_check check (
    char_length(btrim(description)) between 1 and 500
  ),
  constraint customer_events_actor_check check (
    char_length(btrim(actor_name)) between 1 and 160
  )
);

create index customer_events_customer_idx
on public.customer_events (business_id, customer_id, created_at desc);

alter table public.customer_notes enable row level security;
alter table public.customer_events enable row level security;

create policy customer_notes_select_members
on public.customer_notes
for select
to authenticated
using (public.is_business_member(business_id));

create policy customer_events_select_members
on public.customer_events
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.customer_notes from anon, authenticated;
revoke all on public.customer_events from anon, authenticated;

grant select on public.customer_notes to authenticated;
grant select on public.customer_events to authenticated;

create or replace function public.normalize_customer_tags(p_tags text[])
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
  from (
    select lower(btrim(candidate)) as tag
    from unnest(coalesce(p_tags, '{}'::text[])) as candidate
    where nullif(btrim(candidate), '') is not null
  ) cleaned;
$$;

create or replace function public.record_customer_event(
  p_business_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_description text,
  p_actor_id uuid,
  p_actor_name text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.customer_events (
    business_id,
    customer_id,
    event_type,
    description,
    actor_id,
    actor_name
  )
  values (
    p_business_id,
    p_customer_id,
    p_event_type,
    left(p_description, 500),
    p_actor_id,
    coalesce(nullif(btrim(p_actor_name), ''), 'Team member')
  );
$$;

revoke all on function public.record_customer_event(
  uuid, uuid, text, text, uuid, text
) from public, anon, authenticated;

create or replace function public.log_customer_note_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_name text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  if actor_name is null then
    actor_name := 'Team member';
  end if;

  perform public.record_customer_event(
    new.business_id,
    new.customer_id,
    'note_added',
    'Note added.',
    auth.uid(),
    actor_name
  );

  return new;
end;
$$;

create or replace function public.log_customer_address_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_name text;
  target_business_id uuid;
  target_customer_id uuid;
  target_event_type text;
  target_description text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  if actor_name is null then
    actor_name := 'Team member';
  end if;

  if tg_op = 'DELETE' then
    target_business_id := old.business_id;
    target_customer_id := old.customer_id;
    target_event_type := 'address_deleted';
    target_description := 'Address removed: '
      || coalesce(old.label, old.line1, 'Address');
  elsif tg_op = 'UPDATE' then
    target_business_id := new.business_id;
    target_customer_id := new.customer_id;
    target_event_type := 'address_updated';
    target_description := 'Address updated: '
      || coalesce(new.label, new.line1, 'Address');
  else
    target_business_id := new.business_id;
    target_customer_id := new.customer_id;
    target_event_type := 'address_added';
    target_description := 'Address added: '
      || coalesce(new.label, new.line1, 'Address');
  end if;

  begin
    perform public.record_customer_event(
      target_business_id,
      target_customer_id,
      target_event_type,
      target_description,
      auth.uid(),
      actor_name
    );
  exception
    when foreign_key_violation then
      null;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

insert into public.customer_notes (
  business_id,
  customer_id,
  body,
  author_name,
  created_by,
  created_at
)
select
  c.business_id,
  c.id,
  c.notes,
  coalesce(nullif(btrim(p.full_name), ''), 'Team member'),
  c.updated_by,
  c.updated_at
from public.customers c
left join public.profiles p on p.id = c.updated_by
where c.notes is not null;

insert into public.customer_events (
  business_id,
  customer_id,
  event_type,
  description,
  actor_id,
  actor_name,
  created_at
)
select
  c.business_id,
  c.id,
  'customer_created',
  'Customer profile created.',
  c.created_by,
  coalesce(nullif(btrim(p.full_name), ''), 'Team member'),
  c.created_at
from public.customers c
left join public.profiles p on p.id = c.created_by;

insert into public.customer_events (
  business_id,
  customer_id,
  event_type,
  description,
  actor_id,
  actor_name,
  created_at
)
select
  n.business_id,
  n.customer_id,
  'note_added',
  'Note added.',
  n.created_by,
  n.author_name,
  n.created_at
from public.customer_notes n;

create trigger customer_notes_log_event
after insert on public.customer_notes
for each row execute function public.log_customer_note_event();

create trigger customer_addresses_log_event
after insert or update or delete on public.customer_addresses
for each row execute function public.log_customer_address_event();

drop function if exists public.search_customers(
  uuid, text, uuid, integer, integer, text, text
);

create or replace function public.search_customers(
  p_business_id uuid,
  p_search text default null,
  p_customer_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'name',
  p_direction text default 'asc',
  p_status text default null,
  p_tag text default null
)
returns table (
  id uuid,
  business_id uuid,
  full_name text,
  company_name text,
  email text,
  phone text,
  notes text,
  status text,
  tags text[],
  primary_address_label text,
  primary_address_line1 text,
  primary_address_city text,
  primary_address_country text,
  address_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  search_country text;
  search_digits text;
  normalized_sort text := coalesce(nullif(lower(btrim(p_sort)), ''), 'name');
  normalized_direction text := coalesce(
    nullif(lower(btrim(p_direction)), ''),
    'asc'
  );
  normalized_status text := nullif(lower(btrim(p_status)), '');
  normalized_tag text := nullif(lower(btrim(p_tag)), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if normalized_sort not in ('name', 'company', 'recent', 'created') then
    raise exception 'Customer sort option is not valid.'
      using errcode = '22023';
  end if;

  if normalized_direction not in ('asc', 'desc') then
    raise exception 'Customer sort direction is not valid.'
      using errcode = '22023';
  end if;

  if normalized_status is not null
     and normalized_status not in ('active', 'inactive', 'archived') then
    raise exception 'Customer status filter is not valid.'
      using errcode = '22023';
  end if;

  select b.country into search_country
  from public.businesses b
  where b.id = p_business_id;

  search_digits := public.normalize_customer_phone_digits(
    normalized_search,
    search_country
  );

  return query
  select
    c.id,
    c.business_id,
    c.full_name,
    c.company_name,
    c.email,
    c.phone,
    c.notes,
    c.status,
    c.tags,
    pa.label as primary_address_label,
    pa.line1 as primary_address_line1,
    pa.city as primary_address_city,
    pa.country as primary_address_country,
    (
      select count(*)::bigint
      from public.customer_addresses a
      where a.business_id = c.business_id
        and a.customer_id = c.id
    ) as address_count,
    c.created_at,
    c.updated_at,
    count(*) over ()::bigint as total_count
  from public.customers c
  left join lateral (
    select
      a.label,
      a.line1,
      a.city,
      a.country
    from public.customer_addresses a
    where a.business_id = c.business_id
      and a.customer_id = c.id
    order by a.is_default desc, a.created_at asc, a.id
    limit 1
  ) pa on true
  where c.business_id = p_business_id
    and (p_customer_id is null or c.id = p_customer_id)
    and (normalized_status is null or c.status = normalized_status)
    and (
      normalized_tag is null
      or c.tags @> array[normalized_tag]::text[]
    )
    and (
      normalized_search is null
      or c.full_name ilike '%' || normalized_search || '%'
      or coalesce(c.company_name, '') ilike '%' || normalized_search || '%'
      or coalesce(c.email, '') ilike '%' || normalized_search || '%'
      or coalesce(c.phone, '') ilike '%' || normalized_search || '%'
      or array_to_string(c.tags, ' ') ilike '%' || normalized_search || '%'
      or (
        search_digits is not null
        and char_length(search_digits) >= 3
        and c.phone_normalized like '%' || right(search_digits, 9)
      )
      or exists (
        select 1
        from public.customer_addresses a
        where a.business_id = c.business_id
          and a.customer_id = c.id
          and (
            a.line1 ilike '%' || normalized_search || '%'
            or coalesce(a.line2, '') ilike '%' || normalized_search || '%'
            or coalesce(a.city, '') ilike '%' || normalized_search || '%'
          )
      )
    )
  order by
    case
      when normalized_sort = 'name' and normalized_direction = 'asc'
      then lower(c.full_name)
    end asc nulls last,
    case
      when normalized_sort = 'name' and normalized_direction = 'desc'
      then lower(c.full_name)
    end desc nulls last,
    case
      when normalized_sort = 'company' and normalized_direction = 'asc'
      then lower(coalesce(c.company_name, c.full_name))
    end asc nulls last,
    case
      when normalized_sort = 'company' and normalized_direction = 'desc'
      then lower(coalesce(c.company_name, c.full_name))
    end desc nulls last,
    case
      when normalized_sort = 'recent' and normalized_direction = 'asc'
      then c.updated_at
    end asc nulls last,
    case
      when normalized_sort = 'recent' and normalized_direction = 'desc'
      then c.updated_at
    end desc nulls last,
    case
      when normalized_sort = 'created' and normalized_direction = 'asc'
      then c.created_at
    end asc nulls last,
    case
      when normalized_sort = 'created' and normalized_direction = 'desc'
      then c.created_at
    end desc nulls last,
    lower(c.full_name),
    c.id
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.list_customer_tags(p_business_id uuid)
returns table (
  tag text,
  customer_count bigint
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  select
    tag_value as tag,
    count(*)::bigint as customer_count
  from public.customers c
  cross join lateral unnest(c.tags) as tag_value
  where c.business_id = p_business_id
  group by tag_value
  order by tag_value;
end;
$$;

drop function if exists public.create_customer(
  uuid, text, text, text, text, text
);

create or replace function public.create_customer(
  p_business_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_notes text default null,
  p_status text default 'active',
  p_tags text[] default '{}'::text[],
  p_duplicate_override boolean default false,
  p_duplicate_reason text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  normalized_name text := nullif(btrim(p_full_name), '');
  normalized_email text := lower(nullif(btrim(p_email), ''));
  normalized_phone text := nullif(btrim(p_phone), '');
  normalized_company text := nullif(btrim(p_company_name), '');
  normalized_notes text := nullif(btrim(p_notes), '');
  normalized_status text := lower(
    coalesce(nullif(btrim(p_status), ''), 'active')
  );
  normalized_tags text[];
  normalized_override_reason text := nullif(btrim(p_duplicate_reason), '');
  business_country text;
  normalized_phone_digits text;
  duplicate_email boolean := false;
  duplicate_phone boolean := false;
  created_customer public.customers;
begin
  if actor_id is null then
    raise exception 'Authentication is required to create a customer.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage customers.'
      using errcode = '42501';
  end if;

  select b.country into business_country
  from public.businesses b
  where b.id = p_business_id;

  if business_country is null then
    raise exception 'The business could not be found.'
      using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Customer name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_email is not null and (
    char_length(normalized_email) not between 3 and 254
    or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Enter a valid customer email address.'
      using errcode = '22023';
  end if;

  normalized_phone_digits := public.normalize_customer_phone_digits(
    normalized_phone,
    business_country
  );

  if normalized_phone is not null
     and (
       normalized_phone_digits is null
       or char_length(normalized_phone_digits) not between 7 and 15
     ) then
    raise exception 'Customer phone must contain 7 to 15 digits.'
      using errcode = '22023';
  end if;

  if normalized_email is null and normalized_phone_digits is null then
    raise exception 'Add an email address or phone number for the customer.'
      using errcode = '22023';
  end if;

  if normalized_company is not null
     and char_length(normalized_company) not between 1 and 160 then
    raise exception 'Company name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Customer notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'inactive', 'archived') then
    raise exception 'Customer status is not valid.'
      using errcode = '22023';
  end if;

  normalized_tags := public.normalize_customer_tags(p_tags);

  if cardinality(normalized_tags) > 20 then
    raise exception 'Add no more than 20 customer tags.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(normalized_tags) as tag_value
    where char_length(tag_value) > 40
  ) then
    raise exception 'Each customer tag must be 40 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_email is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_business_id::text || ':customer-email:' || normalized_email,
        0
      )
    );
  end if;

  if normalized_phone_digits is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_business_id::text || ':customer-phone:' || normalized_phone_digits,
        0
      )
    );
  end if;

  duplicate_email := normalized_email is not null and exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and lower(btrim(c.email)) = normalized_email
  );

  duplicate_phone := normalized_phone_digits is not null and exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.phone_normalized = normalized_phone_digits
  );

  if duplicate_email or duplicate_phone then
    if not p_duplicate_override then
      if duplicate_email then
        raise exception 'A customer with this email address already exists.'
          using errcode = '23505';
      end if;
      raise exception 'A customer with this phone number already exists.'
        using errcode = '23505';
    end if;

    if not public.has_business_role(
      p_business_id,
      array['owner', 'admin', 'manager']
    ) then
      raise exception 'Only owners, admins and managers can override duplicate customer details.'
        using errcode = '42501';
    end if;

    if normalized_override_reason is null
       or char_length(normalized_override_reason) not between 3 and 240 then
      raise exception 'Add a reason between 3 and 240 characters for the duplicate override.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.customers (
    business_id,
    full_name,
    company_name,
    email,
    phone,
    phone_normalized,
    notes,
    status,
    tags,
    created_by,
    updated_by
  )
  values (
    p_business_id,
    normalized_name,
    normalized_company,
    normalized_email,
    normalized_phone,
    normalized_phone_digits,
    normalized_notes,
    normalized_status,
    normalized_tags,
    actor_id,
    actor_id
  )
  returning * into created_customer;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

  if normalized_notes is not null then
    insert into public.customer_notes (
      business_id,
      customer_id,
      body,
      author_name,
      created_by
    )
    values (
      created_customer.business_id,
      created_customer.id,
      normalized_notes,
      actor_name,
      actor_id
    );
  end if;

  perform public.record_customer_event(
    created_customer.business_id,
    created_customer.id,
    'customer_created',
    'Customer profile created.',
    actor_id,
    actor_name
  );

  if duplicate_email or duplicate_phone then
    perform public.record_customer_event(
      created_customer.business_id,
      created_customer.id,
      'duplicate_override',
      'Duplicate contact warning overridden: ' || normalized_override_reason,
      actor_id,
      actor_name
    );
  end if;

  return created_customer;
end;
$$;

drop function if exists public.update_customer(
  uuid, text, text, text, text, text
);

create or replace function public.update_customer(
  p_customer_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_notes text default null,
  p_status text default null,
  p_tags text[] default null,
  p_duplicate_override boolean default false,
  p_duplicate_reason text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_customer public.customers;
  normalized_name text := nullif(btrim(p_full_name), '');
  normalized_email text := lower(nullif(btrim(p_email), ''));
  normalized_phone text := nullif(btrim(p_phone), '');
  normalized_company text := nullif(btrim(p_company_name), '');
  normalized_notes text := nullif(btrim(p_notes), '');
  normalized_status text := nullif(lower(btrim(p_status)), '');
  normalized_tags text[];
  normalized_override_reason text := nullif(btrim(p_duplicate_reason), '');
  next_status text;
  next_tags text[];
  next_notes text;
  business_country text;
  normalized_phone_digits text;
  duplicate_email boolean := false;
  duplicate_phone boolean := false;
  contact_changed boolean := false;
  updated_customer public.customers;
begin
  if actor_id is null then
    raise exception 'Authentication is required to update a customer.'
      using errcode = '28000';
  end if;

  select * into current_customer
  from public.customers c
  where c.id = p_customer_id
  for update;

  if not found then
    raise exception 'Customer not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_customer.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage customers.'
      using errcode = '42501';
  end if;

  select b.country into business_country
  from public.businesses b
  where b.id = current_customer.business_id;

  if normalized_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Customer name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_email is not null and (
    char_length(normalized_email) not between 3 and 254
    or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Enter a valid customer email address.'
      using errcode = '22023';
  end if;

  normalized_phone_digits := public.normalize_customer_phone_digits(
    normalized_phone,
    business_country
  );

  if normalized_phone is not null
     and (
       normalized_phone_digits is null
       or char_length(normalized_phone_digits) not between 7 and 15
     ) then
    raise exception 'Customer phone must contain 7 to 15 digits.'
      using errcode = '22023';
  end if;

  if normalized_email is null and normalized_phone_digits is null then
    raise exception 'Add an email address or phone number for the customer.'
      using errcode = '22023';
  end if;

  if normalized_company is not null
     and char_length(normalized_company) not between 1 and 160 then
    raise exception 'Company name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if p_notes is not null
     and (
       normalized_notes is null
       or char_length(normalized_notes) > 2000
     ) then
    raise exception 'Customer notes must be between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  next_status := coalesce(normalized_status, current_customer.status);

  if next_status not in ('active', 'inactive', 'archived') then
    raise exception 'Customer status is not valid.'
      using errcode = '22023';
  end if;

  next_tags := case
    when p_tags is null then current_customer.tags
    else public.normalize_customer_tags(p_tags)
  end;

  if cardinality(next_tags) > 20 then
    raise exception 'Add no more than 20 customer tags.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(next_tags) as tag_value
    where char_length(tag_value) > 40
  ) then
    raise exception 'Each customer tag must be 40 characters or fewer.'
      using errcode = '22023';
  end if;

  next_notes := case
    when p_notes is null then current_customer.notes
    else normalized_notes
  end;

  if normalized_email is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        current_customer.business_id::text
          || ':customer-email:'
          || normalized_email,
        0
      )
    );
  end if;

  if normalized_phone_digits is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        current_customer.business_id::text
          || ':customer-phone:'
          || normalized_phone_digits,
        0
      )
    );
  end if;

  duplicate_email := normalized_email is not null and exists (
    select 1
    from public.customers c
    where c.business_id = current_customer.business_id
      and c.id <> p_customer_id
      and lower(btrim(c.email)) = normalized_email
  );

  duplicate_phone := normalized_phone_digits is not null and exists (
    select 1
    from public.customers c
    where c.business_id = current_customer.business_id
      and c.id <> p_customer_id
      and c.phone_normalized = normalized_phone_digits
  );

  if duplicate_email or duplicate_phone then
    if not p_duplicate_override then
      if duplicate_email then
        raise exception 'A customer with this email address already exists.'
          using errcode = '23505';
      end if;
      raise exception 'A customer with this phone number already exists.'
        using errcode = '23505';
    end if;

    if not public.has_business_role(
      current_customer.business_id,
      array['owner', 'admin', 'manager']
    ) then
      raise exception 'Only owners, admins and managers can override duplicate customer details.'
        using errcode = '42501';
    end if;

    if normalized_override_reason is null
       or char_length(normalized_override_reason) not between 3 and 240 then
      raise exception 'Add a reason between 3 and 240 characters for the duplicate override.'
        using errcode = '22023';
    end if;
  end if;

  contact_changed := current_customer.full_name is distinct from normalized_name
    or current_customer.company_name is distinct from normalized_company
    or lower(btrim(coalesce(current_customer.email, ''))) is distinct from
      coalesce(normalized_email, '')
    or current_customer.phone_normalized is distinct from normalized_phone_digits;

  update public.customers
  set
    full_name = normalized_name,
    company_name = normalized_company,
    email = normalized_email,
    phone = normalized_phone,
    phone_normalized = normalized_phone_digits,
    notes = next_notes,
    status = next_status,
    tags = next_tags,
    updated_by = actor_id
  where id = p_customer_id
  returning * into updated_customer;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

  if p_notes is not null then
    insert into public.customer_notes (
      business_id,
      customer_id,
      body,
      author_name,
      created_by
    )
    values (
      updated_customer.business_id,
      updated_customer.id,
      normalized_notes,
      actor_name,
      actor_id
    );
  end if;

  if current_customer.status is distinct from next_status then
    perform public.record_customer_event(
      updated_customer.business_id,
      updated_customer.id,
      'status_changed',
      'Status changed from ' || initcap(current_customer.status)
        || ' to ' || initcap(next_status) || '.',
      actor_id,
      actor_name
    );
  end if;

  if current_customer.tags is distinct from next_tags then
    perform public.record_customer_event(
      updated_customer.business_id,
      updated_customer.id,
      'tags_updated',
      'Tags updated to: ' || coalesce(array_to_string(next_tags, ', '), 'none'),
      actor_id,
      actor_name
    );
  end if;

  if contact_changed then
    perform public.record_customer_event(
      updated_customer.business_id,
      updated_customer.id,
      'customer_updated',
      'Customer contact details updated.',
      actor_id,
      actor_name
    );
  end if;

  if duplicate_email or duplicate_phone then
    perform public.record_customer_event(
      updated_customer.business_id,
      updated_customer.id,
      'duplicate_override',
      'Duplicate contact warning overridden: ' || normalized_override_reason,
      actor_id,
      actor_name
    );
  end if;

  return updated_customer;
end;
$$;

create or replace function public.add_customer_note(
  p_customer_id uuid,
  p_body text
)
returns public.customer_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_customer public.customers;
  normalized_body text := nullif(btrim(p_body), '');
  created_note public.customer_notes;
begin
  if actor_id is null then
    raise exception 'Authentication is required to add a note.'
      using errcode = '28000';
  end if;

  select * into current_customer
  from public.customers c
  where c.id = p_customer_id
  for update;

  if not found then
    raise exception 'Customer not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_customer.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage customers.'
      using errcode = '42501';
  end if;

  if normalized_body is null or char_length(normalized_body) > 2000 then
    raise exception 'Customer notes must be between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

  insert into public.customer_notes (
    business_id,
    customer_id,
    body,
    author_name,
    created_by
  )
  values (
    current_customer.business_id,
    current_customer.id,
    normalized_body,
    actor_name,
    actor_id
  )
  returning * into created_note;

  update public.customers
  set
    notes = normalized_body,
    updated_by = actor_id
  where id = p_customer_id;

  return created_note;
end;
$$;

revoke all on function public.normalize_customer_tags(text[])
from public, anon, authenticated;

revoke all on function public.search_customers(
  uuid, text, uuid, integer, integer, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.list_customer_tags(uuid)
from public, anon, authenticated;

revoke all on function public.create_customer(
  uuid, text, text, text, text, text, text, text[], boolean, text
) from public, anon, authenticated;

revoke all on function public.update_customer(
  uuid, text, text, text, text, text, text, text[], boolean, text
) from public, anon, authenticated;

revoke all on function public.add_customer_note(uuid, text)
from public, anon, authenticated;

grant execute on function public.normalize_customer_tags(text[])
to authenticated, service_role;

grant execute on function public.search_customers(
  uuid, text, uuid, integer, integer, text, text, text, text
) to authenticated, service_role;

grant execute on function public.list_customer_tags(uuid)
to authenticated, service_role;

grant execute on function public.create_customer(
  uuid, text, text, text, text, text, text, text[], boolean, text
) to authenticated, service_role;

grant execute on function public.update_customer(
  uuid, text, text, text, text, text, text, text[], boolean, text
) to authenticated, service_role;

grant execute on function public.add_customer_note(uuid, text)
to authenticated, service_role;
