-- Workspace analytics RPCs backed by live business records.

create or replace function public.workspace_get_dashboard_data(p_business_id uuid)
returns table (
  currency text,
  total_orders bigint,
  orders_today bigint,
  open_orders bigint,
  completed_orders bigint,
  cancelled_orders bigint,
  active_products bigint,
  total_customers bigint,
  verified_payments bigint,
  paid_amount numeric,
  pending_payments bigint,
  pending_amount numeric,
  outstanding_amount numeric,
  orders_with_balance bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_currency text;
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select b.currency into v_currency
  from public.businesses b
  where b.id = p_business_id;

  if v_currency is null then
    raise exception 'The workspace could not be found.'
      using errcode = '22023';
  end if;

  return query
  with order_stats as (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where o.created_at >= current_date)::bigint as orders_today,
      count(*) filter (
        where o.status not in ('completed', 'cancelled')
      )::bigint as open_orders,
      count(*) filter (where o.status = 'completed')::bigint as completed_orders,
      count(*) filter (where o.status = 'cancelled')::bigint as cancelled_orders
    from public.orders o
    where o.business_id = p_business_id
  ),
  catalogue_stats as (
    select
      count(*) filter (where p.status = 'active')::bigint as active_products
    from public.products p
    where p.business_id = p_business_id
  ),
  customer_stats as (
    select count(*)::bigint as total_customers
    from public.customers c
    where c.business_id = p_business_id
  ),
  payment_stats as (
    select
      count(*) filter (
        where p.status in ('verified', 'completed')
      )::bigint as verified_payments,
      coalesce(
        sum(p.amount) filter (where p.status in ('verified', 'completed')),
        0
      )::numeric as paid_amount,
      count(*) filter (where p.status = 'pending')::bigint as pending_payments,
      coalesce(sum(p.amount) filter (where p.status = 'pending'), 0)::numeric
        as pending_amount
    from public.payments p
    where p.business_id = p_business_id
  ),
  balance_stats as (
    select
      coalesce(
        sum(greatest(o.total - coalesce(paid.total, 0), 0)),
        0
      )::numeric as outstanding_amount,
      count(*) filter (
        where greatest(o.total - coalesce(paid.total, 0), 0) > 0
      )::bigint as orders_with_balance
    from public.orders o
    left join lateral (
      select coalesce(sum(p.amount), 0) as total
      from public.payments p
      where p.business_id = o.business_id
        and p.order_id = o.id
        and p.status in ('verified', 'completed')
    ) paid on true
    where o.business_id = p_business_id
      and o.status not in ('draft', 'cancelled')
  )
  select
    v_currency,
    os.total_orders,
    os.orders_today,
    os.open_orders,
    os.completed_orders,
    os.cancelled_orders,
    cs.active_products,
    cush.total_customers,
    ps.verified_payments,
    ps.paid_amount,
    ps.pending_payments,
    ps.pending_amount,
    bs.outstanding_amount,
    bs.orders_with_balance
  from order_stats os
  cross join catalogue_stats cs
  cross join customer_stats cush
  cross join payment_stats ps
  cross join balance_stats bs;
end;
$$;

