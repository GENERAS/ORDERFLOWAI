create table if not exists public.storefront_checkout_references (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  token_hash text not null unique,
  items jsonb not null,
  channel text not null default 'online_store' check (channel in ('online_store', 'whatsapp')),
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  order_id uuid references public.orders(id) on delete set null,
  constraint storefront_checkout_references_expiry_check check (expires_at > created_at)
);

create index if not exists storefront_checkout_references_store_created_idx
on public.storefront_checkout_references (store_id, created_at desc);

alter table public.storefront_checkout_references enable row level security;

revoke all on public.storefront_checkout_references from anon, authenticated;

create or replace function public.create_storefront_checkout_reference(
  p_store_slug text,
  p_items jsonb,
  p_channel text default 'online_store'
)
returns table (
  reference text,
  checkout_path text,
  expires_at timestamptz,
  item_count integer,
  currency text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_channel text := lower(btrim(coalesce(p_channel, 'online_store')));
  store_row public.stores;
  business_row public.businesses;
  item jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_quantity integer;
  variant_count integer;
  normalized_items jsonb := '[]'::jsonb;
  uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  token text;
  token_hash text;
  expires_at_value timestamptz := now() + interval '30 minutes';
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

  if normalized_channel not in ('online_store', 'whatsapp') then
    raise exception 'Unsupported checkout channel.'
      using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Add between 1 and 50 items to your order.'
      using errcode = '22023';
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
    where v.product_id = item_product_id
      and v.business_id = store_row.business_id
      and v.status = 'active';

    if variant_count > 0 and item_variant_id is null then
      raise exception 'Choose a variant for this product.'
        using errcode = '22023';
    end if;

    if variant_count = 0 and item_variant_id is not null then
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

    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', item_product_id,
        'variant_id', item_variant_id,
        'quantity', item_quantity
      )
    );
  end loop;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash := encode(extensions.digest(token, 'sha256'), 'hex');

  insert into public.storefront_checkout_references (
    business_id,
    store_id,
    token_hash,
    items,
    channel,
    expires_at
  )
  values (
    store_row.business_id,
    store_row.id,
    token_hash,
    normalized_items,
    normalized_channel,
    expires_at_value
  );

  return query
  select
    token,
    '/store/' || normalized_slug || '/checkout/' || token,
    expires_at_value,
    jsonb_array_length(normalized_items)::integer,
    business_row.currency;
end;
$$;

