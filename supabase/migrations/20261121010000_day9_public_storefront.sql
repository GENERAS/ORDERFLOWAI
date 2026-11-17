create table public.stores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text,
  logo_path text,
  contact_email text,
  contact_phone text,
  contact_address text,
  show_contact boolean not null default false,
  brand_color text not null default '#4f46e5',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_slug_check check (
    char_length(slug) between 2 and 80
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint stores_name_check check (char_length(btrim(name)) between 1 and 160),
  constraint stores_description_check check (
    description is null or char_length(description) <= 2000
  ),
  constraint stores_contact_email_check check (
    contact_email is null or (
      char_length(btrim(contact_email)) between 3 and 254
      and btrim(contact_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint stores_contact_phone_check check (
    contact_phone is null or char_length(btrim(contact_phone)) between 7 and 32
  ),
  constraint stores_contact_address_check check (
    contact_address is null or char_length(btrim(contact_address)) <= 500
  ),
  constraint stores_brand_color_check check (
    brand_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  constraint stores_status_check check (status in ('active', 'inactive'))
);

create table public.storefront_order_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  constraint storefront_order_requests_key_check check (
    char_length(btrim(idempotency_key)) between 1 and 128
  ),
  constraint storefront_order_requests_business_key_key
    unique (business_id, idempotency_key)
);

create index stores_status_slug_idx on public.stores (status, slug);

create index storefront_order_requests_business_created_idx
on public.storefront_order_requests (business_id, created_at desc);

alter table public.products
add column storefront_visible boolean not null default false;

create index products_storefront_visible_idx
on public.products (business_id, status, storefront_visible)
where storefront_visible;

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

create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

create or replace function public.validate_store_logo_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.logo_path is null then
    return new;
  end if;

  if new.logo_path !~ (
    '^' || new.business_id::text
    || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    || '\.[A-Za-z0-9]+$'
  ) then
    raise exception 'Store logo paths must use business/file format.'
      using errcode = '22023';
  end if;

  if position('..' in new.logo_path) > 0 then
    raise exception 'Store logo paths cannot contain traversal segments.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger stores_validate_logo_path
before insert or update of business_id, logo_path on public.stores
for each row execute function public.validate_store_logo_path();

create or replace function public.unique_store_slug(p_business_slug text, p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text := lower(btrim(p_business_slug));
  suffix text := left(replace(p_business_id::text, '-', ''), 10);
begin
  if not exists (select 1 from public.stores s where s.slug = candidate) then
    return candidate;
  end if;

  candidate := left(candidate, least(char_length(candidate), 68)) || '-' || suffix;

  if not exists (select 1 from public.stores s where s.slug = candidate) then
    return candidate;
  end if;

  return candidate || '-' || left(md5(random()::text), 6);
end;
$$;

create or replace function public.auto_create_business_store()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stores (business_id, slug, name, status)
  values (
    new.id,
    public.unique_store_slug(new.slug, new.id),
    new.name,
    'active'
  );

  return new;
end;
$$;

insert into public.stores (business_id, slug, name, status)
select
  b.id,
  public.unique_store_slug(b.slug, b.id),
  b.name,
  'active'
from public.businesses b
where not exists (
  select 1 from public.stores s where s.business_id = b.id
);

create trigger businesses_auto_create_store
after insert on public.businesses
for each row execute function public.auto_create_business_store();

create or replace function public.is_public_product_image(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.product_images pi
    join public.products p
      on p.business_id = pi.business_id
     and p.id = pi.product_id
    join public.stores s
      on s.business_id = p.business_id
     and s.status = 'active'
    where pi.storage_path = p_storage_path
      and p.status = 'active'
      and p.storefront_visible
  );
$$;

create or replace function public.is_public_store_logo(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.stores s
    where s.logo_path = p_storage_path
      and s.status = 'active'
  );
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'store-logos',
  'store-logos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy storefront_product_images_select_public
on storage.objects
for select
to anon
using (
  bucket_id = 'product-images'
  and public.is_public_product_image(storage.objects.name)
);

create policy store_logos_select_members
on storage.objects
for select
to authenticated
using (
  bucket_id = 'store-logos'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy store_logos_select_public
on storage.objects
for select
to anon
using (
  bucket_id = 'store-logos'
  and public.is_public_store_logo(storage.objects.name)
);

create policy store_logos_insert_managers
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'store-logos'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager']
  )
);

create policy store_logos_update_managers
on storage.objects
for update
to authenticated
using (
  bucket_id = 'store-logos'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager']
  )
)
with check (
  bucket_id = 'store-logos'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager']
  )
);

create policy store_logos_delete_managers
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'store-logos'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager']
  )
);

