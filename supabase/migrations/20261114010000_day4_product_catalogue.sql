-- Day 4: product catalogue, taxonomy, variants, attributes and product images.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  parent_id uuid,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_business_id_id_key unique (business_id, id),
  constraint categories_parent_fk foreign key (business_id, parent_id)
    references public.categories(business_id, id) on delete restrict,
  constraint categories_name_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint categories_description_check check (
    description is null or char_length(description) <= 1000
  ),
  constraint categories_sort_order_check check (
    sort_order between 0 and 1000000
  ),
  constraint categories_no_self_parent_check check (
    parent_id is null or parent_id <> id
  )
);

create unique index categories_business_name_key
on public.categories (business_id, lower(btrim(name)));

create index categories_business_parent_idx
on public.categories (business_id, parent_id);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_business_id_id_key unique (business_id, id),
  constraint brands_name_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint brands_description_check check (
    description is null or char_length(description) <= 1000
  )
);

create unique index brands_business_name_key
on public.brands (business_id, lower(btrim(name)));

create index brands_business_idx
on public.brands (business_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid,
  brand_id uuid,
  name text not null,
  description text,
  status text not null default 'draft',
  sku text,
  barcode text,
  price numeric(14, 2) not null default 0,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_business_id_id_key unique (business_id, id),
  constraint products_category_fk foreign key (business_id, category_id)
    references public.categories(business_id, id) on delete restrict,
  constraint products_brand_fk foreign key (business_id, brand_id)
    references public.brands(business_id, id) on delete restrict,
  constraint products_name_check check (
    char_length(btrim(name)) between 1 and 200
  ),
  constraint products_description_check check (
    description is null or char_length(description) <= 5000
  ),
  constraint products_status_check check (
    status in ('draft', 'active', 'archived')
  ),
  constraint products_sku_check check (
    sku is null or char_length(btrim(sku)) between 1 and 80
  ),
  constraint products_barcode_check check (
    barcode is null or char_length(btrim(barcode)) between 1 and 80
  ),
  constraint products_price_check check (price >= 0),
  constraint products_currency_check check (currency ~ '^[A-Z]{3}$')
);

create unique index products_business_sku_key
on public.products (business_id, upper(btrim(sku)))
where sku is not null;

create unique index products_business_barcode_key
on public.products (business_id, upper(btrim(barcode)))
where barcode is not null;

create index products_business_updated_idx
on public.products (business_id, updated_at desc);

create index products_business_status_idx
on public.products (business_id, status);

create index products_business_category_idx
on public.products (business_id, category_id);

create index products_business_brand_idx
on public.products (business_id, brand_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  name text not null,
  sku text,
  barcode text,
  price_override numeric(14, 2),
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_business_id_id_key unique (business_id, id),
  constraint product_variants_business_product_id_key
    unique (business_id, product_id, id),
  constraint product_variants_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id) on delete cascade,
  constraint product_variants_name_check check (
    char_length(btrim(name)) between 1 and 160
  ),
  constraint product_variants_sku_check check (
    sku is null or char_length(btrim(sku)) between 1 and 80
  ),
  constraint product_variants_barcode_check check (
    barcode is null or char_length(btrim(barcode)) between 1 and 80
  ),
  constraint product_variants_price_check check (
    price_override is null or price_override >= 0
  ),
  constraint product_variants_status_check check (
    status in ('active', 'inactive')
  ),
  constraint product_variants_sort_order_check check (
    sort_order between 0 and 1000000
  )
);

create unique index product_variants_business_sku_key
on public.product_variants (business_id, upper(btrim(sku)))
where sku is not null;

create unique index product_variants_business_barcode_key
on public.product_variants (business_id, upper(btrim(barcode)))
where barcode is not null;

create index product_variants_product_idx
on public.product_variants (business_id, product_id, sort_order);

