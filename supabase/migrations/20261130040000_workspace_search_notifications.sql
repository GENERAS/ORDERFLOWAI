create table if not exists public.workspace_notification_reads (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  primary key (business_id, user_id, notification_key),
  constraint workspace_notification_reads_key_check
    check (char_length(btrim(notification_key)) between 1 and 255)
);

create index if not exists workspace_notification_reads_user_idx
on public.workspace_notification_reads (business_id, user_id, read_at desc);

alter table public.workspace_notification_reads enable row level security;

revoke all on public.workspace_notification_reads from public, anon, authenticated, service_role;

create or replace function public.workspace_global_search(
  p_business_id uuid,
  p_query text,
  p_limit integer default 8
)
returns table (
  result_type text,
  id uuid,
  title text,
  subtitle text,
  href text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  query_digits text := regexp_replace(normalized_query, '[^0-9]', '', 'g');
  safe_limit integer := least(greatest(coalesce(p_limit, 8), 1), 50);
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to search this workspace.'
      using errcode = '42501';
  end if;

  if normalized_query = '' then
    return;
  end if;

  return query
  with matches as (
    select
      case
        when lower(btrim(p.name)) = normalized_query
          or (
            nullif(btrim(p.sku), '') is not null
            and lower(btrim(p.sku)) = normalized_query
          )
        then 0
        when lower(btrim(p.name)) like normalized_query || '%' then 1
        else 2
      end as sort_rank,
      'product'::text as result_type,
      p.id as id,
      p.name as title,
      left(
        case
          when nullif(btrim(p.sku), '') is not null then 'SKU ' || btrim(p.sku)
          else 'Product'
        end
        || ' · ' || p.currency || ' ' || to_char(p.price, 'FM9999999999990.00'),
        200
      ) as subtitle,
      '/products/' || p.id::text as href
    from public.products p
    where p.business_id = p_business_id
      and p.status = 'active'
      and (
        lower(p.name) like '%' || normalized_query || '%'
        or lower(coalesce(p.sku, '')) like '%' || normalized_query || '%'
        or lower(coalesce(p.barcode, '')) like '%' || normalized_query || '%'
        or (
          length(query_digits) >= 7
          and regexp_replace(coalesce(p.barcode, ''), '[^0-9]', '', 'g')
            like '%' || query_digits || '%'
        )
      )

    union all

    select
      case
        when lower(btrim(c.full_name)) = normalized_query
          or lower(btrim(coalesce(c.email, ''))) = normalized_query
        then 0
        when lower(btrim(c.full_name)) like normalized_query || '%' then 1
        else 2
      end as sort_rank,
      'customer'::text as result_type,
      c.id as id,
      c.full_name as title,
      left(
        case
          when nullif(btrim(c.company_name), '') is not null
            then btrim(c.company_name) || ' · '
          else ''
        end
        || coalesce(
          nullif(btrim(c.email), ''),
          nullif(btrim(c.phone), ''),
          'No contact details'
        ),
        200
      ) as subtitle,
      '/customers/' || c.id::text as href
    from public.customers c
    where c.business_id = p_business_id
      and c.status = 'active'
      and (
        lower(c.full_name) like '%' || normalized_query || '%'
        or lower(coalesce(c.company_name, '')) like '%' || normalized_query || '%'
        or lower(coalesce(c.email, '')) like '%' || normalized_query || '%'
        or lower(coalesce(c.phone, '')) like '%' || normalized_query || '%'
        or (
          length(query_digits) >= 7
          and c.phone_normalized like '%' || query_digits || '%'
        )
      )

    union all

    select
      case
        when lower(btrim(o.order_number)) = normalized_query then 0
        when lower(btrim(o.order_number)) like normalized_query || '%' then 1
        else 2
      end as sort_rank,
      'order'::text as result_type,
      o.id as id,
      'Order ' || o.order_number as title,
      left(
        o.customer_name_snapshot
        || coalesce(' · ' || nullif(btrim(o.customer_phone_snapshot), ''), '')
        || coalesce(' · ' || nullif(btrim(o.customer_email_snapshot), ''), '')
        || ' · ' || o.status,
        200
      ) as subtitle,
      '/orders/' || o.id::text as href
    from public.orders o
    where o.business_id = p_business_id
      and (
        lower(o.order_number) like '%' || normalized_query || '%'
        or lower(coalesce(o.customer_name_snapshot, '')) like '%' || normalized_query || '%'
        or lower(coalesce(o.customer_phone_snapshot, '')) like '%' || normalized_query || '%'
        or lower(coalesce(o.customer_email_snapshot, '')) like '%' || normalized_query || '%'
        or (
          length(query_digits) >= 7
          and regexp_replace(coalesce(o.customer_phone_snapshot, ''), '[^0-9]', '', 'g')
            like '%' || query_digits || '%'
        )
      )
  )
  select
    matches.result_type,
    matches.id,
    matches.title,
    matches.subtitle,
    matches.href
  from matches
  order by matches.sort_rank, matches.title, matches.id
  limit safe_limit;
end;
$$;

create or replace function public.workspace_list_notifications(
  p_business_id uuid,
  p_limit integer default 20
)
returns table (
  notification_key text,
  result_type text,
  reference_id uuid,
  title text,
  subtitle text,
  href text,
  occurred_at timestamptz,
  is_read boolean,
  read_at timestamptz,
  unread_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to view these notifications.'
      using errcode = '42501';
  end if;

  return query
  with derived as (
    select
      'storefront_order:' || o.id::text as notification_key,
      'storefront_order'::text as result_type,
      o.id as reference_id,
      'Storefront order awaiting approval'::text as title,
      left(
        '#' || o.order_number || ' · ' || o.customer_name_snapshot
        || ' · ' || o.currency || ' ' || to_char(o.total, 'FM9999999999990.00'),
        200
      ) as subtitle,
      '/orders/' || o.id::text as href,
      coalesce(o.customer_confirmed_at, o.created_at) as occurred_at
    from public.orders o
    where o.business_id = p_business_id
      and o.source = 'storefront'
      and o.status = 'awaiting_business_approval'

    union all

    select
      'payment:' || p.id::text as notification_key,
      'payment'::text as result_type,
      p.id as reference_id,
      case when p.status = 'failed' then 'Payment failed' else 'Payment pending' end as title,
      left(
        p.payment_number
        || ' · ' || coalesce(o.order_number, 'Order')
        || ' · ' || p.currency || ' ' || to_char(p.amount, 'FM9999999999990.00'),
        200
      ) as subtitle,
      '/payments/' || p.id::text as href,
      coalesce(p.failed_at, p.updated_at, p.created_at) as occurred_at
    from public.payments p
    left join public.orders o
      on o.business_id = p.business_id
     and o.id = p.order_id
    where p.business_id = p_business_id
      and p.status in ('pending', 'failed')

    union all

    select
      'whatsapp:' || c.id::text as notification_key,
      'conversation'::text as result_type,
      c.id as reference_id,
      'Unread WhatsApp messages'::text as title,
      left(
        coalesce(nullif(btrim(c.display_name), ''), c.external_customer_id)
        || ' · ' || c.unread_count::text || ' unread',
        200
      ) as subtitle,
      '/inbox?conversation=' || c.id::text as href,
      coalesce(c.last_message_at, c.last_incoming_at, c.updated_at) as occurred_at
    from public.communication_conversations c
    where c.business_id = p_business_id
      and c.channel = 'whatsapp'
      and c.unread_count > 0
      and c.status not in ('resolved', 'archived')

    union all

    select
      'cancelled_order:' || o.id::text as notification_key,
      'cancelled_order'::text as result_type,
      o.id as reference_id,
      'Order cancelled'::text as title,
      left(
        '#' || o.order_number || ' · ' || o.customer_name_snapshot
        || coalesce(' · ' || left(btrim(o.cancellation_reason), 80), ''),
        200
      ) as subtitle,
      '/orders/' || o.id::text as href,
      coalesce(o.cancelled_at, o.updated_at) as occurred_at
    from public.orders o
    where o.business_id = p_business_id
      and o.status = 'cancelled'
      and o.cancelled_at >= now() - interval '7 days'
  ),
  annotated as (
    select
      d.*,
      coalesce(r.read_at is not null, false) as is_read,
      r.read_at
    from derived d
    left join public.workspace_notification_reads r
      on r.business_id = p_business_id
     and r.user_id = auth.uid()
     and r.notification_key = d.notification_key
  ),
  totals as (
    select cast(count(*) filter (where not a.is_read) as integer) as unread_count
    from annotated a
  )
  select
    a.notification_key,
    a.result_type,
    a.reference_id,
    a.title,
    a.subtitle,
    a.href,
    a.occurred_at,
    a.is_read,
    a.read_at,
    t.unread_count
  from annotated a
  cross join totals t
  order by a.is_read, a.occurred_at desc nulls last, a.notification_key
  limit safe_limit;
end;
$$;

create or replace function public.workspace_mark_notification_read(
  p_business_id uuid,
  p_notification_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_key text := nullif(btrim(p_notification_key), '');
begin
  if p_business_id is null
     or normalized_key is null
     or char_length(normalized_key) > 255
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to update notifications in this workspace.'
      using errcode = '42501';
  end if;

  if auth.uid() is null then
    raise exception 'Sign in to update notifications.'
      using errcode = '28000';
  end if;

  insert into public.workspace_notification_reads (
    business_id,
    user_id,
    notification_key,
    read_at
  )
  values (p_business_id, auth.uid(), normalized_key, now())
  on conflict (business_id, user_id, notification_key)
  do update set read_at = excluded.read_at;

  return true;
end;
$$;

revoke all on function public.workspace_global_search(uuid, text, integer) from public;
revoke all on function public.workspace_global_search(uuid, text, integer) from anon;
grant execute on function public.workspace_global_search(uuid, text, integer) to authenticated, service_role;

revoke all on function public.workspace_list_notifications(uuid, integer) from public;
revoke all on function public.workspace_list_notifications(uuid, integer) from anon;
grant execute on function public.workspace_list_notifications(uuid, integer) to authenticated, service_role;

revoke all on function public.workspace_mark_notification_read(uuid, text) from public;
revoke all on function public.workspace_mark_notification_read(uuid, text) from anon;
grant execute on function public.workspace_mark_notification_read(uuid, text) to authenticated, service_role;
