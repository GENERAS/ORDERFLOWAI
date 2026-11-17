-- Day 8: payment records, manual verification, refunds and payment reporting.
-- Payments stay independent from order fulfilment status.

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_business_code_key unique (business_id, code),
  constraint payment_methods_code_check check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint payment_methods_label_check check (
    char_length(btrim(label)) between 1 and 80
  )
);

create index payment_methods_business_active_idx
on public.payment_methods (business_id, is_active, sort_order);

create table public.payment_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint payment_counters_last_number_check check (last_number >= 0)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  payment_number text not null,
  amount numeric(14, 2) not null,
  currency text not null,
  method_code text not null,
  method_label_snapshot text not null,
  status text not null default 'pending',
  payment_date date not null default current_date,
  transaction_reference text,
  provider_key text,
  provider_transaction_id text,
  provider_event_id text,
  notes text,
  idempotency_key text,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_by_name text not null default 'Team member',
  verified_by uuid references auth.users(id) on delete set null,
  verified_by_name text,
  verified_at timestamptz,
  verification_note text,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_reason text,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_business_id_id_key unique (business_id, id),
  constraint payments_business_number_key unique (business_id, payment_number),
  constraint payments_order_fk
    foreign key (business_id, order_id)
    references public.orders(business_id, id) on delete restrict,
  constraint payments_method_fk
    foreign key (business_id, method_code)
    references public.payment_methods(business_id, code) on delete restrict,
  constraint payments_number_check check (
    char_length(btrim(payment_number)) between 3 and 40
  ),
  constraint payments_amount_check check (amount > 0),
  constraint payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payments_status_check check (
    status in ('pending', 'verified', 'rejected', 'failed')
  ),
  constraint payments_transaction_reference_check check (
    transaction_reference is null
    or char_length(btrim(transaction_reference)) between 1 and 120
  ),
  constraint payments_provider_key_check check (
    provider_key is null or char_length(btrim(provider_key)) between 1 and 60
  ),
  constraint payments_provider_transaction_check check (
    provider_transaction_id is null
    or char_length(btrim(provider_transaction_id)) between 1 and 160
  ),
  constraint payments_provider_event_check check (
    provider_event_id is null
    or char_length(btrim(provider_event_id)) between 1 and 200
  ),
  constraint payments_notes_check check (
    notes is null or char_length(notes) <= 1000
  ),
  constraint payments_verification_note_check check (
    verification_note is null
    or char_length(btrim(verification_note)) between 1 and 500
  ),
  constraint payments_rejection_reason_check check (
    rejection_reason is null
    or char_length(btrim(rejection_reason)) between 3 and 500
  ),
  constraint payments_failure_reason_check check (
    failure_reason is null
    or char_length(btrim(failure_reason)) between 3 and 500
  ),
  constraint payments_actor_name_check check (
    char_length(btrim(recorded_by_name)) between 1 and 160
  ),
  constraint payments_verified_by_name_check check (
    verified_by_name is null
    or char_length(btrim(verified_by_name)) between 1 and 160
  ),
  constraint payments_rejected_by_name_check check (
    rejected_by_name is null
    or char_length(btrim(rejected_by_name)) between 1 and 160
  ),
  constraint payments_status_state_check check (
    (
      status = 'pending'
      and verified_at is null
      and rejected_at is null
      and failed_at is null
    )
    or (
      status = 'verified'
      and verified_at is not null
      and verified_by_name is not null
      and rejected_at is null
      and failed_at is null
    )
    or (
      status = 'rejected'
      and rejected_at is not null
      and rejected_by_name is not null
      and rejection_reason is not null
      and verified_at is null
      and failed_at is null
    )
    or (
      status = 'failed'
      and failed_at is not null
      and failure_reason is not null
      and verified_at is null
      and rejected_at is null
    )
  )
);

create unique index payments_business_idempotency_key_uidx
on public.payments (business_id, idempotency_key)
where idempotency_key is not null;

create unique index payments_provider_event_uidx
on public.payments (business_id, provider_key, provider_event_id)
where provider_key is not null and provider_event_id is not null;

create index payments_business_status_idx
on public.payments (business_id, status, created_at desc);

create index payments_business_date_idx
on public.payments (business_id, payment_date desc, created_at desc);

create index payments_business_order_idx
on public.payments (business_id, order_id, created_at desc);

create index payments_business_method_idx
on public.payments (business_id, method_code, created_at desc);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_id uuid not null,
  amount numeric(14, 2) not null,
  status text not null default 'requested',
  reason text not null,
  reference text,
  idempotency_key text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text not null,
  requested_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  completed_by_name text,
  completed_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_refunds_business_id_id_key unique (business_id, id),
  constraint payment_refunds_payment_fk
    foreign key (business_id, payment_id)
    references public.payments(business_id, id) on delete restrict,
  constraint payment_refunds_amount_check check (amount > 0),
  constraint payment_refunds_status_check check (
    status in ('requested', 'completed', 'rejected')
  ),
  constraint payment_refunds_reason_check check (
    char_length(btrim(reason)) between 3 and 500
  ),
  constraint payment_refunds_reference_check check (
    reference is null or char_length(btrim(reference)) between 1 and 120
  ),
  constraint payment_refunds_requested_by_name_check check (
    char_length(btrim(requested_by_name)) between 1 and 160
  ),
  constraint payment_refunds_completed_by_name_check check (
    completed_by_name is null
    or char_length(btrim(completed_by_name)) between 1 and 160
  ),
  constraint payment_refunds_rejected_by_name_check check (
    rejected_by_name is null
    or char_length(btrim(rejected_by_name)) between 1 and 160
  ),
  constraint payment_refunds_rejection_reason_check check (
    rejection_reason is null
    or char_length(btrim(rejection_reason)) between 3 and 500
  ),
  constraint payment_refunds_status_state_check check (
    (
      status = 'requested'
      and completed_at is null
      and rejected_at is null
    )
    or (
      status = 'completed'
      and completed_at is not null
      and completed_by_name is not null
      and rejected_at is null
    )
    or (
      status = 'rejected'
      and rejected_at is not null
      and rejected_by_name is not null
      and rejection_reason is not null
      and completed_at is null
    )
  )
);