create table public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  data_type text not null default 'text',
  is_variant_attribute boolean not null default false,
  is_required boolean not null default false,
  unit text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_attributes_business_id_id_key unique (business_id, id),
  constraint product_attributes_name_check check (
    char_length(btrim(name)) between 1 and 80
  ),
  constraint product_attributes_data_type_check check (
    data_type in ('text', 'number', 'boolean', 'select')
  ),
  constraint product_attributes_unit_check check (
    unit is null or char_length(btrim(unit)) between 1 and 40
  ),
  constraint product_attributes_sort_order_check check (
    sort_order between 0 and 1000000
  )
);

create unique index product_attributes_business_name_key
on public.product_attributes (business_id, lower(btrim(name)));

create index product_attributes_business_sort_idx
on public.product_attributes (business_id, sort_order, name);

create table public.product_attribute_options (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  attribute_id uuid not null,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint product_attribute_options_business_id_id_key
    unique (business_id, id),
  constraint product_attribute_options_business_attribute_id_key
    unique (business_id, attribute_id, id),
  constraint product_attribute_options_attribute_fk
    foreign key (business_id, attribute_id)
    references public.product_attributes(business_id, id) on delete cascade,
  constraint product_attribute_options_value_check check (
    char_length(btrim(value)) between 1 and 120
  ),
  constraint product_attribute_options_sort_order_check check (
    sort_order between 0 and 1000000
  )
);

create unique index product_attribute_options_value_key
on public.product_attribute_options (
  business_id,
  attribute_id,
  lower(btrim(value))
);

create index product_attribute_options_attribute_idx
on public.product_attribute_options (business_id, attribute_id, sort_order);

create table public.product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid,
  attribute_id uuid not null,
  option_id uuid,
  value_text text,
  value_number numeric(14, 4),
  value_boolean boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_attribute_values_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id) on delete cascade,
  constraint product_attribute_values_variant_fk
    foreign key (business_id, product_id, variant_id)
    references public.product_variants(business_id, product_id, id)
    on delete cascade,
  constraint product_attribute_values_attribute_fk
    foreign key (business_id, attribute_id)
    references public.product_attributes(business_id, id) on delete restrict,
  constraint product_attribute_values_option_fk
    foreign key (business_id, attribute_id, option_id)
    references public.product_attribute_options(business_id, attribute_id, id)
    on delete restrict,
  constraint product_attribute_values_text_check check (
    value_text is null or char_length(value_text) <= 500
  )
);

create unique index product_attribute_values_product_key
on public.product_attribute_values (business_id, product_id, attribute_id)
where variant_id is null;

create unique index product_attribute_values_variant_key
on public.product_attribute_values (business_id, variant_id, attribute_id)
where variant_id is not null;

create index product_attribute_values_product_idx
on public.product_attribute_values (business_id, product_id);

create index product_attribute_values_attribute_idx
on public.product_attribute_values (business_id, attribute_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint product_images_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id) on delete cascade,
  constraint product_images_storage_path_key unique (storage_path),
  constraint product_images_storage_path_check check (
    char_length(storage_path) between 3 and 500
  ),
  constraint product_images_alt_text_check check (
    alt_text is null or char_length(alt_text) <= 300
  ),
  constraint product_images_sort_order_check check (
    sort_order between 0 and 1000000
  )
);

create index product_images_product_idx
on public.product_images (business_id, product_id, sort_order);

create unique index product_images_primary_key
on public.product_images (business_id, product_id)
where is_primary;

create or replace function public.prevent_catalogue_business_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'Catalogue records cannot be moved between businesses.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.validate_category_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_business_id uuid;
  ancestor_id uuid;
  depth integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A category cannot be its own parent.'
      using errcode = '22023';
  end if;

  select business_id into parent_business_id
  from public.categories
  where id = new.parent_id;

  if parent_business_id is null or parent_business_id <> new.business_id then
    raise exception 'The parent category must belong to the same business.'
      using errcode = '22023';
  end if;

  ancestor_id := new.parent_id;

  while ancestor_id is not null loop
    if ancestor_id = new.id then
      raise exception 'Category hierarchy cannot contain a cycle.'
        using errcode = '22023';
    end if;

    select parent_id into ancestor_id
    from public.categories
    where id = ancestor_id;

    depth := depth + 1;

    if depth > 100 then
      raise exception 'Category hierarchy is too deep.'
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.set_product_currency()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  business_currency text;
begin
  select currency into business_currency
  from public.businesses
  where id = new.business_id;

  if business_currency is null then
    raise exception 'The product business does not exist.'
      using errcode = '23503';
  end if;

  if new.currency is null then
    new.currency := business_currency;
  elsif new.currency <> business_currency then
    raise exception 'Product currency must match the business currency.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_catalogue_code_uniqueness()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  normalized_sku text := nullif(upper(btrim(new.sku)), '');
  normalized_barcode text := nullif(upper(btrim(new.barcode)), '');
  duplicate_found boolean := false;
