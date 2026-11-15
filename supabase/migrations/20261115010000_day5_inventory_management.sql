create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid,
  is_tracked boolean not null default true,
  physical_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  low_stock_threshold integer,
  available_quantity integer generated always as (
    physical_quantity - reserved_quantity
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_business_id_id_key unique (business_id, id),
  constraint inventory_items_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id) on delete cascade,
  constraint inventory_items_variant_fk
    foreign key (business_id, product_id, variant_id)
    references public.product_variants(business_id, product_id, id)
    on delete cascade,
  constraint inventory_items_physical_check check (physical_quantity >= 0),
  constraint inventory_items_reserved_check check (reserved_quantity >= 0),
  constraint inventory_items_reserved_physical_check check (
    reserved_quantity <= physical_quantity
  ),
  constraint inventory_items_threshold_check check (
    low_stock_threshold is null or low_stock_threshold >= 0
  ),
  constraint inventory_items_untracked_check check (
    is_tracked or (physical_quantity = 0 and reserved_quantity = 0)
  )
);

create unique index inventory_items_product_key
on public.inventory_items (business_id, product_id)
where variant_id is null;

create unique index inventory_items_variant_key
on public.inventory_items (business_id, product_id, variant_id)
where variant_id is not null;

create index inventory_items_business_updated_idx
on public.inventory_items (business_id, updated_at desc);

create index inventory_items_business_available_idx
on public.inventory_items (business_id, available_quantity);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  inventory_item_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  operation text not null,
  quantity_change integer not null,
  previous_physical integer not null,
  new_physical integer not null,
  previous_reserved integer not null,
  new_reserved integer not null,
  reason text,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  sku_snapshot text,
  performed_by uuid not null,
  performed_by_name text not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint stock_movements_inventory_item_fk
    foreign key (business_id, inventory_item_id)
    references public.inventory_items(business_id, id) on delete cascade,
  constraint stock_movements_operation_check check (
    operation in (
      'receive',
      'reduce',
      'adjustment',
      'damage',
      'loss',
      'return',
      'reserve',
      'release'
    )
  ),
  constraint stock_movements_quantity_check check (quantity_change <> 0),
  constraint stock_movements_previous_physical_check check (previous_physical >= 0),
  constraint stock_movements_new_physical_check check (new_physical >= 0),
  constraint stock_movements_previous_reserved_check check (previous_reserved >= 0),
  constraint stock_movements_new_reserved_check check (new_reserved >= 0),
  constraint stock_movements_balance_check check (
    new_reserved <= new_physical
  ),
  constraint stock_movements_reason_check check (
    reason is null or char_length(reason) <= 500
  ),
  constraint stock_movements_idempotency_check check (
    idempotency_key is null
    or char_length(btrim(idempotency_key)) between 1 and 128
  )
);

create unique index stock_movements_idempotency_key
on public.stock_movements (business_id, idempotency_key)
where idempotency_key is not null;

create index stock_movements_business_created_idx
on public.stock_movements (business_id, created_at desc);

create index stock_movements_item_created_idx
on public.stock_movements (business_id, inventory_item_id, created_at desc);

create index stock_movements_business_operation_idx
on public.stock_movements (business_id, operation, created_at desc);

create or replace function public.validate_inventory_item()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  variant_product_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.business_id is distinct from old.business_id
    or new.product_id is distinct from old.product_id
    or new.variant_id is distinct from old.variant_id
  ) then
    raise exception 'Inventory records cannot be moved between products.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and p.business_id = new.business_id
  ) then
    raise exception 'The inventory product does not belong to this business.'
      using errcode = '23503';
  end if;

  if new.variant_id is null then
    if exists (
      select 1
      from public.product_variants v
      where v.business_id = new.business_id
        and v.product_id = new.product_id
    ) then
      raise exception 'This product has variants. Track stock per variant instead.'
        using errcode = '22023';
    end if;
  else
    select v.product_id into variant_product_id
    from public.product_variants v
    where v.id = new.variant_id
      and v.business_id = new.business_id;

    if variant_product_id is null or variant_product_id <> new.product_id then
      raise exception 'The inventory variant does not belong to this product.'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_product_variant_inventory_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.inventory_items i
    where i.business_id = new.business_id
      and i.product_id = new.product_id
      and i.variant_id is null
  ) then
    raise exception 'This product already tracks stock at product level. Remove that inventory record before adding variants.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_stock_movement_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Stock movements are immutable.'
    using errcode = '42501';