alter table public.stores enable row level security;
alter table public.storefront_order_requests enable row level security;

create policy stores_select_members
on public.stores
for select
to authenticated
using (public.is_business_member(business_id));

create or replace function public.get_store_profile(p_business_id uuid)
returns table (
  id uuid,
  business_id uuid,
  slug text,
  name text,
  description text,
  logo_path text,
  contact_email text,
  contact_phone text,
  contact_address text,
  show_contact boolean,
  brand_color text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
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
    s.id,
    s.business_id,
    s.slug,
    s.name,
    s.description,
    s.logo_path,
    s.contact_email,
    s.contact_phone,
    s.contact_address,
    s.show_contact,
    s.brand_color,
    s.status,
    s.created_at,
    s.updated_at
  from public.stores s
  where s.business_id = p_business_id;
end;
$$;

create or replace function public.get_public_store(p_store_slug text)
returns table (
  store_slug text,
  store_name text,
  description text,
  logo_path text,
  brand_color text,
  contact_email text,
  contact_phone text,
  contact_address text,
  currency text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
begin
  return query
  select
    s.slug,
    s.name,
    s.description,
    s.logo_path,
    s.brand_color,
    case when s.show_contact then s.contact_email else null end,
    case when s.show_contact then s.contact_phone else null end,
    case when s.show_contact then s.contact_address else null end,
    b.currency
  from public.stores s
  join public.businesses b on b.id = s.business_id
  where s.slug = normalized_slug
    and s.status = 'active';

  if not found then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.update_store_profile(
  p_business_id uuid,
  p_slug text,
  p_name text,
  p_description text default null,
  p_logo_path text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_address text default null,
  p_show_contact boolean default false,
  p_brand_color text default '#4f46e5',
  p_status text default 'active'
)
returns public.stores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_store public.stores;
  normalized_slug text := lower(btrim(p_slug));
  normalized_name text := btrim(p_name);
  normalized_color text := lower(btrim(p_brand_color));
  normalized_status text := lower(btrim(p_status));
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your online store.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to manage this online store.'
      using errcode = '42501';
  end if;

  if normalized_slug is null
     or char_length(normalized_slug) not between 2 and 80
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Store links must be 2-80 lowercase letters, numbers, or hyphens.'
      using errcode = '22023';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Store name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Choose a valid brand color.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'inactive') then
    raise exception 'Choose a valid store status.'
      using errcode = '22023';
  end if;

  update public.stores
  set
    slug = normalized_slug,
    name = normalized_name,
    description = nullif(btrim(p_description), ''),
    logo_path = nullif(btrim(p_logo_path), ''),
    contact_email = nullif(btrim(p_contact_email), ''),
    contact_phone = nullif(btrim(p_contact_phone), ''),
    contact_address = nullif(btrim(p_contact_address), ''),
    show_contact = coalesce(p_show_contact, false),
    brand_color = normalized_color,
    status = normalized_status
  where business_id = p_business_id
  returning * into current_store;

  if not found then
    raise exception 'This online store could not be found.'
      using errcode = '22023';
  end if;

  return current_store;
exception
  when unique_violation then
    raise exception 'That store link is already taken.'
      using errcode = '23505';
end;
$$;

create or replace function public.set_storefront_product_visibility(
  p_product_id uuid,
  p_visible boolean
)
returns public.products
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_product public.products;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your catalogue.'
      using errcode = '28000';
  end if;

  select * into current_product
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'Product not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    current_product.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to change this catalogue.'
      using errcode = '42501';
  end if;

  update public.products
  set storefront_visible = coalesce(p_visible, false)
  where id = p_product_id
  returning * into current_product;

  return current_product;
end;
$$;

create or replace function public.search_storefront_management_products(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  status text,
  sku text,
  price numeric,
  currency text,
  category_name text,
  primary_image_path text,
  storefront_visible boolean,
  total_count bigint
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  normalized_status text := nullif(btrim(p_status), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if normalized_status is not null
     and normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Product status filter is not valid.'
      using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.name,
    p.status,
    p.sku,
    p.price,
    p.currency,
    c.name as category_name,
    img.primary_image_path,
    p.storefront_visible,
    count(*) over ()::bigint as total_count
  from public.products p
  left join public.categories c
    on c.id = p.category_id
   and c.business_id = p.business_id
  left join lateral (
    select pi.storage_path as primary_image_path
    from public.product_images pi
    where pi.business_id = p.business_id
      and pi.product_id = p.id
    order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
    limit 1
  ) img on true
  where p.business_id = p_business_id
    and (
      normalized_search is null
      or p.name ilike '%' || normalized_search || '%'
      or coalesce(p.sku, '') ilike '%' || normalized_search || '%'
    )
    and (normalized_status is null or p.status = normalized_status)
  order by p.storefront_visible desc, p.updated_at desc, p.name asc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.list_storefront_categories(p_store_slug text)
returns table (
  id uuid,
  name text,
  product_count bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  store_business_id uuid;
begin
  select s.business_id into store_business_id
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if store_business_id is null then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  return query
  select
    c.id,
    c.name,
    count(distinct p.id)::bigint as product_count
  from public.categories c
  join public.products p
    on p.business_id = c.business_id
   and p.category_id = c.id
   and p.status = 'active'
   and p.storefront_visible
   and exists (
     select 1
     from public.product_variants v
     where v.business_id = p.business_id
       and v.product_id = p.id
       and v.status = 'active'
   )
   or p.business_id = c.business_id
      and p.category_id = c.id
      and p.status = 'active'
      and p.storefront_visible
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )
  where c.business_id = store_business_id
  group by c.id, c.name
  having count(distinct p.id) > 0
  order by lower(c.name);
end;
$$;

create or replace function public.search_storefront_products(
  p_store_slug text,
  p_search text default null,
  p_category_id uuid default null,
  p_sort text default 'featured',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  currency text,
  category_name text,
  brand_name text,
  primary_image_path text,
  primary_image_alt text,
  availability text,
  has_variants boolean,
  price_from boolean,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_search text := nullif(btrim(p_search), '');
  normalized_sort text := lower(btrim(p_sort));
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  store_business_id uuid;
begin
  select s.business_id into store_business_id
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if store_business_id is null then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  if normalized_sort not in ('featured', 'name', 'price_asc', 'price_desc', 'newest') then
    normalized_sort := 'featured';
  end if;

  return query
  with units as (
    select
      p.id as product_id,
      p.price as unit_price,
      null::uuid as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id is null
    where p.business_id = store_business_id
      and p.status = 'active'
      and p.storefront_visible
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )

    union all

    select
      p.id as product_id,
      coalesce(v.price_override, p.price) as unit_price,
      v.id as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
     and v.product_id = p.id
     and v.status = 'active'
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id = v.id
    where p.business_id = store_business_id
      and p.status = 'active'
      and p.storefront_visible
  ),
  product_units as (
    select
      u.product_id,
      min(u.unit_price) as price,
      bool_or(u.variant_id is not null) as has_variants,
      count(distinct u.unit_price) > 1 as price_from,
      bool_or(
        case
          when not u.is_tracked then true
          else u.available_quantity > 0
        end
      ) as is_available,
      bool_or(u.is_tracked) as has_tracked
    from units u
    group by u.product_id
  )
  select
    p.id,
    p.name,
    p.description,
    pu.price,
    p.currency,
    c.name as category_name,
    b.name as brand_name,
    img.primary_image_path,
    img.primary_image_alt,
    case
      when not pu.has_tracked then 'untracked'
      when pu.is_available then 'in_stock'
      else 'out_of_stock'
    end as availability,
    coalesce(pu.has_variants, false) as has_variants,
    coalesce(pu.price_from, false) as price_from,
    count(*) over ()::bigint as total_count
  from product_units pu
  join public.products p
    on p.id = pu.product_id
  left join public.categories c
    on c.id = p.category_id
   and c.business_id = p.business_id
  left join public.brands b
    on b.id = p.brand_id
   and b.business_id = p.business_id
  left join lateral (
    select pi.storage_path as primary_image_path,
      pi.alt_text as primary_image_alt
    from public.product_images pi
    where pi.business_id = p.business_id
      and pi.product_id = p.id
    order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
    limit 1
  ) img on true
  where (
    normalized_search is null
    or p.name ilike '%' || normalized_search || '%'
    or coalesce(p.description, '') ilike '%' || normalized_search || '%'
    or coalesce(p.sku, '') ilike '%' || normalized_search || '%'
    or coalesce(c.name, '') ilike '%' || normalized_search || '%'
  )
    and (p_category_id is null or p.category_id = p_category_id)
  order by
    case when normalized_sort = 'featured' then p.updated_at end desc,
    case when normalized_sort = 'newest' then p.created_at end desc,
    case when normalized_sort = 'name' then lower(p.name) end asc,
    case when normalized_sort = 'price_asc' then pu.price end asc,
    case when normalized_sort = 'price_desc' then pu.price end desc,
    p.name asc,
    p.id asc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.get_storefront_product(
  p_store_slug text,
  p_product_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  currency text,
  category_name text,
  brand_name text,
  availability text,
  has_variants boolean,
  price_from boolean,
  variants jsonb,
  images jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  store_business_id uuid;
  current_product public.products;
begin
  select s.business_id into store_business_id
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if store_business_id is null then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  select * into current_product
  from public.products p
  where p.id = p_product_id
    and p.business_id = store_business_id
    and p.status = 'active'
    and p.storefront_visible;

  if not found then
    raise exception 'This product is not available.'
      using errcode = '22023';
  end if;

  return query
  with units as (
    select
      p.price as unit_price,
      null::uuid as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id is null
    where p.id = current_product.id
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
          and v.status = 'active'
      )

    union all

    select
      coalesce(v.price_override, p.price) as unit_price,
      v.id as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
     and v.product_id = p.id
     and v.status = 'active'
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id = v.id
    where p.id = current_product.id
  ),
  summary as (
    select
      count(*) > 0 as has_units,
      min(u.unit_price) as price,
      bool_or(u.variant_id is not null) as has_variants,
      count(distinct u.unit_price) > 1 as price_from,
      bool_or(
        case
          when not u.is_tracked then true
          else u.available_quantity > 0
        end
      ) as is_available,
      bool_or(u.is_tracked) as has_tracked
    from units u
  )
  select
    current_product.id,
    current_product.name,
    current_product.description,
    s.price,
    current_product.currency,
    c.name as category_name,
    b.name as brand_name,
    case
      when not s.has_tracked then 'untracked'
      when s.is_available then 'in_stock'
      else 'out_of_stock'
    end as availability,
    coalesce(s.has_variants, false) as has_variants,
    coalesce(s.price_from, false) as price_from,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'name', v.name,
          'sku', coalesce(v.sku, current_product.sku),
          'price', coalesce(v.price_override, current_product.price),
          'isTracked', coalesce(i.is_tracked, false),
          'availableQuantity', case when coalesce(i.is_tracked, false) then i.available_quantity else null end,
          'inStock', case
            when not coalesce(i.is_tracked, false) then true
            else coalesce(i.available_quantity, 0) > 0
          end
        )
        order by v.sort_order asc, lower(v.name) asc, v.id asc
      )
      from public.product_variants v
      left join public.inventory_items i
        on i.business_id = v.business_id
       and i.product_id = v.product_id
       and i.variant_id = v.id
      where v.business_id = current_product.business_id
        and v.product_id = current_product.id
        and v.status = 'active'
    ), '[]'::jsonb) as variants,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'path', pi.storage_path,
          'alt', pi.alt_text,
          'sortOrder', pi.sort_order
        )
        order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.business_id = current_product.business_id
        and pi.product_id = current_product.id
    ), '[]'::jsonb) as images
  from summary s
  left join public.categories c
    on c.id = current_product.category_id
   and c.business_id = current_product.business_id
  left join public.brands b
    on b.id = current_product.brand_id
   and b.business_id = current_product.business_id
  where s.has_units;