create unique index payment_refunds_business_idempotency_key_uidx
on public.payment_refunds (business_id, idempotency_key)
where idempotency_key is not null;

create index payment_refunds_business_status_idx
on public.payment_refunds (business_id, status, created_at desc);

create index payment_refunds_payment_idx
on public.payment_refunds (business_id, payment_id, created_at desc);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_id uuid not null,
  event_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default 'Team member',
  created_at timestamptz not null default now(),
  constraint payment_events_business_id_id_key unique (business_id, id),
  constraint payment_events_payment_fk
    foreign key (business_id, payment_id)
    references public.payments(business_id, id) on delete restrict,
  constraint payment_events_type_check check (
    event_type in (
      'created',
      'verified',
      'rejected',
      'failed',
      'refund_requested',
      'refund_completed',
      'refund_rejected'
    )
  ),
  constraint payment_events_summary_check check (
    char_length(btrim(summary)) between 1 and 500
  ),
  constraint payment_events_actor_name_check check (
    char_length(btrim(actor_name)) between 1 and 160
  )
);

create index payment_events_payment_idx
on public.payment_events (business_id, payment_id, created_at desc);

create trigger payment_methods_set_updated_at
before update on public.payment_methods
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create trigger payment_refunds_set_updated_at
before update on public.payment_refunds
for each row execute function public.set_updated_at();

alter table public.payment_methods enable row level security;
alter table public.payment_counters enable row level security;
alter table public.payments enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_events enable row level security;

create policy payment_methods_select_members
on public.payment_methods
for select
to authenticated
using (public.is_business_member(business_id));

create policy payments_select_members
on public.payments
for select
to authenticated
using (public.is_business_member(business_id));

create policy payment_refunds_select_members
on public.payment_refunds
for select
to authenticated
using (public.is_business_member(business_id));

create policy payment_events_select_members
on public.payment_events
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.payment_methods from anon, authenticated;
revoke all on public.payment_counters from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.payment_refunds from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;

grant select on public.payment_methods to authenticated;
grant select on public.payments to authenticated;
grant select on public.payment_refunds to authenticated;
grant select on public.payment_events to authenticated;

create or replace function public.prevent_payment_event_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Payment history is immutable.'
    using errcode = '42501';
end;
$$;

create trigger payment_events_immutable
before update on public.payment_events
for each row execute function public.prevent_payment_event_update();

create or replace function public.seed_default_payment_methods()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.payment_methods (business_id, code, label, sort_order)
  values
    (new.id, 'cash', 'Cash', 10),
    (new.id, 'bank_transfer', 'Bank transfer', 20),
    (new.id, 'mobile_money', 'Mobile money', 30),
    (new.id, 'card', 'Card', 40),
    (new.id, 'other', 'Other', 50)
  on conflict (business_id, code) do nothing;

  return new;
end;
$$;

create trigger businesses_seed_payment_methods
after insert on public.businesses
for each row execute function public.seed_default_payment_methods();

insert into public.payment_methods (business_id, code, label, sort_order)
select
  b.id,
  defaults.code,
  defaults.label,
  defaults.sort_order
from public.businesses b
cross join (
  values
    ('cash', 'Cash', 10),
    ('bank_transfer', 'Bank transfer', 20),
    ('mobile_money', 'Mobile money', 30),
    ('card', 'Card', 40),
    ('other', 'Other', 50)
) as defaults(code, label, sort_order)
on conflict (business_id, code) do nothing;

create or replace function public.payment_actor_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select nullif(btrim(p.full_name), '')
      from public.profiles p
      where p.id = auth.uid()
    ),
    'Team member'
  );
$$;

