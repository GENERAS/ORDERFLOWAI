-- Day 7 hardening: customer/business confirmation, guest orders, server pricing,
-- fulfilment permissions and date filters.

alter table public.orders
drop constraint orders_status_check;

alter table public.orders
add constraint orders_status_check check (
  status in (
    'draft',
    'awaiting_confirmation',
    'awaiting_business_approval',
    'confirmed',
    'processing',
    'ready',
    'completed',
    'cancelled'
  )
);

alter table public.orders
alter column customer_id drop not null;

alter table public.order_events
drop constraint order_events_type_check;

alter table public.order_events
add constraint order_events_type_check check (
  event_type in (
    'created',
    'updated',
    'status_changed',
    'customer_confirmed',
    'business_approved',
    'stock_reserved',
    'stock_released',
    'stock_consumed',
    'fulfilled',
    'cancelled'
  )
);

drop function if exists public.create_order(uuid, uuid, text, jsonb);
drop function if exists public.update_order(uuid, uuid, text, jsonb);
drop function if exists public.create_order_item_record(
  uuid, uuid, uuid, uuid, integer, numeric
);
drop function if exists public.search_orders(
  uuid, text, text, uuid, uuid, integer, integer, text, text
);
drop function if exists public.get_order_overview(uuid);

create or replace function public.create_order_item_record(
  p_business_id uuid,
  p_order_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
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

  resolved_price := coalesce(current_variant.price_override, current_product.price);

  if resolved_price is null or resolved_price < 0 then
    raise exception 'This product does not have a valid catalogue price.'
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
  actor_id uuid := auth.uid();
  actor_name text;
begin
  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
        'stock_reserved',
        'Reserved ' || item.quantity::text || ' unit'
          || case when item.quantity = 1 then '' else 's' end
          || ' for order ' || current_order.order_number || '.',
        jsonb_build_object(
          'orderItemId', item.id,
          'inventoryItemId', item.inventory_item_id,
          'quantity', item.quantity
        ),
        actor_id,
        actor_name
      );
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
  actor_id uuid := auth.uid();
  actor_name text;
begin
  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
      'stock_released',
      'Released ' || item.reserved_quantity::text || ' reserved unit'
        || case when item.reserved_quantity = 1 then '' else 's' end
        || ' for order ' || current_order.order_number || '.',
      jsonb_build_object(
        'orderItemId', item.id,
        'inventoryItemId', item.inventory_item_id,
        'quantity', item.reserved_quantity
      ),
      actor_id,
      actor_name
    );

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
  actor_id uuid := auth.uid();
  actor_name text;