begin
  if normalized_sku is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.business_id::text || ':sku:' || normalized_sku, 0)
    );

    if tg_table_name = 'products' then
      select exists (
        select 1 from public.products p
        where p.business_id = new.business_id
          and p.id <> new.id
          and upper(btrim(p.sku)) = normalized_sku
      ) or exists (
        select 1 from public.product_variants v
        where v.business_id = new.business_id
          and upper(btrim(v.sku)) = normalized_sku
      ) into duplicate_found;
    else
      select exists (
        select 1 from public.products p
        where p.business_id = new.business_id
          and upper(btrim(p.sku)) = normalized_sku
      ) or exists (
        select 1 from public.product_variants v
        where v.business_id = new.business_id
          and v.id <> new.id
          and upper(btrim(v.sku)) = normalized_sku
      ) into duplicate_found;
    end if;

    if duplicate_found then
      raise exception 'That SKU is already used in this business.'
        using errcode = '23505';
    end if;
  end if;

  if normalized_barcode is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.business_id::text || ':barcode:' || normalized_barcode, 0)
    );

    if tg_table_name = 'products' then
      select exists (
        select 1 from public.products p
        where p.business_id = new.business_id
          and p.id <> new.id
          and upper(btrim(p.barcode)) = normalized_barcode
      ) or exists (
        select 1 from public.product_variants v
        where v.business_id = new.business_id
          and upper(btrim(v.barcode)) = normalized_barcode
      ) into duplicate_found;
    else
      select exists (
        select 1 from public.products p
        where p.business_id = new.business_id
          and upper(btrim(p.barcode)) = normalized_barcode
      ) or exists (
        select 1 from public.product_variants v
        where v.business_id = new.business_id
          and v.id <> new.id
          and upper(btrim(v.barcode)) = normalized_barcode
      ) into duplicate_found;
    end if;

    if duplicate_found then
      raise exception 'That barcode is already used in this business.'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_attribute_value()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  attribute_record public.product_attributes;
  variant_product_id uuid;
begin
  select * into attribute_record
  from public.product_attributes
  where id = new.attribute_id
    and business_id = new.business_id;

  if not found then
    raise exception 'The product attribute does not belong to this business.'
      using errcode = '23503';
  end if;

  if attribute_record.is_variant_attribute and new.variant_id is null then
    raise exception 'This attribute must be assigned to a variant.'
      using errcode = '22023';
  end if;

  if not attribute_record.is_variant_attribute and new.variant_id is not null then
    raise exception 'This product-level attribute cannot be assigned to a variant.'
      using errcode = '22023';
  end if;

  if new.variant_id is not null then
    select product_id into variant_product_id
    from public.product_variants
    where id = new.variant_id
      and business_id = new.business_id;

    if variant_product_id is null or variant_product_id <> new.product_id then
      raise exception 'The variant does not belong to this product.'
        using errcode = '22023';
    end if;
  end if;

  if attribute_record.data_type = 'select' then
    if new.option_id is null
       or new.value_text is not null
       or new.value_number is not null
       or new.value_boolean is not null then
      raise exception 'Select attributes require an option and no free-form value.'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.product_attribute_options o
      where o.id = new.option_id
        and o.attribute_id = new.attribute_id
        and o.business_id = new.business_id
    ) then
      raise exception 'The selected option does not belong to this attribute.'
        using errcode = '22023';
    end if;
  elsif attribute_record.data_type = 'text' then
    if new.option_id is not null
       or nullif(btrim(new.value_text), '') is null
       or new.value_number is not null
       or new.value_boolean is not null then
      raise exception 'Text attributes require a text value only.'
        using errcode = '22023';
    end if;
  elsif attribute_record.data_type = 'number' then
    if new.option_id is not null
       or new.value_text is not null
       or new.value_number is null
       or new.value_boolean is not null then
      raise exception 'Number attributes require a numeric value only.'
        using errcode = '22023';
    end if;
  elsif attribute_record.data_type = 'boolean' then
    if new.option_id is not null
       or new.value_text is not null
       or new.value_number is not null
       or new.value_boolean is null then
      raise exception 'Boolean attributes require a true or false value only.'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_image_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  expected_prefix text;