create or replace function public.next_payment_number(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number bigint;
begin
  insert into public.payment_counters (business_id, last_number)
  values (p_business_id, 1)
  on conflict (business_id) do update
  set
    last_number = public.payment_counters.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  return 'PAY-' || lpad(next_number::text, 5, '0');
end;
$$;

create or replace function public.derive_order_payment_status(
  p_order_total numeric,
  p_verified_amount numeric,
  p_completed_refund_amount numeric,
  p_failed_amount numeric,
  p_pending_amount numeric
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_verified_amount, 0) - coalesce(p_completed_refund_amount, 0) < 0
      then 'refunded'
    when coalesce(p_completed_refund_amount, 0) > 0
      and coalesce(p_verified_amount, 0) - coalesce(p_completed_refund_amount, 0) = 0
      then 'refunded'
    when coalesce(p_completed_refund_amount, 0) > 0
      then 'partially_refunded'
    when coalesce(p_verified_amount, 0) >= coalesce(p_order_total, 0)
      and coalesce(p_order_total, 0) > 0
      then 'paid'
    when coalesce(p_verified_amount, 0) > 0
      then 'partially_paid'
    when coalesce(p_failed_amount, 0) > 0
      and coalesce(p_pending_amount, 0) = 0
      then 'failed'
    else 'pending'
  end;
$$;

create or replace function public.log_payment_event(
  p_business_id uuid,
  p_payment_id uuid,
  p_event_type text,
  p_summary text,
  p_details jsonb,
  p_actor_id uuid,
  p_actor_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.payment_events (
    business_id,
    payment_id,
    event_type,
    summary,
    details,
    actor_id,
    actor_name
  )
  values (
    p_business_id,
    p_payment_id,
    p_event_type,
    left(p_summary, 500),
    coalesce(p_details, '{}'::jsonb),
    p_actor_id,
    coalesce(nullif(btrim(p_actor_name), ''), 'Team member')
  );
end;
$$;

create or replace function public.list_payment_methods(p_business_id uuid)
returns table (
  id uuid,
  code text,
  label text,
  is_active boolean,
  sort_order integer
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
    pm.id,
    pm.code,
    pm.label,
    pm.is_active,
    pm.sort_order
  from public.payment_methods pm
  where pm.business_id = p_business_id
    and pm.is_active
  order by pm.sort_order, lower(pm.label);
end;
$$;

create or replace function public.get_order_payment_summary(p_order_id uuid)
returns table (
  order_id uuid,
  business_id uuid,
  order_number text,
  currency text,
  order_total numeric,
  verified_amount numeric,
  refunded_amount numeric,
  net_paid numeric,
  balance_due numeric,
  pending_amount numeric,
  pending_count bigint,
  failed_amount numeric,
  requested_refund_amount numeric,
  payment_status text,
  payment_count bigint,
  last_payment_at timestamptz
)
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
begin
  return query
  select
    o.id,
    o.business_id,
    o.order_number,
    o.currency,
    o.total,
    coalesce(pay.verified_amount, 0)::numeric,
    coalesce(ref.completed_refund_amount, 0)::numeric,
    (
      coalesce(pay.verified_amount, 0)
      - coalesce(ref.completed_refund_amount, 0)
    )::numeric,
    greatest(
      o.total
      - (
        coalesce(pay.verified_amount, 0)
        - coalesce(ref.completed_refund_amount, 0)
      ),
      0
    )::numeric,
    coalesce(pay.pending_amount, 0)::numeric,
    coalesce(pay.pending_count, 0)::bigint,
    coalesce(pay.failed_amount, 0)::numeric,
    coalesce(ref.requested_refund_amount, 0)::numeric,
    public.derive_order_payment_status(
      o.total,
      pay.verified_amount,
      ref.completed_refund_amount,
      pay.failed_amount,
      pay.pending_amount
    ),
    coalesce(pay.payment_count, 0)::bigint,
    pay.last_payment_at
  from public.orders o
  left join lateral (
    select
      sum(p.amount) filter (where p.status = 'verified') as verified_amount,
      sum(p.amount) filter (where p.status = 'pending') as pending_amount,
      count(*) filter (where p.status = 'pending') as pending_count,
      sum(p.amount) filter (where p.status = 'failed') as failed_amount,
      count(*) as payment_count,
      max(p.created_at) as last_payment_at
    from public.payments p
    where p.business_id = o.business_id
      and p.order_id = o.id
  ) pay on true
  left join lateral (
    select
      sum(pr.amount) filter (where pr.status = 'completed') as completed_refund_amount,
      sum(pr.amount) filter (where pr.status = 'requested') as requested_refund_amount
    from public.payment_refunds pr
    join public.payments p
      on p.business_id = pr.business_id
      and p.id = pr.payment_id
    where p.business_id = o.business_id
      and p.order_id = o.id
  ) ref on true
  where o.id = p_order_id;
end;
$$;

create or replace function public.search_payable_orders(
  p_business_id uuid,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  order_number text,
  customer_name text,
  status text,
  currency text,
  order_total numeric,
  verified_amount numeric,
  refunded_amount numeric,
  net_paid numeric,
  balance_due numeric,
  pending_amount numeric,
  failed_amount numeric,
  payment_status text,
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
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  with payment_totals as (
    select
      p.order_id,
      sum(p.amount) filter (where p.status = 'verified') as verified_amount,
      sum(p.amount) filter (where p.status = 'pending') as pending_amount,
      sum(p.amount) filter (where p.status = 'failed') as failed_amount
    from public.payments p
    where p.business_id = p_business_id
    group by p.order_id
  ),
  refund_totals as (
    select
      p.order_id,
      sum(pr.amount) filter (where pr.status = 'completed') as refunded_amount
    from public.payment_refunds pr
    join public.payments p
      on p.business_id = pr.business_id
      and p.id = pr.payment_id
    where p.business_id = p_business_id
    group by p.order_id
  ),
  payable as (
    select
      o.id,
      o.order_number,
      o.customer_name_snapshot,
      o.status,
      o.currency,
      o.total,
      coalesce(pt.verified_amount, 0) as verified_amount,
      coalesce(rt.refunded_amount, 0) as refunded_amount,
      coalesce(pt.verified_amount, 0) - coalesce(rt.refunded_amount, 0) as net_paid,
      greatest(
        o.total - (
          coalesce(pt.verified_amount, 0) - coalesce(rt.refunded_amount, 0)
        ),
        0
      ) as balance_due,
      coalesce(pt.pending_amount, 0) as pending_amount,
      coalesce(pt.failed_amount, 0) as failed_amount,
      o.created_at
    from public.orders o
    left join payment_totals pt on pt.order_id = o.id
    left join refund_totals rt on rt.order_id = o.id
    where o.business_id = p_business_id
      and o.status in ('confirmed', 'processing', 'ready', 'completed')
  )
  select
    p.id,
    p.order_number,
    p.customer_name_snapshot,
    p.status,
    p.currency,
    p.total,
    p.verified_amount,
    p.refunded_amount,
    p.net_paid,
    p.balance_due,
    p.pending_amount,
    p.failed_amount,
    public.derive_order_payment_status(
      p.total,
      p.verified_amount,
      p.refunded_amount,
      p.failed_amount,
      p.pending_amount
    ),
    p.created_at,
    count(*) over ()::bigint
  from payable p
  where p.balance_due > 0
    and (
      normalized_search is null
      or p.order_number ilike '%' || normalized_search || '%'
      or p.customer_name_snapshot ilike '%' || normalized_search || '%'
    )
  order by p.created_at desc, p.id
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.search_payments(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_method_code text default null,
  p_order_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_sort text default null,
  p_direction text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  order_id uuid,
  payment_number text,
  order_number text,
  customer_name text,
  order_status text,
  order_total numeric,
  amount numeric,
  currency text,
  method_code text,
  method_label text,
  status text,
  payment_date date,
  transaction_reference text,
  provider_key text,
  provider_transaction_id text,
  notes text,
  recorded_by_name text,
  verified_by_name text,
  verified_at timestamptz,
  verification_note text,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_reason text,
  failed_at timestamptz,
  failure_reason text,
  refunded_amount numeric,
  requested_refund_amount numeric,
  refundable_amount numeric,
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
  normalized_method text := nullif(lower(btrim(p_method_code)), '');
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
     and normalized_status not in ('all', 'pending', 'verified', 'rejected', 'failed') then
    raise exception 'Payment status filter is not valid.'
      using errcode = '22023';
  end if;

  if normalized_sort not in ('recent', 'amount', 'date', 'number', 'order') then
    raise exception 'Payment sort option is not valid.'
      using errcode = '22023';
  end if;

  if normalized_direction not in ('asc', 'desc') then
    raise exception 'Payment sort direction is not valid.'
      using errcode = '22023';
  end if;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'Payment date range is not valid.'
      using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.business_id,
    p.order_id,
    p.payment_number,
    o.order_number,
    o.customer_name_snapshot,
    o.status,
    o.total,
    p.amount,
    p.currency,
    p.method_code,
    p.method_label_snapshot,
    p.status,
    p.payment_date,
    p.transaction_reference,
    p.provider_key,
    p.provider_transaction_id,
    p.notes,
    p.recorded_by_name,
    p.verified_by_name,
    p.verified_at,
    p.verification_note,
    p.rejected_by_name,
    p.rejected_at,
    p.rejection_reason,
    p.failed_at,
    p.failure_reason,
    coalesce(ref.refunded_amount, 0)::numeric,
    coalesce(ref.requested_refund_amount, 0)::numeric,
    case
      when p.status = 'verified' then greatest(
        p.amount
        - coalesce(ref.refunded_amount, 0)
        - coalesce(ref.requested_refund_amount, 0),
        0
      )
      else 0
    end::numeric,
    p.created_at,
    p.updated_at,
    count(*) over ()::bigint
  from public.payments p
  join public.orders o
    on o.business_id = p.business_id
    and o.id = p.order_id
  left join lateral (
    select
      sum(pr.amount) filter (where pr.status = 'completed') as refunded_amount,
      sum(pr.amount) filter (where pr.status = 'requested') as requested_refund_amount
    from public.payment_refunds pr
    where pr.business_id = p.business_id
      and pr.payment_id = p.id
  ) ref on true
  where p.business_id = p_business_id
    and (p_order_id is null or p.order_id = p_order_id)
    and (
      normalized_status is null
      or normalized_status = 'all'
      or p.status = normalized_status
    )
    and (normalized_method is null or p.method_code = normalized_method)
    and (p_date_from is null or p.payment_date >= p_date_from)
    and (p_date_to is null or p.payment_date <= p_date_to)
    and (
      normalized_search is null
      or p.payment_number ilike '%' || normalized_search || '%'
      or o.order_number ilike '%' || normalized_search || '%'
      or o.customer_name_snapshot ilike '%' || normalized_search || '%'
      or coalesce(p.transaction_reference, '') ilike '%' || normalized_search || '%'
      or coalesce(p.provider_transaction_id, '') ilike '%' || normalized_search || '%'
    )
  order by
    case
      when normalized_sort = 'recent' and normalized_direction = 'asc'
      then p.created_at
    end asc nulls last,
    case
      when normalized_sort = 'recent' and normalized_direction = 'desc'
      then p.created_at
    end desc nulls last,
    case
      when normalized_sort = 'amount' and normalized_direction = 'asc'
      then p.amount
    end asc nulls last,
    case
      when normalized_sort = 'amount' and normalized_direction = 'desc'
      then p.amount
    end desc nulls last,
    case
      when normalized_sort = 'date' and normalized_direction = 'asc'
      then p.payment_date
    end asc nulls last,
    case
      when normalized_sort = 'date' and normalized_direction = 'desc'
      then p.payment_date
    end desc nulls last,
    case
      when normalized_sort = 'number' and normalized_direction = 'asc'
      then lower(p.payment_number)
    end asc nulls last,
    case
      when normalized_sort = 'number' and normalized_direction = 'desc'
      then lower(p.payment_number)
    end desc nulls last,
    case
      when normalized_sort = 'order' and normalized_direction = 'asc'
      then lower(o.order_number)
    end asc nulls last,
    case
      when normalized_sort = 'order' and normalized_direction = 'desc'
      then lower(o.order_number)
    end desc nulls last,
    p.id
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.get_payment(p_payment_id uuid)
returns table (
  id uuid,
  business_id uuid,
  order_id uuid,
  payment_number text,
  order_number text,
  customer_name text,
  order_status text,
  order_total numeric,
  amount numeric,
  currency text,
  method_code text,
  method_label text,
  status text,
  payment_date date,
  transaction_reference text,
  provider_key text,
  provider_transaction_id text,
  provider_event_id text,
  notes text,
  recorded_by_name text,
  verified_by_name text,
  verified_at timestamptz,
  verification_note text,
  rejected_by_name text,
  rejected_at timestamptz,
  rejection_reason text,
  failed_at timestamptz,
  failure_reason text,
  refunded_amount numeric,
  requested_refund_amount numeric,
  refundable_amount numeric,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.business_id,
    p.order_id,
    p.payment_number,
    o.order_number,
    o.customer_name_snapshot,
    o.status,
    o.total,
    p.amount,
    p.currency,
    p.method_code,
    p.method_label_snapshot,
    p.status,
    p.payment_date,
    p.transaction_reference,
    p.provider_key,
    p.provider_transaction_id,
    p.provider_event_id,
    p.notes,
    p.recorded_by_name,
    p.verified_by_name,
    p.verified_at,
    p.verification_note,
    p.rejected_by_name,
    p.rejected_at,
    p.rejection_reason,
    p.failed_at,
    p.failure_reason,
    coalesce(ref.refunded_amount, 0)::numeric,
    coalesce(ref.requested_refund_amount, 0)::numeric,
    case
      when p.status = 'verified' then greatest(
        p.amount
        - coalesce(ref.refunded_amount, 0)
        - coalesce(ref.requested_refund_amount, 0),
        0
      )
      else 0
    end::numeric,
    p.created_at,
    p.updated_at
  from public.payments p
  join public.orders o
    on o.business_id = p.business_id
    and o.id = p.order_id
  left join lateral (
    select
      sum(pr.amount) filter (where pr.status = 'completed') as refunded_amount,
      sum(pr.amount) filter (where pr.status = 'requested') as requested_refund_amount
    from public.payment_refunds pr
    where pr.business_id = p.business_id
      and pr.payment_id = p.id
  ) ref on true
  where p.id = p_payment_id;
$$;

create or replace function public.get_payment_overview(p_business_id uuid)
returns table (
  currency text,
  total_payments bigint,
  pending_count bigint,
  pending_amount numeric,
  verified_count bigint,
  verified_amount numeric,
  failed_count bigint,
  failed_amount numeric,
  rejected_count bigint,
  rejected_amount numeric,
  refunded_amount numeric,
  requested_refund_amount numeric,
  outstanding_amount numeric,
  orders_with_balance bigint
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
  with order_scope as (
    select
      o.id,
      o.currency,
      o.total
    from public.orders o
    where o.business_id = p_business_id
      and o.status in ('confirmed', 'processing', 'ready', 'completed')
  ),
  payment_totals as (
    select
      p.currency,
      count(*)::bigint as total_payments,
      count(*) filter (where p.status = 'pending')::bigint as pending_count,
      coalesce(sum(p.amount) filter (where p.status = 'pending'), 0)::numeric as pending_amount,
      count(*) filter (where p.status = 'verified')::bigint as verified_count,
      coalesce(sum(p.amount) filter (where p.status = 'verified'), 0)::numeric as verified_amount,
      count(*) filter (where p.status = 'failed')::bigint as failed_count,
      coalesce(sum(p.amount) filter (where p.status = 'failed'), 0)::numeric as failed_amount,
      count(*) filter (where p.status = 'rejected')::bigint as rejected_count,
      coalesce(sum(p.amount) filter (where p.status = 'rejected'), 0)::numeric as rejected_amount
    from public.payments p
    where p.business_id = p_business_id
    group by p.currency
  ),
  refund_totals as (
    select
      p.currency,
      coalesce(sum(pr.amount) filter (where pr.status = 'completed'), 0)::numeric
        as refunded_amount,
      coalesce(sum(pr.amount) filter (where pr.status = 'requested'), 0)::numeric
        as requested_refund_amount
    from public.payment_refunds pr
    join public.payments p
      on p.business_id = pr.business_id
      and p.id = pr.payment_id
    where p.business_id = p_business_id
    group by p.currency
  ),
  order_totals as (
    select
      o.currency,
      count(*) filter (
        where greatest(
          o.total - (
            coalesce(paid.net_paid, 0)
          ),
          0
        ) > 0
      )::bigint as orders_with_balance,
      coalesce(
        sum(
          greatest(
            o.total - (
              coalesce(paid.net_paid, 0)
            ),
            0
          )
        ),
        0
      )::numeric as outstanding_amount
    from order_scope o
    left join lateral (
      select
        coalesce(
          (
            select sum(p.amount)
            from public.payments p
            where p.business_id = p_business_id
              and p.order_id = o.id
              and p.status = 'verified'
          ),
          0
        )
        - coalesce(
          (
            select sum(pr.amount)
            from public.payment_refunds pr
            join public.payments p
              on p.business_id = pr.business_id
              and p.id = pr.payment_id
            where p.business_id = p_business_id
              and p.order_id = o.id
              and pr.status = 'completed'
          ),
          0
        ) as net_paid
    ) paid on true
    group by o.currency
  ),
  currencies as (
    select ot.currency as currency_code from order_totals ot
    union
    select pt.currency as currency_code from payment_totals pt
  )
  select
    c.currency_code,
    coalesce(pt.total_payments, 0)::bigint,
    coalesce(pt.pending_count, 0)::bigint,
    coalesce(pt.pending_amount, 0)::numeric,
    coalesce(pt.verified_count, 0)::bigint,
    coalesce(pt.verified_amount, 0)::numeric,
    coalesce(pt.failed_count, 0)::bigint,
    coalesce(pt.failed_amount, 0)::numeric,
    coalesce(pt.rejected_count, 0)::bigint,
    coalesce(pt.rejected_amount, 0)::numeric,
    coalesce(rt.refunded_amount, 0)::numeric,
    coalesce(rt.requested_refund_amount, 0)::numeric,
    coalesce(ot.outstanding_amount, 0)::numeric,
    coalesce(ot.orders_with_balance, 0)::bigint
  from currencies c
  left join payment_totals pt on pt.currency = c.currency_code
  left join refund_totals rt on rt.currency = c.currency_code
  left join order_totals ot on ot.currency = c.currency_code
  order by c.currency_code;
end;
$$;

create or replace function public.record_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method_code text,
  p_payment_date date default null,
  p_transaction_reference text default null,
  p_notes text default null,
  p_provider_key text default null,
  p_provider_transaction_id text default null,
  p_provider_event_id text default null,
  p_idempotency_key text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_order public.orders;
  current_method public.payment_methods;
  existing_payment public.payments;
  created_payment public.payments;
  normalized_amount numeric(14, 2);
  normalized_method text := nullif(lower(btrim(p_method_code)), '');
  normalized_payment_date date := coalesce(p_payment_date, current_date);
  normalized_reference text := nullif(btrim(p_transaction_reference), '');
  normalized_notes text := nullif(p_notes, '');
  normalized_provider_key text := nullif(lower(btrim(p_provider_key)), '');
  normalized_provider_transaction text := nullif(btrim(p_provider_transaction_id), '');
  normalized_provider_event text := nullif(btrim(p_provider_event_id), '');
  normalized_idempotency text := nullif(btrim(p_idempotency_key), '');
  net_paid numeric(14, 2);
begin
  if actor_id is null then
    raise exception 'Authentication is required to record a payment.'
      using errcode = '28000';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount can have at most two decimal places.'
      using errcode = '22023';
  end if;

  normalized_amount := round(p_amount, 2);

  if normalized_method is null then
    raise exception 'Choose a payment method.'
      using errcode = '22023';
  end if;

  if normalized_payment_date > current_date then
    raise exception 'Payment date cannot be in the future.'
      using errcode = '22023';
  end if;

  if normalized_notes is not null and char_length(normalized_notes) > 1000 then
    raise exception 'Payment notes cannot exceed 1000 characters.'
      using errcode = '22023';
  end if;

  if normalized_reference is not null and char_length(normalized_reference) > 120 then
    raise exception 'Transaction reference cannot exceed 120 characters.'
      using errcode = '22023';
  end if;

  if normalized_provider_key is not null and char_length(normalized_provider_key) > 60 then
    raise exception 'Provider key cannot exceed 60 characters.'
      using errcode = '22023';
  end if;

  if normalized_provider_transaction is not null
     and char_length(normalized_provider_transaction) > 160 then
    raise exception 'Provider transaction ID cannot exceed 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_provider_event is not null
     and char_length(normalized_provider_event) > 200 then
    raise exception 'Provider event ID cannot exceed 200 characters.'
      using errcode = '22023';
  end if;

  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_order.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if current_order.status not in ('confirmed', 'processing', 'ready', 'completed') then
    raise exception 'Payments can only be recorded for confirmed or fulfilled orders.'
      using errcode = '22023';
  end if;

  if current_order.total <= 0 then
    raise exception 'This order has no amount due.'
      using errcode = '22023';
  end if;

  select * into current_method
  from public.payment_methods
  where business_id = current_order.business_id
    and code = normalized_method
    and is_active;

  if not found then
    raise exception 'The selected payment method is not available.'
      using errcode = '22023';
  end if;

  if normalized_idempotency is not null then
    select * into existing_payment
    from public.payments
    where business_id = current_order.business_id
      and idempotency_key = normalized_idempotency;

    if found then
      if existing_payment.order_id = current_order.id
         and existing_payment.amount = normalized_amount
         and existing_payment.method_code = normalized_method then
        return existing_payment;
      end if;

      raise exception 'This idempotency key was already used for another payment.'
        using errcode = '22023';
    end if;
  end if;

  net_paid := coalesce(
    (
      select sum(p.amount)
      from public.payments p
      where p.business_id = current_order.business_id
        and p.order_id = current_order.id
        and p.status = 'verified'
    ),
    0
  ) - coalesce(
    (
      select sum(pr.amount)
      from public.payment_refunds pr
      join public.payments p
        on p.business_id = pr.business_id
        and p.id = pr.payment_id
      where p.business_id = current_order.business_id
        and p.order_id = current_order.id
        and pr.status = 'completed'
    ),
    0
  );

  if net_paid >= current_order.total then
    raise exception 'This order is already fully paid.'
      using errcode = '22023';
  end if;

  if normalized_amount > current_order.total - net_paid then
    raise exception 'Payment amount exceeds the outstanding order balance.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  insert into public.payments (
    business_id,
    order_id,
    payment_number,
    amount,
    currency,
    method_code,
    method_label_snapshot,
    status,
    payment_date,
    transaction_reference,
    provider_key,
    provider_transaction_id,
    provider_event_id,
    notes,
    idempotency_key,
    recorded_by,
    recorded_by_name
  )
  values (
    current_order.business_id,
    current_order.id,
    public.next_payment_number(current_order.business_id),
    normalized_amount,
    current_order.currency,
    current_method.code,
    current_method.label,
    'pending',
    normalized_payment_date,
    normalized_reference,
    normalized_provider_key,
    normalized_provider_transaction,
    normalized_provider_event,
    normalized_notes,
    normalized_idempotency,
    actor_id,
    actor_name
  )
  returning * into created_payment;

  perform public.log_payment_event(
    created_payment.business_id,
    created_payment.id,
    'created',
    'Payment ' || created_payment.payment_number || ' recorded for order '
      || current_order.order_number || '.',
    jsonb_build_object(
      'paymentNumber', created_payment.payment_number,
      'orderNumber', current_order.order_number,
      'amount', created_payment.amount,
      'currency', created_payment.currency,
      'methodCode', created_payment.method_code,
      'status', created_payment.status
    ),
    actor_id,
    actor_name
  );

  return created_payment;
end;
$$;

create or replace function public.verify_payment(
  p_payment_id uuid,
  p_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_payment public.payments;
  current_order public.orders;
  normalized_note text := nullif(btrim(p_note), '');
  net_paid numeric(14, 2);
begin
  if actor_id is null then
    raise exception 'Authentication is required to verify a payment.'
      using errcode = '28000';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_payment.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_payment.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'Only owners, admins and managers can verify payments.'
      using errcode = '42501';
  end if;

  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception 'Verification note cannot exceed 500 characters.'
      using errcode = '22023';
  end if;

  select * into current_order
  from public.orders
  where business_id = current_payment.business_id
    and id = current_payment.order_id
  for update;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id
  for update;

  if current_payment.status = 'verified' then
    return current_payment;
  end if;

  if current_payment.status <> 'pending' then
    raise exception 'Only pending payments can be verified.'
      using errcode = '22023';
  end if;

  net_paid := coalesce(
    (
      select sum(p.amount)
      from public.payments p
      where p.business_id = current_order.business_id
        and p.order_id = current_order.id
        and p.status = 'verified'
        and p.id <> current_payment.id
    ),
    0
  ) - coalesce(
    (
      select sum(pr.amount)
      from public.payment_refunds pr
      join public.payments p
        on p.business_id = pr.business_id
        and p.id = pr.payment_id
      where p.business_id = current_order.business_id
        and p.order_id = current_order.id
        and p.status = 'verified'
        and p.id <> current_payment.id
        and pr.status = 'completed'
    ),
    0
  );

  if current_payment.amount > current_order.total - net_paid then
    raise exception 'Payment amount exceeds the outstanding order balance.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  update public.payments
  set
    status = 'verified',
    verified_by = actor_id,
    verified_by_name = actor_name,
    verified_at = now(),
    verification_note = normalized_note
  where id = current_payment.id
  returning * into current_payment;

  perform public.log_payment_event(
    current_payment.business_id,
    current_payment.id,
    'verified',
    'Payment ' || current_payment.payment_number || ' verified.',
    jsonb_build_object(
      'paymentNumber', current_payment.payment_number,
      'orderNumber', current_order.order_number,
      'amount', current_payment.amount,
      'currency', current_payment.currency,
      'note', normalized_note
    ),
    actor_id,
    actor_name
  );

  return current_payment;
end;
$$;

create or replace function public.reject_payment(
  p_payment_id uuid,
  p_reason text
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_payment public.payments;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required to review a payment.'
      using errcode = '28000';
  end if;

  if normalized_reason is null
     or char_length(normalized_reason) not between 3 and 500 then
    raise exception 'A rejection reason between 3 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_payment.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_payment.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'Only owners, admins and managers can reject payments.'
      using errcode = '42501';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id
  for update;

  if current_payment.status = 'rejected' then
    return current_payment;
  end if;

  if current_payment.status <> 'pending' then
    raise exception 'Only pending payments can be rejected.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  update public.payments
  set
    status = 'rejected',
    rejected_by = actor_id,
    rejected_by_name = actor_name,
    rejected_at = now(),
    rejection_reason = normalized_reason
  where id = current_payment.id
  returning * into current_payment;

  perform public.log_payment_event(
    current_payment.business_id,
    current_payment.id,
    'rejected',
    'Payment ' || current_payment.payment_number || ' rejected.',
    jsonb_build_object(
      'paymentNumber', current_payment.payment_number,
      'amount', current_payment.amount,
      'currency', current_payment.currency,
      'reason', normalized_reason
    ),
    actor_id,
    actor_name
  );

  return current_payment;
end;
$$;

create or replace function public.fail_payment(
  p_payment_id uuid,
  p_reason text
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_payment public.payments;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required to update a payment.'
      using errcode = '28000';
  end if;

  if normalized_reason is null
     or char_length(normalized_reason) not between 3 and 500 then
    raise exception 'A failure reason between 3 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_payment.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_payment.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'Only owners, admins and managers can mark payments as failed.'
      using errcode = '42501';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id
  for update;

  if current_payment.status = 'failed' then
    return current_payment;
  end if;

  if current_payment.status <> 'pending' then
    raise exception 'Only pending payments can be marked as failed.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  update public.payments
  set
    status = 'failed',
    failed_at = now(),
    failure_reason = normalized_reason
  where id = current_payment.id
  returning * into current_payment;

  perform public.log_payment_event(
    current_payment.business_id,
    current_payment.id,
    'failed',
    'Payment ' || current_payment.payment_number || ' marked as failed.',
    jsonb_build_object(
      'paymentNumber', current_payment.payment_number,
      'amount', current_payment.amount,
      'currency', current_payment.currency,
      'reason', normalized_reason
    ),
    actor_id,
    actor_name
  );

  return current_payment;
end;
$$;

create or replace function public.request_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_reference text default null,
  p_idempotency_key text default null
)
returns public.payment_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_payment public.payments;
  existing_refund public.payment_refunds;
  created_refund public.payment_refunds;
  normalized_amount numeric(14, 2);
  normalized_reason text := nullif(btrim(p_reason), '');
  normalized_reference text := nullif(btrim(p_reference), '');
  normalized_idempotency text := nullif(btrim(p_idempotency_key), '');
  reserved_amount numeric(14, 2);
begin
  if actor_id is null then
    raise exception 'Authentication is required to request a refund.'
      using errcode = '28000';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_amount <> round(p_amount, 2) then
    raise exception 'Refund amount can have at most two decimal places.'
      using errcode = '22023';
  end if;

  normalized_amount := round(p_amount, 2);

  if normalized_reason is null
     or char_length(normalized_reason) not between 3 and 500 then
    raise exception 'A refund reason between 3 and 500 characters is required.'
      using errcode = '22023';
  end if;

  if normalized_reference is not null and char_length(normalized_reference) > 120 then
    raise exception 'Refund reference cannot exceed 120 characters.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_payment.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if current_payment.status <> 'verified' then
    raise exception 'Refunds can only be requested for verified payments.'
      using errcode = '22023';
  end if;

  if normalized_idempotency is not null then
    select * into existing_refund
    from public.payment_refunds
    where business_id = current_payment.business_id
      and idempotency_key = normalized_idempotency;

    if found then
      if existing_refund.payment_id = current_payment.id
         and existing_refund.amount = normalized_amount then
        return existing_refund;
      end if;

      raise exception 'This idempotency key was already used for another refund.'
        using errcode = '22023';
    end if;
  end if;

  select * into current_payment
  from public.payments
  where id = p_payment_id
  for update;

  reserved_amount := coalesce(
    (
      select sum(pr.amount)
      from public.payment_refunds pr
      where pr.business_id = current_payment.business_id
        and pr.payment_id = current_payment.id
        and pr.status in ('requested', 'completed')
    ),
    0
  );

  if normalized_amount > current_payment.amount - reserved_amount then
    raise exception 'Refund amount exceeds the refundable payment balance.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  insert into public.payment_refunds (
    business_id,
    payment_id,
    amount,
    status,
    reason,
    reference,
    idempotency_key,
    requested_by,
    requested_by_name
  )
  values (
    current_payment.business_id,
    current_payment.id,
    normalized_amount,
    'requested',
    normalized_reason,
    normalized_reference,
    normalized_idempotency,
    actor_id,
    actor_name
  )
  returning * into created_refund;

  perform public.log_payment_event(
    current_payment.business_id,
    current_payment.id,
    'refund_requested',
    'Refund of ' || created_refund.amount::text || ' '
      || current_payment.currency || ' requested.',
    jsonb_build_object(
      'refundId', created_refund.id,
      'paymentNumber', current_payment.payment_number,
      'amount', created_refund.amount,
      'currency', current_payment.currency,
      'reason', normalized_reason
    ),
    actor_id,
    actor_name
  );

  return created_refund;
end;
$$;

create or replace function public.complete_refund(
  p_refund_id uuid,
  p_reference text default null
)
returns public.payment_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_refund public.payment_refunds;
  current_payment public.payments;
  normalized_reference text := nullif(btrim(p_reference), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required to complete a refund.'
      using errcode = '28000';
  end if;

  if normalized_reference is not null and char_length(normalized_reference) > 120 then
    raise exception 'Refund reference cannot exceed 120 characters.'
      using errcode = '22023';
  end if;

  select * into current_refund
  from public.payment_refunds
  where id = p_refund_id;

  if not found then
    raise exception 'The refund could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_refund.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_refund.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'Only owners, admins and managers can complete refunds.'
      using errcode = '42501';
  end if;

  select * into current_refund
  from public.payment_refunds
  where id = p_refund_id
  for update;

  if current_refund.status = 'completed' then
    return current_refund;
  end if;

  if current_refund.status <> 'requested' then
    raise exception 'Only requested refunds can be completed.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where business_id = current_refund.business_id
    and id = current_refund.payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  update public.payment_refunds
  set
    status = 'completed',
    completed_by = actor_id,
    completed_by_name = actor_name,
    completed_at = now(),
    reference = coalesce(normalized_reference, reference)
  where id = current_refund.id
  returning * into current_refund;

  perform public.log_payment_event(
    current_refund.business_id,
    current_refund.payment_id,
    'refund_completed',
    'Refund of ' || current_refund.amount::text || ' '
      || current_payment.currency || ' completed.',
    jsonb_build_object(
      'refundId', current_refund.id,
      'paymentNumber', current_payment.payment_number,
      'amount', current_refund.amount,
      'currency', current_payment.currency,
      'reference', current_refund.reference
    ),
    actor_id,
    actor_name
  );

  return current_refund;
end;
$$;

create or replace function public.reject_refund(
  p_refund_id uuid,
  p_reason text
)
returns public.payment_refunds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_name text;
  current_refund public.payment_refunds;
  current_payment public.payments;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required to reject a refund.'
      using errcode = '28000';
  end if;

  if normalized_reason is null
     or char_length(normalized_reason) not between 3 and 500 then
    raise exception 'A rejection reason between 3 and 500 characters is required.'
      using errcode = '22023';
  end if;

  select * into current_refund
  from public.payment_refunds
  where id = p_refund_id;

  if not found then
    raise exception 'The refund could not be found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(current_refund.business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if not public.has_business_role(
    current_refund.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'Only owners, admins and managers can reject refunds.'
      using errcode = '42501';
  end if;

  select * into current_refund
  from public.payment_refunds
  where id = p_refund_id
  for update;

  if current_refund.status = 'rejected' then
    return current_refund;
  end if;

  if current_refund.status <> 'requested' then
    raise exception 'Only requested refunds can be rejected.'
      using errcode = '22023';
  end if;

  select * into current_payment
  from public.payments
  where business_id = current_refund.business_id
    and id = current_refund.payment_id;

  if not found then
    raise exception 'The payment could not be found.'
      using errcode = '22023';
  end if;

  actor_name := public.payment_actor_name();

  update public.payment_refunds
  set
    status = 'rejected',
    rejected_by = actor_id,
    rejected_by_name = actor_name,
    rejected_at = now(),
    rejection_reason = normalized_reason
  where id = current_refund.id
  returning * into current_refund;

  perform public.log_payment_event(
    current_refund.business_id,
    current_refund.payment_id,
    'refund_rejected',
    'Refund of ' || current_refund.amount::text || ' '
      || current_payment.currency || ' rejected.',
    jsonb_build_object(
      'refundId', current_refund.id,
      'paymentNumber', current_payment.payment_number,
      'amount', current_refund.amount,
      'currency', current_payment.currency,
      'reason', normalized_reason
    ),
    actor_id,
    actor_name
  );

  return current_refund;
end;
$$;

revoke all on function public.prevent_payment_event_update()
from public, anon, authenticated;
revoke all on function public.seed_default_payment_methods()
from public, anon, authenticated;
revoke all on function public.payment_actor_name()
from public, anon, authenticated;
revoke all on function public.next_payment_number(uuid)
from public, anon, authenticated;
revoke all on function public.derive_order_payment_status(
  numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.log_payment_event(
  uuid, uuid, text, text, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function public.list_payment_methods(uuid)
from public, anon, authenticated;
revoke all on function public.get_order_payment_summary(uuid)
from public, anon, authenticated;
revoke all on function public.search_payable_orders(uuid, text, integer, integer)
from public, anon, authenticated;
revoke all on function public.search_payments(
  uuid, text, text, text, uuid, date, date, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_payment(uuid)
from public, anon, authenticated;
revoke all on function public.get_payment_overview(uuid)
from public, anon, authenticated;
revoke all on function public.record_payment(
  uuid, numeric, text, date, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.verify_payment(uuid, text)
from public, anon, authenticated;
revoke all on function public.reject_payment(uuid, text)
from public, anon, authenticated;
revoke all on function public.fail_payment(uuid, text)
from public, anon, authenticated;
revoke all on function public.request_refund(uuid, numeric, text, text, text)
from public, anon, authenticated;
revoke all on function public.complete_refund(uuid, text)
from public, anon, authenticated;
revoke all on function public.reject_refund(uuid, text)
from public, anon, authenticated;

grant execute on function public.derive_order_payment_status(
  numeric, numeric, numeric, numeric, numeric
) to authenticated, service_role;
grant execute on function public.list_payment_methods(uuid)
to authenticated, service_role;
grant execute on function public.get_order_payment_summary(uuid)
to authenticated, service_role;
grant execute on function public.search_payable_orders(uuid, text, integer, integer)
to authenticated, service_role;
grant execute on function public.search_payments(
  uuid, text, text, text, uuid, date, date, text, text, integer, integer
) to authenticated, service_role;
grant execute on function public.get_payment(uuid)
to authenticated, service_role;
grant execute on function public.get_payment_overview(uuid)
to authenticated, service_role;
grant execute on function public.record_payment(
  uuid, numeric, text, date, text, text, text, text, text, text
) to authenticated, service_role;
grant execute on function public.verify_payment(uuid, text)
to authenticated, service_role;
grant execute on function public.reject_payment(uuid, text)
to authenticated, service_role;
grant execute on function public.fail_payment(uuid, text)
to authenticated, service_role;
grant execute on function public.request_refund(uuid, numeric, text, text, text)
to authenticated, service_role;
grant execute on function public.complete_refund(uuid, text)
to authenticated, service_role;
grant execute on function public.reject_refund(uuid, text)
to authenticated, service_role;