end;
$$;

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

create trigger inventory_items_validate
before insert or update on public.inventory_items
for each row execute function public.validate_inventory_item();

create trigger product_variants_inventory_scope_guard
before insert or update of business_id, product_id on public.product_variants
for each row execute function public.guard_product_variant_inventory_scope();

create trigger stock_movements_immutable
before update on public.stock_movements
for each row execute function public.prevent_stock_movement_update();

alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

create policy inventory_items_select_members
on public.inventory_items
for select
to authenticated
using (public.is_business_member(business_id));

create policy stock_movements_select_members
on public.stock_movements
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.inventory_items from anon, authenticated;
revoke all on public.stock_movements from anon, authenticated;

grant select on public.inventory_items to authenticated;
grant select on public.stock_movements to authenticated;

create or replace function public.search_inventory(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_category_id uuid default null,
  p_inventory_item_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns table (
  inventory_item_id uuid,
  business_id uuid,
  product_id uuid,
  variant_id uuid,
  product_name text,
  variant_name text,
  sku text,
  barcode text,
  category_id uuid,
  category_name text,
  product_status text,
  variant_status text,
  is_tracked boolean,
  physical_quantity integer,
  reserved_quantity integer,
  available_quantity integer,
  low_stock_threshold integer,
  inventory_status text,
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
  normalized_status text := nullif(lower(btrim(p_status)), '');
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

  if normalized_status is not null
     and normalized_status not in (
       'all',
       'tracked',
       'untracked',
       'in_stock',
       'low_stock',
       'out_of_stock'
     ) then
    raise exception 'Inventory status filter is not valid.'
      using errcode = '22023';
  end if;

  if normalized_sort not in ('name', 'available', 'physical', 'updated') then
    raise exception 'Inventory sort option is not valid.'
      using errcode = '22023';
  end if;

  if normalized_direction not in ('asc', 'desc') then
    raise exception 'Inventory sort direction is not valid.'
      using errcode = '22023';
  end if;

  return query
  with units as (
    select
      i.id as inventory_item_id,
      p.business_id,
      p.id as product_id,
      null::uuid as variant_id,
      p.name as product_name,
      null::text as variant_name,
      p.sku,
      p.barcode,
      p.category_id,
      p.status as product_status,
      null::text as variant_status,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.physical_quantity, 0) as physical_quantity,
      coalesce(i.reserved_quantity, 0) as reserved_quantity,
      coalesce(i.available_quantity, 0) as available_quantity,
      i.low_stock_threshold,
      coalesce(i.created_at, p.created_at) as created_at,
      coalesce(i.updated_at, p.updated_at) as updated_at
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id is null
    where p.business_id = p_business_id
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )

    union all

    select
      i.id as inventory_item_id,
      p.business_id,
      p.id as product_id,
      v.id as variant_id,
      p.name as product_name,
      v.name as variant_name,
      coalesce(v.sku, p.sku) as sku,
      coalesce(v.barcode, p.barcode) as barcode,
      p.category_id,
      p.status as product_status,
      v.status as variant_status,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.physical_quantity, 0) as physical_quantity,
      coalesce(i.reserved_quantity, 0) as reserved_quantity,
      coalesce(i.available_quantity, 0) as available_quantity,
      i.low_stock_threshold,
      coalesce(i.created_at, v.created_at) as created_at,
      coalesce(i.updated_at, v.updated_at) as updated_at
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
      and v.product_id = p.id
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id = v.id
    where p.business_id = p_business_id
  ),
  joined as (
    select
      u.*,
      c.name as category_name,
      case
        when not u.is_tracked then 'untracked'
        when u.available_quantity <= 0 then 'out_of_stock'
        when u.low_stock_threshold is not null
          and u.available_quantity <= u.low_stock_threshold then 'low_stock'
        else 'in_stock'
      end as inventory_status
    from units u
    left join public.categories c
      on c.id = u.category_id
      and c.business_id = u.business_id
    where (
        normalized_search is null
        or u.product_name ilike '%' || normalized_search || '%'
        or coalesce(u.variant_name, '') ilike '%' || normalized_search || '%'
        or coalesce(u.sku, '') ilike '%' || normalized_search || '%'
        or coalesce(u.barcode, '') ilike '%' || normalized_search || '%'
      )
      and (p_category_id is null or u.category_id = p_category_id)
      and (
        p_inventory_item_id is null
        or u.inventory_item_id = p_inventory_item_id
      )
      and (
        normalized_status is null
        or normalized_status = 'all'
        or normalized_status = 'tracked' and u.is_tracked
        or normalized_status = 'untracked' and not u.is_tracked
        or normalized_status = 'in_stock' and u.is_tracked
          and u.available_quantity > 0
          and (
            u.low_stock_threshold is null
            or u.available_quantity > u.low_stock_threshold
          )
        or normalized_status = 'low_stock' and u.is_tracked
          and u.available_quantity > 0
          and u.low_stock_threshold is not null
          and u.available_quantity <= u.low_stock_threshold
        or normalized_status = 'out_of_stock' and u.is_tracked
          and u.available_quantity <= 0
      )
  )
  select
    j.inventory_item_id,
    j.business_id,
    j.product_id,
    j.variant_id,
    j.product_name,
    j.variant_name,
    j.sku,
    j.barcode,
    j.category_id,
    j.category_name,
    j.product_status,
    j.variant_status,
    j.is_tracked,
    j.physical_quantity,
    j.reserved_quantity,
    j.available_quantity,
    j.low_stock_threshold,
    j.inventory_status,
    j.created_at,
    j.updated_at,
    count(*) over ()::bigint as total_count
  from joined j
  order by
    case
      when normalized_sort = 'name' and normalized_direction = 'asc'
      then lower(j.product_name)
    end asc nulls last,
    case
      when normalized_sort = 'name' and normalized_direction = 'desc'
      then lower(j.product_name)
    end desc nulls last,
    case
      when normalized_sort = 'available' and normalized_direction = 'asc'
      then j.available_quantity
    end asc nulls last,
    case
      when normalized_sort = 'available' and normalized_direction = 'desc'
      then j.available_quantity
    end desc nulls last,
    case
      when normalized_sort = 'physical' and normalized_direction = 'asc'
      then j.physical_quantity
    end asc nulls last,
    case
      when normalized_sort = 'physical' and normalized_direction = 'desc'
      then j.physical_quantity
    end desc nulls last,
    case
      when normalized_sort = 'updated' and normalized_direction = 'asc'
      then j.updated_at
    end asc nulls last,
    case
      when normalized_sort = 'updated' and normalized_direction = 'desc'
      then j.updated_at
    end desc nulls last,
    lower(j.product_name) asc,
    coalesce(j.variant_name, '') asc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.get_inventory_overview(p_business_id uuid)
