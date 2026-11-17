create table public.communication_channels (
  code text primary key,
  name text not null,
  description text,
  status text not null default 'available'
    check (status in ('available', 'coming_soon')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.communication_channels (
  code, name, description, status, sort_order
)
values
  ('whatsapp', 'WhatsApp', 'WhatsApp Business Cloud conversations.', 'available', 1),
  ('instagram', 'Instagram', 'Instagram Direct conversations.', 'coming_soon', 2),
  ('messenger', 'Messenger', 'Facebook Messenger conversations.', 'coming_soon', 3),
  ('web_chat', 'Web Chat', 'Website live chat conversations.', 'coming_soon', 4)
on conflict (code) do nothing;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.business_channel_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null references public.communication_channels(code),
  provider text not null default 'meta',
  external_account_id text,
  external_phone_number_id text,
  display_phone_number text,
  verified_name text,
  business_portfolio_id text,
  status text not null default 'not_connected'
    check (status in (
      'not_connected', 'connected', 'expired', 'revoked', 'error', 'disconnected'
    )),
  token_expires_at timestamptz,
  scopes text[],
  last_health_check_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index business_channel_connections_phone_key
on public.business_channel_connections (business_id, channel, external_phone_number_id)
where external_phone_number_id is not null;

create index business_channel_connections_business_channel_status_idx
on public.business_channel_connections (business_id, channel, status);

create index business_channel_connections_phone_lookup_idx
on public.business_channel_connections (external_phone_number_id)
where external_phone_number_id is not null;

create index business_channel_connections_account_lookup_idx
on public.business_channel_connections (external_account_id)
where external_account_id is not null;

create index business_channel_connections_updated_idx
on public.business_channel_connections (business_id, updated_at desc);

create table private.channel_credentials (
  connection_id uuid primary key
    references public.business_channel_connections(id) on delete cascade,
  access_token text not null,
  token_type text not null default 'bearer',
  scopes text[],
  expires_at timestamptz,
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.channel_credentials enable row level security;

revoke all on private.channel_credentials from public, anon, authenticated;
grant all on private.channel_credentials to service_role;

create table public.communication_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  connection_id uuid
    references public.business_channel_connections(id) on delete set null,
  channel text not null references public.communication_channels(code),
  external_customer_id text not null,
  external_customer_id_type text not null default 'wa_id',
  display_name text,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'pending', 'assigned', 'resolved', 'archived')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  last_message_at timestamptz,
  last_incoming_at timestamptz,
  last_outgoing_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_conversations_business_id_key unique (business_id, id),
  constraint communication_conversations_external_key
    unique (business_id, channel, external_customer_id),
  constraint communication_conversations_external_check check (
    char_length(btrim(external_customer_id)) between 1 and 255
  )
);

create index communication_conversations_business_status_last_idx
on public.communication_conversations (business_id, status, last_message_at desc);

create index communication_conversations_business_customer_idx
on public.communication_conversations (business_id, customer_id, created_at desc);

create index communication_conversations_business_incoming_idx
on public.communication_conversations (business_id, last_incoming_at desc);

create index communication_conversations_business_unread_idx
on public.communication_conversations (business_id, unread_count desc);

create index communication_conversations_business_created_idx
on public.communication_conversations (business_id, created_at desc);

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null,
  connection_id uuid
    references public.business_channel_connections(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  text_content text,
  provider_message_id text,
  provider_status text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  template_name text,
  template_language text,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  media_provider_id text,
  media_mime_type text,
  media_filename text,
  media_caption text,
  media_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  client_request_id uuid,
  occurred_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint communication_messages_conversation_fk
    foreign key (business_id, conversation_id)
    references public.communication_conversations(business_id, id) on delete cascade
);

create unique index communication_messages_business_provider_key
on public.communication_messages (business_id, provider_message_id)
where provider_message_id is not null;

create unique index communication_messages_outbound_request_key
on public.communication_messages (business_id, direction, client_request_id)
where direction = 'outbound';

create index communication_messages_conversation_created_idx
on public.communication_messages (business_id, conversation_id, created_at desc);

create index communication_messages_business_direction_created_idx
on public.communication_messages (business_id, direction, created_at desc);

create index communication_messages_business_status_created_idx
on public.communication_messages (business_id, status, created_at desc);

create index communication_messages_business_occurred_idx
on public.communication_messages (business_id, occurred_at desc);

create index communication_messages_business_provider_status_idx
on public.communication_messages (business_id, provider_status);

create table public.communication_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta',
  event_key text not null,
  business_id uuid,
  connection_id uuid,
  event_type text,
  payload jsonb,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'ignored')),
  error_message text,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_webhook_events_provider_event_key_key
    unique (provider, event_key),
  constraint communication_webhook_events_event_key_check check (
    char_length(btrim(event_key)) between 1 and 500
  )
);

create index communication_webhook_events_business_status_created_idx
on public.communication_webhook_events (business_id, status, created_at desc);

create index communication_webhook_events_connection_created_idx
on public.communication_webhook_events (connection_id, created_at desc);

create index communication_webhook_events_occurred_idx
on public.communication_webhook_events (occurred_at desc);

create table public.communication_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index communication_audit_log_business_created_idx
on public.communication_audit_log (business_id, created_at desc);

create index communication_audit_log_entity_idx
on public.communication_audit_log (business_id, entity_type, entity_id);

create table public.communication_opt_outs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  channel text not null default 'whatsapp',
  external_customer_id text not null,
  opted_out boolean not null default true,
  reason text,
  source text not null default 'webhook',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_opt_outs_key
    unique (business_id, channel, external_customer_id),
  constraint communication_opt_outs_external_check check (
    char_length(btrim(external_customer_id)) between 1 and 255
  )
);

create index communication_opt_outs_business_channel_idx
on public.communication_opt_outs (business_id, channel, opted_out);

create index communication_opt_outs_external_idx
on public.communication_opt_outs (external_customer_id);

create trigger business_channel_connections_set_updated_at
before update on public.business_channel_connections
for each row execute function public.set_updated_at();

create trigger private_channel_credentials_set_updated_at
before update on private.channel_credentials
for each row execute function public.set_updated_at();

create trigger communication_conversations_set_updated_at
before update on public.communication_conversations
for each row execute function public.set_updated_at();

create trigger communication_messages_set_updated_at
before update on public.communication_messages
for each row execute function public.set_updated_at();

create trigger communication_webhook_events_set_updated_at
before update on public.communication_webhook_events
for each row execute function public.set_updated_at();

create trigger communication_opt_outs_set_updated_at
before update on public.communication_opt_outs
for each row execute function public.set_updated_at();

alter table public.communication_channels enable row level security;
alter table public.business_channel_connections enable row level security;
alter table public.communication_conversations enable row level security;
alter table public.communication_messages enable row level security;
alter table public.communication_webhook_events enable row level security;
alter table public.communication_audit_log enable row level security;
alter table public.communication_opt_outs enable row level security;

create policy communication_channels_select
on public.communication_channels
for select
to authenticated
using (true);

create policy business_channel_connections_select_members
on public.business_channel_connections
for select
to authenticated
using (public.is_business_member(business_id));

create policy communication_conversations_select_members
on public.communication_conversations
for select
to authenticated
using (public.is_business_member(business_id));

create policy communication_messages_select_members
on public.communication_messages
for select
to authenticated
using (public.is_business_member(business_id));

create policy communication_webhook_events_select_members
on public.communication_webhook_events
for select
to authenticated
using (public.is_business_member(business_id));

create policy communication_audit_log_select_members
on public.communication_audit_log
for select
to authenticated
using (public.is_business_member(business_id));

create policy communication_opt_outs_select_members
on public.communication_opt_outs
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.communication_channels from anon, authenticated;
revoke all on public.business_channel_connections from anon, authenticated;
revoke all on public.communication_conversations from anon, authenticated;
revoke all on public.communication_messages from anon, authenticated;
revoke all on public.communication_webhook_events from anon, authenticated;
revoke all on public.communication_audit_log from anon, authenticated;
revoke all on public.communication_opt_outs from anon, authenticated;

grant select on public.communication_channels to authenticated;
grant select on public.business_channel_connections to authenticated;
grant select on public.communication_conversations to authenticated;
grant select on public.communication_messages to authenticated;
grant select on public.communication_webhook_events to authenticated;
grant select on public.communication_audit_log to authenticated;
grant select on public.communication_opt_outs to authenticated;

