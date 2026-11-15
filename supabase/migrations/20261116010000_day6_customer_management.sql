-- Day 6: customer profiles, contact details, addresses and duplicate detection.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  company_name text,
  email text,
  phone text,
  phone_normalized text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_business_id_id_key unique (business_id, id),
  constraint customers_full_name_check check (
    char_length(btrim(full_name)) between 1 and 160
  ),
  constraint customers_company_name_check check (
    company_name is null
    or char_length(btrim(company_name)) between 1 and 160
  ),
  constraint customers_email_check check (
    email is null
    or (
      char_length(btrim(email)) between 3 and 254
      and btrim(email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint customers_phone_check check (
    phone is null or char_length(btrim(phone)) between 7 and 32
  ),
  constraint customers_phone_normalized_check check (
    phone_normalized is null or phone_normalized ~ '^[0-9]{7,15}$'
  ),
  constraint customers_notes_check check (
    notes is null or char_length(notes) <= 2000
  ),
  constraint customers_contact_check check (
    email is not null or phone_normalized is not null
  )
);

create unique index customers_business_email_key
on public.customers (business_id, lower(btrim(email)))
where email is not null;

create unique index customers_business_phone_key
on public.customers (business_id, phone_normalized)
where phone_normalized is not null;

create index customers_business_name_idx
on public.customers (business_id, lower(btrim(full_name)));

create index customers_business_updated_idx
on public.customers (business_id, updated_at desc);

create index customers_business_created_idx
on public.customers (business_id, created_at desc);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  label text,
  recipient_name text,
  line1 text not null,
  line2 text,
  city text,
  region text,
  postal_code text,
  country text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_business_id_id_key unique (business_id, id),
  constraint customer_addresses_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete cascade,
  constraint customer_addresses_label_check check (
    label is null or char_length(btrim(label)) between 1 and 80
  ),
  constraint customer_addresses_recipient_check check (
    recipient_name is null
    or char_length(btrim(recipient_name)) between 1 and 160
  ),
  constraint customer_addresses_line1_check check (
    char_length(btrim(line1)) between 1 and 240
  ),
  constraint customer_addresses_line2_check check (
    line2 is null or char_length(btrim(line2)) <= 240
  ),
  constraint customer_addresses_city_check check (
    city is null or char_length(btrim(city)) between 1 and 120
  ),
  constraint customer_addresses_region_check check (
    region is null or char_length(btrim(region)) between 1 and 120
  ),
  constraint customer_addresses_postal_code_check check (
    postal_code is null or char_length(btrim(postal_code)) between 1 and 40
  ),
  constraint customer_addresses_country_check check (
    country ~ '^[A-Z]{2}$'
  )
);

create unique index customer_addresses_default_key
on public.customer_addresses (business_id, customer_id)
where is_default;

create index customer_addresses_customer_idx
on public.customer_addresses (business_id, customer_id, is_default desc, created_at);

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row execute function public.set_updated_at();

create or replace function public.normalize_customer_phone_digits(
  p_phone text,
  p_country text default 'RW'
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_country text := upper(btrim(coalesce(p_country, '')));
begin
  if digits = '' then
    return null;
  end if;

  if left(digits, 2) = '00' then
    digits := substr(digits, 3);
  end if;

  if normalized_country = 'RW' then
    if char_length(digits) = 10 and left(digits, 1) = '0' then
      digits := '250' || substr(digits, 2);
    elsif char_length(digits) = 9 and left(digits, 1) = '7' then
      digits := '250' || digits;
    end if;
  end if;

  return digits;
end;
$$;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;

create policy customers_select_members
on public.customers
for select
to authenticated
using (public.is_business_member(business_id));

create policy customer_addresses_select_members
on public.customer_addresses
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.customers from anon, authenticated;
revoke all on public.customer_addresses from anon, authenticated;

grant select on public.customers to authenticated;
grant select on public.customer_addresses to authenticated;

create or replace function public.search_customers(
  p_business_id uuid,
  p_search text default null,
  p_customer_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns table (
  id uuid,
  business_id uuid,
  full_name text,
  company_name text,
  email text,
  phone text,
  notes text,
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
    and (
      normalized_search is null
      or c.full_name ilike '%' || normalized_search || '%'
      or coalesce(c.company_name, '') ilike '%' || normalized_search || '%'
      or coalesce(c.email, '') ilike '%' || normalized_search || '%'
      or coalesce(c.phone, '') ilike '%' || normalized_search || '%'
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

create or replace function public.find_customer_duplicates(
  p_business_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_exclude_customer_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  company_name text,
  email text,
  phone text,
  match_reasons text[]
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  normalized_name text := lower(nullif(btrim(p_full_name), ''));
  normalized_email text := lower(nullif(btrim(p_email), ''));
  business_country text;
  normalized_phone text;
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if normalized_name is null and normalized_email is null and p_phone is null then
    return;
  end if;

  select b.country into business_country
  from public.businesses b
  where b.id = p_business_id;

  normalized_phone := public.normalize_customer_phone_digits(
    p_phone,
    business_country
  );

  return query
  with matches as (
    select
      c.id,
      c.full_name,
      c.company_name,
      c.email,
      c.phone,
      (
        normalized_email is not null
        and lower(btrim(c.email)) = normalized_email
      ) or (
        normalized_phone is not null
        and c.phone_normalized = normalized_phone
      ) as contact_match,
      array_remove(
        array[
          case
            when normalized_email is not null
              and lower(btrim(c.email)) = normalized_email
            then 'email'::text
          end,
          case
            when normalized_phone is not null
              and c.phone_normalized = normalized_phone
            then 'phone'::text
          end,
          case
            when normalized_name is not null
              and lower(btrim(c.full_name)) = normalized_name
            then 'name'::text
          end
        ],
        null
      ) as match_reasons
    from public.customers c
    where c.business_id = p_business_id
      and (
        p_exclude_customer_id is null
        or c.id <> p_exclude_customer_id
      )
      and (
        (
          normalized_email is not null
          and lower(btrim(c.email)) = normalized_email
        )
        or (
          normalized_phone is not null
          and c.phone_normalized = normalized_phone
        )
        or (
          normalized_name is not null
          and lower(btrim(c.full_name)) = normalized_name
        )
      )
  )
  select
    m.id,
    m.full_name,
    m.company_name,
    m.email,
    m.phone,
    m.match_reasons
  from matches m
  order by m.contact_match desc, lower(m.full_name), m.id
  limit 5;
end;
$$;

create or replace function public.create_customer(
  p_business_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_notes text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_name text := nullif(btrim(p_full_name), '');
  normalized_email text := lower(nullif(btrim(p_email), ''));
  normalized_phone text := nullif(btrim(p_phone), '');
  normalized_company text := nullif(btrim(p_company_name), '');
  normalized_notes text := nullif(btrim(p_notes), '');
  business_country text;
  normalized_phone_digits text;
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

  if normalized_email is not null and exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and lower(btrim(c.email)) = normalized_email
  ) then
    raise exception 'A customer with this email address already exists.'
      using errcode = '23505';
  end if;

  if normalized_phone_digits is not null and exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.phone_normalized = normalized_phone_digits
  ) then
    raise exception 'A customer with this phone number already exists.'
      using errcode = '23505';
  end if;

  insert into public.customers (
    business_id,
    full_name,
    company_name,
    email,
    phone,
    phone_normalized,
    notes,
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
    actor_id,
    actor_id
  )
  returning * into created_customer;

  return created_customer;
end;
$$;

create or replace function public.update_customer(
  p_customer_id uuid,
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_notes text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  current_customer public.customers;
  normalized_name text := nullif(btrim(p_full_name), '');
  normalized_email text := lower(nullif(btrim(p_email), ''));
  normalized_phone text := nullif(btrim(p_phone), '');
  normalized_company text := nullif(btrim(p_company_name), '');
  normalized_notes text := nullif(btrim(p_notes), '');
  business_country text;
  normalized_phone_digits text;
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

  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Customer notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_email is not null and exists (
    select 1
    from public.customers c
    where c.business_id = current_customer.business_id
      and c.id <> p_customer_id
      and lower(btrim(c.email)) = normalized_email
  ) then
    raise exception 'A customer with this email address already exists.'
      using errcode = '23505';
  end if;

  if normalized_phone_digits is not null and exists (
    select 1
    from public.customers c
    where c.business_id = current_customer.business_id
      and c.id <> p_customer_id
      and c.phone_normalized = normalized_phone_digits
  ) then
    raise exception 'A customer with this phone number already exists.'
      using errcode = '23505';
  end if;

  update public.customers
  set
    full_name = normalized_name,
    company_name = normalized_company,
    email = normalized_email,
    phone = normalized_phone,
    phone_normalized = normalized_phone_digits,
    notes = normalized_notes,
    updated_by = actor_id
  where id = p_customer_id
  returning * into updated_customer;

  return updated_customer;
end;
$$;

create or replace function public.save_customer_address(
  p_customer_id uuid,
  p_address_id uuid default null,
  p_label text default null,
  p_recipient_name text default null,
  p_line1 text default null,
  p_line2 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country text default null,
  p_is_default boolean default false
)
returns public.customer_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  current_customer public.customers;
  current_address public.customer_addresses;
  normalized_label text := nullif(btrim(p_label), '');
  normalized_recipient text := nullif(btrim(p_recipient_name), '');
  normalized_line1 text := nullif(btrim(p_line1), '');
  normalized_line2 text := nullif(btrim(p_line2), '');
  normalized_city text := nullif(btrim(p_city), '');
  normalized_region text := nullif(btrim(p_region), '');
  normalized_postal text := nullif(btrim(p_postal_code), '');
  business_country text;
  normalized_country text;
  address_count integer;
  saved_address public.customer_addresses;
begin
  if actor_id is null then
    raise exception 'Authentication is required to manage addresses.'
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

  normalized_country := upper(coalesce(nullif(btrim(p_country), ''), business_country));

  if normalized_line1 is null or char_length(normalized_line1) not between 1 and 240 then
    raise exception 'Address line 1 must be between 1 and 240 characters.'
      using errcode = '22023';
  end if;

  if normalized_label is not null and char_length(normalized_label) > 80 then
    raise exception 'Address label must be 80 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_recipient is not null and char_length(normalized_recipient) > 160 then
    raise exception 'Recipient name must be 160 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_line2 is not null and char_length(normalized_line2) > 240 then
    raise exception 'Address line 2 must be 240 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_city is not null and char_length(normalized_city) > 120 then
    raise exception 'City must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_region is not null and char_length(normalized_region) > 120 then
    raise exception 'Region must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_postal is not null and char_length(normalized_postal) > 40 then
    raise exception 'Postal code must be 40 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_country !~ '^[A-Z]{2}$' then
    raise exception 'Address country must be a two-letter ISO code.'
      using errcode = '22023';
  end if;

  select count(*)::integer into address_count
  from public.customer_addresses a
  where a.business_id = current_customer.business_id
    and a.customer_id = p_customer_id;

  if p_address_id is not null then
    select * into current_address
    from public.customer_addresses a
    where a.id = p_address_id
      and a.business_id = current_customer.business_id
      and a.customer_id = p_customer_id
    for update;

    if not found then
      raise exception 'Address not found or you do not have access to it.'
        using errcode = '42501';
    end if;

    if p_is_default then
      update public.customer_addresses
      set is_default = false
      where business_id = current_customer.business_id
        and customer_id = p_customer_id
        and id <> p_address_id
        and is_default;
    end if;

    update public.customer_addresses
    set
      label = normalized_label,
      recipient_name = normalized_recipient,
      line1 = normalized_line1,
      line2 = normalized_line2,
      city = normalized_city,
      region = normalized_region,
      postal_code = normalized_postal,
      country = normalized_country,
      is_default = p_is_default
    where id = p_address_id
    returning * into saved_address;
  else
    if p_is_default or address_count = 0 then
      update public.customer_addresses
      set is_default = false
      where business_id = current_customer.business_id
        and customer_id = p_customer_id
        and is_default;
    end if;

    insert into public.customer_addresses (
      business_id,
      customer_id,
      label,
      recipient_name,
      line1,
      line2,
      city,
      region,
      postal_code,
      country,
      is_default
    )
    values (
      current_customer.business_id,
      p_customer_id,
      normalized_label,
      normalized_recipient,
      normalized_line1,
      normalized_line2,
      normalized_city,
      normalized_region,
      normalized_postal,
      normalized_country,
      p_is_default or address_count = 0
    )
    returning * into saved_address;
  end if;

  if not exists (
    select 1
    from public.customer_addresses a
    where a.business_id = current_customer.business_id
      and a.customer_id = p_customer_id
      and a.is_default
  ) then
    update public.customer_addresses
    set is_default = true
    where id = (
      select a.id
      from public.customer_addresses a
      where a.business_id = current_customer.business_id
        and a.customer_id = p_customer_id
      order by a.created_at, a.id
      limit 1
    )
    returning * into saved_address;
  end if;

  select * into saved_address
  from public.customer_addresses a
  where a.id = saved_address.id;

  return saved_address;
end;
$$;

create or replace function public.delete_customer_address(
  p_address_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  current_address public.customer_addresses;
begin
  if actor_id is null then
    raise exception 'Authentication is required to manage addresses.'
      using errcode = '28000';
  end if;

  select * into current_address
  from public.customer_addresses a
  where a.id = p_address_id
  for update;

  if not found then
    raise exception 'Address not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_address.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage customers.'
      using errcode = '42501';
  end if;

  delete from public.customer_addresses
  where id = p_address_id;

  if current_address.is_default then
    update public.customer_addresses
    set is_default = true
    where id = (
      select a.id
      from public.customer_addresses a
      where a.business_id = current_address.business_id
        and a.customer_id = current_address.customer_id
      order by a.created_at, a.id
      limit 1
    );
  end if;

  return true;
end;
$$;

revoke all on function public.normalize_customer_phone_digits(text, text)
from public, anon, authenticated;

revoke all on function public.search_customers(
  uuid, text, uuid, integer, integer, text, text
) from public, anon, authenticated;

revoke all on function public.find_customer_duplicates(
  uuid, text, text, text, uuid
) from public, anon, authenticated;

revoke all on function public.create_customer(
  uuid, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.update_customer(
  uuid, text, text, text, text, text
) from public, anon, authenticated;

revoke all on function public.save_customer_address(
  uuid, uuid, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

revoke all on function public.delete_customer_address(uuid)
from public, anon, authenticated;

grant execute on function public.normalize_customer_phone_digits(text, text)
to authenticated, service_role;

grant execute on function public.search_customers(
  uuid, text, uuid, integer, integer, text, text
) to authenticated, service_role;

grant execute on function public.find_customer_duplicates(
  uuid, text, text, text, uuid
) to authenticated, service_role;

grant execute on function public.create_customer(
  uuid, text, text, text, text, text
) to authenticated, service_role;

grant execute on function public.update_customer(
  uuid, text, text, text, text, text
) to authenticated, service_role;

grant execute on function public.save_customer_address(
  uuid, uuid, text, text, text, text, text, text, text, text, boolean
) to authenticated, service_role;

grant execute on function public.delete_customer_address(uuid)
to authenticated, service_role;
