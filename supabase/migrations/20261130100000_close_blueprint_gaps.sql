create table if not exists public.customer_follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  title text not null,
  notes text,
  due_at timestamptz,
  status text not null default 'pending',
  assigned_to uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_follow_ups_business_id_id_key unique (business_id, id),
  constraint customer_follow_ups_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete cascade,
  constraint customer_follow_ups_title_check check (
    char_length(btrim(title)) between 1 and 160
  ),
  constraint customer_follow_ups_notes_check check (
    notes is null or char_length(notes) <= 2000
  ),
  constraint customer_follow_ups_status_check check (
    status in ('pending', 'completed', 'cancelled')
  )
);

create index if not exists customer_follow_ups_customer_idx
on public.customer_follow_ups (business_id, customer_id, due_at nulls last, created_at desc);

create index if not exists customer_follow_ups_due_idx
on public.customer_follow_ups (business_id, status, due_at nulls last);

create trigger customer_follow_ups_set_updated_at
before update on public.customer_follow_ups
for each row execute function public.set_updated_at();

alter table public.customer_follow_ups enable row level security;

revoke all on public.customer_follow_ups from public, anon;
grant select, insert, update, delete on public.customer_follow_ups to authenticated;
grant all on public.customer_follow_ups to service_role;

drop policy if exists customer_follow_ups_member_policy on public.customer_follow_ups;
create policy customer_follow_ups_member_policy
on public.customer_follow_ups
for all
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