create or replace function public.communication_normalize_phone(p_phone text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select regexp_replace(p_phone, '[^0-9]', '', 'g');
$$;

create or replace function public.communication_can_manage_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.has_business_role(
      p_business_id,
      array['owner', 'admin', 'manager']
    );
$$;

create or replace function public.communication_log_audit(
  p_business_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null or nullif(btrim(coalesce(p_action, '')), '') is null then
    return;
  end if;

  insert into public.communication_audit_log (
    business_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  values (
    p_business_id,
    auth.uid(),
    left(btrim(p_action), 120),
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    nullif(btrim(coalesce(p_entity_id, '')), ''),
    coalesce(p_details, '{}'::jsonb),
    now()
  );
end;
$$;

create or replace function public.communication_list_channels(p_business_id uuid)
returns table (
  code text,
  name text,
  description text,
  channel_status text,
  sort_order integer,
  connection_id uuid,
  connection_status text,
  display_phone_number text,
  external_account_id text,
  external_phone_number_id text,
  verified_name text,
  business_portfolio_id text,
  last_error text,
  connected_at timestamptz,
  metadata jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view communication channels.'
      using errcode = '28000';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  select
    cc.code,
    cc.name,
    cc.description,
    cc.status as channel_status,
    cc.sort_order,
    conn.id as connection_id,
    conn.status as connection_status,
    conn.display_phone_number,
    conn.external_account_id,
    conn.external_phone_number_id,
    conn.verified_name,
    conn.business_portfolio_id,
    conn.last_error,
    conn.connected_at,
    coalesce(conn.metadata, '{}'::jsonb) as metadata
  from public.communication_channels cc
  left join lateral (
    select bcc.*
    from public.business_channel_connections bcc
    where bcc.business_id = p_business_id
      and bcc.channel = cc.code
    order by
      case when bcc.status = 'connected' then 0 else 1 end,
      bcc.created_at desc,
      bcc.id desc
    limit 1
  ) conn on true
  order by cc.sort_order, cc.code;
end;
$$;

create or replace function public.communication_get_connection(
  p_business_id uuid,
  p_channel text
)
returns table (
  code text,
  name text,
  description text,
  channel_status text,
  sort_order integer,
  connection_id uuid,
  connection_status text,
  display_phone_number text,
  external_account_id text,
  external_phone_number_id text,
  verified_name text,
  business_portfolio_id text,
  last_error text,
  connected_at timestamptz,
  metadata jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
begin
  if auth.uid() is null then
    raise exception 'Sign in to view channel connections.'
      using errcode = '28000';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  select
    cc.code,
    cc.name,
    cc.description,
    cc.status as channel_status,
    cc.sort_order,
    conn.id as connection_id,
    conn.status as connection_status,
    conn.display_phone_number,
    conn.external_account_id,
    conn.external_phone_number_id,
    conn.verified_name,
    conn.business_portfolio_id,
    conn.last_error,
    conn.connected_at,
    coalesce(conn.metadata, '{}'::jsonb) as metadata
  from public.communication_channels cc
  left join lateral (
    select bcc.*
    from public.business_channel_connections bcc
    where bcc.business_id = p_business_id
      and bcc.channel = cc.code
    order by
      case when bcc.status = 'connected' then 0 else 1 end,
      bcc.created_at desc,
      bcc.id desc
    limit 1
  ) conn on true
  where cc.code = v_channel;
end;
$$;

create or replace function public.communication_disconnect_channel(
  p_business_id uuid,
  p_channel text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_connection public.business_channel_connections;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage channel connections.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to disconnect channels.'
      using errcode = '42501';
  end if;

  if v_channel = '' then
    raise exception 'Choose a valid channel.'
      using errcode = '22023';
  end if;

  select bcc.*
  into v_connection
  from public.business_channel_connections bcc
  where bcc.business_id = p_business_id
    and bcc.channel = v_channel
  order by
    case when bcc.status = 'connected' then 0 else 1 end,
    bcc.created_at desc,
    bcc.id desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  update public.business_channel_connections bcc
  set
    status = 'disconnected',
    disconnected_at = now(),
    updated_at = now()
  where bcc.id = v_connection.id;

  delete from private.channel_credentials cc
  where cc.connection_id = v_connection.id;

  perform public.communication_log_audit(
    p_business_id,
    'channel_disconnected',
    'channel_connection',
    v_connection.id::text,
    jsonb_build_object(
      'channel', v_channel,
      'previousStatus', v_connection.status,
      'phoneNumberId', v_connection.external_phone_number_id
    )
  );

  return true;
end;
$$;

create or replace function public.communication_list_assignable_users(p_business_id uuid)
returns table (
  user_id uuid,
  full_name text,
  role text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view assignable users.'
      using errcode = '28000';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  select
    bm.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Team member') as full_name,
    bm.role
  from public.business_members bm
  left join public.profiles p on p.id = bm.user_id
  where bm.business_id = p_business_id
    and bm.status = 'active'
  order by
    case bm.role
      when 'owner' then 1
      when 'admin' then 2
      when 'manager' then 3
      when 'staff' then 4
      else 5
    end,
    lower(coalesce(p.full_name, '')),
    bm.user_id;
end;
$$;

create or replace function public.communication_list_conversations(
  p_business_id uuid,
  p_status text default null,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  connection_id uuid,
  channel text,
  external_customer_id text,
  external_customer_id_type text,
  display_name text,
  customer_id uuid,
  status text,
  assigned_to uuid,
  assigned_at timestamptz,
  last_message_at timestamptz,
  last_incoming_at timestamptz,
  last_outgoing_at timestamptz,
  unread_count integer,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  customer_name text,
  customer_phone text,
  last_message_text text,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Sign in to view conversations.'
      using errcode = '28000';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  if v_status is not null
     and v_status <> 'all'
     and v_status not in ('open', 'pending', 'assigned', 'resolved', 'archived') then
    raise exception 'Conversation status filter is not valid.'
      using errcode = '22023';
  end if;

  v_pattern := '%' || v_search || '%';

  return query
  with filtered as (
    select
      c.id,
      c.business_id,
      c.connection_id,
      c.channel,
      c.external_customer_id,
      c.external_customer_id_type,
      c.display_name,
      c.customer_id,
      c.status,
      c.assigned_to,
      c.assigned_at,
      c.last_message_at,
      c.last_incoming_at,
      c.last_outgoing_at,
      c.unread_count,
      c.metadata,
      c.created_at,
      c.updated_at,
      coalesce(cust.full_name, c.display_name, c.external_customer_id) as customer_name,
      coalesce(cust.phone, c.external_customer_id) as customer_phone,
      (
        select m.text_content
        from public.communication_messages m
        where m.conversation_id = c.id
        order by m.created_at desc, m.id desc
        limit 1
      ) as last_message_text
    from public.communication_conversations c
    left join public.customers cust
      on cust.id = c.customer_id
     and cust.business_id = c.business_id
    where c.business_id = p_business_id
      and (
        v_status is null
        or v_status = 'all'
        or c.status = v_status
      )
      and (
        v_search is null
        or c.external_customer_id ilike v_pattern
        or coalesce(c.display_name, '') ilike v_pattern
        or coalesce(cust.full_name, '') ilike v_pattern
        or exists (
          select 1
          from public.communication_messages sm
          where sm.conversation_id = c.id
            and coalesce(sm.text_content, '') ilike v_pattern
        )
      )
  )
  select
    f.id,
    f.business_id,
    f.connection_id,
    f.channel,
    f.external_customer_id,
    f.external_customer_id_type,
    f.display_name,
    f.customer_id,
    f.status,
    f.assigned_to,
    f.assigned_at,
    f.last_message_at,
    f.last_incoming_at,
    f.last_outgoing_at,
    f.unread_count,
    f.metadata,
    f.created_at,
    f.updated_at,
    f.customer_name,
    f.customer_phone,
    f.last_message_text,
    count(*) over ()::bigint as total_count
  from filtered f
  order by coalesce(f.last_message_at, f.created_at) desc, f.id desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.communication_get_conversation(p_conversation_id uuid)
returns table (
  id uuid,
  business_id uuid,
  connection_id uuid,
  channel text,
  external_customer_id text,
  external_customer_id_type text,
  display_name text,
  customer_id uuid,
  status text,
  assigned_to uuid,
  assigned_at timestamptz,
  last_message_at timestamptz,
  last_incoming_at timestamptz,
  last_outgoing_at timestamptz,
  unread_count integer,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  customer_name text,
  customer_phone text,
  customer_email text,
  customer_status text,
  connection_phone_number text,
  connection_external_account_id text,
  connection_status text,
  assigned_user_full_name text,
  customer_orders jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view conversations.'
      using errcode = '28000';
  end if;

  select c.*
  into v_conversation
  from public.communication_conversations c
  where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(v_conversation.business_id) then
    raise exception 'You do not have access to this conversation.'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.business_id,
    c.connection_id,
    c.channel,
    c.external_customer_id,
    c.external_customer_id_type,
    c.display_name,
    c.customer_id,
    c.status,
    c.assigned_to,
    c.assigned_at,
    c.last_message_at,
    c.last_incoming_at,
    c.last_outgoing_at,
    c.unread_count,
    c.metadata,
    c.created_at,
    c.updated_at,
    coalesce(cust.full_name, c.display_name, c.external_customer_id) as customer_name,
    coalesce(cust.phone, c.external_customer_id) as customer_phone,
    cust.email as customer_email,
    cust.status as customer_status,
    conn.display_phone_number as connection_phone_number,
    conn.external_account_id as connection_external_account_id,
    conn.status as connection_status,
    coalesce(nullif(btrim(assignee.full_name), ''), 'Team member') as assigned_user_full_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent_order.id,
          'order_number', recent_order.order_number,
          'status', recent_order.status,
          'total', recent_order.total,
          'currency', recent_order.currency,
          'created_at', recent_order.created_at
        )
        order by recent_order.created_at desc, recent_order.id desc
      )
      from (
        select o.id, o.order_number, o.status, o.total, o.currency, o.created_at
        from public.orders o
        where o.business_id = c.business_id
          and o.customer_id = c.customer_id
        order by o.created_at desc, o.id desc
        limit 5
      ) recent_order
    ), '[]'::jsonb) as customer_orders
  from public.communication_conversations c
  left join public.customers cust
    on cust.id = c.customer_id
   and cust.business_id = c.business_id
  left join public.business_channel_connections conn
    on conn.id = c.connection_id
  left join public.profiles assignee
    on assignee.id = c.assigned_to
  where c.id = p_conversation_id;
end;
$$;

create or replace function public.communication_list_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  business_id uuid,
  conversation_id uuid,
  connection_id uuid,
  direction text,
  message_type text,
  text_content text,
  provider_message_id text,
  provider_status text,
  status text,
  template_name text,
  template_language text,
  media_asset_id uuid,
  media_provider_id text,
  media_mime_type text,
  media_filename text,
  media_caption text,
  media_metadata jsonb,
  error_code text,
  error_message text,
  client_request_id uuid,
  occurred_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  has_more boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Sign in to view messages.'
      using errcode = '28000';
  end if;

  select c.business_id into v_business_id
  from public.communication_conversations c
  where c.id = p_conversation_id;

  if v_business_id is null then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(v_business_id) then
    raise exception 'You do not have access to this conversation.'
      using errcode = '42501';
  end if;

  return query
  with matched as (
    select m.*
    from public.communication_messages m
    where m.conversation_id = p_conversation_id
      and (p_before is null or m.created_at < p_before)
  ),
  paged as (
    select
      matched.*,
      row_number() over (order by matched.created_at desc, matched.id desc) as page_row
    from matched
  ),
  matched_counts as (
    select count(*)::bigint as total_count from matched
  )
  select
    p.id,
    p.business_id,
    p.conversation_id,
    p.connection_id,
    p.direction,
    p.message_type,
    p.text_content,
    p.provider_message_id,
    p.provider_status,
    p.status,
    p.template_name,
    p.template_language,
    p.media_asset_id,
    p.media_provider_id,
    p.media_mime_type,
    p.media_filename,
    p.media_caption,
    p.media_metadata,
    p.error_code,
    p.error_message,
    p.client_request_id,
    p.occurred_at,
    p.sent_at,
    p.delivered_at,
    p.read_at,
    p.failed_at,
    p.metadata,
    p.created_at,
    p.updated_at,
    p.created_by,
    (mc.total_count > v_limit) as has_more
  from paged p
  cross join matched_counts mc
  where p.page_row <= v_limit
  order by p.page_row;
end;
$$;

create or replace function public.communication_get_send_context(p_conversation_id uuid)
returns table (
  conversation_id uuid,
  business_id uuid,
  channel text,
  connection_id uuid,
  connection_status text,
  recipient text,
  customer_id uuid,
  last_incoming_at timestamptz,
  service_window_open boolean,
  template_required boolean,
  opted_out boolean,
  can_send boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
  v_connection_status text;
  v_opted_out boolean := false;
  v_window_open boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view send context.'
      using errcode = '28000';
  end if;

  select c.*
  into v_conversation
  from public.communication_conversations c
  where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(v_conversation.business_id) then
    raise exception 'You do not have access to this conversation.'
      using errcode = '42501';
  end if;

  select bcc.status into v_connection_status
  from public.business_channel_connections bcc
  where bcc.id = v_conversation.connection_id;

  select coalesce(o.opted_out, false) into v_opted_out
  from public.communication_opt_outs o
  where o.business_id = v_conversation.business_id
    and o.channel = v_conversation.channel
    and o.external_customer_id = v_conversation.external_customer_id
  order by o.created_at desc, o.id desc
  limit 1;

  v_opted_out := coalesce(v_opted_out, false);
  v_window_open := v_conversation.last_incoming_at is not null
    and v_conversation.last_incoming_at > now() - interval '24 hours';

  return query
  select
    v_conversation.id,
    v_conversation.business_id,
    v_conversation.channel,
    v_conversation.connection_id,
    v_connection_status,
    v_conversation.external_customer_id,
    v_conversation.customer_id,
    v_conversation.last_incoming_at,
    v_window_open,
    not v_window_open,
    v_opted_out,
    coalesce(v_connection_status, '') = 'connected' and not v_opted_out;
end;
$$;

create or replace function public.communication_assign_conversation(
  p_conversation_id uuid,
  p_assignee_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
begin
  if auth.uid() is null then
    raise exception 'Sign in to assign conversations.'
      using errcode = '28000';
  end if;

  select c.*
  into v_conversation
  from public.communication_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    v_conversation.business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to assign conversations.'
      using errcode = '42501';
  end if;

  if p_assignee_id is not null then
    if not exists (
      select 1
      from public.business_members bm
      where bm.business_id = v_conversation.business_id
        and bm.user_id = p_assignee_id
        and bm.status = 'active'
    ) then
      raise exception 'The assignee must be an active member of this business.'
        using errcode = '22023';
    end if;

    update public.communication_conversations c
    set
      assigned_to = p_assignee_id,
      assigned_at = now(),
      status = 'assigned'
    where c.id = p_conversation_id;
  else
    update public.communication_conversations c
    set
      assigned_to = null,
      assigned_at = null,
      status = 'open'
    where c.id = p_conversation_id;
  end if;

  perform public.communication_log_audit(
    v_conversation.business_id,
    case when p_assignee_id is null then 'conversation_unassigned' else 'conversation_assigned' end,
    'conversation',
    p_conversation_id::text,
    jsonb_build_object(
      'previousAssignee', v_conversation.assigned_to,
      'assignee', p_assignee_id,
      'previousStatus', v_conversation.status
    )
  );

  return true;
end;
$$;

create or replace function public.communication_set_conversation_status(
  p_conversation_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to update conversations.'
      using errcode = '28000';
  end if;

  if v_status is null
     or v_status not in ('open', 'pending', 'assigned', 'resolved', 'archived') then
    raise exception 'Choose a valid conversation status.'
      using errcode = '22023';
  end if;

  select c.*
  into v_conversation
  from public.communication_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    v_conversation.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to update conversations.'
      using errcode = '42501';
  end if;

  update public.communication_conversations c
  set status = v_status
  where c.id = p_conversation_id;

  perform public.communication_log_audit(
    v_conversation.business_id,
    'conversation_status_changed',
    'conversation',
    p_conversation_id::text,
    jsonb_build_object(
      'from', v_conversation.status,
      'to', v_status
    )
  );

  return true;
end;
$$;

create or replace function public.communication_mark_conversation_read(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to update conversations.'
      using errcode = '28000';
  end if;

  select c.business_id into v_business_id
  from public.communication_conversations c
  where c.id = p_conversation_id
  for update;

  if v_business_id is null then
    return false;
  end if;

  if not public.is_business_member(v_business_id) then
    raise exception 'You do not have access to this conversation.'
      using errcode = '42501';
  end if;

  update public.communication_conversations c
  set unread_count = 0
  where c.id = p_conversation_id;

  return true;
end;
$$;

create or replace function public.communication_set_opt_out(
  p_business_id uuid,
  p_external_customer_id text,
  p_opted_out boolean,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_external_id text := nullif(btrim(coalesce(p_external_customer_id, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to update opt-out settings.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to update opt-out settings.'
      using errcode = '42501';
  end if;

  if v_external_id is null or p_opted_out is null then
    raise exception 'A customer identifier and opt-out choice are required.'
      using errcode = '22023';
  end if;

  insert into public.communication_opt_outs (
    business_id,
    channel,
    external_customer_id,
    opted_out,
    reason,
    source,
    created_at,
    updated_at
  )
  values (
    p_business_id,
    'whatsapp',
    left(v_external_id, 255),
    p_opted_out,
    left(v_reason, 500),
    'manual',
    now(),
    now()
  )
  on conflict (business_id, channel, external_customer_id) do update
  set
    opted_out = excluded.opted_out,
    reason = excluded.reason,
    source = 'manual',
    updated_at = now();

  perform public.communication_log_audit(
    p_business_id,
    case when p_opted_out then 'opt_out_set' else 'opt_out_cleared' end,
    'opt_out',
    left(v_external_id, 255),
    jsonb_build_object(
      'channel', 'whatsapp',
      'externalCustomerId', v_external_id,
      'reason', v_reason
    )
  );

  return true;
end;
$$;

create or replace function public.communication_create_outbound_message(
  p_conversation_id uuid,
  p_message_type text,
  p_text_content text,
  p_media_asset_id uuid,
  p_template_name text,
  p_template_language text,
  p_client_request_id uuid
)
returns table (
  id uuid,
  business_id uuid,
  conversation_id uuid,
  connection_id uuid,
  direction text,
  message_type text,
  text_content text,
  status text,
  provider_message_id text,
  media_asset_id uuid,
  media_provider text,
  media_provider_file_id text,
  recipient text,
  template_name text,
  template_language text,
  client_request_id uuid,
  created_at timestamptz,
  is_duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
  v_connection public.business_channel_connections;
  v_asset_id uuid;
  v_asset_mime_type text;
  v_asset_filename text;
  v_asset_metadata jsonb;
  v_existing public.communication_messages;
  v_message public.communication_messages;
  v_message_type text := lower(btrim(coalesce(p_message_type, '')));
  v_text_content text := nullif(btrim(coalesce(p_text_content, '')), '');
  v_template_name text := nullif(btrim(coalesce(p_template_name, '')), '');
  v_template_language text := nullif(btrim(coalesce(p_template_language, '')), '');
  v_media_provider text;
  v_media_provider_file_id text;
  v_window_open boolean;
  v_opted_out boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in to send messages.'
      using errcode = '28000';
  end if;

  if v_message_type is null or v_message_type not in ('text', 'image') then
    raise exception 'Only text and image messages are supported.'
      using errcode = '22023';
  end if;

  if p_client_request_id is null then
    raise exception 'A valid client request id is required.'
      using errcode = '22023';
  end if;

  select c.*
  into v_conversation
  from public.communication_conversations c
  where c.id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation not found.'
      using errcode = '22023';
  end if;

  if not public.has_business_role(
    v_conversation.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to send messages for this business.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_conversation.business_id::text || ':outbound:' || p_client_request_id::text,
      0
    )
  );

  select m.*
  into v_existing
  from public.communication_messages m
  where m.business_id = v_conversation.business_id
    and m.direction = 'outbound'
    and m.client_request_id = p_client_request_id;

  if found then
    v_media_provider := null;
    v_media_provider_file_id := null;
    if v_existing.media_asset_id is not null then
      select ma.provider, ma.provider_file_id
      into v_media_provider, v_media_provider_file_id
      from public.media_assets ma
      where ma.id = v_existing.media_asset_id;
    end if;

    return query
    select
      v_existing.id,
      v_existing.business_id,
      v_existing.conversation_id,
      v_existing.connection_id,
      v_existing.direction,
      v_existing.message_type,
      v_existing.text_content,
      v_existing.status,
      v_existing.provider_message_id,
      v_existing.media_asset_id,
      v_media_provider,
      v_media_provider_file_id,
      v_conversation.external_customer_id,
      v_existing.template_name,
      v_existing.template_language,
      v_existing.client_request_id,
      v_existing.created_at,
      true;
    return;
  end if;

  select bcc.*
  into v_connection
  from public.business_channel_connections bcc
  where bcc.id = v_conversation.connection_id;

  if not found
     or v_connection.business_id <> v_conversation.business_id
     or v_connection.channel <> v_conversation.channel
     or v_connection.status <> 'connected' then
    raise exception 'The selected channel is not connected.'
      using errcode = '22023';
  end if;

  select coalesce(o.opted_out, false) into v_opted_out
  from public.communication_opt_outs o
  where o.business_id = v_conversation.business_id
    and o.channel = v_conversation.channel
    and o.external_customer_id = v_conversation.external_customer_id
  order by o.created_at desc, o.id desc
  limit 1;

  if coalesce(v_opted_out, false) then
    raise exception 'This customer has opted out of messages.'
      using errcode = '22023';
  end if;

  v_window_open := v_conversation.last_incoming_at is not null
    and v_conversation.last_incoming_at > now() - interval '24 hours';

  if not v_window_open and v_template_name is null then
    raise exception 'A template is required outside the 24-hour service window.'
      using errcode = '22023';
  end if;

  if v_message_type = 'text' and v_text_content is null then
    raise exception 'Text messages require text content.'
      using errcode = '22023';
  end if;

  v_media_provider := null;
  v_media_provider_file_id := null;

  if v_message_type = 'image' then
    select
      ma.id,
      ma.provider,
      ma.provider_file_id,
      ma.mime_type,
      ma.original_filename
    into
      v_asset_id,
      v_media_provider,
      v_media_provider_file_id,
      v_asset_mime_type,
      v_asset_filename
    from public.media_assets ma
    where ma.id = p_media_asset_id
      and ma.business_id = v_conversation.business_id
      and ma.status = 'ready'
      and ma.asset_category in ('product_image', 'store_logo')
      and ma.mime_type like 'image/%';

    if not found then
      raise exception 'Choose a ready image owned by this business.'
        using errcode = '22023';
    end if;

    v_asset_metadata := jsonb_build_object(
      'provider', v_media_provider,
      'providerFileId', v_media_provider_file_id,
      'filename', v_asset_filename,
      'mimeType', v_asset_mime_type
    );
  end if;

  insert into public.communication_messages (
    business_id,
    conversation_id,
    connection_id,
    direction,
    message_type,
    text_content,
    status,
    template_name,
    template_language,
    media_asset_id,
    media_caption,
    media_mime_type,
    media_filename,
    media_metadata,
    client_request_id,
    occurred_at,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_conversation.business_id,
    v_conversation.id,
    v_connection.id,
    'outbound',
    v_message_type,
    v_text_content,
    'queued',
    v_template_name,
    v_template_language,
    v_asset_id,
    case when v_message_type = 'image' then v_text_content else null end,
    v_asset_mime_type,
    v_asset_filename,
    case when v_asset_id is not null then v_asset_metadata else '{}'::jsonb end,
    p_client_request_id,
    now(),
    jsonb_build_object('source', 'dashboard'),
    auth.uid(),
    now(),
    now()
  )
  returning * into v_message;

  update public.communication_conversations c
  set
    last_outgoing_at = now(),
    last_message_at = now()
  where c.id = p_conversation_id;

  perform public.communication_log_audit(
    v_conversation.business_id,
    'outbound_message_created',
    'message',
    v_message.id::text,
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'channel', v_conversation.channel,
      'messageType', v_message_type,
      'templateName', v_template_name,
      'clientRequestId', p_client_request_id
    )
  );

  return query
  select
    v_message.id,
    v_message.business_id,
    v_message.conversation_id,
    v_message.connection_id,
    v_message.direction,
    v_message.message_type,
    v_message.text_content,
    v_message.status,
    v_message.provider_message_id,
    v_message.media_asset_id,
    v_media_provider,
    v_media_provider_file_id,
    v_conversation.external_customer_id,
    v_message.template_name,
    v_message.template_language,
    v_message.client_request_id,
    v_message.created_at,
    false;
end;
$$;

create or replace function public.communication_finalize_outbound_message(
  p_message_id uuid,
  p_provider_message_id text,
  p_status text default 'sent',
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.communication_messages;
  v_provider_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_status_name text := nullif(lower(btrim(coalesce(p_status, 'sent'))), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to update messages.'
      using errcode = '28000';
  end if;

  if v_provider_id is null then
    raise exception 'A provider message id is required.'
      using errcode = '22023';
  end if;

  if v_status_name is null or v_status_name not in ('sent', 'delivered', 'read') then
    raise exception 'Choose a valid outbound message status.'
      using errcode = '22023';
  end if;

  select m.*
  into v_message
  from public.communication_messages m
  where m.id = p_message_id
  for update;

  if not found then
    raise exception 'Message not found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(v_message.business_id) then
    raise exception 'You do not have access to this message.'
      using errcode = '42501';
  end if;

  if v_message.direction <> 'outbound' or v_message.status <> 'queued' then
    raise exception 'Only queued outbound messages can be finalized.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.communication_messages m
    where m.business_id = v_message.business_id
      and m.provider_message_id = v_provider_id
      and m.id <> v_message.id
  ) then
    raise exception 'That provider message id is already in use.'
      using errcode = '23505';
  end if;

  update public.communication_messages m
  set
    status = v_status_name,
    provider_message_id = v_provider_id,
    provider_status = v_status_name,
    sent_at = now(),
    delivered_at = case when v_status_name in ('delivered', 'read') then now() else null end,
    read_at = case when v_status_name = 'read' then now() else null end,
    metadata = m.metadata || coalesce(p_metadata, '{}'::jsonb),
    updated_at = now()
  where m.id = p_message_id;

  perform public.communication_log_audit(
    v_message.business_id,
    'outbound_message_finalized',
    'message',
    p_message_id::text,
    jsonb_build_object(
      'providerMessageId', v_provider_id,
      'status', v_status_name
    )
  );

  return true;
end;
$$;

create or replace function public.communication_fail_outbound_message(
  p_message_id uuid,
  p_error_code text,
  p_error_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.communication_messages;
begin
  if auth.uid() is null then
    raise exception 'Sign in to update messages.'
      using errcode = '28000';
  end if;

  select m.*
  into v_message
  from public.communication_messages m
  where m.id = p_message_id
  for update;

  if not found then
    raise exception 'Message not found.'
      using errcode = '22023';
  end if;

  if not public.is_business_member(v_message.business_id) then
    raise exception 'You do not have access to this message.'
      using errcode = '42501';
  end if;

  if v_message.direction <> 'outbound' then
    raise exception 'Only outbound messages can be marked as failed.'
      using errcode = '22023';
  end if;

  update public.communication_messages m
  set
    status = 'failed',
    provider_status = 'failed',
    error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
    error_message = nullif(left(btrim(coalesce(p_error_message, '')), 1000), ''),
    metadata = m.metadata || coalesce(p_metadata, '{}'::jsonb),
    failed_at = now(),
    updated_at = now()
  where m.id = p_message_id;

  perform public.communication_log_audit(
    v_message.business_id,
    'outbound_message_failed',
    'message',
    p_message_id::text,
    jsonb_build_object(
      'errorCode', nullif(btrim(coalesce(p_error_code, '')), ''),
      'errorMessage', nullif(left(btrim(coalesce(p_error_message, '')), 500), '')
    )
  );

  return true;
end;
$$;

create or replace function public.communication_get_inbound_media(p_message_id uuid)
returns table (
  business_id uuid,
  connection_id uuid,
  media_provider_id text,
  media_mime_type text,
  media_filename text,
  message_type text,
  status text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view inbound media.'
      using errcode = '28000';
  end if;

  return query
  select
    m.business_id,
    m.connection_id,
    m.media_provider_id,
    m.media_mime_type,
    m.media_filename,
    m.message_type,
    m.status
  from public.communication_messages m
  where m.id = p_message_id
    and m.direction = 'inbound'
    and m.media_provider_id is not null
    and public.is_business_member(m.business_id);
end;
$$;

create or replace function public.communication_list_business_images(
  p_business_id uuid,
  p_limit integer default 50
)
returns table (
  media_asset_id uuid,
  provider text,
  provider_file_id text,
  delivery_url text,
  filename text,
  mime_type text,
  file_size bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Sign in to view business images.'
      using errcode = '28000';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  select
    ma.id as media_asset_id,
    ma.provider,
    ma.provider_file_id,
    case
      when ma.provider = 'cloudinary' then
        coalesce(
          ma.delivery_url,
          public.media_resolve_image_url('cloudinary:' || ma.provider_file_id)
        )
      else ma.delivery_url
    end as delivery_url,
    ma.original_filename as filename,
    ma.mime_type,
    ma.file_size
  from public.media_assets ma
  where ma.business_id = p_business_id
    and ma.status = 'ready'
    and ma.mime_type like 'image/%'
  order by ma.created_at desc, ma.id desc
  limit v_limit;
end;
$$;

create or replace function public.communication_resolve_whatsapp_connection(
  p_phone_number_id text,
  p_waba_id text
)
returns table (
  connection_id uuid,
  business_id uuid,
  status text,
  phone_number_id text,
  waba_id text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_phone_id text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  v_waba_id text := nullif(btrim(coalesce(p_waba_id, '')), '');
begin
  return query
  select
    bcc.id,
    bcc.business_id,
    bcc.status,
    bcc.external_phone_number_id,
    bcc.external_account_id
  from public.business_channel_connections bcc
  where bcc.channel = 'whatsapp'
    and (
      (v_phone_id is not null and bcc.external_phone_number_id = v_phone_id)
      or (v_waba_id is not null and bcc.external_account_id = v_waba_id)
    )
  order by
    case
      when v_phone_id is not null and v_waba_id is not null
        and bcc.external_phone_number_id = v_phone_id
        and bcc.external_account_id = v_waba_id then 0
      when v_phone_id is not null and bcc.external_phone_number_id = v_phone_id then 1
      else 2
    end,
    bcc.created_at desc,
    bcc.id desc
  limit 1;
end;
$$;

create or replace function public.communication_get_channel_token(p_connection_id uuid)
returns table (
  access_token text,
  connection_id uuid,
  business_id uuid,
  phone_number_id text,
  waba_id text,
  status text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  return query
  select
    cc.access_token,
    bcc.id,
    bcc.business_id,
    bcc.external_phone_number_id,
    bcc.external_account_id,
    bcc.status
  from private.channel_credentials cc
  join public.business_channel_connections bcc on bcc.id = cc.connection_id
  where cc.connection_id = p_connection_id;
end;
$$;

create or replace function public.communication_upsert_whatsapp_connection(
  p_business_id uuid,
  p_phone_number_id text,
  p_waba_id text,
  p_business_portfolio_id text,
  p_display_phone_number text,
  p_verified_name text,
  p_access_token text,
  p_token_expires_at timestamptz,
  p_scopes text[],
  p_connected_by uuid
)
returns table (
  connection_id uuid,
  business_id uuid,
  channel text,
  provider text,
  status text,
  external_account_id text,
  external_phone_number_id text,
  display_phone_number text,
  verified_name text,
  business_portfolio_id text,
  token_expires_at timestamptz,
  scopes text[],
  connected_by uuid,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_id text := nullif(btrim(coalesce(p_phone_number_id, '')), '');
  v_waba_id text := nullif(btrim(coalesce(p_waba_id, '')), '');
  v_access_token text := nullif(btrim(coalesce(p_access_token, '')), '');
  v_connection public.business_channel_connections;
begin
  if v_phone_id is null or v_waba_id is null or v_access_token is null then
    raise exception 'Phone number id, WABA id and access token are required.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
  ) then
    raise exception 'Business not found.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_business_id::text || ':whatsapp:' || v_phone_id,
      0
    )
  );

  select bcc.*
  into v_connection
  from public.business_channel_connections bcc
  where bcc.business_id = p_business_id
    and bcc.channel = 'whatsapp'
    and bcc.external_phone_number_id = v_phone_id
  for update;

  if not found then
    insert into public.business_channel_connections (
      business_id,
      channel,
      provider,
      external_account_id,
      external_phone_number_id,
      display_phone_number,
      verified_name,
      business_portfolio_id,
      status,
      token_expires_at,
      scopes,
      connected_by,
      connected_at,
      created_at,
      updated_at
    )
    values (
      p_business_id,
      'whatsapp',
      'meta',
      v_waba_id,
      v_phone_id,
      nullif(btrim(coalesce(p_display_phone_number, '')), ''),
      nullif(btrim(coalesce(p_verified_name, '')), ''),
      nullif(btrim(coalesce(p_business_portfolio_id, '')), ''),
      'connected',
      p_token_expires_at,
      p_scopes,
      p_connected_by,
      now(),
      now(),
      now()
    )
    returning * into v_connection;
  else
    update public.business_channel_connections bcc
    set
      external_account_id = v_waba_id,
      display_phone_number = nullif(btrim(coalesce(p_display_phone_number, '')), ''),
      verified_name = nullif(btrim(coalesce(p_verified_name, '')), ''),
      business_portfolio_id = nullif(btrim(coalesce(p_business_portfolio_id, '')), ''),
      status = 'connected',
      token_expires_at = p_token_expires_at,
      scopes = p_scopes,
      last_error = null,
      connected_by = coalesce(p_connected_by, bcc.connected_by),
      connected_at = now(),
      disconnected_at = null,
      updated_at = now()
    where bcc.id = v_connection.id
    returning * into v_connection;
  end if;

  insert into private.channel_credentials (
    connection_id,
    access_token,
    token_type,
    scopes,
    expires_at,
    refreshed_at,
    created_at,
    updated_at
  )
  values (
    v_connection.id,
    v_access_token,
    'bearer',
    p_scopes,
    p_token_expires_at,
    now(),
    now(),
    now()
  )
  on conflict (connection_id) do update
  set
    access_token = excluded.access_token,
    token_type = 'bearer',
    scopes = excluded.scopes,
    expires_at = excluded.expires_at,
    refreshed_at = now(),
    updated_at = now();

  perform public.communication_log_audit(
    p_business_id,
    'whatsapp_connection_upserted',
    'channel_connection',
    v_connection.id::text,
    jsonb_build_object(
      'channel', 'whatsapp',
      'phoneNumberId', v_phone_id,
      'wabaId', v_waba_id
    )
  );

  return query
  select
    v_connection.id,
    v_connection.business_id,
    v_connection.channel,
    v_connection.provider,
    v_connection.status,
    v_connection.external_account_id,
    v_connection.external_phone_number_id,
    v_connection.display_phone_number,
    v_connection.verified_name,
    v_connection.business_portfolio_id,
    v_connection.token_expires_at,
    v_connection.scopes,
    v_connection.connected_by,
    v_connection.connected_at,
    v_connection.disconnected_at,
    v_connection.last_error,
    v_connection.metadata,
    v_connection.created_at,
    v_connection.updated_at;
end;
$$;

create or replace function public.communication_set_connection_health(
  p_connection_id uuid,
  p_status text,
  p_error text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_business_id uuid;
begin
  if v_status is null or v_status not in (
    'not_connected', 'connected', 'expired', 'revoked', 'error', 'disconnected'
  ) then
    raise exception 'Choose a valid connection health status.'
      using errcode = '22023';
  end if;

  update public.business_channel_connections bcc
  set
    status = v_status,
    last_error = nullif(btrim(coalesce(p_error, '')), ''),
    metadata = bcc.metadata || coalesce(p_metadata, '{}'::jsonb),
    last_health_check_at = now(),
    updated_at = now()
  where bcc.id = p_connection_id
  returning bcc.business_id into v_business_id;

  if v_business_id is null then
    return false;
  end if;

  perform public.communication_log_audit(
    v_business_id,
    'connection_health_changed',
    'channel_connection',
    p_connection_id::text,
    jsonb_build_object('status', v_status)
  );

  return true;
end;
$$;

create or replace function public.communication_process_whatsapp_webhook(p_payload jsonb)
returns table (
  status text,
  processed integer,
  duplicates integer,
  ignored integer,
  business_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_change jsonb;
  v_value jsonb;
  v_message jsonb;
  v_status_item jsonb;
  v_contact_item jsonb;
  v_media_object jsonb;
  v_error_item jsonb;
  v_phone_id text;
  v_waba_id text;
  v_connection_id uuid;
  v_business_id uuid;
  v_event_business_id uuid;
  v_result_business_id uuid;
  v_connection_status text;
  v_event_key text;
  v_event_id uuid;
  v_event_type text;
  v_external_id text;
  v_display_name text;
  v_phone_digits text;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_provider_id text;
  v_message_type text;
  v_text_content text;
  v_media_id text;
  v_mime_type text;
  v_media_filename text;
  v_timestamp text;
  v_occurred_at timestamptz;
  v_status_name text;
  v_error_code text;
  v_error_message text;
  v_target_message_id uuid;
  v_processed integer := 0;
  v_duplicates integer := 0;
  v_ignored integer := 0;
  v_failed integer := 0;
  v_result_status text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'The webhook payload must be a JSON object.'
      using errcode = '22023';
  end if;

  for v_entry in
    select entries.item_value
    from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'entry') = 'array'
        then p_payload->'entry'
        else '[]'::jsonb
      end
    ) as entries(item_value)
  loop
    v_waba_id := nullif(btrim(coalesce(v_entry->>'id', '')), '');

    for v_change in
      select changes.item_value
      from jsonb_array_elements(
        case when jsonb_typeof(v_entry->'changes') = 'array'
          then v_entry->'changes'
          else '[]'::jsonb
        end
      ) as changes(item_value)
    loop
      v_value := case
        when jsonb_typeof(v_change->'value') = 'object'
          then v_change->'value'
          else '{}'::jsonb
      end;
      v_phone_id := nullif(
        btrim(coalesce(v_value->'metadata'->>'phone_number_id', '')),
        ''
      );

      v_connection_id := null;
      v_business_id := null;
      v_connection_status := null;

      select
        bcc.id,
        bcc.business_id,
        bcc.status
      into v_connection_id, v_business_id, v_connection_status
      from public.business_channel_connections bcc
      where bcc.channel = 'whatsapp'
        and (
          (v_phone_id is not null and bcc.external_phone_number_id = v_phone_id)
          or (v_waba_id is not null and bcc.external_account_id = v_waba_id)
        )
      order by
        case
          when v_phone_id is not null and v_waba_id is not null
            and bcc.external_phone_number_id = v_phone_id
            and bcc.external_account_id = v_waba_id then 0
          when v_phone_id is not null and bcc.external_phone_number_id = v_phone_id then 1
          else 2
        end,
        bcc.created_at desc,
        bcc.id desc
      limit 1;

      if v_business_id is not null and v_result_business_id is null then
        v_result_business_id := v_business_id;
      end if;

      for v_message in
        select items.item_value
        from jsonb_array_elements(
          case when jsonb_typeof(v_value->'messages') = 'array'
            then v_value->'messages'
            else '[]'::jsonb
          end
        ) as items(item_value)
      loop
        v_provider_id := nullif(btrim(coalesce(v_message->>'id', '')), '');
        if v_provider_id is null then
          continue;
        end if;

        v_timestamp := nullif(btrim(coalesce(v_message->>'timestamp', '')), '');
        if v_timestamp ~ '^[0-9]+([.][0-9]+)?$' then
          v_occurred_at := to_timestamp(v_timestamp::double precision);
        else
          v_occurred_at := now();
        end if;

        v_event_key := 'whatsapp:message:' || v_provider_id;
        v_event_type := 'message';
        v_event_id := null;
        v_event_business_id := null;

        insert into public.communication_webhook_events as e (
          provider,
          event_key,
          business_id,
          connection_id,
          event_type,
          payload,
          status,
          occurred_at,
          created_at,
          updated_at
        )
        values (
          'meta',
          v_event_key,
          v_business_id,
          v_connection_id,
          v_event_type,
          jsonb_build_object(
            'payload', p_payload,
            'entry', v_entry,
            'change', v_change,
            'message', v_message
          ),
          'received',
          v_occurred_at,
          now(),
          now()
        )
        on conflict (provider, event_key) do nothing
        returning e.id, e.business_id into v_event_id, v_event_business_id;

        if v_event_id is null then
          v_duplicates := v_duplicates + 1;
          if v_event_business_id is not null and v_result_business_id is null then
            v_result_business_id := v_event_business_id;
          end if;
          continue;
        end if;

        if v_business_id is null then
          update public.communication_webhook_events e
          set
            status = 'ignored',
            error_message = 'No connected WhatsApp channel matched this webhook.',
            updated_at = now()
          where e.id = v_event_id;
          v_ignored := v_ignored + 1;
          continue;
        end if;

        begin
          v_external_id := nullif(
            btrim(coalesce(v_message->>'from_user_id', v_message->>'from', '')),
            ''
          );

          if v_external_id is null then
            raise exception 'The inbound message has no customer identifier.'
              using errcode = '22023';
          end if;

          v_external_id := left(v_external_id, 255);
          v_message_type := lower(btrim(coalesce(v_message->>'type', 'text')));
          if v_message_type = '' then
            v_message_type := 'text';
          end if;

          v_display_name := null;
          select coalesce(
            nullif(btrim(coalesce(contact_item.contact_obj#>>'{profile,name}', '')), ''),
            nullif(btrim(coalesce(contact_item.contact_obj->>'name', '')), ''),
            nullif(btrim(coalesce(contact_item.contact_obj->>'wa_id', '')), '')
          )
          into v_display_name
          from jsonb_array_elements(
            case when jsonb_typeof(v_value->'contacts') = 'array'
              then v_value->'contacts'
              else '[]'::jsonb
            end
          ) as contact_item(contact_obj)
          where nullif(btrim(coalesce(contact_item.contact_obj->>'wa_id', '')), '') = coalesce(
            nullif(btrim(coalesce(v_message->>'from', '')), ''),
            v_external_id
          )
          limit 1;

          v_display_name := coalesce(v_display_name, v_external_id);
          v_phone_digits := public.communication_normalize_phone(
            coalesce(
              nullif(btrim(coalesce(v_message->>'from', '')), ''),
              v_external_id
            )
          );
          v_customer_id := null;

          if char_length(coalesce(v_phone_digits, '')) between 7 and 15 then
            select c.id into v_customer_id
            from public.customers c
            where c.business_id = v_business_id
              and c.phone_normalized = v_phone_digits
            limit 1;
          end if;

          perform pg_advisory_xact_lock(
            hashtextextended(
              v_business_id::text || ':conversation:whatsapp:' || v_external_id,
              0
            )
          );

          select c.id into v_conversation_id
          from public.communication_conversations c
          where c.business_id = v_business_id
            and c.channel = 'whatsapp'
            and c.external_customer_id = v_external_id
          for update;

          if found then
            update public.communication_conversations c
            set
              customer_id = coalesce(c.customer_id, v_customer_id),
              connection_id = coalesce(c.connection_id, v_connection_id),
              display_name = coalesce(nullif(btrim(coalesce(v_display_name, '')), ''), c.display_name),
              last_message_at = case
                when c.last_message_at is null or c.last_message_at < v_occurred_at
                then v_occurred_at else c.last_message_at
              end,
              last_incoming_at = case
                when c.last_incoming_at is null or c.last_incoming_at < v_occurred_at
                then v_occurred_at else c.last_incoming_at
              end,
              unread_count = c.unread_count + 1,
              updated_at = now()
            where c.id = v_conversation_id;
          else
            insert into public.communication_conversations (
              business_id,
              connection_id,
              channel,
              external_customer_id,
              external_customer_id_type,
              display_name,
              customer_id,
              status,
              unread_count,
              last_message_at,
              last_incoming_at,
              created_at,
              updated_at
            )
            values (
              v_business_id,
              v_connection_id,
              'whatsapp',
              v_external_id,
              'wa_id',
              left(v_display_name, 255),
              v_customer_id,
              'open',
              1,
              v_occurred_at,
              v_occurred_at,
              now(),
              now()
            )
            returning id into v_conversation_id;
          end if;

          v_media_object := coalesce(v_message->v_message_type, '{}'::jsonb);
          v_text_content := nullif(
            btrim(coalesce(v_media_object->>'body', v_media_object->>'caption', '')),
            ''
          );
          v_media_id := nullif(btrim(coalesce(v_media_object->>'id', '')), '');
          v_mime_type := case v_message_type
            when 'image' then 'image/jpeg'
            when 'audio' then 'audio/ogg'
            when 'video' then 'video/mp4'
            when 'document' then 'application/octet-stream'
            else null
          end;
          v_media_filename := case
            when v_media_id is not null then v_message_type || '-' || v_media_id
            else null
          end;

          insert into public.communication_messages (
            business_id,
            conversation_id,
            connection_id,
            direction,
            message_type,
            text_content,
            provider_message_id,
            status,
            occurred_at,
            media_provider_id,
            media_mime_type,
            media_filename,
            media_caption,
            media_metadata,
            metadata,
            created_at,
            updated_at
          )
          values (
            v_business_id,
            v_conversation_id,
            v_connection_id,
            'inbound',
            v_message_type,
            v_text_content,
            v_provider_id,
            'received',
            v_occurred_at,
            v_media_id,
            v_mime_type,
            left(v_media_filename, 255),
            v_text_content,
            case
              when v_media_id is not null then jsonb_build_object(
                'provider', 'meta',
                'media', v_media_object
              )
              else '{}'::jsonb
            end,
            jsonb_build_object('webhookEventKey', v_event_key),
            now(),
            now()
          )
          on conflict do nothing;

          if v_message_type = 'text'
             and v_text_content is not null
             and lower(btrim(v_text_content)) ~ '^(stop|unsubscribe|opt[ -]?out)$' then
            insert into public.communication_opt_outs (
              business_id,
              channel,
              external_customer_id,
              opted_out,
              reason,
              source,
              created_at,
              updated_at
            )
            values (
              v_business_id,
              'whatsapp',
              v_external_id,
              true,
              left(lower(btrim(v_text_content)), 255),
              'webhook',
              now(),
              now()
            )
            on conflict (business_id, channel, external_customer_id) do update
            set
              opted_out = true,
              reason = excluded.reason,
              source = 'webhook',
              updated_at = now();
          end if;

          update public.communication_webhook_events e
          set
            status = 'processed',
            business_id = v_business_id,
            connection_id = v_connection_id,
            updated_at = now()
          where e.id = v_event_id;
          v_processed := v_processed + 1;
        exception
          when others then
            update public.communication_webhook_events e
            set
              status = 'failed',
              error_message = left(sqlerrm, 1000),
              updated_at = now()
            where e.id = v_event_id;
            v_failed := v_failed + 1;
        end;
      end loop;

      for v_status_item in
        select items.item_value
        from jsonb_array_elements(
          case when jsonb_typeof(v_value->'statuses') = 'array'
            then v_value->'statuses'
            else '[]'::jsonb
          end
        ) as items(item_value)
      loop
        v_provider_id := nullif(btrim(coalesce(v_status_item->>'id', '')), '');
        if v_provider_id is null then
          continue;
        end if;

        v_status_name := nullif(lower(btrim(coalesce(v_status_item->>'status', ''))), '');
        v_timestamp := nullif(btrim(coalesce(v_status_item->>'timestamp', '')), '');
        if v_timestamp ~ '^[0-9]+([.][0-9]+)?$' then
          v_occurred_at := to_timestamp(v_timestamp::double precision);
        else
          v_occurred_at := now();
        end if;

        v_event_key := 'whatsapp:status:' || v_provider_id
          || ':' || coalesce(v_status_name, 'unknown')
          || ':' || coalesce(v_timestamp, 'none');
        v_event_type := 'status';
        v_event_id := null;
        v_event_business_id := null;

        insert into public.communication_webhook_events as e (
          provider,
          event_key,
          business_id,
          connection_id,
          event_type,
          payload,
          status,
          occurred_at,
          created_at,
          updated_at
        )
        values (
          'meta',
          v_event_key,
          v_business_id,
          v_connection_id,
          v_event_type,
          jsonb_build_object(
            'payload', p_payload,
            'entry', v_entry,
            'change', v_change,
            'status', v_status_item
          ),
          'received',
          v_occurred_at,
          now(),
          now()
        )
        on conflict (provider, event_key) do nothing
        returning e.id, e.business_id into v_event_id, v_event_business_id;

        if v_event_id is null then
          v_duplicates := v_duplicates + 1;
          if v_event_business_id is not null and v_result_business_id is null then
            v_result_business_id := v_event_business_id;
          end if;
          continue;
        end if;

        if v_business_id is null
           or v_status_name is null
           or v_status_name not in ('sent', 'delivered', 'read', 'failed') then
          update public.communication_webhook_events e
          set
            status = 'ignored',
            error_message = case
              when v_business_id is null
                then 'No connected WhatsApp channel matched this webhook.'
              else 'Unsupported message status.'
            end,
            updated_at = now()
          where e.id = v_event_id;
          v_ignored := v_ignored + 1;
          continue;
        end if;

        begin
          v_error_code := null;
          v_error_message := null;
          select
            v_error_item.item_value->>'code',
            coalesce(
              nullif(btrim(coalesce(v_error_item.item_value->>'title', '')), ''),
              nullif(btrim(coalesce(v_error_item.item_value->>'message', '')), ''),
              nullif(btrim(coalesce(v_error_item.item_value->>'details', '')), '')
            )
          into v_error_code, v_error_message
          from jsonb_array_elements(
            case when jsonb_typeof(v_status_item->'errors') = 'array'
              then v_status_item->'errors'
              else '[]'::jsonb
            end
          ) as v_error_item(item_value)
          limit 1;

          select m.id into v_target_message_id
          from public.communication_messages m
          where m.business_id = v_business_id
            and m.direction = 'outbound'
            and m.provider_message_id = v_provider_id
          limit 1;

          if found then
            update public.communication_messages m
            set
              status = v_status_name,
              provider_status = v_status_name,
              sent_at = case
                when v_status_name in ('sent', 'delivered', 'read')
                then coalesce(m.sent_at, v_occurred_at) else m.sent_at
              end,
              delivered_at = case
                when v_status_name in ('delivered', 'read')
                then coalesce(m.delivered_at, v_occurred_at) else m.delivered_at
              end,
              read_at = case
                when v_status_name = 'read'
                then coalesce(m.read_at, v_occurred_at) else m.read_at
              end,
              failed_at = case
                when v_status_name = 'failed' then v_occurred_at else m.failed_at
              end,
              error_code = case when v_status_name = 'failed' then v_error_code else m.error_code end,
              error_message = case when v_status_name = 'failed' then v_error_message else m.error_message end,
              metadata = m.metadata || jsonb_build_object('webhookEventKey', v_event_key),
              updated_at = now()
            where m.id = v_target_message_id;
          end if;

          update public.communication_webhook_events e
          set
            status = 'processed',
            business_id = v_business_id,
            connection_id = v_connection_id,
            updated_at = now()
          where e.id = v_event_id;
          v_processed := v_processed + 1;
        exception
          when others then
            update public.communication_webhook_events e
            set
              status = 'failed',
              error_message = left(sqlerrm, 1000),
              updated_at = now()
            where e.id = v_event_id;
            v_failed := v_failed + 1;
        end;
      end loop;
    end loop;
  end loop;

  v_result_status := case
    when v_failed > 0 then 'partial'
    when v_processed + v_duplicates + v_ignored = 0 then 'ignored'
    else 'completed'
  end;

  return query
  select
    v_result_status,
    v_processed,
    v_duplicates,
    v_ignored,
    v_result_business_id;
end;
$$;

revoke all on function public.communication_normalize_phone(text)
from public, anon, authenticated;
revoke all on function public.communication_can_manage_business(uuid)
from public, anon, authenticated;
revoke all on function public.communication_log_audit(uuid, text, text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.communication_list_channels(uuid)
from public, anon, authenticated;
revoke all on function public.communication_get_connection(uuid, text)
from public, anon, authenticated;
revoke all on function public.communication_disconnect_channel(uuid, text)
from public, anon, authenticated;
revoke all on function public.communication_list_assignable_users(uuid)
from public, anon, authenticated;
revoke all on function public.communication_list_conversations(
  uuid, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.communication_get_conversation(uuid)
from public, anon, authenticated;
revoke all on function public.communication_list_messages(uuid, timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.communication_get_send_context(uuid)
from public, anon, authenticated;
revoke all on function public.communication_assign_conversation(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.communication_set_conversation_status(uuid, text)
from public, anon, authenticated;
revoke all on function public.communication_mark_conversation_read(uuid)
from public, anon, authenticated;
revoke all on function public.communication_set_opt_out(uuid, text, boolean, text)
from public, anon, authenticated;
revoke all on function public.communication_create_outbound_message(
  uuid, text, text, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.communication_finalize_outbound_message(
  uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.communication_fail_outbound_message(
  uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.communication_get_inbound_media(uuid)
from public, anon, authenticated;
revoke all on function public.communication_list_business_images(uuid, integer)
from public, anon, authenticated;
revoke all on function public.communication_resolve_whatsapp_connection(text, text)
from public, anon, authenticated;
revoke all on function public.communication_get_channel_token(uuid)
from public, anon, authenticated;
revoke all on function public.communication_upsert_whatsapp_connection(
  uuid, text, text, text, text, text, text, timestamptz, text[], uuid
) from public, anon, authenticated;
revoke all on function public.communication_set_connection_health(
  uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.communication_process_whatsapp_webhook(jsonb)
from public, anon, authenticated;

grant execute on function public.communication_normalize_phone(text)
to authenticated, service_role;
grant execute on function public.communication_can_manage_business(uuid)
to authenticated, service_role;
grant execute on function public.communication_log_audit(uuid, text, text, text, jsonb)
to service_role;
grant execute on function public.communication_list_channels(uuid)
to authenticated, service_role;
grant execute on function public.communication_get_connection(uuid, text)
to authenticated, service_role;
grant execute on function public.communication_disconnect_channel(uuid, text)
to authenticated, service_role;
grant execute on function public.communication_list_assignable_users(uuid)
to authenticated, service_role;
grant execute on function public.communication_list_conversations(
  uuid, text, text, integer, integer
) to authenticated, service_role;
grant execute on function public.communication_get_conversation(uuid)
to authenticated, service_role;
grant execute on function public.communication_list_messages(uuid, timestamptz, integer)
to authenticated, service_role;
grant execute on function public.communication_get_send_context(uuid)
to authenticated, service_role;
grant execute on function public.communication_assign_conversation(uuid, uuid)
to authenticated, service_role;
grant execute on function public.communication_set_conversation_status(uuid, text)
to authenticated, service_role;
grant execute on function public.communication_mark_conversation_read(uuid)
to authenticated, service_role;
grant execute on function public.communication_set_opt_out(uuid, text, boolean, text)
to authenticated, service_role;
grant execute on function public.communication_create_outbound_message(
  uuid, text, text, uuid, text, text, uuid
) to authenticated, service_role;
grant execute on function public.communication_finalize_outbound_message(
  uuid, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.communication_fail_outbound_message(
  uuid, text, text, jsonb
) to authenticated, service_role;
grant execute on function public.communication_get_inbound_media(uuid)
to authenticated, service_role;
grant execute on function public.communication_list_business_images(uuid, integer)
to authenticated, service_role;
grant execute on function public.communication_resolve_whatsapp_connection(text, text)
to service_role;
grant execute on function public.communication_get_channel_token(uuid)
to service_role;
grant execute on function public.communication_upsert_whatsapp_connection(
  uuid, text, text, text, text, text, text, timestamptz, text[], uuid
) to service_role;
grant execute on function public.communication_set_connection_health(
  uuid, text, text, jsonb
) to service_role;
grant execute on function public.communication_process_whatsapp_webhook(jsonb)
to service_role;

