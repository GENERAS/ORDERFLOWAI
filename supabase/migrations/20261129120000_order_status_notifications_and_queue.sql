-- Automatic customer status notifications, disconnected-WhatsApp fallback and storefront order inbox.

create table if not exists public.storefront_order_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  checkout_reference_id uuid references public.storefront_checkout_references(id) on delete set null,
  event_key text not null check (
    event_key in ('received', 'confirmed', 'processing', 'ready', 'completed', 'cancelled')
  ),
  title text not null,
  message text not null,
  delivery_channel text not null default 'storefront' check (
    delivery_channel in ('storefront', 'whatsapp')
  ),
  whatsapp_connected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (order_id, event_key)
);

create index if not exists storefront_order_notifications_order_created_idx
on public.storefront_order_notifications (order_id, created_at desc);

create index if not exists storefront_order_notifications_business_created_idx
on public.storefront_order_notifications (business_id, created_at desc);

create index if not exists orders_business_source_status_idx
on public.orders (business_id, source, status, created_at desc);

alter table public.storefront_order_notifications enable row level security;

revoke all on public.storefront_order_notifications from anon, authenticated;

create or replace function public.storefront_is_whatsapp_connected(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.business_channel_connections c
    where c.business_id = p_business_id
      and c.channel = 'whatsapp'
      and c.status = 'connected'
      and (c.token_expires_at is null or c.token_expires_at > now())
  );
$$;

