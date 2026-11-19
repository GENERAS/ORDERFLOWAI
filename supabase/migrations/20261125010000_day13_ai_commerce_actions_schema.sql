alter table public.orders
add column if not exists source text not null default 'manual';

alter table public.orders
drop constraint if exists orders_source_check;

alter table public.orders
add constraint orders_source_check check (
  source in ('manual', 'storefront', 'ai_assistant')
);

alter table public.orders
add column if not exists channel text;

alter table public.orders
drop constraint if exists orders_channel_fk;

alter table public.orders
add constraint orders_channel_fk
  foreign key (channel) references public.communication_channels(code) on delete set null;

alter table public.orders
add column if not exists conversation_id uuid;

alter table public.orders
drop constraint if exists orders_conversation_fk;

alter table public.orders
add constraint orders_conversation_fk
  foreign key (business_id, conversation_id)
  references public.communication_conversations(business_id, id) on delete set null;

alter table public.orders
add column if not exists discount_amount numeric(14, 2) not null default 0;

alter table public.orders
add column if not exists delivery_fee numeric(14, 2) not null default 0;

alter table public.orders
add column if not exists tax_amount numeric(14, 2) not null default 0;

alter table public.orders
add column if not exists delivery_method text;

alter table public.orders
add column if not exists delivery_address text;

alter table public.orders
add column if not exists delivery_instructions text;

alter table public.orders
add column if not exists customer_confirmed_at timestamptz;

alter table public.orders
add column if not exists requires_reconfirmation boolean not null default false;

alter table public.orders
drop constraint if exists order_charges_check;

alter table public.orders
add constraint order_charges_check check (
  discount_amount >= 0
  and delivery_fee >= 0
  and tax_amount >= 0
);

alter table public.order_events
drop constraint if exists order_events_type_check;

alter table public.order_events
add constraint order_events_type_check check (
  event_type in (
    'created',
    'updated',
    'status_changed',
    'customer_confirmed',
    'business_approved',
    'business_rejected',
    'clarification_requested',
    'order_prepared',
    'quote_presented',
    'quote_revised',
    'customer_reconfirmation_required',
    'customer_cancelled',
    'stock_reserved',
    'stock_released',
    'stock_consumed',
    'fulfilled',
    'cancelled'
  )
);

create table if not exists public.ai_order_charge_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  delivery_fee numeric(14, 2) not null default 0 check (delivery_fee >= 0),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 2000),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.ai_order_quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  conversation_id uuid,
  channel text,
  customer_id uuid,
  version integer not null default 1 check (version between 1 and 1000),
  status text not null default 'draft'
    check (status in ('draft', 'presented', 'accepted', 'superseded', 'expired', 'cancelled')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14, 2) not null default 0 check (discount_amount >= 0),
  delivery_fee numeric(14, 2) not null default 0 check (delivery_fee >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  idempotency_key text,
  created_at timestamptz not null default now(),
  presented_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  superseded_at timestamptz,
  cancelled_at timestamptz,
  constraint ai_order_quotes_business_id_key unique (business_id, id),
  constraint ai_order_quotes_order_version_key unique (business_id, order_id, version),
  constraint ai_order_quotes_idempotency_key unique (business_id, idempotency_key),
  constraint ai_order_quotes_order_fk
    foreign key (business_id, order_id) references public.orders(business_id, id) on delete cascade,
  constraint ai_order_quotes_customer_fk
    foreign key (business_id, customer_id) references public.customers(business_id, id) on delete set null,
  constraint ai_order_quotes_conversation_fk
    foreign key (business_id, conversation_id)
    references public.communication_conversations(business_id, id) on delete set null,
  constraint ai_order_quotes_channel_fk
    foreign key (channel) references public.communication_channels(code) on delete set null
);

create table if not exists public.ai_order_quote_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  product_name_snapshot text not null,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 100000),
  line_total numeric(14, 2) not null check (line_total >= 0),
  available_quantity integer,
  created_at timestamptz not null default now(),
  constraint ai_order_quote_items_business_id_key unique (business_id, id),
  constraint ai_order_quote_items_quote_fk
    foreign key (business_id, quote_id)
    references public.ai_order_quotes(business_id, id) on delete cascade,
  constraint ai_order_quote_items_product_fk
    foreign key (business_id, product_id) references public.products(business_id, id) on delete restrict,
  constraint ai_order_quote_items_variant_fk
    foreign key (business_id, product_id, variant_id)
    references public.product_variants(business_id, product_id, id) on delete restrict
);