begin
  expected_prefix := new.business_id::text || '/' || new.product_id::text || '/';

  if new.storage_path !~ (
    '^' || new.business_id::text || '/' || new.product_id::text
    || '/[A-Za-z0-9._-]+$'
  ) then
    raise exception 'Product image paths must use business/product/file format.'
      using errcode = '22023';
  end if;

  if position('..' in new.storage_path) > 0 then
    raise exception 'Product image paths cannot contain traversal segments.'
      using errcode = '22023';
  end if;

  if left(new.storage_path, char_length(expected_prefix)) <> expected_prefix then
    raise exception 'Product image path does not match the product.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

create trigger product_attributes_set_updated_at
before update on public.product_attributes
for each row execute function public.set_updated_at();

create trigger product_attribute_values_set_updated_at
before update on public.product_attribute_values
for each row execute function public.set_updated_at();

create trigger categories_prevent_business_change
before update on public.categories
for each row execute function public.prevent_catalogue_business_change();

create trigger brands_prevent_business_change
before update on public.brands
for each row execute function public.prevent_catalogue_business_change();

create trigger products_prevent_business_change
before update on public.products
for each row execute function public.prevent_catalogue_business_change();

create trigger product_variants_prevent_business_change
before update on public.product_variants
for each row execute function public.prevent_catalogue_business_change();

create trigger product_attributes_prevent_business_change
before update on public.product_attributes
for each row execute function public.prevent_catalogue_business_change();

create trigger product_attribute_options_prevent_business_change
before update on public.product_attribute_options
for each row execute function public.prevent_catalogue_business_change();

create trigger product_attribute_values_prevent_business_change
before update on public.product_attribute_values
for each row execute function public.prevent_catalogue_business_change();

create trigger product_images_prevent_business_change
before update on public.product_images
for each row execute function public.prevent_catalogue_business_change();

create trigger categories_validate_parent
before insert or update of parent_id, business_id on public.categories
for each row execute function public.validate_category_parent();

create trigger products_set_currency
before insert or update of business_id, currency on public.products
for each row execute function public.set_product_currency();

create trigger products_enforce_codes
before insert or update of sku, barcode on public.products
for each row execute function public.enforce_catalogue_code_uniqueness();

create trigger product_variants_enforce_codes
before insert or update of sku, barcode on public.product_variants
for each row execute function public.enforce_catalogue_code_uniqueness();

create trigger product_attribute_values_validate
before insert or update on public.product_attribute_values
for each row execute function public.validate_product_attribute_value();

create trigger product_images_validate_path
before insert or update of business_id, product_id, storage_path on public.product_images
for each row execute function public.validate_product_image_path();

alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_attributes enable row level security;
alter table public.product_attribute_options enable row level security;
alter table public.product_attribute_values enable row level security;
alter table public.product_images enable row level security;

create policy categories_select_members
on public.categories
for select
to authenticated
using (public.is_business_member(business_id));

create policy categories_insert_managers
on public.categories
for insert
to authenticated
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy categories_update_managers
on public.categories
for update
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
)
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy categories_delete_managers
on public.categories
for delete
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy brands_select_members
on public.brands
for select
to authenticated
using (public.is_business_member(business_id));

create policy brands_insert_managers
on public.brands
for insert
to authenticated
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy brands_update_managers
on public.brands
for update
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
)
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy brands_delete_managers
on public.brands
for delete
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attributes_select_members
on public.product_attributes
for select
to authenticated
using (public.is_business_member(business_id));