create or replace function public.workspace_list_customer_follow_ups(
  p_business_id uuid,
  p_customer_id uuid default null
)
returns table (
  id uuid,
  customer_id uuid,
  customer_name text,
  title text,
  notes text,
  due_at timestamptz,
  status text,
  assignee_name text,
  created_at timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to view customer follow-ups.'
      using errcode = '42501';
  end if;

  return query
  select
    f.id,
    f.customer_id,
    c.full_name as customer_name,
    f.title,
    f.notes,
    f.due_at,
    f.status,
    p.full_name as assignee_name,
    f.created_at,
    f.completed_at
  from public.customer_follow_ups f
  join public.customers c
    on c.business_id = f.business_id
   and c.id = f.customer_id
  left join public.profiles p on p.id = f.assigned_to
  where f.business_id = p_business_id
    and (p_customer_id is null or f.customer_id = p_customer_id)
  order by
    case f.status when 'pending' then 0 when 'completed' then 1 else 2 end,
    f.due_at nulls last,
    f.created_at desc;
end;
$$;

create or replace function public.workspace_create_customer_follow_up(
  p_business_id uuid,
  p_customer_id uuid,
  p_title text,
  p_due_at timestamptz default null,
  p_notes text default null,
  p_assigned_to uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_customer_name text;
  v_follow_up_id uuid;
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager']
     ) then
    raise exception 'You do not have permission to manage customer follow-ups.'
      using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 160 then
    raise exception 'Enter a follow-up title of 160 characters or fewer.'
      using errcode = '22023';
  end if;

  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Follow-up notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  select c.full_name into v_customer_name
  from public.customers c
  where c.business_id = p_business_id
    and c.id = p_customer_id;

  if not found then
    raise exception 'The customer could not be found.'
      using errcode = 'PGRST116';
  end if;

  insert into public.customer_follow_ups (
    business_id,
    customer_id,
    title,
    notes,
    due_at,
    status,
    assigned_to,
    created_by
  )
  values (
    p_business_id,
    p_customer_id,
    v_title,
    v_notes,
    p_due_at,
    'pending',
    p_assigned_to,
    auth.uid()
  )
  returning id into v_follow_up_id;

  perform public.communication_log_audit(
    p_business_id,
    'customer_follow_up_created',
    'customer_follow_up',
    v_follow_up_id::text,
    jsonb_build_object('customer_name', v_customer_name, 'title', v_title)
  );

  return true;
end;
$$;

create or replace function public.workspace_update_customer_follow_up_status(
  p_follow_up_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_business_id uuid;
  v_previous_status text;
begin
  if p_follow_up_id is null then
    raise exception 'Select a follow-up first.'
      using errcode = '22023';
  end if;

  if v_status not in ('pending', 'completed', 'cancelled') then
    raise exception 'Choose a valid follow-up status.'
      using errcode = '22023';
  end if;

  select f.business_id, f.status
  into v_business_id, v_previous_status
  from public.customer_follow_ups f
  where f.id = p_follow_up_id;

  if not found
     or not public.has_business_role(
       v_business_id,
       array['owner', 'admin', 'manager']
     ) then
    raise exception 'You do not have permission to manage customer follow-ups.'
      using errcode = '42501';
  end if;

  if v_previous_status = v_status then
    return true;
  end if;

  update public.customer_follow_ups f
  set status = v_status,
      completed_at = case when v_status = 'completed' then now() else null end
  where f.id = p_follow_up_id;

  perform public.communication_log_audit(
    v_business_id,
    'customer_follow_up_status_updated',
    'customer_follow_up',
    p_follow_up_id::text,
    jsonb_build_object('previous_status', v_previous_status, 'status', v_status)
  );

  return true;
end;
$$;

create or replace function public.workspace_delete_customer_follow_up(
  p_follow_up_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_title text;
begin
  select f.business_id, f.title
  into v_business_id, v_title
  from public.customer_follow_ups f
  where f.id = p_follow_up_id;

  if not found
     or not public.has_business_role(
       v_business_id,
       array['owner', 'admin', 'manager']
     ) then
    raise exception 'You do not have permission to manage customer follow-ups.'
      using errcode = '42501';
  end if;

  delete from public.customer_follow_ups f
  where f.id = p_follow_up_id;

  perform public.communication_log_audit(
    v_business_id,
    'customer_follow_up_deleted',
    'customer_follow_up',
    p_follow_up_id::text,
    jsonb_build_object('title', v_title)
  );

  return true;
end;
$$;

create table if not exists public.workspace_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  notify_email boolean not null default true,
  notify_new_orders boolean not null default true,
  notify_payments boolean not null default true,
  ai_tone text not null default 'concise'
    check (ai_tone in ('concise', 'friendly', 'professional')),
  ai_require_confirmation boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspace_settings_set_updated_at
before update on public.workspace_settings
for each row execute function public.set_updated_at();

insert into public.workspace_settings (business_id)
select b.id
from public.businesses b
on conflict (business_id) do nothing;

alter table public.workspace_settings enable row level security;

revoke all on public.workspace_settings from public, anon;
grant select, insert, update on public.workspace_settings to authenticated;
grant all on public.workspace_settings to service_role;

drop policy if exists workspace_settings_member_policy on public.workspace_settings;
create policy workspace_settings_member_policy
on public.workspace_settings
for all
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
    array['owner', 'admin']
  )
);

create or replace function public.workspace_get_settings(p_business_id uuid)
returns table (
  business_id uuid,
  name text,
  industry text,
  country text,
  currency text,
  timezone text,
  notify_email boolean,
  notify_new_orders boolean,
  notify_payments boolean,
  ai_tone text,
  ai_require_confirmation boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to view workspace settings.'
      using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    b.industry,
    b.country,
    b.currency,
    b.timezone,
    coalesce(s.notify_email, true),
    coalesce(s.notify_new_orders, true),
    coalesce(s.notify_payments, true),
    coalesce(s.ai_tone, 'concise'),
    coalesce(s.ai_require_confirmation, true)
  from public.businesses b
  left join public.workspace_settings s on s.business_id = b.id
  where b.id = p_business_id;
end;
$$;

create or replace function public.workspace_update_settings(
  p_business_id uuid,
  p_name text,
  p_industry text,
  p_country text,
  p_currency text,
  p_timezone text,
  p_notify_email boolean,
  p_notify_new_orders boolean,
  p_notify_payments boolean,
  p_ai_tone text,
  p_ai_require_confirmation boolean
)
returns table (
  business_id uuid,
  name text,
  industry text,
  country text,
  currency text,
  timezone text,
  notify_email boolean,
  notify_new_orders boolean,
  notify_payments boolean,
  ai_tone text,
  ai_require_confirmation boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_timezone text := btrim(coalesce(p_timezone, ''));
  v_tone text := lower(btrim(coalesce(p_ai_tone, 'concise')));
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to change workspace settings.'
      using errcode = '42501';
  end if;

  if char_length(v_name) not between 1 and 160 then
    raise exception 'The business name must be 160 characters or fewer.'
      using errcode = '22023';
  end if;

  if char_length(coalesce(v_industry, '')) > 80 then
    raise exception 'The industry must be 80 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'Choose a valid two-letter country code.'
      using errcode = '22023';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid three-letter currency code.'
      using errcode = '22023';
  end if;

  if char_length(v_timezone) not between 1 and 80 then
    raise exception 'Choose a valid timezone.'
      using errcode = '22023';
  end if;

  if v_tone not in ('concise', 'friendly', 'professional') then
    raise exception 'Choose a valid assistant tone.'
      using errcode = '22023';
  end if;

  update public.businesses b
  set name = v_name,
      industry = v_industry,
      country = v_country,
      currency = v_currency,
      timezone = v_timezone
  where b.id = p_business_id;

  if not found then
    raise exception 'The workspace could not be found.'
      using errcode = 'PGRST116';
  end if;

  insert into public.workspace_settings (
    business_id,
    notify_email,
    notify_new_orders,
    notify_payments,
    ai_tone,
    ai_require_confirmation
  )
  values (
    p_business_id,
    coalesce(p_notify_email, true),
    coalesce(p_notify_new_orders, true),
    coalesce(p_notify_payments, true),
    v_tone,
    coalesce(p_ai_require_confirmation, true)
  )
  on conflict (business_id) do update
  set notify_email = excluded.notify_email,
      notify_new_orders = excluded.notify_new_orders,
      notify_payments = excluded.notify_payments,
      ai_tone = excluded.ai_tone,
      ai_require_confirmation = excluded.ai_require_confirmation;

  perform public.communication_log_audit(
    p_business_id,
    'workspace_settings_updated',
    'business',
    p_business_id::text,
    jsonb_build_object(
      'currency', v_currency,
      'timezone', v_timezone,
      'ai_tone', v_tone
    )
  );

  return query
  select
    b.id,
    b.name,
    b.industry,
    b.country,
    b.currency,
    b.timezone,
    s.notify_email,
    s.notify_new_orders,
    s.notify_payments,
    s.ai_tone,
    s.ai_require_confirmation
  from public.businesses b
  join public.workspace_settings s on s.business_id = b.id
  where b.id = p_business_id;
end;
$$;

create table if not exists public.subscription_plans (
  code text primary key,
  name text not null,
  description text,
  monthly_amount numeric(14, 2) not null default 0,
  currency text not null default 'USD',
  order_limit integer,
  user_limit integer,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code_check check (
    char_length(btrim(code)) between 2 and 40
  ),
  constraint subscription_plans_name_check check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint subscription_plans_amount_check check (monthly_amount >= 0),
  constraint subscription_plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_plans_limits_check check (
    order_limit is null or order_limit > 0
  ),
  constraint subscription_plans_user_limit_check check (
    user_limit is null or user_limit > 0
  )
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code) on delete restrict,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  external_reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check (
    status in ('trialing', 'active', 'past_due', 'cancelled')
  )
);

create trigger subscription_plans_set_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

insert into public.subscription_plans (
  code,
  name,
  description,
  monthly_amount,
  currency,
  order_limit,
  user_limit,
  features,
  is_active
)
values
  (
    'free',
    'Free',
    'Core workspace tools for a small business.',
    0,
    'USD',
    100,
    3,
    '["Product catalogue", "Inventory", "Orders", "Payments", "Basic reports"]'::jsonb,
    true
  ),
  (
    'growth',
    'Growth',
    'For growing teams that need more automation.',
    29,
    'USD',
    1000,
    15,
    '["Everything in Free", "AI assistant", "Advanced reports", "Team management"]'::jsonb,
    true
  ),
  (
    'scale',
    'Scale',
    'For multi-channel operations with higher volume.',
    79,
    'USD',
    null,
    null,
    '["Everything in Growth", "Priority support", "Custom limits"]'::jsonb,
    true
  )
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    monthly_amount = excluded.monthly_amount,
    currency = excluded.currency,
    order_limit = excluded.order_limit,
    user_limit = excluded.user_limit,
    features = excluded.features,
    is_active = excluded.is_active;

insert into public.subscriptions (business_id, plan_code, status, created_by)
select b.id, 'free', 'active', null
from public.businesses b
on conflict (business_id) do nothing;

alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;

revoke all on public.subscription_plans from public, anon;
revoke all on public.subscriptions from public, anon;
grant select on public.subscription_plans, public.subscriptions to authenticated;
grant all on public.subscription_plans, public.subscriptions to service_role;

drop policy if exists subscription_plans_read_policy on public.subscription_plans;
create policy subscription_plans_read_policy
on public.subscription_plans
for select
to authenticated
using (is_active);

drop policy if exists subscriptions_member_read_policy on public.subscriptions;
create policy subscriptions_member_read_policy
on public.subscriptions
for select
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'manager', 'staff']
  )
);