begin
  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Team member')
  into actor_name
  from public.profiles p
  where p.id = actor_id;

  actor_name := coalesce(actor_name, 'Team member');

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
      'Order ' || current_order.order_number || ' fulfilled',
      'order:' || p_order_id::text || ':complete-release:' || item.id::text
    );

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
      'stock_released',
      'Released the reservation for order ' || current_order.order_number || '.',
      jsonb_build_object(
        'orderItemId', item.id,
        'inventoryItemId', item.inventory_item_id,
        'quantity', item.reserved_quantity
      ),
      actor_id,
      actor_name
    );

    perform public.record_stock_operation(
      item.inventory_item_id,
      'reduce',
      -item.reserved_quantity,
      'Order ' || current_order.order_number || ' fulfilled',
      'order:' || p_order_id::text || ':complete-consume:' || item.id::text
    );

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
      'stock_consumed',
      'Consumed ' || item.reserved_quantity::text || ' unit'
        || case when item.reserved_quantity = 1 then '' else 's' end
        || ' for fulfilled order ' || current_order.order_number || '.',
      jsonb_build_object(
        'orderItemId', item.id,
        'inventoryItemId', item.inventory_item_id,
        'quantity', item.reserved_quantity
      ),
      actor_id,
      actor_name
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
  p_direction text default 'desc',
  p_created_from date default null,
  p_created_to date default null
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

  if p_created_from is not null
     and p_created_to is not null
     and p_created_from > p_created_to then
    raise exception 'The order date range is not valid.'
      using errcode = '22023';
  end if;

  if normalized_status is not null
     and normalized_status not in (
       'all',
       'draft',
       'awaiting_confirmation',
       'awaiting_business_approval',
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
      p_created_from is null
      or o.created_at >= p_created_from::timestamptz
    )
    and (
      p_created_to is null
      or o.created_at < (p_created_to + 1)::timestamptz
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

create or replace function public.get_order_overview(p_business_id uuid)
returns table (
  total_orders bigint,
  draft_count bigint,
  awaiting_confirmation_count bigint,
  awaiting_business_approval_count bigint,
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
    count(*) filter (where o.status = 'awaiting_business_approval')::bigint,
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
  p_customer_id uuid default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email text default null,
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
  customer_name text;
  customer_phone text;
  customer_email text;
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

  if p_customer_id is not null then
    select * into current_customer
    from public.customers
    where id = p_customer_id
      and business_id = p_business_id;

    if not found then
      raise exception 'Choose a customer from this workspace.'
        using errcode = '22023';
    end if;

    customer_name := current_customer.full_name;
    customer_phone := current_customer.phone;
    customer_email := current_customer.email;
  else
    customer_name := nullif(btrim(p_guest_name), '');
    customer_phone := nullif(btrim(p_guest_phone), '');
    customer_email := nullif(btrim(p_guest_email), '');

    if customer_name is null
       or char_length(customer_name) not between 1 and 160 then
      raise exception 'Choose a customer or enter the walk-in customer name.'
        using errcode = '22023';
    end if;

    if customer_phone is not null
       and char_length(customer_phone) not between 7 and 32 then
      raise exception 'Enter a valid walk-in customer phone number.'
        using errcode = '22023';
    end if;

    if customer_email is not null
       and (
         char_length(customer_email) not between 3 and 254
         or position('@' in customer_email) <= 1
       ) then
      raise exception 'Enter a valid walk-in customer email address.'
        using errcode = '22023';
    end if;
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

  for item in select * from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(item ->> 'unit_price'), '') is not null
       or nullif(btrim(item ->> 'unitPrice'), '') is not null
       or nullif(btrim(item ->> 'line_total'), '') is not null then
      raise exception 'Order prices are calculated by the server and cannot be supplied by the client.'
        using errcode = '22023';
    end if;
  end loop;

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
    p_customer_id,
    customer_name,
    customer_phone,
    customer_email,
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
      (item ->> 'quantity')::integer
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
      'currency', created_order.currency,
      'customerType', case when p_customer_id is null then 'guest' else 'customer' end
    ),
    actor_id,
    actor_name
  );

  return created_order;
end;
$$;