create policy product_attributes_insert_managers
on public.product_attributes
for insert
to authenticated
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attributes_update_managers
on public.product_attributes
for update
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
)
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attributes_delete_managers
on public.product_attributes
for delete
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attribute_options_select_members
on public.product_attribute_options
for select
to authenticated
using (public.is_business_member(business_id));

create policy product_attribute_options_insert_managers
on public.product_attribute_options
for insert
to authenticated
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attribute_options_update_managers
on public.product_attribute_options
for update
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
)
with check (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy product_attribute_options_delete_managers
on public.product_attribute_options
for delete
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'admin', 'manager'])
);

create policy products_select_members
on public.products
for select
to authenticated
using (public.is_business_member(business_id));

create policy products_insert_members
on public.products
for insert
to authenticated
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy products_update_members
on public.products
for update
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
)
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_variants_select_members
on public.product_variants
for select
to authenticated
using (public.is_business_member(business_id));

create policy product_variants_insert_members
on public.product_variants
for insert
to authenticated
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_variants_update_members
on public.product_variants
for update
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
)
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_attribute_values_select_members
on public.product_attribute_values
for select
to authenticated
using (public.is_business_member(business_id));

create policy product_attribute_values_insert_members
on public.product_attribute_values
for insert
to authenticated
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_attribute_values_update_members
on public.product_attribute_values
for update
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
)
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_attribute_values_delete_members
on public.product_attribute_values
for delete
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_images_select_members
on public.product_images
for select
to authenticated
using (public.is_business_member(business_id));