create or replace function public.workspace_get_subscription(p_business_id uuid)
returns table (
  business_id uuid,
  plan_code text,
  plan_name text,
  status text,
  monthly_amount numeric,
  currency text,
  order_limit integer,
  user_limit integer,
  current_period_end timestamptz,
  features jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     ) then
    raise exception 'You do not have permission to view this subscription.'
      using errcode = '42501';
  end if;

  return query
  select
    s.business_id,
    sp.code,
    sp.name,
    s.status,
    sp.monthly_amount,
    sp.currency,
    sp.order_limit,
    sp.user_limit,
    s.current_period_end,
    sp.features
  from public.subscriptions s
  join public.subscription_plans sp on sp.code = s.plan_code
  where s.business_id = p_business_id;
end;
$$;

create or replace function public.platform_list_subscriptions(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  plan text,
  status text,
  current_period_end timestamptz,
  amount numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.subscriptions.read') then
    raise exception 'You do not have permission to view subscriptions.'
      using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.business_id,
    b.name,
    sp.code,
    s.status,
    s.current_period_end,
    sp.monthly_amount,
    sp.currency
  from public.subscriptions s
  join public.businesses b on b.id = s.business_id
  join public.subscription_plans sp on sp.code = s.plan_code
  order by s.updated_at desc, b.name
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.workspace_get_report_insights(
  p_business_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  average_processing_hours numeric,
  timed_completed_orders bigint,
  active_employees bigint,
  ai_prepared_orders bigint,
  ai_approved_orders bigint,
  repeat_customers bigint,
  customers_with_orders bigint,
  repeat_customer_rate numeric,
  low_stock_items bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(
       p_business_id,
       array['owner', 'admin', 'manager', 'staff']
     )
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  return query
  with scoped_orders as (
    select o.id, o.customer_id, o.confirmed_at, o.completed_at
    from public.orders o
    where o.business_id = p_business_id
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to)
      and o.status not in ('draft', 'cancelled')
  ),
  timing_stats as (
    select
      coalesce(
        round(
          avg(extract(epoch from (so.completed_at - so.confirmed_at)) / 3600)
            filter (where so.confirmed_at is not null and so.completed_at is not null),
          1
        ),
        0
      ) as average_processing_hours,
      count(*) filter (
        where so.confirmed_at is not null and so.completed_at is not null
      )::bigint as timed_completed_orders
    from scoped_orders so
  ),
  employee_stats as (
    select count(distinct e.actor_id)::bigint as active_employees
    from public.order_events e
    where e.business_id = p_business_id
      and e.actor_id is not null
      and (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at <= p_to)
  ),
  ai_stats as (
    select
      count(*)::bigint as ai_prepared_orders,
      count(*) filter (where ap.status = 'approved')::bigint as ai_approved_orders
    from public.ai_order_preparations ap
    where ap.business_id = p_business_id
      and (p_from is null or ap.created_at >= p_from)
      and (p_to is null or ap.created_at <= p_to)
  ),
  customer_stats as (
    select
      count(*) filter (where order_count > 1)::bigint as repeat_customers,
      count(*)::bigint as customers_with_orders
    from (
      select so.customer_id, count(*) as order_count
      from scoped_orders so
      group by so.customer_id
    ) customer_orders
  ),
  stock_stats as (
    select count(*)::bigint as low_stock_items
    from public.inventory_items i
    where i.business_id = p_business_id
      and i.is_tracked
      and i.low_stock_threshold is not null
      and i.available_quantity <= i.low_stock_threshold
  )
  select
    t.average_processing_hours,
    t.timed_completed_orders,
    e.active_employees,
    a.ai_prepared_orders,
    a.ai_approved_orders,
    c.repeat_customers,
    c.customers_with_orders,
    coalesce(
      round(100.0 * c.repeat_customers / nullif(c.customers_with_orders, 0), 1),
      0
    ) as repeat_customer_rate,
    s.low_stock_items
  from timing_stats t
  cross join employee_stats e
  cross join ai_stats a
  cross join customer_stats c
  cross join stock_stats s;
end;
$$;

alter table public.platform_support_sessions
drop constraint if exists platform_support_sessions_roles_check;

alter table public.platform_support_sessions
add constraint platform_support_sessions_roles_check
check (business_roles <@ array['admin', 'manager', 'staff']::text[]);

create or replace function public.workspace_invite_member(
  p_business_id uuid,
  p_email text,
  p_role text
)
returns table (
  id uuid,
  business_id uuid,
  email text,
  role text,
  token text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_existing_user_id uuid;
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'manager', 'staff') then
    raise exception 'Choose a valid role for this invitation.'
      using errcode = '22023';
  end if;

  if v_role = 'owner'
     and not public.has_business_role(p_business_id, array['owner']) then
    raise exception 'Only an owner can invite another owner.'
      using errcode = '42501';
  end if;

  select u.id into v_existing_user_id
  from auth.users u
  where lower(btrim(coalesce(u.email, ''))) = v_email
  limit 1;

  if v_existing_user_id is not null
     and exists (
       select 1
       from public.business_members bm
       where bm.business_id = p_business_id
         and bm.user_id = v_existing_user_id
     ) then
    raise exception 'This person is already a member of this workspace.'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.business_invitations bi
    where bi.business_id = p_business_id
      and bi.email = v_email
      and bi.status = 'pending'
  ) then
    raise exception 'An invitation is already pending for this email address.'
      using errcode = '23505';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.business_invitations (
    business_id,
    email,
    role,
    token_hash,
    status,
    invited_by,
    expires_at
  )
  values (
    p_business_id,
    v_email,
    v_role,
    v_token_hash,
    'pending',
    auth.uid(),
    now() + interval '7 days'
  )
  returning id into v_invitation_id;

  perform public.communication_log_audit(
    p_business_id,
    'workspace_invitation_created',
    'business_invitation',
    v_invitation_id::text,
    jsonb_build_object('email', v_email, 'role', v_role)
  );

  return query
  select
    bi.id,
    bi.business_id,
    bi.email,
    bi.role,
    v_token,
    bi.expires_at,
    bi.created_at
  from public.business_invitations bi
  where bi.id = v_invitation_id;