create or replace function public.workspace_get_recent_activity(
  p_business_id uuid,
  p_limit integer default 10
)
returns table (
  id uuid,
  event_type text,
  summary text,
  order_id uuid,
  order_number text,
  actor_name text,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.event_type,
    e.summary,
    e.order_id,
    o.order_number,
    e.actor_name,
    e.created_at
  from public.order_events e
  join public.orders o
    on o.business_id = e.business_id
    and o.id = e.order_id
  where e.business_id = p_business_id
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

create or replace function public.workspace_get_report_summary(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  currency text,
  date_from timestamptz,
  date_to timestamptz,
  total_orders bigint,
  completed_orders bigint,
  open_orders bigint,
  cancelled_orders bigint,
  units_sold bigint,
  paid_amount numeric,
  outstanding_amount numeric,
  orders_with_balance bigint,
  payment_status jsonb,
  outstanding_payments jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_currency text;
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The report end date must be after the start date.'
      using errcode = '22023';
  end if;

  select b.currency into v_currency
  from public.businesses b
  where b.id = p_business_id;

  if v_currency is null then
    raise exception 'The workspace could not be found.'
      using errcode = '22023';
  end if;

  return query
  with scoped_orders as (
    select o.*
    from public.orders o
    where o.business_id = p_business_id
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
  ),
  scoped_payments as (
    select p.*
    from public.payments p
    where p.business_id = p_business_id
      and (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at <= p_to)
  ),
  order_stats as (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where so.status = 'completed')::bigint as completed_orders,
      count(*) filter (
        where so.status not in ('completed', 'cancelled')
      )::bigint as open_orders,
      count(*) filter (where so.status = 'cancelled')::bigint as cancelled_orders
    from scoped_orders so
  ),
  units_stats as (
    select coalesce(sum(oi.quantity), 0)::bigint as units_sold
    from public.order_items oi
    join scoped_orders so
      on so.business_id = oi.business_id
      and so.id = oi.order_id
    where exists (
      select 1
      from public.payments p
      where p.business_id = so.business_id
        and p.order_id = so.id
        and p.status in ('verified', 'completed')
    )
  ),
  payment_stats as (
    select
      coalesce(
        sum(sp.amount) filter (
          where sp.status in ('verified', 'completed')
        ),
        0
      )::numeric as paid_amount
    from scoped_payments sp
  ),
  balance_stats as (
    select
      coalesce(
        sum(greatest(so.total - coalesce(paid.total, 0), 0)),
        0
      )::numeric as outstanding_amount,
      count(*) filter (
        where greatest(so.total - coalesce(paid.total, 0), 0) > 0
      )::bigint as orders_with_balance
    from scoped_orders so
    left join lateral (
      select coalesce(sum(p.amount), 0) as total
      from public.payments p
      where p.business_id = so.business_id
        and p.order_id = so.id
        and p.status in ('verified', 'completed')
    ) paid on true
    where so.status not in ('draft', 'cancelled')
  ),
  payment_status_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'status', s.status,
          'count', s.payment_count,
          'amount', s.amount
        )
        order by s.status
      ),
      '[]'::jsonb
    ) as rows
    from (
      select
        sp.status,
        count(*)::bigint as payment_count,
        coalesce(sum(sp.amount), 0)::numeric as amount
      from scoped_payments sp
      group by sp.status
    ) s
  ),
  outstanding_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', x.id,
          'order_number', x.order_number,
          'customer_name', x.customer_name,
          'status', x.status,
          'order_total', x.order_total,
          'paid_amount', x.paid_amount,
          'balance', x.balance
        )
        order by x.balance desc, x.order_number
      ),
      '[]'::jsonb
    ) as rows
    from (
      select
        so.id,
        so.order_number,
        so.customer_name_snapshot as customer_name,
        so.status,
        so.total as order_total,
        coalesce(paid.total, 0) as paid_amount,
        greatest(so.total - coalesce(paid.total, 0), 0) as balance
      from scoped_orders so
      left join lateral (
        select coalesce(sum(p.amount), 0) as total
        from public.payments p
        where p.business_id = so.business_id
          and p.order_id = so.id
          and p.status in ('verified', 'completed')
      ) paid on true
      where so.status not in ('draft', 'cancelled')
        and greatest(so.total - coalesce(paid.total, 0), 0) > 0
      order by balance desc, so.order_number
      limit 10
    ) x
  )
  select
    v_currency,
    p_from,
    p_to,
    os.total_orders,
    os.completed_orders,
    os.open_orders,
    os.cancelled_orders,
    us.units_sold,
    ps.paid_amount,
    bs.outstanding_amount,
    bs.orders_with_balance,
    psr.rows,
    opr.rows
  from order_stats os
  cross join units_stats us
  cross join payment_stats ps
  cross join balance_stats bs
  cross join payment_status_rows psr
  cross join outstanding_rows opr;
end;
$$;