end;
$$;

create or replace function public.reserve_storefront_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  item record;
  next_reserved integer;
begin
  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  for item in
    select
      oi.id,
      oi.quantity,
      oi.product_id,
      oi.variant_id,
      inv.id as inventory_item_id,
      inv.is_tracked,
      inv.physical_quantity,
      inv.reserved_quantity,
      inv.available_quantity,
      p.name as product_name,
      v.name as variant_name,
      coalesce(v.sku, p.sku) as sku
    from public.order_items oi
    join public.products p
      on p.business_id = oi.business_id
     and p.id = oi.product_id
    left join public.product_variants v
      on v.business_id = oi.business_id
     and v.product_id = oi.product_id
     and v.id = oi.variant_id
    left join public.inventory_items inv
      on inv.business_id = oi.business_id
     and inv.product_id = oi.product_id
     and inv.variant_id is not distinct from oi.variant_id
    where oi.business_id = current_order.business_id
      and oi.order_id = p_order_id
    order by oi.created_at, oi.id
    for update of inv
  loop
    if item.inventory_item_id is null or not item.is_tracked then
      continue;
    end if;

    if item.available_quantity < item.quantity then
      raise exception 'One or more items are no longer available in the requested quantity.'
        using errcode = '22023';
    end if;

    next_reserved := item.reserved_quantity + item.quantity;

    insert into public.stock_movements (
      business_id,
      inventory_item_id,
      product_id,
      variant_id,
      operation,
      quantity_change,
      previous_physical,
      new_physical,
      previous_reserved,
      new_reserved,
      reason,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      performed_by,
      performed_by_name,
      idempotency_key
    )
    values (
      current_order.business_id,
      item.inventory_item_id,
      item.product_id,
      item.variant_id,
      'reserve',
      item.quantity,
      item.physical_quantity,
      item.physical_quantity,
      item.reserved_quantity,
      next_reserved,
      'Online store order ' || current_order.order_number,
      item.product_name,
      item.variant_name,
      item.sku,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'Online storefront',
      'order:' || p_order_id::text || ':reserve:' || item.id::text
    );

    update public.inventory_items
    set reserved_quantity = next_reserved
    where id = item.inventory_item_id;

    update public.order_items
    set reserved_quantity = item.quantity
    where id = item.id;
  end loop;

  update public.orders
  set stock_state = 'reserved'
  where id = p_order_id;