create table if not exists public.ai_order_preparations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  conversation_id uuid,
  channel text not null default 'ai_assistant',
  customer_id uuid,
  source text not null default 'ai_assistant'
    check (source in ('ai_assistant', 'whatsapp', 'web_chat', 'storefront')),
  status text not null default 'preparing'
    check (
      status in (
        'preparing',
        'awaiting_customer_confirmation',
        'customer_confirmed',
        'awaiting_business_approval',
        'clarification_requested',
        'approved',
        'rejected',
        'cancelled'
      )
    ),
  current_quote_id uuid,
  customer_confirmed_at timestamptz,
  confirmation_source text,
  confirmation_reference text,
  confirmed_quote_id uuid,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  clarification_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_order_preparations_business_id_key unique (business_id, id),
  constraint ai_order_preparations_order_key unique (business_id, order_id),
  constraint ai_order_preparations_order_fk
    foreign key (business_id, order_id) references public.orders(business_id, id) on delete cascade,
  constraint ai_order_preparations_customer_fk
    foreign key (business_id, customer_id) references public.customers(business_id, id) on delete set null,
  constraint ai_order_preparations_conversation_fk
    foreign key (business_id, conversation_id)
    references public.communication_conversations(business_id, id) on delete set null,
  constraint ai_order_preparations_channel_fk
    foreign key (channel) references public.communication_channels(code) on delete restrict,
  constraint ai_order_preparations_current_quote_fk
    foreign key (business_id, current_quote_id) references public.ai_order_quotes(business_id, id) on delete set null,
  constraint ai_order_preparations_confirmed_quote_fk
    foreign key (business_id, confirmed_quote_id) references public.ai_order_quotes(business_id, id) on delete set null
);

create table if not exists public.ai_order_idempotency (
  business_id uuid not null references public.businesses(id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, idempotency_key)
);

create table if not exists public.ai_order_action_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid,
  quote_id uuid,
  conversation_id uuid,
  action text not null check (char_length(btrim(action)) between 3 and 80),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_role text,
  source text,
  channel text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_order_quotes_business_status_idx
on public.ai_order_quotes (business_id, status, created_at desc);

create index if not exists ai_order_quotes_order_idx
on public.ai_order_quotes (business_id, order_id, version desc);

create index if not exists ai_order_quote_items_quote_idx
on public.ai_order_quote_items (business_id, quote_id, created_at);

create unique index if not exists ai_order_quote_items_unit_key
on public.ai_order_quote_items (
  business_id,
  quote_id,
  product_id,
  coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index if not exists ai_order_preparations_business_status_idx
on public.ai_order_preparations (business_id, status, updated_at desc);

create index if not exists ai_order_preparations_conversation_idx
on public.ai_order_preparations (business_id, conversation_id, updated_at desc);

create index if not exists ai_order_action_log_business_created_idx
on public.ai_order_action_log (business_id, created_at desc);

create index if not exists ai_order_action_log_order_idx
on public.ai_order_action_log (business_id, order_id, created_at desc);

alter table public.ai_order_charge_settings enable row level security;
alter table public.ai_order_quotes enable row level security;
alter table public.ai_order_quote_items enable row level security;
alter table public.ai_order_preparations enable row level security;
alter table public.ai_order_idempotency enable row level security;
alter table public.ai_order_action_log enable row level security;

drop policy if exists ai_order_charge_settings_select on public.ai_order_charge_settings;
create policy ai_order_charge_settings_select on public.ai_order_charge_settings
for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_order_quotes_select on public.ai_order_quotes;
create policy ai_order_quotes_select on public.ai_order_quotes
for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_order_quote_items_select on public.ai_order_quote_items;
create policy ai_order_quote_items_select on public.ai_order_quote_items
for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_order_preparations_select on public.ai_order_preparations;
create policy ai_order_preparations_select on public.ai_order_preparations
for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_order_idempotency_select on public.ai_order_idempotency;
create policy ai_order_idempotency_select on public.ai_order_idempotency
for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_order_action_log_select on public.ai_order_action_log;
create policy ai_order_action_log_select on public.ai_order_action_log
for select to authenticated using (public.is_business_member(business_id));

revoke all on public.ai_order_charge_settings from public, anon, authenticated;
revoke all on public.ai_order_quotes from public, anon, authenticated;
revoke all on public.ai_order_quote_items from public, anon, authenticated;
revoke all on public.ai_order_preparations from public, anon, authenticated;
revoke all on public.ai_order_idempotency from public, anon, authenticated;
revoke all on public.ai_order_action_log from public, anon, authenticated;

grant select on public.ai_order_charge_settings to authenticated;
grant select on public.ai_order_quotes to authenticated;
grant select on public.ai_order_quote_items to authenticated;
grant select on public.ai_order_preparations to authenticated;
grant select on public.ai_order_idempotency to authenticated;
grant select on public.ai_order_action_log to authenticated;

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
    total = greatest(
      0,
      coalesce(
        (
          select sum(oi.line_total)
          from public.order_items oi
          where oi.business_id = o.business_id
            and oi.order_id = o.id
        ),
        0
      ) - o.discount_amount + o.delivery_fee + o.tax_amount
    ),
    updated_at = now()
  where o.id = target_order_id;

  return null;
end;
$$;