create or replace function public.get_storefront_checkout_reference(
  p_store_slug text,
  p_reference text
)
returns table (
  store_name text,
  store_slug text,
  currency text,
  items jsonb,
  estimated_total numeric,
  expires_at timestamptz,
  channel text
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_reference text := lower(btrim(p_reference));
  reference_row public.storefront_checkout_references;
  store_row public.stores;
  business_row public.businesses;
  item jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_quantity integer;
  item_name text;
  item_variant_name text;
  item_price numeric;
  line_total numeric;
  resolved_items jsonb := '[]'::jsonb;
  resolved_total numeric := 0;
begin
  if normalized_reference is null or char_length(normalized_reference) > 256 then
    raise exception 'This checkout link is not valid.'
      using errcode = '22023';
  end if;

  select r.* into reference_row
  from public.storefront_checkout_references r
  where r.token_hash = encode(extensions.digest(normalized_reference, 'sha256'), 'hex')
    and r.status = 'active'
    and r.expires_at > now();

  if not found then
    raise exception 'This checkout link has expired or has already been used.'
      using errcode = '22023';
  end if;

  select s.* into store_row
  from public.stores s
  where s.id = reference_row.store_id
    and s.slug = normalized_slug
    and s.status = 'active';

  if not found then
    raise exception 'This checkout link is not valid for this store.'
      using errcode = '22023';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = store_row.business_id;

  for item in select * from jsonb_array_elements(reference_row.items)
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_variant_id := nullif(item ->> 'variant_id', '')::uuid;
    item_quantity := (item ->> 'quantity')::integer;

    select p.name, v.name, coalesce(v.price_override, p.price)
    into item_name, item_variant_name, item_price
    from public.products p
    left join public.product_variants v
      on v.id = item_variant_id
     and v.business_id = p.business_id
     and v.status = 'active'
    where p.id = item_product_id
      and p.business_id = store_row.business_id
      and p.status = 'active'
      and p.storefront_visible;

    if not found then
      raise exception 'One or more products in this checkout link are no longer available.'
        using errcode = '22023';
    end if;

    line_total := item_price * item_quantity;
    resolved_total := resolved_total + line_total;
    resolved_items := resolved_items || jsonb_build_array(
      jsonb_build_object(
        'productId', item_product_id,
        'variantId', item_variant_id,
        'name', item_name,
        'variantName', coalesce(item_variant_name, ''),
        'quantity', item_quantity,
        'unitPrice', item_price,
        'lineTotal', line_total
      )
    );
  end loop;

  return query
  select
    store_row.name,
    store_row.slug,
    business_row.currency,
    resolved_items,
    resolved_total,
    reference_row.expires_at,
    reference_row.channel;
end;
$$;

create or replace function public.submit_storefront_order(
  p_store_slug text,
  p_customer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_city text,
  p_instructions text,
  p_items jsonb,
  p_idempotency_key text,
  p_checkout_reference text,
  p_channel text
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
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_reference text := lower(btrim(p_checkout_reference));
  normalized_channel text;
  store_row public.stores;
  reference_row public.storefront_checkout_references;
  created_order_id uuid;
  created_order_number text;
  created_order_status text;
  created_order_total numeric;
  created_order_currency text;
  created_order_created_at timestamptz;
  created_order_message text;
begin
  select s.* into store_row
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if not found then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  if normalized_reference is null or char_length(normalized_reference) > 256 then
    raise exception 'This checkout link is not valid.'
      using errcode = '22023';
  end if;

  select r.* into reference_row
  from public.storefront_checkout_references r
  where r.token_hash = encode(extensions.digest(normalized_reference, 'sha256'), 'hex')
  for update;

  if not found
     or reference_row.status <> 'active'
     or reference_row.expires_at <= now()
     or reference_row.store_id <> store_row.id
     or reference_row.items is distinct from p_items then
    raise exception 'This checkout link has expired or does not match your cart.'
      using errcode = '22023';
  end if;

  normalized_channel := lower(btrim(coalesce(p_channel, reference_row.channel, 'online_store')));

  if normalized_channel not in ('online_store', 'whatsapp') then
    raise exception 'Unsupported checkout channel.'
      using errcode = '22023';
  end if;

  update public.storefront_checkout_references
  set status = 'used',
      used_at = now()
  where public.storefront_checkout_references.id = reference_row.id
    and public.storefront_checkout_references.status = 'active';

  if not found then
    raise exception 'This checkout link has already been used.'
      using errcode = '22023';
  end if;

  select *
  into
    created_order_number,
    created_order_status,
    created_order_total,
    created_order_currency,
    created_order_created_at,
    created_order_message
  from public.submit_storefront_order(
    p_store_slug,
    p_customer_name,
    p_phone,
    p_email,
    p_address,
    p_city,
    p_instructions,
    p_items,
    'reference:' || reference_row.id::text
  );

  select o.id into created_order_id
  from public.orders o
  where o.business_id = store_row.business_id
    and o.order_number = created_order_number;

  update public.orders
  set source = 'storefront',
      channel = case when normalized_channel = 'whatsapp' then 'whatsapp' else null end,
      delivery_method = normalized_channel,
      delivery_address = nullif(btrim(coalesce(p_address, '')), ''),
      delivery_instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
      customer_confirmed_at = now()
  where id = created_order_id;

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
    created_order_id,
    'updated',
    case
      when normalized_channel = 'whatsapp' then 'WhatsApp checkout confirmed by customer.'
      else 'Online store checkout confirmed by customer.'
    end,
    jsonb_build_object(
      'source', 'storefront',
      'channel', normalized_channel,
      'checkoutReferenceId', reference_row.id
    ),
    null,
    'Online storefront'
  );

  update public.storefront_checkout_references
  set order_id = created_order_id
  where id = reference_row.id;

  order_number := created_order_number;
  status := created_order_status;
  total := created_order_total;
  currency := created_order_currency;
  created_at := created_order_created_at;
  message := created_order_message;

  return next;
end;
$$;

revoke all on function public.create_storefront_checkout_reference(text, jsonb, text)
from public, anon, authenticated;
revoke all on function public.get_storefront_checkout_reference(text, text)
from public, anon, authenticated;
revoke all on function public.submit_storefront_order(
  text, text, text, text, text, text, text, jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_storefront_checkout_reference(text, jsonb, text)
to anon, authenticated, service_role;
grant execute on function public.get_storefront_checkout_reference(text, text)
to anon, authenticated, service_role;
grant execute on function public.submit_storefront_order(
  text, text, text, text, text, text, text, jsonb, text, text, text
) to anon, authenticated, service_role;