create or replace function public.update_order(
  p_order_id uuid,
  p_customer_id uuid default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email text default null,
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
  customer_name text;
  customer_phone text;
  customer_email text;
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
    raise exception 'Only draft or awaiting customer confirmation orders can be edited. Cancel the order to make changes after confirmation.'
      using errcode = '22023';
  end if;

  if p_customer_id is not null then
    select * into current_customer
    from public.customers
    where id = p_customer_id
      and business_id = current_order.business_id;

    if not found then
      raise exception 'Choose a customer from this workspace.'
        using errcode = '22023';
    end if;

    customer_name := current_customer.full_name;
    customer_phone := current_customer.phone;
    customer_email := current_customer.email;
  else
    customer_name := nullif(btrim(p_guest_name), '');
    customer_phone := nullif(btrim(p_guest_phone), '');
    customer_email := nullif(btrim(p_guest_email), '');

    if customer_name is null
       or char_length(customer_name) not between 1 and 160 then
      raise exception 'Choose a customer or enter the walk-in customer name.'
        using errcode = '22023';
    end if;

    if customer_phone is not null
       and char_length(customer_phone) not between 7 and 32 then
      raise exception 'Enter a valid walk-in customer phone number.'
        using errcode = '22023';
    end if;

    if customer_email is not null
       and (
         char_length(customer_email) not between 3 and 254
         or position('@' in customer_email) <= 1
       ) then
      raise exception 'Enter a valid walk-in customer email address.'
        using errcode = '22023';
    end if;
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

  for item in select * from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(item ->> 'unit_price'), '') is not null
       or nullif(btrim(item ->> 'unitPrice'), '') is not null
       or nullif(btrim(item ->> 'line_total'), '') is not null then
      raise exception 'Order prices are calculated by the server and cannot be supplied by the client.'
        using errcode = '22023';
    end if;
  end loop;

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
      (item ->> 'quantity')::integer
    );
  end loop;

  update public.orders
  set
    customer_id = p_customer_id,
    customer_name_snapshot = customer_name,
    customer_phone_snapshot = customer_phone,
    customer_email_snapshot = customer_email,
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
      'currency', updated_order.currency,
      'customerType', case when p_customer_id is null then 'guest' else 'customer' end
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
  event_type text;
  event_summary text;
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
       'awaiting_business_approval',
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
      and normalized_status = 'awaiting_business_approval'
    )
    or (
      current_order.status = 'awaiting_business_approval'
      and normalized_status = 'confirmed'
    )
    or (current_order.status = 'confirmed' and normalized_status = 'processing')
    or (current_order.status = 'processing' and normalized_status = 'ready')
    or (current_order.status = 'ready' and normalized_status = 'completed')
  ) then
    raise exception 'That order status change is not allowed.'
      using errcode = '22023';
  end if;

  if normalized_status in ('confirmed', 'completed')
     and not public.has_business_role(
       current_order.business_id,
       array['owner', 'admin', 'manager']
     ) then
    raise exception 'Only owners, admins and managers can approve or fulfil orders.'
      using errcode = '42501';
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

  event_type := case
    when normalized_status = 'awaiting_business_approval' then 'customer_confirmed'
    when normalized_status = 'confirmed' then 'business_approved'
    when normalized_status = 'completed' then 'fulfilled'
    else 'status_changed'
  end;

  event_summary := case
    when normalized_status = 'awaiting_business_approval'
      then 'Customer confirmation recorded. Awaiting business approval.'
    when normalized_status = 'confirmed'
      then 'Order approved by the business and stock reserved.'
    when normalized_status = 'completed'
      then 'Order fulfilled and reserved stock consumed.'
    else 'Order status changed from '
      || replace(previous_status, '_', ' ') || ' to '
      || replace(normalized_status, '_', ' ') || '.'
  end;

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
    event_type,
    event_summary,
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
  uuid, uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.reserve_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.release_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.consume_order_stock(uuid)
from public, anon, authenticated;
revoke all on function public.search_orders(
  uuid, text, text, uuid, uuid, integer, integer, text, text, date, date
) from public, anon, authenticated;
revoke all on function public.search_order_catalogue(
  uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_order_overview(uuid)
from public, anon, authenticated;
revoke all on function public.create_order(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_order(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_order_status(uuid, text)
from public, anon, authenticated;
revoke all on function public.cancel_order(uuid, text)
from public, anon, authenticated;

grant execute on function public.search_orders(
  uuid, text, text, uuid, uuid, integer, integer, text, text, date, date
) to authenticated, service_role;
grant execute on function public.search_order_catalogue(
  uuid, text, integer, integer
) to authenticated, service_role;
grant execute on function public.get_order_overview(uuid)
to authenticated, service_role;
grant execute on function public.create_order(
  uuid, uuid, text, text, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.update_order(
  uuid, uuid, text, text, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.update_order_status(uuid, text)
to authenticated, service_role;
grant execute on function public.cancel_order(uuid, text)
to authenticated, service_role;