returns table (
  total_units bigint,
  tracked_units bigint,
  untracked_units bigint,
  in_stock_units bigint,
  low_stock_units bigint,
  out_of_stock_units bigint,
  total_physical bigint,
  total_reserved bigint,
  total_available bigint,
  movement_count bigint,
  movements_today bigint,
  last_movement_at timestamptz
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
  with units as (
    select
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.physical_quantity, 0) as physical_quantity,
      coalesce(i.reserved_quantity, 0) as reserved_quantity,
      coalesce(i.available_quantity, 0) as available_quantity,
      i.low_stock_threshold
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id is null
    where p.business_id = p_business_id
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )

    union all

    select
      coalesce(i.is_tracked, false),
      coalesce(i.physical_quantity, 0),
      coalesce(i.reserved_quantity, 0),
      coalesce(i.available_quantity, 0),
      i.low_stock_threshold
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
      and v.product_id = p.id
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id = v.id
    where p.business_id = p_business_id
  )
  select
    count(*)::bigint as total_units,
    count(*) filter (where u.is_tracked)::bigint as tracked_units,
    count(*) filter (where not u.is_tracked)::bigint as untracked_units,
    count(*) filter (
      where u.is_tracked
        and u.available_quantity > 0
        and (
          u.low_stock_threshold is null
          or u.available_quantity > u.low_stock_threshold
        )
    )::bigint as in_stock_units,
    count(*) filter (
      where u.is_tracked
        and u.available_quantity > 0
        and u.low_stock_threshold is not null
        and u.available_quantity <= u.low_stock_threshold
    )::bigint as low_stock_units,
    count(*) filter (
      where u.is_tracked and u.available_quantity <= 0
    )::bigint as out_of_stock_units,
    coalesce(sum(u.physical_quantity), 0)::bigint as total_physical,
    coalesce(sum(u.reserved_quantity), 0)::bigint as total_reserved,
    coalesce(sum(u.available_quantity), 0)::bigint as total_available,
    (
      select count(*)::bigint
      from public.stock_movements m
      where m.business_id = p_business_id
    ) as movement_count,
    (
      select count(*)::bigint
      from public.stock_movements m
      where m.business_id = p_business_id
        and m.created_at >= date_trunc('day', now())
    ) as movements_today,
    (
      select max(m.created_at)
      from public.stock_movements m
      where m.business_id = p_business_id
    ) as last_movement_at
  from units u;