create or replace function public.workspace_get_report_series(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  period_start timestamptz,
  order_count bigint,
  paid_orders bigint,
  paid_amount numeric
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_from := p_from;
  v_to := p_to;

  if v_from is null and v_to is null then
    v_to := now();
    v_from := v_to - interval '29 days';
  elsif v_from is null then
    v_from := v_to - interval '29 days';
  elsif v_to is null then
    v_to := v_from + interval '29 days';
  end if;

  if v_to < v_from then
    raise exception 'The report end date must be after the start date.'
      using errcode = '22023';
  end if;

  v_start := date_trunc('day', v_from);
  v_end := date_trunc('day', v_to);

  if v_end > v_start + interval '365 days' then
    v_start := v_end - interval '365 days';
  end if;

  return query
  with days as (
    select generate_series(v_start, v_end, interval '1 day') as day_start
  ),
  day_orders as (
    select
      date_trunc('day', o.created_at) as day_start,
      count(*)::bigint as order_count,
      count(*) filter (
        where exists (
          select 1
          from public.payments p
          where p.business_id = o.business_id
            and p.order_id = o.id
            and p.status in ('verified', 'completed')
        )
      )::bigint as paid_orders
    from public.orders o
    where o.business_id = p_business_id
      and o.created_at >= v_from
      and o.created_at <= v_to
    group by date_trunc('day', o.created_at)
  ),
  day_payments as (
    select
      date_trunc('day', p.created_at) as day_start,
      coalesce(
        sum(p.amount) filter (
          where p.status in ('verified', 'completed')
        ),
        0
      )::numeric as paid_amount
    from public.payments p
    where p.business_id = p_business_id
      and p.created_at >= v_from
      and p.created_at <= v_to
    group by date_trunc('day', p.created_at)
  )
  select
    d.day_start,
    coalesce(o.order_count, 0)::bigint,
    coalesce(o.paid_orders, 0)::bigint,
    coalesce(pay.paid_amount, 0)::numeric
  from days d
  left join day_orders o on o.day_start = d.day_start
  left join day_payments pay on pay.day_start = d.day_start
  order by d.day_start;
end;
$$;

create or replace function public.workspace_get_top_products(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 10
)
returns table (
  product_id uuid,
  product_name text,
  sku text,
  units_sold bigint,
  order_count bigint,
  order_value numeric,
  currency text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The report end date must be after the start date.'
      using errcode = '22023';
  end if;

  return query
  with paid_orders as (
    select o.id, o.currency
    from public.orders o
    where o.business_id = p_business_id
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
      and exists (
        select 1
        from public.payments p
        where p.business_id = o.business_id
          and p.order_id = o.id
          and p.status in ('verified', 'completed')
      )
  )
  select
    oi.product_id,
    max(oi.product_name_snapshot) as product_name,
    coalesce(max(oi.sku_snapshot), max(pr.sku)) as sku,
    sum(oi.quantity)::bigint as units_sold,
    count(distinct oi.order_id)::bigint as order_count,
    coalesce(sum(oi.line_total), 0)::numeric as order_value,
    po.currency
  from paid_orders po
  join public.order_items oi
    on oi.business_id = p_business_id
    and oi.order_id = po.id
  left join public.products pr
    on pr.business_id = p_business_id
    and pr.id = oi.product_id
  group by oi.product_id, po.currency
  order by units_sold desc, order_value desc, product_name
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

create or replace function public.workspace_get_top_customers(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 10
)
returns table (
  customer_id uuid,
  customer_name text,
  order_count bigint,
  paid_amount numeric,
  last_order_at timestamptz,
  currency text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The report end date must be after the start date.'
      using errcode = '22023';
  end if;

  return query
  with paid_orders as (
    select
      o.id,
      o.customer_id,
      o.customer_name_snapshot,
      o.created_at,
      o.currency,
      coalesce(paid.total, 0) as paid_amount
    from public.orders o
    left join lateral (
      select coalesce(sum(p.amount), 0) as total
      from public.payments p
      where p.business_id = o.business_id
        and p.order_id = o.id
        and p.status in ('verified', 'completed')
    ) paid on true
    where o.business_id = p_business_id
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
      and exists (
        select 1
        from public.payments p
        where p.business_id = o.business_id
          and p.order_id = o.id
          and p.status in ('verified', 'completed')
      )
  )
  select
    po.customer_id,
    coalesce(c.full_name, po.customer_name_snapshot) as customer_name,
    count(*)::bigint as order_count,
    coalesce(sum(po.paid_amount), 0)::numeric as paid_amount,
    max(po.created_at) as last_order_at,
    po.currency
  from paid_orders po
  left join public.customers c
    on c.business_id = p_business_id
    and c.id = po.customer_id
  group by po.customer_id, coalesce(c.full_name, po.customer_name_snapshot), po.currency
  order by paid_amount desc, order_count desc, customer_name
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

create or replace function public.workspace_get_channel_breakdown(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  channel text,
  label text,
  order_count bigint,
  paid_amount numeric,
  currency text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null then
    raise exception 'Select a workspace first.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
  and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'The report end date must be after the start date.'
      using errcode = '22023';
  end if;

  return query
  with scoped_orders as (
    select
      o.id,
      o.business_id,
      o.currency,
      coalesce(
        nullif(o.channel, ''),
        prep.source,
        checkout.channel,
        o.source,
        'unassigned'
      ) as channel_code
    from public.orders o
    left join lateral (
      select ap.source
      from public.ai_order_preparations ap
      where ap.business_id = o.business_id
        and ap.order_id = o.id
      order by ap.created_at desc
      limit 1
    ) prep on true
    left join lateral (
      select scr.channel
      from public.storefront_checkout_references scr
      where scr.business_id = o.business_id
        and scr.order_id = o.id
      order by scr.created_at desc
      limit 1
    ) checkout on true
    where o.business_id = p_business_id
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
      and o.status not in ('draft', 'cancelled')
  ),
  order_payments as (
    select
      so.channel_code,
      so.currency,
      coalesce(paid.total, 0) as paid_amount
    from scoped_orders so
    left join lateral (
      select coalesce(sum(p.amount), 0) as total
      from public.payments p
      where p.business_id = so.business_id
        and p.order_id = so.id
        and p.status in ('verified', 'completed')
    ) paid on true
  )
  select
    op.channel_code as channel,
    case op.channel_code
      when 'ai_assistant' then 'AI assistant'
      when 'online_store' then 'Online store'
      when 'whatsapp' then 'WhatsApp'
      when 'web_chat' then 'Web chat'
      when 'storefront' then 'Storefront'
      when 'manual' then 'Manual'
      else initcap(replace(op.channel_code, '_', ' '))
    end as label,
    count(*)::bigint as order_count,
    coalesce(sum(op.paid_amount), 0)::numeric as paid_amount,
    op.currency
  from order_payments op
  group by op.channel_code, op.currency
  order by paid_amount desc, order_count desc, channel;
end;
$$;

revoke all on function public.workspace_get_dashboard_data(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_recent_activity(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_report_summary(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_report_series(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_top_products(uuid, timestamptz, timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_top_customers(uuid, timestamptz, timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_channel_breakdown(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.workspace_get_dashboard_data(uuid)
to authenticated, service_role;
grant execute on function public.workspace_get_recent_activity(uuid, integer)
to authenticated, service_role;
grant execute on function public.workspace_get_report_summary(uuid, timestamptz, timestamptz)
to authenticated, service_role;
grant execute on function public.workspace_get_report_series(uuid, timestamptz, timestamptz)
to authenticated, service_role;
grant execute on function public.workspace_get_top_products(uuid, timestamptz, timestamptz, integer)
to authenticated, service_role;
grant execute on function public.workspace_get_top_customers(uuid, timestamptz, timestamptz, integer)
to authenticated, service_role;
grant execute on function public.workspace_get_channel_breakdown(uuid, timestamptz, timestamptz)
to authenticated, service_role;