end;
$$;

create or replace function public.workspace_update_member_role(
  p_business_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_current_role text;
  v_current_status text;
  v_active_owner_count integer;
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'manager', 'staff') then
    raise exception 'Choose a valid role for this member.'
      using errcode = '22023';
  end if;

  select bm.role, bm.status into v_current_role, v_current_status
  from public.business_members bm
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  if not found then
    raise exception 'The team member could not be found.'
      using errcode = 'PGRST116';
  end if;

  if (v_current_role = 'owner' or v_role = 'owner')
     and not public.has_business_role(p_business_id, array['owner']) then
    raise exception 'Only an owner can change owner access.'
      using errcode = '42501';
  end if;

  if v_current_role = v_role then
    return true;
  end if;

  if v_current_role = 'owner' and v_current_status = 'active' and v_role <> 'owner' then
    select count(*)::integer into v_active_owner_count
    from public.business_members bm
    where bm.business_id = p_business_id
      and bm.role = 'owner'
      and bm.status = 'active';

    if v_active_owner_count <= 1 then
      raise exception 'The workspace must keep at least one active owner.'
        using errcode = '22023';
    end if;
  end if;

  update public.business_members bm
  set role = v_role
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  perform public.communication_log_audit(
    p_business_id,
    'workspace_member_role_updated',
    'business_member',
    p_user_id::text,
    jsonb_build_object('previous_role', v_current_role, 'role', v_role)
  );

  return true;