create policy product_images_insert_members
on public.product_images
for insert
to authenticated
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_images_update_members
on public.product_images
for update
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
)
with check (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create policy product_images_delete_members
on public.product_images
for delete
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_business_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

create policy product_images_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
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

create policy product_images_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.has_business_role(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end,
    array['owner', 'admin', 'manager', 'staff']
  )
)
with check (
  bucket_id = 'product-images'
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

create policy product_images_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
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

revoke all on public.categories from anon, authenticated;
revoke all on public.brands from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_variants from anon, authenticated;
revoke all on public.product_attributes from anon, authenticated;
revoke all on public.product_attribute_options from anon, authenticated;
revoke all on public.product_attribute_values from anon, authenticated;
revoke all on public.product_images from anon, authenticated;

grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.brands to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.product_variants to authenticated;
grant select, insert, update, delete on public.product_attributes to authenticated;
grant select, insert, update, delete on public.product_attribute_options to authenticated;
grant select, insert, update, delete on public.product_attribute_values to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;

revoke all on function public.prevent_catalogue_business_change()
from public, anon, authenticated;
revoke all on function public.validate_category_parent()
from public, anon, authenticated;
revoke all on function public.set_product_currency()
from public, anon, authenticated;
revoke all on function public.enforce_catalogue_code_uniqueness()
from public, anon, authenticated;
revoke all on function public.validate_product_attribute_value()
from public, anon, authenticated;
revoke all on function public.validate_product_image_path()
from public, anon, authenticated;

create or replace function public.create_product(
  p_business_id uuid,
  p_name text,
  p_description text default null,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_sku text default null,
  p_barcode text default null,
  p_price numeric default 0,
  p_status text default 'draft',
  p_attributes jsonb default '[]'::jsonb,
  p_variants jsonb default '[]'::jsonb
)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created_product public.products;
  created_variant public.product_variants;
  attribute_item jsonb;
  variant_item jsonb;
  normalized_name text := nullif(btrim(p_name), '');
  normalized_status text := coalesce(nullif(btrim(p_status), ''), 'draft');
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 200 then
    raise exception 'Product name must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'Product price cannot be negative.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Product status is not valid.'
      using errcode = '22023';
  end if;

  insert into public.products (
    business_id,
    category_id,
    brand_id,
    name,
    description,
    status,
    sku,
    barcode,
    price
  )
  values (
    p_business_id,
    p_category_id,
    p_brand_id,
    normalized_name,
    nullif(btrim(p_description), ''),
    normalized_status,
    nullif(upper(btrim(p_sku)), ''),
    nullif(upper(btrim(p_barcode)), ''),
    p_price
  )
  returning * into created_product;

  for attribute_item in
    select value from jsonb_array_elements(coalesce(p_attributes, '[]'::jsonb))
  loop
    insert into public.product_attribute_values (
      business_id,
      product_id,
      variant_id,
      attribute_id,
      option_id,
      value_text,
      value_number,
      value_boolean
    )
    values (
      p_business_id,
      created_product.id,
      null,
      (attribute_item ->> 'attribute_id')::uuid,
      nullif(attribute_item ->> 'option_id', '')::uuid,
      nullif(attribute_item ->> 'value_text', ''),
      nullif(attribute_item ->> 'value_number', '')::numeric,
      case
        when attribute_item ? 'value_boolean'
          and attribute_item ->> 'value_boolean' <> ''
        then (attribute_item ->> 'value_boolean')::boolean
        else null
      end
    );
  end loop;

  for variant_item in
    select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
  loop
    insert into public.product_variants (
      business_id,
      product_id,
      name,
      sku,
      barcode,
      price_override,
      status,
      sort_order
    )
    values (
      p_business_id,
      created_product.id,
      btrim(variant_item ->> 'name'),
      nullif(upper(btrim(variant_item ->> 'sku')), ''),
      nullif(upper(btrim(variant_item ->> 'barcode')), ''),
      nullif(variant_item ->> 'price_override', '')::numeric,
      coalesce(nullif(btrim(variant_item ->> 'status'), ''), 'active'),
      coalesce((variant_item ->> 'sort_order')::integer, 0)
    )
    returning * into created_variant;

    for attribute_item in
      select value
      from jsonb_array_elements(
        coalesce(variant_item -> 'attributes', '[]'::jsonb)
      )
    loop
      insert into public.product_attribute_values (
        business_id,
        product_id,
        variant_id,
        attribute_id,
        option_id,
        value_text,
        value_number,
        value_boolean
      )
      values (
        p_business_id,
        created_product.id,
        created_variant.id,
        (attribute_item ->> 'attribute_id')::uuid,
        nullif(attribute_item ->> 'option_id', '')::uuid,
        nullif(attribute_item ->> 'value_text', ''),
        nullif(attribute_item ->> 'value_number', '')::numeric,
        case
          when attribute_item ? 'value_boolean'
            and attribute_item ->> 'value_boolean' <> ''
          then (attribute_item ->> 'value_boolean')::boolean
          else null
        end
      );
    end loop;
  end loop;

  return created_product;
end;
$$;

create or replace function public.update_product(
  p_product_id uuid,
  p_name text,
  p_description text default null,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_sku text default null,
  p_barcode text default null,
  p_price numeric default 0,
  p_status text default 'draft',
  p_attributes jsonb default '[]'::jsonb,
  p_variants jsonb default '[]'::jsonb
)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_product public.products;
  current_variant public.product_variants;
  attribute_item jsonb;
  variant_item jsonb;
  variant_id uuid;
  variant_ids uuid[] := '{}';
  normalized_name text := nullif(btrim(p_name), '');
  normalized_status text := coalesce(nullif(btrim(p_status), ''), 'draft');
begin
  select * into current_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 200 then
    raise exception 'Product name must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'Product price cannot be negative.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Product status is not valid.'
      using errcode = '22023';
  end if;

  update public.products
  set
    category_id = p_category_id,
    brand_id = p_brand_id,
    name = normalized_name,
    description = nullif(btrim(p_description), ''),
    status = normalized_status,
    sku = nullif(upper(btrim(p_sku)), ''),
    barcode = nullif(upper(btrim(p_barcode)), ''),
    price = p_price
  where id = p_product_id
  returning * into current_product;

  delete from public.product_attribute_values
  where business_id = current_product.business_id
    and product_id = current_product.id
    and variant_id is null;

  for attribute_item in
    select value from jsonb_array_elements(coalesce(p_attributes, '[]'::jsonb))
  loop
    insert into public.product_attribute_values (
      business_id,
      product_id,
      variant_id,
      attribute_id,
      option_id,
      value_text,
      value_number,
      value_boolean
    )
    values (
      current_product.business_id,
      current_product.id,
      null,
      (attribute_item ->> 'attribute_id')::uuid,
      nullif(attribute_item ->> 'option_id', '')::uuid,
      nullif(attribute_item ->> 'value_text', ''),
      nullif(attribute_item ->> 'value_number', '')::numeric,
      case
        when attribute_item ? 'value_boolean'
          and attribute_item ->> 'value_boolean' <> ''
        then (attribute_item ->> 'value_boolean')::boolean
        else null
      end
    );
  end loop;

  for variant_item in
    select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
  loop
    variant_id := nullif(variant_item ->> 'id', '')::uuid;

    if variant_id is not null then
      select * into current_variant
      from public.product_variants
      where id = variant_id
        and business_id = current_product.business_id
        and product_id = current_product.id
      for update;

      if not found then
        raise exception 'Variant not found for this product.'
          using errcode = '42501';
      end if;

      update public.product_variants
      set
        name = btrim(variant_item ->> 'name'),
        sku = nullif(upper(btrim(variant_item ->> 'sku')), ''),
        barcode = nullif(upper(btrim(variant_item ->> 'barcode')), ''),
        price_override = nullif(variant_item ->> 'price_override', '')::numeric,
        status = coalesce(nullif(btrim(variant_item ->> 'status'), ''), 'active'),
        sort_order = coalesce((variant_item ->> 'sort_order')::integer, 0)
      where id = variant_id
      returning * into current_variant;
    else
      insert into public.product_variants (
        business_id,
        product_id,
        name,
        sku,
        barcode,
        price_override,
        status,
        sort_order
      )
      values (
        current_product.business_id,
        current_product.id,
        btrim(variant_item ->> 'name'),
        nullif(upper(btrim(variant_item ->> 'sku')), ''),
        nullif(upper(btrim(variant_item ->> 'barcode')), ''),
        nullif(variant_item ->> 'price_override', '')::numeric,
        coalesce(nullif(btrim(variant_item ->> 'status'), ''), 'active'),
        coalesce((variant_item ->> 'sort_order')::integer, 0)
      )
      returning * into current_variant;

      variant_id := current_variant.id;
    end if;

    variant_ids := array_append(variant_ids, variant_id);

    delete from public.product_attribute_values
    where business_id = current_product.business_id
      and product_id = current_product.id
      and variant_id = variant_id;

    for attribute_item in
      select value
      from jsonb_array_elements(
        coalesce(variant_item -> 'attributes', '[]'::jsonb)
      )
    loop
      insert into public.product_attribute_values (
        business_id,
        product_id,
        variant_id,
        attribute_id,
        option_id,
        value_text,
        value_number,
        value_boolean
      )
      values (
        current_product.business_id,
        current_product.id,
        variant_id,
        (attribute_item ->> 'attribute_id')::uuid,
        nullif(attribute_item ->> 'option_id', '')::uuid,
        nullif(attribute_item ->> 'value_text', ''),
        nullif(attribute_item ->> 'value_number', '')::numeric,
        case
          when attribute_item ? 'value_boolean'
            and attribute_item ->> 'value_boolean' <> ''
          then (attribute_item ->> 'value_boolean')::boolean
          else null
        end
      );
    end loop;
  end loop;

  update public.product_variants
  set status = 'inactive'
  where business_id = current_product.business_id
    and product_id = current_product.id
    and status = 'active'
    and not (id = any(variant_ids));

  return current_product;
end;
$$;

create or replace function public.create_product_attribute(
  p_business_id uuid,
  p_name text,
  p_data_type text,
  p_is_variant_attribute boolean default false,
  p_unit text default null,
  p_options jsonb default '[]'::jsonb
)
returns public.product_attributes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created_attribute public.product_attributes;
  normalized_name text := nullif(btrim(p_name), '');
  normalized_type text := coalesce(nullif(btrim(p_data_type), ''), 'text');
  option_value text;
  option_index integer := 0;
begin
  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to manage product attributes.'
      using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 80 then
    raise exception 'Attribute name must be between 1 and 80 characters.'
      using errcode = '22023';
  end if;

  if normalized_type not in ('text', 'number', 'boolean', 'select') then
    raise exception 'Attribute type is not valid.'
      using errcode = '22023';
  end if;

  if normalized_type = 'select'
     and coalesce(jsonb_array_length(p_options), 0) = 0 then
    raise exception 'Select attributes require at least one option.'
      using errcode = '22023';
  end if;

  if normalized_type <> 'select'
     and coalesce(jsonb_array_length(p_options), 0) > 0 then
    raise exception 'Only select attributes can have options.'
      using errcode = '22023';
  end if;

  insert into public.product_attributes (
    business_id,
    name,
    data_type,
    is_variant_attribute,
    unit
  )
  values (
    p_business_id,
    normalized_name,
    normalized_type,
    coalesce(p_is_variant_attribute, false),
    nullif(btrim(p_unit), '')
  )
  returning * into created_attribute;

  for option_value in
    select value from jsonb_array_elements_text(coalesce(p_options, '[]'::jsonb))
  loop
    if btrim(option_value) <> '' then
      insert into public.product_attribute_options (
        business_id,
        attribute_id,
        value,
        sort_order
      )
      values (
        p_business_id,
        created_attribute.id,
        btrim(option_value),
        option_index
      );

      option_index := option_index + 1;
    end if;
  end loop;

  return created_attribute;
end;
$$;

create or replace function public.search_products(
  p_business_id uuid,
  p_search text default null,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  category_id uuid,
  brand_id uuid,
  name text,
  description text,
  status text,
  sku text,
  barcode text,
  price numeric,
  currency text,
  category_name text,
  brand_name text,
  variant_count bigint,
  primary_image_path text,
  primary_image_alt text,
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
    p.business_id,
    p.category_id,
    p.brand_id,
    p.name,
    p.description,
    p.status,
    p.sku,
    p.barcode,
    p.price,
    p.currency,
    c.name as category_name,
    b.name as brand_name,
    coalesce(vc.variant_count, 0)::bigint as variant_count,
    img.primary_image_path,
    img.primary_image_alt,
    p.created_at,
    p.updated_at,
    count(*) over ()::bigint as total_count
  from public.products p
  left join public.categories c
    on c.id = p.category_id
    and c.business_id = p.business_id
  left join public.brands b
    on b.id = p.brand_id
    and b.business_id = p.business_id
  left join lateral (
    select count(*)::bigint as variant_count
    from public.product_variants v
    where v.business_id = p.business_id
      and v.product_id = p.id
      and v.status = 'active'
  ) vc on true
  left join lateral (
    select pi.storage_path as primary_image_path,
      pi.alt_text as primary_image_alt
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
      or coalesce(p.barcode, '') ilike '%' || normalized_search || '%'
    )
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_brand_id is null or p.brand_id = p_brand_id)
    and (normalized_status is null or p.status = normalized_status)
  order by p.updated_at desc, p.name asc
  limit safe_limit
  offset safe_offset;
end;
$$;

revoke all on function public.create_product(
  uuid, text, text, uuid, uuid, text, text, numeric, text, jsonb, jsonb
) from public, anon, authenticated;

revoke all on function public.update_product(
  uuid, text, text, uuid, uuid, text, text, numeric, text, jsonb, jsonb
) from public, anon, authenticated;

revoke all on function public.create_product_attribute(
  uuid, text, text, boolean, text, jsonb
) from public, anon, authenticated;

revoke all on function public.search_products(
  uuid, text, uuid, uuid, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.create_product(
  uuid, text, text, uuid, uuid, text, text, numeric, text, jsonb, jsonb
) to authenticated, service_role;

grant execute on function public.update_product(
  uuid, text, text, uuid, uuid, text, text, numeric, text, jsonb, jsonb
) to authenticated, service_role;

grant execute on function public.create_product_attribute(
  uuid, text, text, boolean, text, jsonb
) to authenticated, service_role;

grant execute on function public.search_products(
  uuid, text, uuid, uuid, text, integer, integer
) to authenticated, service_role;