end;
$$;

create or replace function public.submit_storefront_order(
  p_store_slug text,
  p_customer_name text,
  p_phone text,
  p_email text default null,
  p_address text default null,
  p_city text default null,
  p_instructions text default null,
  p_items jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns table (
  order_number text,
  status text,
  total numeric,
  currency text,
  created_at timestamptz,
  message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_name text := btrim(p_customer_name);
  normalized_phone text := btrim(p_phone);
  normalized_email text := lower(btrim(p_email));
  normalized_address text := nullif(btrim(p_address), '');
  normalized_city text := nullif(btrim(p_city), '');
  normalized_instructions text := nullif(btrim(p_instructions), '');
  normalized_key text := nullif(btrim(p_idempotency_key), '');
  store_row public.stores;
  business_row public.businesses;
  customer_id_to_link uuid;
  normalized_customer_phone text;
  delivery_notes text;
  created_order public.orders;
  item jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_quantity integer;
  item_count integer;
  variant_count integer;
  has_active_variant boolean;
  uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  request_hash text;
  existing_request public.storefront_order_requests;
  response_payload jsonb;
begin
  select s.* into store_row
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if not found then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = store_row.business_id;

  if normalized_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Enter your name.'
      using errcode = '22023';
  end if;

  if normalized_phone is null or char_length(normalized_phone) not between 7 and 32 then
    raise exception 'Enter a valid phone number.'
      using errcode = '22023';
  end if;

  if normalized_email is not null
     and (
       char_length(normalized_email) not between 3 and 254
       or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     ) then
    raise exception 'Enter a valid email address.'
      using errcode = '22023';
  end if;

  if normalized_address is not null and char_length(normalized_address) > 500 then
    raise exception 'Delivery address must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_city is not null and char_length(normalized_city) > 120 then
    raise exception 'City or location must be 120 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_instructions is not null and char_length(normalized_instructions) > 1000 then
    raise exception 'Customer instructions must be 1000 characters or fewer.'
      using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Add between 1 and 50 items to your order.'
      using errcode = '22023';
  end if;

  if normalized_key is not null and char_length(normalized_key) > 128 then
    raise exception 'The checkout request is too large.'
      using errcode = '22023';
  end if;

  request_hash := md5(
    concat_ws(
      '|',
      normalized_name,
      normalized_phone,
      coalesce(normalized_email, ''),
      coalesce(normalized_address, ''),
      coalesce(normalized_city, ''),
      coalesce(normalized_instructions, ''),
      p_items::text
    )
  );

  if normalized_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        store_row.business_id::text || ':storefront-order:' || normalized_key,
        0
      )
    );

    select * into existing_request
    from public.storefront_order_requests sr
    where sr.business_id = store_row.business_id
      and sr.idempotency_key = normalized_key;

    if found then
      if existing_request.request_hash <> request_hash then
        raise exception 'This checkout request was already used for different details.'
          using errcode = '23505';
      end if;

      order_number := existing_request.response ->> 'orderNumber';
      status := existing_request.response ->> 'status';
      total := (existing_request.response ->> 'total')::numeric;
      currency := existing_request.response ->> 'currency';
      created_at := (existing_request.response ->> 'createdAt')::timestamptz;
      message := existing_request.response ->> 'message';
      return next;
      return;
    end if;
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'Each order item must be an object.'
        using errcode = '22023';
    end if;

    if nullif(btrim(item ->> 'unit_price'), '') is not null
       or nullif(btrim(item ->> 'unitPrice'), '') is not null
       or nullif(btrim(item ->> 'line_total'), '') is not null
       or nullif(btrim(item ->> 'price'), '') is not null then
      raise exception 'Prices are calculated from the store catalogue.'
        using errcode = '22023';
    end if;

    if coalesce(item ->> 'product_id', '') !~ uuid_pattern then
      raise exception 'Select a valid product.'
        using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(item ->> 'variant_id', '')), '') is not null
       and btrim(item ->> 'variant_id') !~ uuid_pattern then
      raise exception 'Select a valid product variant.'
        using errcode = '22023';
    end if;

    item_product_id := (item ->> 'product_id')::uuid;
    item_variant_id := nullif(btrim(coalesce(item ->> 'variant_id', '')), '')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    if item_quantity is null or item_quantity < 1 or item_quantity > 100 then
      raise exception 'Each item quantity must be between 1 and 100.'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.products p
      where p.id = item_product_id
        and p.business_id = store_row.business_id
        and p.status = 'active'
        and p.storefront_visible
    ) then
      raise exception 'One or more products are no longer available.'
        using errcode = '22023';
    end if;

    select count(*) into variant_count
    from public.product_variants v
    where v.business_id = store_row.business_id
      and v.product_id = item_product_id
      and v.status = 'active';

    has_active_variant := variant_count > 0;

    if has_active_variant and item_variant_id is null then
      raise exception 'Choose a variant for this product.'
        using errcode = '22023';
    end if;

    if not has_active_variant and item_variant_id is not null then
      raise exception 'This product does not have selectable variants.'
        using errcode = '22023';
    end if;

    if item_variant_id is not null
       and not exists (
         select 1
         from public.product_variants v
         where v.id = item_variant_id
           and v.business_id = store_row.business_id
           and v.product_id = item_product_id
           and v.status = 'active'
       ) then
      raise exception 'One or more product variants are no longer available.'
        using errcode = '22023';
    end if;
  end loop;

  customer_id_to_link := null;

  if normalized_email is not null and normalized_phone is not null then
    normalized_customer_phone := public.normalize_customer_phone_digits(
      normalized_phone,
      business_row.country
    );

    if normalized_customer_phone is not null then
      select c.id into customer_id_to_link
      from public.customers c
      where c.business_id = store_row.business_id
        and lower(btrim(c.email)) = normalized_email
        and c.phone_normalized = normalized_customer_phone
      limit 1;
    end if;
  end if;

  delivery_notes := 'Online store order.';

  if normalized_address is not null then
    delivery_notes := delivery_notes || E'\nDelivery address: ' || normalized_address;
  end if;

  if normalized_city is not null then
    delivery_notes := delivery_notes || E'\nCity or location: ' || normalized_city;
  end if;

  if normalized_instructions is not null then
    delivery_notes := delivery_notes || E'\nCustomer instructions: ' || normalized_instructions;
  end if;

  if char_length(delivery_notes) > 2000 then
    raise exception 'The delivery details are too long.'
      using errcode = '22023';
  end if;

  insert into public.orders (
    business_id,
    order_number,
    customer_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    customer_email_snapshot,
    status,
    currency,
    notes,
    created_by,
    updated_by
  )
  values (
    store_row.business_id,
    public.next_order_number(store_row.business_id),
    customer_id_to_link,
    normalized_name,
    normalized_phone,
    normalized_email,
    'awaiting_business_approval',
    business_row.currency,
    delivery_notes,
    null,
    null
  )
  returning * into created_order;

  for item in select * from jsonb_array_elements(p_items)
  loop
    perform public.create_order_item_record(
      store_row.business_id,
      created_order.id,
      (item ->> 'product_id')::uuid,
      nullif(btrim(coalesce(item ->> 'variant_id', '')), '')::uuid,
      (item ->> 'quantity')::integer
    );
  end loop;

  perform public.reserve_storefront_order_stock(created_order.id);

  select * into created_order
  from public.orders
  where id = created_order.id;

  select count(*) into item_count
  from public.order_items oi
  where oi.business_id = store_row.business_id
    and oi.order_id = created_order.id;

  insert into public.order_events (
    business_id,
    order_id,
    event_type,
    summary,
    details,
    actor_id,
    actor_name
  )
  values (
    store_row.business_id,
    created_order.id,
    'customer_confirmed',
    'Online store checkout submitted. Awaiting business approval.',
    jsonb_build_object(
      'source', 'online_store',
      'storeSlug', store_row.slug,
      'itemCount', item_count,
      'total', created_order.total,
      'currency', created_order.currency
    ),
    null,
    'Online storefront'
  );

  order_number := created_order.order_number;
  status := created_order.status;
  total := created_order.total;
  currency := created_order.currency;
  created_at := created_order.created_at;
  message := 'Your order has been received. The business will review it shortly.';

  response_payload := jsonb_build_object(
    'orderNumber', order_number,
    'status', status,
    'total', total,
    'currency', currency,
    'createdAt', created_at,
    'message', message
  );

  if normalized_key is not null then
    insert into public.storefront_order_requests (
      business_id,
      idempotency_key,
      request_hash,
      response
    )
    values (
      store_row.business_id,
      normalized_key,
      request_hash,
      response_payload
    );
  end if;

  return next;