create or replace function public.queue_storefront_order_notification(
  p_order_id uuid,
  p_event_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_reference_id uuid;
  v_event_key text := lower(btrim(coalesce(p_event_key, '')));
  v_connected boolean := false;
  v_title text;
  v_message text;
begin
  select o.* into v_order
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return false;
  end if;

  select r.id into v_reference_id
  from public.storefront_checkout_references r
  where r.order_id = p_order_id
  order by r.used_at desc nulls last, r.created_at desc
  limit 1;

  if not found then
    return false;
  end if;

  if v_event_key not in ('received', 'confirmed', 'processing', 'ready', 'completed', 'cancelled') then
    return false;
  end if;

  v_connected := public.storefront_is_whatsapp_connected(v_order.business_id);

  v_title := case v_event_key
    when 'received' then 'Order received'
    when 'confirmed' then 'Order confirmed'
    when 'processing' then 'Order is being prepared'
    when 'ready' then 'Order is ready'
    when 'completed' then 'Order completed'
    when 'cancelled' then 'Order cancelled'
  end;

  v_message := case v_event_key
    when 'received'
      then 'We received order ' || v_order.order_number || '. It is waiting for business approval.'
    when 'confirmed'
      then 'Order ' || v_order.order_number || ' has been confirmed and is proceeding.'
    when 'processing'
      then 'Order ' || v_order.order_number || ' is being prepared.'
    when 'ready'
      then 'Order ' || v_order.order_number || ' is ready for collection or delivery.'
    when 'completed'
      then 'Order ' || v_order.order_number || ' has been completed. Thank you.'
    when 'cancelled'
      then 'Order ' || v_order.order_number || ' was cancelled. Open the store for more details.'
  end;

  insert into public.storefront_order_notifications (
    business_id,
    order_id,
    checkout_reference_id,
    event_key,
    title,
    message,
    delivery_channel,
    whatsapp_connected
  )
  values (
    v_order.business_id,
    v_order.id,
    v_reference_id,
    v_event_key,
    v_title,
    v_message,
    case when v_connected then 'whatsapp' else 'storefront' end,
    v_connected
  )
  on conflict (order_id, event_key) do nothing;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function public.storefront_reference_order_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.order_id is not null
     and (tg_op = 'INSERT' or old.order_id is null or old.order_id is distinct from new.order_id) then
    perform public.queue_storefront_order_notification(new.order_id, 'received');
  end if;
  return null;
end;
$$;

drop trigger if exists storefront_checkout_references_order_notification
on public.storefront_checkout_references;

create trigger storefront_checkout_references_order_notification
after insert or update of order_id on public.storefront_checkout_references
for each row
execute function public.storefront_reference_order_created_notification();

create or replace function public.storefront_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_key text;
begin
  if new.status is distinct from old.status then
    v_event_key := case new.status
      when 'awaiting_business_approval' then 'received'
      when 'confirmed' then 'confirmed'
      when 'processing' then 'processing'
      when 'ready' then 'ready'
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      else null
    end;

    if v_event_key is not null then
      perform public.queue_storefront_order_notification(new.id, v_event_key);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists storefront_order_status_notification
on public.orders;

create trigger storefront_order_status_notification
after update of status on public.orders
for each row
execute function public.storefront_order_status_notification();

create or replace function public.get_storefront_order_status(
  p_store_slug text,
  p_reference text
)
returns table (
  order_number text,
  status text,
  status_title text,
  status_message text,
  total numeric,
  currency text,
  created_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  channel text,
  whatsapp_connected boolean,
  notification_channel text,
  latest_notification jsonb,
  timeline jsonb
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_reference text := lower(btrim(p_reference));
  v_store public.stores;
  v_reference public.storefront_checkout_references;
  v_order public.orders;
  v_connected boolean := false;
  v_status_rank integer := 0;
  v_status_title text;
  v_status_message text;
  v_latest_notification jsonb := null;
  v_timeline jsonb := '[]'::jsonb;
begin
  if normalized_reference is null or char_length(normalized_reference) > 256 then
    raise exception 'This order link is not valid.'
      using errcode = '22023';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = normalized_slug;

  if not found then
    raise exception 'This order link is not valid for this store.'
      using errcode = '22023';
  end if;

  select r.* into v_reference
  from public.storefront_checkout_references r
  where r.store_id = v_store.id
    and r.token_hash = encode(extensions.digest(normalized_reference, 'sha256'), 'hex')
    and r.order_id is not null;

  if not found then
    raise exception 'No order has been placed with this link yet.'
      using errcode = '22023';
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = v_reference.order_id
    and o.business_id = v_store.business_id;

  if not found then
    raise exception 'This order could not be found.'
      using errcode = '22023';
  end if;

  v_connected := public.storefront_is_whatsapp_connected(v_order.business_id);

  v_status_rank := case v_order.status
    when 'awaiting_business_approval' then 1
    when 'confirmed' then 2
    when 'processing' then 3
    when 'ready' then 4
    when 'completed' then 5
    else 0
  end;

  v_status_title := case v_order.status
    when 'awaiting_business_approval' then 'Order received'
    when 'confirmed' then 'Confirmed - proceeding'
    when 'processing' then 'Being prepared'
    when 'ready' then 'Ready'
    when 'completed' then 'Completed'
    when 'cancelled' then 'Cancelled'
    else 'Order received'
  end;

  v_status_message := case v_order.status
    when 'awaiting_business_approval'
      then 'Your order was received and is waiting for the business to confirm it.'
    when 'confirmed'
      then 'The business confirmed your order. It is now proceeding automatically in the system.'
    when 'processing'
      then 'Your order is being prepared.'
    when 'ready'
      then 'Your order is ready for collection or delivery.'
    when 'completed'
      then 'Your order is complete. Thank you for ordering.'
    when 'cancelled'
      then 'This order was cancelled. You can place a new order from the store.'
    else 'Your order was received.'
  end;

  select jsonb_build_object(
    'title', n.title,
    'message', n.message,
    'createdAt', n.created_at,
    'deliveryChannel', n.delivery_channel,
    'whatsappConnected', n.whatsapp_connected
  )
  into v_latest_notification
  from public.storefront_order_notifications n
  where n.order_id = v_order.id
  order by
    n.created_at desc,
    case n.event_key
      when 'received' then 0
      when 'confirmed' then 1
      when 'processing' then 2
      when 'ready' then 3
      when 'completed' then 4
      when 'cancelled' then 5
      else 0
    end desc
  limit 1;

  v_timeline := jsonb_build_array(
    jsonb_build_object(
      'key', 'received',
      'label', 'Order received',
      'complete', v_status_rank >= 1,
      'current', v_order.status = 'awaiting_business_approval',
      'at', v_order.created_at
    ),
    jsonb_build_object(
      'key', 'confirmed',
      'label', 'Business confirmed',
      'complete', v_status_rank >= 2,
      'current', v_order.status = 'confirmed',
      'at', v_order.confirmed_at
    ),
    jsonb_build_object(
      'key', 'processing',
      'label', 'Preparing',
      'complete', v_status_rank >= 3,
      'current', v_order.status = 'processing',
      'at', null
    ),
    jsonb_build_object(
      'key', 'ready',
      'label', 'Ready',
      'complete', v_status_rank >= 4,
      'current', v_order.status = 'ready',
      'at', null
    ),
    jsonb_build_object(
      'key', 'completed',
      'label', 'Completed',
      'complete', v_status_rank >= 5,
      'current', v_order.status = 'completed',
      'at', v_order.completed_at
    )
  );

  if v_order.status = 'cancelled' then
    v_timeline := v_timeline || jsonb_build_array(
      jsonb_build_object(
        'key', 'cancelled',
        'label', 'Cancelled',
        'complete', true,
        'current', true,
        'at', v_order.cancelled_at
      )
    );
  end if;

  return query
  select
    v_order.order_number,
    v_order.status,
    v_status_title,
    v_status_message,
    v_order.total,
    v_order.currency,
    v_order.created_at,
    v_order.confirmed_at,
    v_order.completed_at,
    v_reference.channel,
    v_connected,
    case when v_connected then 'whatsapp' else 'storefront' end,
    v_latest_notification,
    v_timeline;
end;
$$;

create or replace function public.list_storefront_order_queue(
  p_business_id uuid,
  p_status text default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  order_number text,
  customer_name text,
  customer_phone text,
  status text,
  stock_state text,
  source text,
  channel text,
  currency text,
  total numeric,
  item_count integer,
  delivery_method text,
  customer_confirmed_at timestamptz,
  created_at timestamptz,
  whatsapp_connected boolean,
  latest_notification_title text,
  latest_notification_message text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_status text := nullif(lower(btrim(p_status)), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to view these orders.'
      using errcode = '42501';
  end if;

  if normalized_status is not null and normalized_status not in (
    'draft',
    'awaiting_confirmation',
    'awaiting_business_approval',
    'confirmed',
    'processing',
    'ready',
    'completed',
    'cancelled'
  ) then
    raise exception 'Choose a valid order status.'
      using errcode = '22023';
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.customer_name_snapshot,
    o.customer_phone_snapshot,
    o.status,
    o.stock_state,
    o.source,
    o.channel,
    o.currency,
    o.total,
    (
      select count(*)::integer
      from public.order_items oi
      where oi.order_id = o.id
    ) as item_count,
    o.delivery_method,
    o.customer_confirmed_at,
    o.created_at,
    public.storefront_is_whatsapp_connected(o.business_id) as whatsapp_connected,
    n.title as latest_notification_title,
    n.message as latest_notification_message
  from public.orders o
  left join lateral (
    select sn.title, sn.message
    from public.storefront_order_notifications sn
    where sn.order_id = o.id
    order by
      sn.created_at desc,
      case sn.event_key
        when 'received' then 0
        when 'confirmed' then 1
        when 'processing' then 2
        when 'ready' then 3
        when 'completed' then 4
        when 'cancelled' then 5
        else 0
      end desc
    limit 1
  ) n on true
  where o.business_id = p_business_id
    and o.source = 'storefront'
    and (normalized_status is null or o.status = normalized_status)
  order by
    case o.status
      when 'awaiting_business_approval' then 0
      when 'confirmed' then 1
      when 'processing' then 2
      when 'ready' then 3
      when 'completed' then 4
      else 5
    end,
    o.created_at desc
  limit safe_limit;
end;
$$;

revoke all on function public.storefront_is_whatsapp_connected(uuid) from public;
grant execute on function public.storefront_is_whatsapp_connected(uuid) to authenticated, service_role;

revoke all on function public.queue_storefront_order_notification(uuid, text) from public;
grant execute on function public.queue_storefront_order_notification(uuid, text) to service_role;

revoke all on function public.storefront_reference_order_created_notification() from public;
revoke all on function public.storefront_order_status_notification() from public;

revoke all on function public.get_storefront_order_status(text, text) from public;
grant execute on function public.get_storefront_order_status(text, text) to anon, authenticated, service_role;

revoke all on function public.list_storefront_order_queue(uuid, text, integer) from public;
grant execute on function public.list_storefront_order_queue(uuid, text, integer) to authenticated, service_role;
