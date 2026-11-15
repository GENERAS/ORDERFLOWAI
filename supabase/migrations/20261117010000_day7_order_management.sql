-- Day 7: order management, agreed prices, activity history and stock rules.

create table public.order_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint order_counters_last_number_check check (last_number >= 0)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_number text not null,
  customer_id uuid not null,
  customer_name_snapshot text not null,
  customer_phone_snapshot text,
  customer_email_snapshot text,
  status text not null default 'draft',
  stock_state text not null default 'none',
  currency text not null,
  subtotal numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  notes text,
  cancellation_reason text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_business_id_id_key unique (business_id, id),
  constraint orders_business_number_key unique (business_id, order_number),
  constraint orders_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete restrict,
  constraint orders_number_check check (
    char_length(btrim(order_number)) between 3 and 40
  ),
  constraint orders_customer_name_check check (
    char_length(btrim(customer_name_snapshot)) between 1 and 160
  ),
  constraint orders_customer_phone_check check (
    customer_phone_snapshot is null
    or char_length(btrim(customer_phone_snapshot)) between 7 and 32
  ),
  constraint orders_customer_email_check check (
    customer_email_snapshot is null
    or char_length(btrim(customer_email_snapshot)) between 3 and 254
  ),
  constraint orders_status_check check (
    status in (
      'draft',
      'awaiting_confirmation',
      'confirmed',
      'processing',
      'ready',
      'completed',
      'cancelled'
    )
  ),
  constraint orders_stock_state_check check (
    stock_state in ('none', 'reserved', 'released', 'consumed')
  ),
  constraint orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint orders_subtotal_check check (subtotal >= 0),
  constraint orders_total_check check (total >= 0),
  constraint orders_notes_check check (
    notes is null or char_length(notes) <= 2000
  ),
  constraint orders_cancellation_reason_check check (
    cancellation_reason is null
    or char_length(btrim(cancellation_reason)) between 3 and 500
  )
);

create index orders_business_status_idx
on public.orders (business_id, status, created_at desc);

create index orders_business_customer_idx
on public.orders (business_id, customer_id, created_at desc);

create index orders_business_created_idx
on public.orders (business_id, created_at desc);

create index orders_business_updated_idx
on public.orders (business_id, updated_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_price numeric(14, 2) not null,
  quantity integer not null,
  reserved_quantity integer not null default 0,
  line_total numeric(14, 2)
    generated always as ((quantity::numeric) * unit_price) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_business_id_id_key unique (business_id, id),
  constraint order_items_order_fk
    foreign key (business_id, order_id)
    references public.orders(business_id, id) on delete cascade,
  constraint order_items_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id) on delete restrict,
  constraint order_items_variant_fk
    foreign key (business_id, product_id, variant_id)
    references public.product_variants(business_id, product_id, id)
    on delete restrict,
  constraint order_items_product_name_check check (
    char_length(btrim(product_name_snapshot)) between 1 and 200
  ),
  constraint order_items_variant_name_check check (
    variant_name_snapshot is null
    or char_length(btrim(variant_name_snapshot)) between 1 and 160
  ),
  constraint order_items_sku_check check (
    sku_snapshot is null or char_length(btrim(sku_snapshot)) between 1 and 80
  ),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_quantity_check check (quantity between 1 and 100000),
  constraint order_items_reserved_check check (
    reserved_quantity >= 0 and reserved_quantity <= quantity
  )
);