end;
$$;

revoke all on public.stores from anon, authenticated;
revoke all on public.storefront_order_requests from anon, authenticated;
grant select on public.stores to authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.validate_store_logo_path() from public, anon, authenticated;
revoke all on function public.unique_store_slug(text, uuid) from public, anon, authenticated;
revoke all on function public.auto_create_business_store() from public, anon, authenticated;
revoke all on function public.is_public_product_image(text) from public;
revoke all on function public.is_public_store_logo(text) from public;

revoke all on function public.get_store_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_public_store(text) from public, anon, authenticated;
revoke all on function public.update_store_profile(
  uuid, text, text, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.set_storefront_product_visibility(uuid, boolean)
from public, anon, authenticated;
revoke all on function public.search_storefront_management_products(
  uuid, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.list_storefront_categories(text)
from public, anon, authenticated;
revoke all on function public.search_storefront_products(
  text, text, uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_storefront_product(text, uuid)
from public, anon, authenticated;
revoke all on function public.reserve_storefront_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.submit_storefront_order(
  text, text, text, text, text, text, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.is_public_product_image(text) to anon, authenticated, service_role;
grant execute on function public.is_public_store_logo(text) to anon, authenticated, service_role;

grant execute on function public.get_store_profile(uuid) to authenticated, service_role;
grant execute on function public.update_store_profile(
  uuid, text, text, text, text, text, text, text, boolean, text, text
) to authenticated, service_role;
grant execute on function public.set_storefront_product_visibility(uuid, boolean)
to authenticated, service_role;
grant execute on function public.search_storefront_management_products(
  uuid, text, text, integer, integer
) to authenticated, service_role;

grant execute on function public.get_public_store(text) to anon, authenticated, service_role;
grant execute on function public.list_storefront_categories(text)
to anon, authenticated, service_role;
grant execute on function public.search_storefront_products(
  text, text, uuid, text, integer, integer
) to anon, authenticated, service_role;
grant execute on function public.get_storefront_product(text, uuid)
to anon, authenticated, service_role;
grant execute on function public.submit_storefront_order(
  text, text, text, text, text, text, text, jsonb, text
) to anon, authenticated, service_role;