end;
$$;

create or replace function public.workspace_set_member_status(
  p_business_id uuid,
  p_user_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_current_role text;
  v_current_status text;
  v_active_owner_count integer;
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  if v_status not in ('active', 'suspended') then
    raise exception 'Choose a valid status for this member.'
      using errcode = '22023';
  end if;

  select bm.role, bm.status into v_current_role, v_current_status
  from public.business_members bm
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  if not found then
    raise exception 'The team member could not be found.'
      using errcode = 'PGRST116';
  end if;

  if v_current_role = 'owner'
     and not public.has_business_role(p_business_id, array['owner']) then
    raise exception 'Only an owner can change owner access.'
      using errcode = '42501';
  end if;

  if v_current_status = v_status then
    return true;
  end if;

  if v_current_role = 'owner' and v_current_status = 'active' and v_status = 'suspended' then
    select count(*)::integer into v_active_owner_count
    from public.business_members bm
    where bm.business_id = p_business_id
      and bm.role = 'owner'
      and bm.status = 'active';

    if v_active_owner_count <= 1 then
      raise exception 'The workspace must keep at least one active owner.'
        using errcode = '22023';
    end if;
  end if;

  update public.business_members bm
  set status = v_status
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  perform public.communication_log_audit(
    p_business_id,
    case when v_status = 'suspended' then 'workspace_member_suspended' else 'workspace_member_activated' end,
    'business_member',
    p_user_id::text,
    jsonb_build_object('previous_status', v_current_status, 'status', v_status)
  );

  return true;
end;
$$;

create or replace function public.workspace_remove_member(
  p_business_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_role text;
  v_current_status text;
  v_active_owner_count integer;
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  select bm.role, bm.status into v_current_role, v_current_status
  from public.business_members bm
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  if not found then
    raise exception 'The team member could not be found.'
      using errcode = 'PGRST116';
  end if;

  if v_current_role = 'owner'
     and not public.has_business_role(p_business_id, array['owner']) then
    raise exception 'Only an owner can remove owner access.'
      using errcode = '42501';
  end if;

  if v_current_role = 'owner' and v_current_status = 'active' then
    select count(*)::integer into v_active_owner_count
    from public.business_members bm
    where bm.business_id = p_business_id
      and bm.role = 'owner'
      and bm.status = 'active';

    if v_active_owner_count <= 1 then
      raise exception 'The workspace must keep at least one active owner.'
        using errcode = '22023';
    end if;
  end if;

  delete from public.business_members bm
  where bm.business_id = p_business_id
    and bm.user_id = p_user_id;

  perform public.communication_log_audit(
    p_business_id,
    'workspace_member_removed',
    'business_member',
    p_user_id::text,
    jsonb_build_object('previous_role', v_current_role, 'previous_status', v_current_status)
  );

  return true;
end;
$$;

revoke all on function public.workspace_list_customer_follow_ups(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_create_customer_follow_up(uuid, uuid, text, timestamptz, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_update_customer_follow_up_status(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_delete_customer_follow_up(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_settings(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_update_settings(uuid, text, text, text, text, text, boolean, boolean, boolean, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_subscription(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.platform_list_subscriptions(integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.workspace_get_report_insights(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.workspace_list_customer_follow_ups(uuid, uuid)
to authenticated, service_role;
grant execute on function public.workspace_create_customer_follow_up(uuid, uuid, text, timestamptz, text, uuid)
to authenticated, service_role;
grant execute on function public.workspace_update_customer_follow_up_status(uuid, text)
to authenticated, service_role;
grant execute on function public.workspace_delete_customer_follow_up(uuid)
to authenticated, service_role;
grant execute on function public.workspace_get_settings(uuid)
to authenticated, service_role;
grant execute on function public.workspace_update_settings(uuid, text, text, text, text, text, boolean, boolean, boolean, text, boolean)
to authenticated, service_role;
grant execute on function public.workspace_get_subscription(uuid)
to authenticated, service_role;
grant execute on function public.platform_list_subscriptions(integer, integer)
to authenticated, service_role;
grant execute on function public.workspace_get_report_insights(uuid, timestamptz, timestamptz)
to authenticated, service_role;