end;
$$;

create or replace function public.list_stock_movements(
  p_business_id uuid,
  p_search text default null,
  p_operation text default null,
  p_inventory_item_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  inventory_item_id uuid,
  product_id uuid,
  variant_id uuid,
  product_name text,
  variant_name text,
  sku text,
  operation text,
  quantity_change integer,
  previous_physical integer,
  new_physical integer,
  previous_reserved integer,
  new_reserved integer,
  reason text,
  performed_by uuid,
  performed_by_name text,
  idempotency_key text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  normalized_operation text := nullif(lower(btrim(p_operation)), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if normalized_operation is not null
     and normalized_operation <> 'all'
     and normalized_operation not in (
       'receive',
       'reduce',
       'adjustment',
       'damage',
       'loss',
       'return',
       'reserve',
       'release'
     ) then
    raise exception 'Stock operation filter is not valid.'
      using errcode = '22023';
  end if;

  return query
  select
    m.id,
    m.business_id,
    m.inventory_item_id,
    m.product_id,
    m.variant_id,
    m.product_name_snapshot as product_name,
    m.variant_name_snapshot as variant_name,
    m.sku_snapshot as sku,
    m.operation,
    m.quantity_change,
    m.previous_physical,
    m.new_physical,
    m.previous_reserved,
    m.new_reserved,
    m.reason,
    m.performed_by,
    m.performed_by_name,
    m.idempotency_key,
    m.created_at,
    count(*) over ()::bigint as total_count
  from public.stock_movements m
  where m.business_id = p_business_id
    and (
      normalized_search is null
      or m.product_name_snapshot ilike '%' || normalized_search || '%'
      or coalesce(m.variant_name_snapshot, '') ilike '%' || normalized_search || '%'
      or coalesce(m.sku_snapshot, '') ilike '%' || normalized_search || '%'
      or coalesce(m.reason, '') ilike '%' || normalized_search || '%'
      or m.performed_by_name ilike '%' || normalized_search || '%'
    )
    and (
      normalized_operation is null
      or normalized_operation = 'all'
      or m.operation = normalized_operation
    )
    and (
      p_inventory_item_id is null
      or m.inventory_item_id = p_inventory_item_id
    )
  order by m.created_at desc, m.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.enable_inventory_tracking(
  p_product_id uuid,
  p_variant_id uuid default null,
  p_low_stock_threshold integer default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_product public.products;
  current_variant public.product_variants;
  current_item public.inventory_items;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage inventory.'
      using errcode = '42501';
  end if;

  if p_low_stock_threshold is not null and p_low_stock_threshold < 0 then
    raise exception 'The low-stock threshold cannot be negative.'
      using errcode = '22023';
  end if;

  select * into current_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_product.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to change inventory settings.'
      using errcode = '42501';
  end if;

  if p_variant_id is null then
    if exists (
      select 1
      from public.product_variants v
      where v.business_id = current_product.business_id
        and v.product_id = current_product.id
    ) then
      raise exception 'This product has variants. Choose a variant to track.'
        using errcode = '22023';
    end if;
  else
    select * into current_variant
    from public.product_variants
    where id = p_variant_id
      and business_id = current_product.business_id
      and product_id = current_product.id;

    if not found then
      raise exception 'Variant not found for this product.'
        using errcode = '22023';
    end if;
  end if;

  select * into current_item
  from public.inventory_items
  where business_id = current_product.business_id
    and product_id = current_product.id
    and variant_id is not distinct from p_variant_id
  for update;

  if found then
    if current_item.is_tracked then
      return current_item;
    end if;

    update public.inventory_items
    set
      is_tracked = true,
      low_stock_threshold = p_low_stock_threshold
    where id = current_item.id
    returning * into current_item;

    return current_item;
  end if;

  insert into public.inventory_items (
    business_id,
    product_id,
    variant_id,
    is_tracked,
    low_stock_threshold
  )
  values (
    current_product.business_id,
    current_product.id,
    p_variant_id,
    true,
    p_low_stock_threshold
  )
  returning * into current_item;

  return current_item;
end;
$$;

create or replace function public.disable_inventory_tracking(
  p_inventory_item_id uuid
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_item public.inventory_items;
  has_movements boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage inventory.'
      using errcode = '42501';
  end if;

  select * into current_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory record not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_item.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to change inventory settings.'
      using errcode = '42501';
  end if;

  if not current_item.is_tracked then
    return current_item;
  end if;

  if current_item.physical_quantity <> 0
     or current_item.reserved_quantity <> 0 then
    raise exception 'Reduce physical and reserved stock to zero before turning off tracking.'
      using errcode = '22023';
  end if;

  update public.inventory_items
  set
    is_tracked = false,
    low_stock_threshold = null
  where id = current_item.id
  returning * into current_item;

  select exists (
    select 1
    from public.stock_movements m
    where m.inventory_item_id = current_item.id
  ) into has_movements;

  if not has_movements then
    delete from public.inventory_items where id = current_item.id;
  end if;

  return current_item;
end;
$$;

create or replace function public.update_inventory_threshold(
  p_inventory_item_id uuid,
  p_low_stock_threshold integer
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_item public.inventory_items;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage inventory.'
      using errcode = '42501';
  end if;

  if p_low_stock_threshold is not null and p_low_stock_threshold < 0 then
    raise exception 'The low-stock threshold cannot be negative.'
      using errcode = '22023';
  end if;

  select * into current_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory record not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_item.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to change inventory settings.'
      using errcode = '42501';
  end if;

  if not current_item.is_tracked then
    raise exception 'Turn on stock tracking before setting a threshold.'
      using errcode = '22023';
  end if;

  update public.inventory_items
  set low_stock_threshold = p_low_stock_threshold
  where id = current_item.id
  returning * into current_item;

  return current_item;
end;
$$;

create or replace function public.record_stock_operation(
  p_inventory_item_id uuid,
  p_operation text,
  p_quantity_change integer,
  p_reason text default null,
  p_idempotency_key text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_item public.inventory_items;
  current_product public.products;
  current_variant public.product_variants;
  existing_movement public.stock_movements;
  created_movement public.stock_movements;
  normalized_operation text := lower(btrim(p_operation));
  normalized_reason text := nullif(btrim(p_reason), '');
  normalized_key text := nullif(btrim(p_idempotency_key), '');
  actor_id uuid := auth.uid();
  actor_name text;
  next_physical integer;
  next_reserved integer;
  has_variant boolean := false;
begin
  if actor_id is null then
    raise exception 'Sign in to manage inventory.'
      using errcode = '42501';
  end if;

  select * into current_item
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory record not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_item.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to change stock.'
      using errcode = '42501';
  end if;

  if not current_item.is_tracked then
    raise exception 'Stock tracking is turned off for this item.'
      using errcode = '22023';
  end if;

  if normalized_operation is null
     or normalized_operation not in (
    'receive',
    'reduce',
    'adjustment',
    'damage',
    'loss',
    'return',
    'reserve',
    'release'
  ) then
    raise exception 'Stock operation is not valid.'
      using errcode = '22023';
  end if;

  if p_quantity_change is null or p_quantity_change = 0 then
    raise exception 'Stock quantity change must be a non-zero whole number.'
      using errcode = '22023';
  end if;

  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'Stock notes must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  if normalized_operation in ('adjustment', 'damage', 'loss')
     and normalized_reason is null then
    raise exception 'Add a reason for this stock change.'
      using errcode = '22023';
  end if;

  if normalized_key is not null then
    if char_length(normalized_key) > 128 then
      raise exception 'The idempotency key is too long.'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        current_item.business_id::text || ':stock:' || normalized_key,
        0
      )
    );

    select * into existing_movement
    from public.stock_movements
    where business_id = current_item.business_id
      and idempotency_key = normalized_key;

    if found then
      if existing_movement.inventory_item_id <> current_item.id
         or existing_movement.operation <> normalized_operation then
        raise exception 'That idempotency key was already used for another stock operation.'
          using errcode = '23505';
      end if;

      return existing_movement;
    end if;
  end if;

  next_physical := current_item.physical_quantity;
  next_reserved := current_item.reserved_quantity;

  if normalized_operation in ('receive', 'return') then
    if p_quantity_change <= 0 then
      raise exception 'This operation requires a positive quantity.'
        using errcode = '22023';
    end if;
    next_physical := next_physical + p_quantity_change;
  elsif normalized_operation in ('reduce', 'damage', 'loss') then
    if p_quantity_change >= 0 then
      raise exception 'This operation requires a negative quantity change.'
        using errcode = '22023';
    end if;
    next_physical := next_physical + p_quantity_change;
  elsif normalized_operation = 'adjustment' then
    next_physical := next_physical + p_quantity_change;
  elsif normalized_operation = 'reserve' then
    if p_quantity_change <= 0 then
      raise exception 'Reserve requires a positive quantity.'
        using errcode = '22023';
    end if;
    next_reserved := next_reserved + p_quantity_change;
  elsif normalized_operation = 'release' then
    if p_quantity_change >= 0 then
      raise exception 'Release requires a negative quantity change.'
        using errcode = '22023';
    end if;
    next_reserved := next_reserved + p_quantity_change;
  end if;

  if next_physical < 0 then
    raise exception 'Physical stock cannot be negative.'
      using errcode = '22023';
  end if;

  if next_reserved < 0 then
    raise exception 'Reserved stock cannot be negative.'
      using errcode = '22023';
  end if;

  if next_reserved > next_physical then
    raise exception 'Available stock is too low for this operation.'
      using errcode = '22023';
  end if;

  select * into current_product
  from public.products
  where id = current_item.product_id
    and business_id = current_item.business_id;

  if not found then
    raise exception 'The inventory product no longer exists.'
      using errcode = '23503';
  end if;

  if current_item.variant_id is not null then
    select * into current_variant
    from public.product_variants
    where id = current_item.variant_id
      and business_id = current_item.business_id
      and product_id = current_item.product_id;

    if not found then
      raise exception 'The inventory variant no longer exists.'
        using errcode = '23503';
    end if;
    has_variant := true;
  end if;

  select nullif(btrim(p.full_name), '') into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

  update public.inventory_items
  set
    physical_quantity = next_physical,
    reserved_quantity = next_reserved
  where id = current_item.id;

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
    current_item.business_id,
    current_item.id,
    current_item.product_id,
    current_item.variant_id,
    normalized_operation,
    p_quantity_change,
    current_item.physical_quantity,
    next_physical,
    current_item.reserved_quantity,
    next_reserved,
    normalized_reason,
    current_product.name,
    case when has_variant then current_variant.name else null end,
    case
      when has_variant then coalesce(current_variant.sku, current_product.sku)
      else current_product.sku
    end,
    actor_id,
    actor_name,
    normalized_key
  )
  returning * into created_movement;

  return created_movement;
end;
$$;

revoke all on function public.validate_inventory_item()
from public, anon, authenticated;
revoke all on function public.guard_product_variant_inventory_scope()
from public, anon, authenticated;
revoke all on function public.prevent_stock_movement_update()
from public, anon, authenticated;

revoke all on function public.search_inventory(
  uuid, text, text, uuid, uuid, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.get_inventory_overview(uuid)
from public, anon, authenticated;
revoke all on function public.list_stock_movements(
  uuid, text, text, uuid, integer, integer
) from public, anon, authenticated;
revoke all on function public.enable_inventory_tracking(uuid, uuid, integer)
from public, anon, authenticated;
revoke all on function public.disable_inventory_tracking(uuid)
from public, anon, authenticated;
revoke all on function public.update_inventory_threshold(uuid, integer)
from public, anon, authenticated;
revoke all on function public.record_stock_operation(
  uuid, text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.search_inventory(
  uuid, text, text, uuid, uuid, integer, integer, text, text
) to authenticated, service_role;
grant execute on function public.get_inventory_overview(uuid)
to authenticated, service_role;
grant execute on function public.list_stock_movements(
  uuid, text, text, uuid, integer, integer
) to authenticated, service_role;
grant execute on function public.enable_inventory_tracking(uuid, uuid, integer)
to authenticated, service_role;
grant execute on function public.disable_inventory_tracking(uuid)
to authenticated, service_role;
grant execute on function public.update_inventory_threshold(uuid, integer)
to authenticated, service_role;
grant execute on function public.record_stock_operation(
  uuid, text, integer, text, text
) to authenticated, service_role;