create unique index order_items_unique_unit_key
on public.order_items (
  business_id,
  order_id,
  product_id,
  coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index order_items_order_idx
on public.order_items (business_id, order_id, created_at);

create index order_items_product_idx
on public.order_items (business_id, product_id, variant_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  event_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  created_at timestamptz not null default now(),
  constraint order_events_business_id_id_key unique (business_id, id),
  constraint order_events_order_fk
    foreign key (business_id, order_id)
    references public.orders(business_id, id) on delete cascade,
  constraint order_events_type_check check (
    event_type in ('created', 'updated', 'status_changed', 'cancelled')
  ),
  constraint order_events_summary_check check (
    char_length(btrim(summary)) between 1 and 500
  ),
  constraint order_events_actor_name_check check (
    char_length(btrim(actor_name)) between 1 and 160
  )
);

create index order_events_order_idx
on public.order_events (business_id, order_id, created_at desc);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger order_items_set_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

create or replace function public.prevent_order_event_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Order activity is immutable.'
    using errcode = '42501';
end;
$$;

create trigger order_events_immutable
before update on public.order_events
for each row execute function public.prevent_order_event_update();

create or replace function public.sync_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_order_id uuid;
begin
  if tg_op = 'DELETE' then
    target_order_id := old.order_id;
  else
    target_order_id := new.order_id;
  end if;

  update public.orders o
  set
    subtotal = coalesce(
      (
        select sum(oi.line_total)
        from public.order_items oi
        where oi.business_id = o.business_id
          and oi.order_id = o.id
      ),
      0
    ),
    total = coalesce(
      (
        select sum(oi.line_total)
        from public.order_items oi
        where oi.business_id = o.business_id
          and oi.order_id = o.id
      ),
      0
    ),
    updated_at = now()
  where o.id = target_order_id;

  return null;
end;
$$;

create trigger order_items_sync_totals
after insert or update or delete on public.order_items
for each row execute function public.sync_order_totals();

alter table public.order_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy orders_select_members
on public.orders
for select
to authenticated
using (public.is_business_member(business_id));

create policy order_items_select_members
on public.order_items
for select
to authenticated
using (public.is_business_member(business_id));

create policy order_events_select_members
on public.order_events
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.order_counters from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.order_events from anon, authenticated;

grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.order_events to authenticated;

create or replace function public.next_order_number(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number bigint;
begin
  insert into public.order_counters (business_id, last_number)
  values (p_business_id, 1)
  on conflict (business_id) do update
  set
    last_number = public.order_counters.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  return 'ORD-' || lpad(next_number::text, 5, '0');
end;
$$;

create or replace function public.create_order_item_record(
  p_business_id uuid,
  p_order_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_unit_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_product public.products;
  current_variant public.product_variants;
  has_variants boolean := false;
  resolved_price numeric(14, 2);
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'Order item quantity must be between 1 and 100000.'
      using errcode = '22023';
  end if;

  select * into current_product
  from public.products
  where id = p_product_id
    and business_id = p_business_id;

  if not found then
    raise exception 'The selected product could not be found.'
      using errcode = '22023';
  end if;

  if current_product.status <> 'active' then
    raise exception 'Only active products can be added to an order.'
      using errcode = '22023';
  end if;

  if p_variant_id is not null then
    select * into current_variant
    from public.product_variants
    where id = p_variant_id
      and business_id = p_business_id
      and product_id = p_product_id;

    if not found then
      raise exception 'The selected product variant could not be found.'
        using errcode = '22023';
    end if;

    if current_variant.status <> 'active' then
      raise exception 'Only active variants can be added to an order.'
        using errcode = '22023';
    end if;
  else
    select exists (
      select 1
      from public.product_variants v
      where v.business_id = p_business_id
        and v.product_id = p_product_id
    ) into has_variants;

    if has_variants then
      raise exception 'Choose a variant for this product.'
        using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1
    from public.order_items oi
    where oi.business_id = p_business_id
      and oi.order_id = p_order_id
      and oi.product_id = p_product_id
      and oi.variant_id is not distinct from p_variant_id
  ) then
    raise exception 'Each product or variant can only appear once in an order.'
      using errcode = '22023';
  end if;

  resolved_price := p_unit_price;
  if resolved_price is null then
    resolved_price := coalesce(current_variant.price_override, current_product.price);
  end if;

  if resolved_price is null or resolved_price < 0 then
    raise exception 'Enter a valid agreed price for this item.'
      using errcode = '22023';
  end if;

  insert into public.order_items (
    business_id,
    order_id,
    product_id,
    variant_id,
    product_name_snapshot,
    variant_name_snapshot,
    sku_snapshot,
    unit_price,
    quantity
  )
  values (
    p_business_id,
    p_order_id,
    p_product_id,
    p_variant_id,
    current_product.name,
    case when p_variant_id is not null then current_variant.name else null end,
    case
      when p_variant_id is not null
        then coalesce(current_variant.sku, current_product.sku)
      else current_product.sku
    end,
    resolved_price,
    p_quantity
  );
end;
$$;

create or replace function public.reserve_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  item record;
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
      inv.id as inventory_item_id,
      inv.is_tracked
    from public.order_items oi
    left join public.inventory_items inv
      on inv.business_id = oi.business_id
      and inv.product_id = oi.product_id
      and inv.variant_id is not distinct from oi.variant_id
    where oi.business_id = current_order.business_id
      and oi.order_id = p_order_id
    order by oi.created_at, oi.id
  loop
    if item.inventory_item_id is not null and item.is_tracked then
      perform public.record_stock_operation(
        item.inventory_item_id,
        'reserve',
        item.quantity,
        'Order ' || current_order.order_number || ' confirmed',
        'order:' || p_order_id::text || ':reserve:' || item.id::text
      );

      update public.order_items
      set reserved_quantity = item.quantity
      where id = item.id;
    end if;
  end loop;

  update public.orders
  set stock_state = 'reserved'
  where id = p_order_id;
end;
$$;

create or replace function public.release_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  item record;
  released_any boolean := false;
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
      oi.reserved_quantity,
      inv.id as inventory_item_id
    from public.order_items oi
    left join public.inventory_items inv
      on inv.business_id = oi.business_id
      and inv.product_id = oi.product_id
      and inv.variant_id is not distinct from oi.variant_id
    where oi.business_id = current_order.business_id
      and oi.order_id = p_order_id
      and oi.reserved_quantity > 0
    order by oi.created_at, oi.id
  loop
    if item.inventory_item_id is null then
      raise exception 'Reserved inventory for this order is no longer available.'
        using errcode = '22023';
    end if;

    perform public.record_stock_operation(
      item.inventory_item_id,
      'release',
      -item.reserved_quantity,
      'Order ' || current_order.order_number || ' cancelled',
      'order:' || p_order_id::text || ':cancel-release:' || item.id::text
    );

    update public.order_items
    set reserved_quantity = 0
    where id = item.id;

    released_any := true;
  end loop;

  if released_any or current_order.stock_state = 'reserved' then
    update public.orders
    set stock_state = 'released'
    where id = p_order_id;
  end if;
end;
$$;

create or replace function public.consume_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  item record;
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
      oi.reserved_quantity,
      inv.id as inventory_item_id
    from public.order_items oi
    left join public.inventory_items inv
      on inv.business_id = oi.business_id
      and inv.product_id = oi.product_id
      and inv.variant_id is not distinct from oi.variant_id
    where oi.business_id = current_order.business_id
      and oi.order_id = p_order_id
      and oi.reserved_quantity > 0
    order by oi.created_at, oi.id
  loop
    if item.inventory_item_id is null then
      raise exception 'Reserved inventory for this order is no longer available.'
        using errcode = '22023';
    end if;

    perform public.record_stock_operation(
      item.inventory_item_id,
      'release',
      -item.reserved_quantity,
      'Order ' || current_order.order_number || ' completed',
      'order:' || p_order_id::text || ':complete-release:' || item.id::text
    );

    perform public.record_stock_operation(
      item.inventory_item_id,
      'reduce',
      -item.reserved_quantity,
      'Order ' || current_order.order_number || ' completed',
      'order:' || p_order_id::text || ':complete-consume:' || item.id::text
    );

    update public.order_items
    set reserved_quantity = 0
    where id = item.id;
  end loop;

  update public.orders
  set stock_state = 'consumed'
  where id = p_order_id;
end;
$$;

create or replace function public.search_orders(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_customer_id uuid default null,
  p_order_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'recent',
  p_direction text default 'desc'
)
returns table (
  id uuid,
  business_id uuid,
  order_number text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  customer_email text,
  status text,
  stock_state text,
  currency text,
  subtotal numeric,
  total numeric,
  notes text,
  cancellation_reason text,
  item_count bigint,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
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
  normalized_sort text := coalesce(nullif(lower(btrim(p_sort)), ''), 'recent');
  normalized_direction text := coalesce(
    nullif(lower(btrim(p_direction)), ''),
    'desc'
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
       'draft',
       'awaiting_confirmation',
       'confirmed',
       'processing',
       'ready',
       'completed',
       'cancelled'
     ) then
    raise exception 'Order status filter is not valid.'
      using errcode = '22023';
  end if;

  if normalized_sort not in ('recent', 'updated', 'total', 'number', 'customer') then
    raise exception 'Order sort option is not valid.'
      using errcode = '22023';
  end if;

  if normalized_direction not in ('asc', 'desc') then
    raise exception 'Order sort direction is not valid.'
      using errcode = '22023';
  end if;

  return query
  select
    o.id,
    o.business_id,
    o.order_number,
    o.customer_id,
    o.customer_name_snapshot,
    o.customer_phone_snapshot,
    o.customer_email_snapshot,
    o.status,
    o.stock_state,
    o.currency,
    o.subtotal,
    o.total,
    o.notes,
    o.cancellation_reason,
    (
      select count(*)
      from public.order_items oi
      where oi.business_id = o.business_id
        and oi.order_id = o.id
    ) as item_count,
    o.confirmed_at,
    o.completed_at,
    o.cancelled_at,
    o.created_at,
    o.updated_at,
    count(*) over ()::bigint as total_count
  from public.orders o
  where o.business_id = p_business_id
    and (p_order_id is null or o.id = p_order_id)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (
      normalized_status is null
      or normalized_status = 'all'
      or o.status = normalized_status
    )
    and (
      normalized_search is null
      or o.order_number ilike '%' || normalized_search || '%'
      or o.customer_name_snapshot ilike '%' || normalized_search || '%'
      or coalesce(o.customer_phone_snapshot, '') ilike '%' || normalized_search || '%'
      or coalesce(o.customer_email_snapshot, '') ilike '%' || normalized_search || '%'
    )
  order by
    case
      when normalized_sort = 'recent' and normalized_direction = 'asc'
      then o.created_at
    end asc nulls last,
    case
      when normalized_sort = 'recent' and normalized_direction = 'desc'
      then o.created_at
    end desc nulls last,
    case
      when normalized_sort = 'updated' and normalized_direction = 'asc'
      then o.updated_at
    end asc nulls last,
    case
      when normalized_sort = 'updated' and normalized_direction = 'desc'
      then o.updated_at
    end desc nulls last,
    case
      when normalized_sort = 'total' and normalized_direction = 'asc'
      then o.total
    end asc nulls last,
    case
      when normalized_sort = 'total' and normalized_direction = 'desc'
      then o.total
    end desc nulls last,
    case
      when normalized_sort = 'number' and normalized_direction = 'asc'
      then lower(o.order_number)
    end asc nulls last,
    case
      when normalized_sort = 'number' and normalized_direction = 'desc'
      then lower(o.order_number)
    end desc nulls last,
    case
      when normalized_sort = 'customer' and normalized_direction = 'asc'
      then lower(o.customer_name_snapshot)
    end asc nulls last,
    case
      when normalized_sort = 'customer' and normalized_direction = 'desc'
      then lower(o.customer_name_snapshot)
    end desc nulls last,
    o.id
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.search_order_catalogue(
  p_business_id uuid,
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  product_id uuid,
  variant_id uuid,
  product_name text,
  variant_name text,
  sku text,
  unit_price numeric,
  is_tracked boolean,
  available_quantity integer,
  inventory_status text,
  total_count bigint
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  with units as (
    select
      p.id as product_id,
      null::uuid as variant_id,
      p.name as product_name,
      null::text as variant_name,
      p.sku,
      p.price as unit_price,
      i.id as inventory_item_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id is null
    where p.business_id = p_business_id
      and p.status = 'active'
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )

    union all

    select
      p.id as product_id,
      v.id as variant_id,
      p.name as product_name,
      v.name as variant_name,
      coalesce(v.sku, p.sku) as sku,
      coalesce(v.price_override, p.price) as unit_price,
      i.id as inventory_item_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
      and v.product_id = p.id
    left join public.inventory_items i
      on i.business_id = p.business_id
      and i.product_id = p.id
      and i.variant_id = v.id
    where p.business_id = p_business_id
      and p.status = 'active'
      and v.status = 'active'
  )
  select
    u.product_id,
    u.variant_id,
    u.product_name,
    u.variant_name,
    u.sku,
    u.unit_price,
    u.is_tracked,
    u.available_quantity,
    case
      when not u.is_tracked then 'untracked'
      when u.available_quantity <= 0 then 'out_of_stock'
      else 'in_stock'
    end as inventory_status,
    count(*) over ()::bigint as total_count
  from units u
  where (
    normalized_search is null
    or u.product_name ilike '%' || normalized_search || '%'
    or coalesce(u.variant_name, '') ilike '%' || normalized_search || '%'
    or coalesce(u.sku, '') ilike '%' || normalized_search || '%'
  )
  order by lower(u.product_name), lower(coalesce(u.variant_name, '')), u.product_id
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.get_order_overview(p_business_id uuid)
returns table (
  total_orders bigint,
  draft_count bigint,
  awaiting_confirmation_count bigint,
  confirmed_count bigint,
  processing_count bigint,
  ready_count bigint,
  completed_count bigint,
  cancelled_count bigint,
  open_value numeric,
  completed_value numeric,
  orders_today bigint
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
    count(*)::bigint,
    count(*) filter (where o.status = 'draft')::bigint,
    count(*) filter (where o.status = 'awaiting_confirmation')::bigint,
    count(*) filter (where o.status = 'confirmed')::bigint,
    count(*) filter (where o.status = 'processing')::bigint,
    count(*) filter (where o.status = 'ready')::bigint,
    count(*) filter (where o.status = 'completed')::bigint,
    count(*) filter (where o.status = 'cancelled')::bigint,
    coalesce(
      sum(o.total) filter (
        where o.status not in ('completed', 'cancelled')
      ),
      0
    )::numeric,
    coalesce(
      sum(o.total) filter (where o.status = 'completed'),
      0
    )::numeric,
    count(*) filter (where o.created_at >= current_date)::bigint
  from public.orders o
  where o.business_id = p_business_id;
end;
$$;

create or replace function public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_customer public.customers;
  business_currency text;
  normalized_notes text := nullif(btrim(p_notes), '');
  created_order public.orders;
  item jsonb;
  item_count integer;
  new_number text;
begin
  if actor_id is null then
    raise exception 'Sign in to manage orders.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage orders.'
      using errcode = '42501';
  end if;

  select b.currency into business_currency
  from public.businesses b
  where b.id = p_business_id;

  if business_currency is null then
    raise exception 'The business could not be found.'
      using errcode = '42501';
  end if;

  select * into current_customer
  from public.customers
  where id = p_customer_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Choose a customer from this workspace.'
      using errcode = '22023';
  end if;

  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Order notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the order.'
      using errcode = '22023';
  end if;

  new_number := public.next_order_number(p_business_id);

  insert into public.orders (
    business_id,
    order_number,
    customer_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    customer_email_snapshot,
    currency,
    notes,
    created_by,
    updated_by
  )
  values (
    p_business_id,
    new_number,
    current_customer.id,
    current_customer.full_name,
    current_customer.phone,
    current_customer.email,
    business_currency,
    normalized_notes,
    actor_id,
    actor_id
  )
  returning * into created_order;

  for item in select * from jsonb_array_elements(p_items)
  loop
    perform public.create_order_item_record(
      p_business_id,
      created_order.id,
      (item ->> 'product_id')::uuid,
      nullif(btrim(item ->> 'variant_id'), '')::uuid,
      (item ->> 'quantity')::integer,
      case
        when nullif(btrim(item ->> 'unit_price'), '') is null then null
        else (item ->> 'unit_price')::numeric
      end
    );
  end loop;

  select * into created_order
  from public.orders
  where id = created_order.id;

  select count(*) into item_count
  from public.order_items
  where business_id = p_business_id
    and order_id = created_order.id;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
    p_business_id,
    created_order.id,
    'created',
    'Order created with ' || item_count::text || ' item'
      || case when item_count = 1 then '' else 's' end || '.',
    jsonb_build_object(
      'itemCount', item_count,
      'total', created_order.total,
      'currency', created_order.currency
    ),
    actor_id,
    actor_name
  );

  return created_order;
end;
$$;

create or replace function public.update_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_order public.orders;
  current_customer public.customers;
  normalized_notes text := nullif(btrim(p_notes), '');
  item jsonb;
  item_count integer;
  updated_order public.orders;
begin
  if actor_id is null then
    raise exception 'Sign in to manage orders.'
      using errcode = '28000';
  end if;

  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    current_order.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage orders.'
      using errcode = '42501';
  end if;

  if current_order.status not in ('draft', 'awaiting_confirmation') then
    raise exception 'Only draft or awaiting orders can be edited. Cancel the order to make changes after confirmation.'
      using errcode = '22023';
  end if;

  select * into current_customer
  from public.customers
  where id = p_customer_id
    and business_id = current_order.business_id;

  if not found then
    raise exception 'Choose a customer from this workspace.'
      using errcode = '22023';
  end if;

  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Order notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the order.'
      using errcode = '22023';
  end if;

  delete from public.order_items
  where business_id = current_order.business_id
    and order_id = p_order_id;

  for item in select * from jsonb_array_elements(p_items)
  loop
    perform public.create_order_item_record(
      current_order.business_id,
      p_order_id,
      (item ->> 'product_id')::uuid,
      nullif(btrim(item ->> 'variant_id'), '')::uuid,
      (item ->> 'quantity')::integer,
      case
        when nullif(btrim(item ->> 'unit_price'), '') is null then null
        else (item ->> 'unit_price')::numeric
      end
    );
  end loop;

  update public.orders
  set
    customer_id = current_customer.id,
    customer_name_snapshot = current_customer.full_name,
    customer_phone_snapshot = current_customer.phone,
    customer_email_snapshot = current_customer.email,
    notes = normalized_notes,
    updated_by = actor_id
  where id = p_order_id;

  select * into updated_order
  from public.orders
  where id = p_order_id;

  select count(*) into item_count
  from public.order_items
  where business_id = current_order.business_id
    and order_id = p_order_id;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
    current_order.business_id,
    p_order_id,
    'updated',
    'Order details updated with ' || item_count::text || ' item'
      || case when item_count = 1 then '' else 's' end || '.',
    jsonb_build_object(
      'itemCount', item_count,
      'total', updated_order.total,
      'currency', updated_order.currency
    ),
    actor_id,
    actor_name
  );

  return updated_order;
end;
$$;

create or replace function public.update_order_status(
  p_order_id uuid,
  p_status text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_order public.orders;
  updated_order public.orders;
  normalized_status text := nullif(lower(btrim(p_status)), '');
  previous_status text;
begin
  if actor_id is null then
    raise exception 'Sign in to manage orders.'
      using errcode = '28000';
  end if;

  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    current_order.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage orders.'
      using errcode = '42501';
  end if;

  if normalized_status is null
     or normalized_status not in (
       'awaiting_confirmation',
       'confirmed',
       'processing',
       'ready',
       'completed'
     ) then
    raise exception 'Choose a valid order status.'
      using errcode = '22023';
  end if;

  if normalized_status = current_order.status then
    raise exception 'The order is already in that status.'
      using errcode = '22023';
  end if;

  if not (
    (current_order.status = 'draft' and normalized_status = 'awaiting_confirmation')
    or (
      current_order.status = 'awaiting_confirmation'
      and normalized_status = 'confirmed'
    )
    or (current_order.status = 'confirmed' and normalized_status = 'processing')
    or (current_order.status = 'processing' and normalized_status = 'ready')
    or (current_order.status = 'ready' and normalized_status = 'completed')
  ) then
    raise exception 'That order status change is not allowed.'
      using errcode = '22023';
  end if;

  previous_status := current_order.status;

  if normalized_status = 'confirmed' then
    perform public.reserve_order_stock(p_order_id);
  elsif normalized_status = 'completed' then
    perform public.consume_order_stock(p_order_id);
  end if;

  update public.orders
  set
    status = normalized_status,
    confirmed_at = case
      when normalized_status = 'confirmed' then coalesce(confirmed_at, now())
      else confirmed_at
    end,
    completed_at = case
      when normalized_status = 'completed' then coalesce(completed_at, now())
      else completed_at
    end,
    updated_by = actor_id
  where id = p_order_id;

  select * into updated_order
  from public.orders
  where id = p_order_id;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
    current_order.business_id,
    p_order_id,
    'status_changed',
    case
      when normalized_status = 'confirmed'
        then 'Order confirmed and stock reserved.'
      when normalized_status = 'completed'
        then 'Order completed and reserved stock consumed.'
      else 'Order status changed from '
        || replace(previous_status, '_', ' ') || ' to '
        || replace(normalized_status, '_', ' ') || '.'
    end,
    jsonb_build_object(
      'from', previous_status,
      'to', normalized_status,
      'stockState', updated_order.stock_state
    ),
    actor_id,
    actor_name
  );

  return updated_order;
end;
$$;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_order public.orders;
  updated_order public.orders;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null then
    raise exception 'Sign in to manage orders.'
      using errcode = '28000';
  end if;

  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    current_order.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to manage orders.'
      using errcode = '42501';
  end if;

  if current_order.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled orders cannot be cancelled.'
      using errcode = '22023';
  end if;

  if normalized_reason is null
     or char_length(normalized_reason) < 3
     or char_length(normalized_reason) > 500 then
    raise exception 'Add a cancellation reason between 3 and 500 characters.'
      using errcode = '22023';
  end if;

  if current_order.stock_state = 'reserved' then
    perform public.release_order_stock(p_order_id);
  end if;

  update public.orders
  set
    status = 'cancelled',
    cancellation_reason = normalized_reason,
    cancelled_at = coalesce(cancelled_at, now()),
    updated_by = actor_id
  where id = p_order_id;

  select * into updated_order
  from public.orders
  where id = p_order_id;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
    current_order.business_id,
    p_order_id,
    'cancelled',
    'Order cancelled: ' || left(normalized_reason, 200),
    jsonb_build_object(
      'reason', normalized_reason,
      'previousStatus', current_order.status,
      'stockState', updated_order.stock_state
    ),
    actor_id,
    actor_name
  );

  return updated_order;
end;
$$;

revoke all on function public.prevent_order_event_update()
from public, anon, authenticated;
revoke all on function public.sync_order_totals()
from public, anon, authenticated;
revoke all on function public.next_order_number(uuid)
from public, anon, authenticated;
revoke all on function public.create_order_item_record(
  uuid, uuid, uuid, uuid, integer, numeric
) from public, anon, authenticated;
revoke all on function public.reserve_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.release_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.consume_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.search_orders(
  uuid, text, text, uuid, uuid, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.search_order_catalogue(
  uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_order_overview(uuid)
from public, anon, authenticated;
revoke all on function public.create_order(uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.update_order(uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.update_order_status(uuid, text)
from public, anon, authenticated;
revoke all on function public.cancel_order(uuid, text)
from public, anon, authenticated;

grant execute on function public.search_orders(
  uuid, text, text, uuid, uuid, integer, integer, text, text
) to authenticated, service_role;
grant execute on function public.search_order_catalogue(
  uuid, text, integer, integer
) to authenticated, service_role;
grant execute on function public.get_order_overview(uuid)
to authenticated, service_role;
grant execute on function public.create_order(uuid, uuid, text, jsonb)
to authenticated, service_role;
grant execute on function public.update_order(uuid, uuid, text, jsonb)
to authenticated, service_role;
grant execute on function public.update_order_status(uuid, text)
to authenticated, service_role;
grant execute on function public.cancel_order(uuid, text)
to authenticated, service_role;
