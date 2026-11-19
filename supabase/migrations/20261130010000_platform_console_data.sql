create or replace function public.platform_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  email_masked text,
  role_summary text,
  business_count bigint,
  status text,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.users.read') then
    raise exception 'You do not have permission to view users.'
      using errcode = '42501';
  end if;

  perform public.log_platform_action(
    'sensitive_read',
    'platform.users.read',
    null,
    null,
    'platform_users',
    null,
    jsonb_build_object('scope', 'directory', 'filtered', v_search is not null),
    null,
    null
  );

  return query
  select
    p.id,
    p.full_name,
    case
      when u.email is null then null
      when strpos(u.email, '@') > 0
        then left(split_part(u.email, '@', 1), 2)
          || '***@' || split_part(u.email, '@', 2)
      else '***'
    end,
    coalesce((
      select string_agg(distinct bm.role, ', ' order by bm.role)
      from public.business_members bm
      where bm.user_id = p.id
        and bm.status = 'active'
    ), 'No workspace'),
    (
      select count(*)
      from public.business_members bm
      where bm.user_id = p.id
        and bm.status = 'active'
    )::bigint,
    case
      when exists (
        select 1 from public.business_members bm
        where bm.user_id = p.id and bm.status = 'active'
      ) then 'active'
      when exists (
        select 1 from public.business_members bm where bm.user_id = p.id
      ) then 'no_active_workspace'
      else 'no_workspace'
    end,
    u.last_sign_in_at,
    p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where v_search is null
    or lower(coalesce(p.full_name, '')) like '%' || v_search || '%'
    or lower(coalesce(u.email, '')) like '%' || v_search || '%'
    or p.id::text like '%' || v_search || '%'
  order by p.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.platform_list_storefronts(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  store_name text,
  slug text,
  status text,
  contact_email_masked text,
  visible_product_count bigint,
  has_logo boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.storefronts.read') then
    raise exception 'You do not have permission to view storefronts.'
      using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.business_id,
    b.name,
    s.name,
    s.slug,
    s.status,
    case
      when s.contact_email is null then null
      when strpos(s.contact_email, '@') > 0
        then left(split_part(s.contact_email, '@', 1), 2)
          || '***@' || split_part(s.contact_email, '@', 2)
      else '***'
    end,
    (
      select count(*)
      from public.products pr
      where pr.business_id = s.business_id
        and pr.status = 'active'
        and pr.storefront_visible
    )::bigint,
    s.logo_path is not null or s.logo_media_asset_id is not null,
    s.created_at,
    s.updated_at
  from public.stores s
  join public.businesses b on b.id = s.business_id
  where v_search is null
    or lower(s.name) like '%' || v_search || '%'
    or lower(s.slug) like '%' || v_search || '%'
    or lower(b.name) like '%' || v_search || '%'
  order by s.updated_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.platform_list_orders_payments(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  order_number text,
  customer_name_masked text,
  customer_phone_masked text,
  customer_email_masked text,
  status text,
  currency text,
  total numeric,
  payment_status text,
  payment_count bigint,
  verified_amount numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.orders.read') then
    raise exception 'You do not have permission to investigate orders.'
      using errcode = '42501';
  end if;

  if v_status is not null and v_status not in (
    'draft', 'awaiting_confirmation', 'awaiting_business_approval',
    'confirmed', 'processing', 'ready', 'completed', 'cancelled'
  ) then
    raise exception 'Order status filter is not valid.'
      using errcode = '22023';
  end if;

  perform public.log_platform_action(
    'payment_investigation',
    'platform.orders.read',
    null,
    null,
    'platform_orders',
    null,
    jsonb_build_object('filtered', v_search is not null or v_status is not null),
    null,
    null
  );

  return query
  select
    o.id,
    o.business_id,
    b.name,
    o.order_number,
    case when o.customer_name_snapshot is null then null
      else left(o.customer_name_snapshot, 1) || '***' end,
    case when o.customer_phone_snapshot is null then null
      else '***' || right(regexp_replace(o.customer_phone_snapshot, '[^0-9]', '', 'g'), 4)
      end,
    case
      when o.customer_email_snapshot is null then null
      when strpos(o.customer_email_snapshot, '@') > 0
        then left(split_part(o.customer_email_snapshot, '@', 1), 2)
          || '***@' || split_part(o.customer_email_snapshot, '@', 2)
      else '***'
    end,
    o.status,
    o.currency,
    o.total,
    public.derive_order_payment_status(
      o.total,
      coalesce(pay.verified_amount, 0),
      coalesce(ref.refunded_amount, 0),
      coalesce(pay.failed_amount, 0),
      coalesce(pay.pending_amount, 0)
    ),
    coalesce(pay.payment_count, 0)::bigint,
    coalesce(pay.verified_amount, 0),
    o.created_at
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join lateral (
    select
      count(*)::bigint as payment_count,
      coalesce(sum(p.amount) filter (where p.status = 'verified'), 0) as verified_amount,
      coalesce(sum(p.amount) filter (where p.status = 'failed'), 0) as failed_amount,
      coalesce(sum(p.amount) filter (where p.status = 'pending'), 0) as pending_amount
    from public.payments p
    where p.business_id = o.business_id and p.order_id = o.id
  ) pay on true
  left join lateral (
    select coalesce(sum(pr.amount) filter (where pr.status = 'completed'), 0) as refunded_amount
    from public.payment_refunds pr
    where pr.business_id = o.business_id and pr.payment_id in (
      select p.id from public.payments p
      where p.business_id = o.business_id and p.order_id = o.id
    )
  ) ref on true
  where (v_status is null or o.status = v_status)
    and (
      v_search is null
      or lower(o.order_number) like '%' || v_search || '%'
      or o.id::text like '%' || v_search || '%'
      or lower(b.name) like '%' || v_search || '%'
    )
  order by o.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.platform_list_ai_activity(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  provider text,
  model text,
  status text,
  language text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric,
  latency_ms integer,
  error_code text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.ai.read') then
    raise exception 'You do not have permission to view AI activity.'
      using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.business_id,
    b.name,
    ar.provider,
    ar.model,
    ar.status,
    ar.language,
    ar.input_tokens,
    ar.output_tokens,
    ar.estimated_cost_usd,
    ar.latency_ms,
    ar.error_code,
    ar.created_at
  from public.ai_assistant_requests ar
  join public.businesses b on b.id = ar.business_id
  order by ar.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.platform_list_communications(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  channel text,
  channel_name text,
  connection_status text,
  phone_masked text,
  last_health_check_at timestamptz,
  conversations_24h bigint,
  messages_24h bigint,
  failed_webhooks_24h bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_platform_permission('platform.communications.read') then
    raise exception 'You do not have permission to view communication health.'
      using errcode = '42501';
  end if;

  perform public.log_platform_action(
    'sensitive_read',
    'platform.communications.read',
    null,
    null,
    'platform_communications',
    null,
    '{}'::jsonb,
    null,
    null
  );

  return query
  select
    c.id,
    c.business_id,
    b.name,
    c.channel,
    ch.name,
    c.status,
    case when c.display_phone_number is null then null
      else '***' || right(regexp_replace(c.display_phone_number, '[^0-9]', '', 'g'), 4)
      end,
    c.last_health_check_at,
    (
      select count(*)
      from public.communication_conversations cc
      where cc.business_id = c.business_id
        and cc.channel = c.channel
        and cc.created_at >= now() - interval '24 hours'
    )::bigint,
    (
      select count(*)
      from public.communication_messages cm
      join public.communication_conversations cc2
        on cc2.business_id = cm.business_id
       and cc2.id = cm.conversation_id
      where cm.business_id = c.business_id
        and cc2.channel = c.channel
        and cm.created_at >= now() - interval '24 hours'
    )::bigint,
    (
      select count(*)
      from public.communication_webhook_events cw
      where cw.business_id = c.business_id
        and cw.status = 'failed'
        and cw.created_at >= now() - interval '24 hours'
    )::bigint
  from public.business_channel_connections c
  join public.businesses b on b.id = c.business_id
  left join public.communication_channels ch on ch.code = c.channel
  order by c.updated_at desc
  limit v_limit
  offset v_offset;
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
begin
  if not public.has_platform_permission('platform.subscriptions.read') then
    raise exception 'You do not have permission to view subscriptions.'
      using errcode = '42501';
  end if;

  return query
  select
    null::uuid,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::timestamptz,
    null::numeric,
    null::text
  where false;
end;
$$;

create or replace function public.platform_list_integrations()
returns table (
  code text,
  name text,
  category text,
  status text,
  detail text,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.integrations.read') then
    raise exception 'You do not have permission to view integrations.'
      using errcode = '42501';
  end if;

  return query
  with integration_rows as (
    select
      cc.code,
      cc.name,
      'messaging'::text as category,
      case
        when cc.status = 'coming_soon' then 'coming_soon'
        when counts.connected_count > 0 then 'connected'
        else 'not_connected'
      end as status,
      case
        when cc.status = 'coming_soon' then cc.description
        else counts.connected_count::text || ' connected workspace(s)'
      end as detail,
      counts.last_activity_at
    from public.communication_channels cc
    left join lateral (
      select
        count(*) filter (where c.status = 'connected')::bigint as connected_count,
        max(c.last_health_check_at) as last_activity_at
      from public.business_channel_connections c
      where c.channel = cc.code
    ) counts on true

    union all

    select
      'media_storage'::text,
      'Media storage'::text,
      'storage'::text,
      case when config.provider is not null then 'configured' else 'not_configured' end,
      case when config.provider is not null
        then 'provider: ' || config.provider
        else 'No provider configured'
      end,
      config.updated_at
    from public.media_provider_config config
    where config.id = true

    union all

    select
      'ai_provider'::text,
      'AI provider'::text,
      'ai'::text,
      case when usage.request_count > 0 then 'configured' else 'not_configured' end,
      coalesce(usage.detail, 'No provider requests recorded'),
      usage.last_activity_at
    from (
      select
        count(*)::bigint as request_count,
        max(created_at) as last_activity_at,
        string_agg(distinct provider, ', ' order by provider)
          || ' requests recorded' as detail
      from public.ai_assistant_requests
      where provider is not null
    ) usage
  )
  select r.code, r.name, r.category, r.status, r.detail, r.last_activity_at
  from integration_rows r
  order by r.category, r.code;
end;
$$;

create or replace function public.platform_get_storage_usage()
returns table (
  total_bytes bigint,
  asset_count bigint,
  business_count bigint,
  ready_bytes bigint,
  failed_count bigint,
  by_provider jsonb,
  by_category jsonb,
  largest_asset_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.storage.read') then
    raise exception 'You do not have permission to view storage usage.'
      using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(ma.file_size), 0)::bigint,
    count(*)::bigint,
    count(distinct ma.business_id)::bigint,
    coalesce(sum(ma.file_size) filter (where ma.status = 'ready'), 0)::bigint,
    count(*) filter (where ma.status = 'failed')::bigint,
    coalesce((
      select jsonb_object_agg(provider, jsonb_build_object(
        'assets', provider_rows.asset_count,
        'bytes', provider_rows.total_bytes
      ))
      from (
        select ma2.provider, count(*)::bigint as asset_count, sum(ma2.file_size)::bigint as total_bytes
        from public.media_assets ma2
        where ma2.status <> 'deleted'
        group by ma2.provider
      ) provider_rows
    ), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(asset_category, jsonb_build_object(
        'assets', category_rows.asset_count,
        'bytes', category_rows.total_bytes
      ))
      from (
        select ma3.asset_category, count(*)::bigint as asset_count, sum(ma3.file_size)::bigint as total_bytes
        from public.media_assets ma3
        where ma3.status <> 'deleted'
        group by ma3.asset_category
      ) category_rows
    ), '{}'::jsonb),
    coalesce(max(ma.file_size), 0)::bigint
  from public.media_assets ma
  where ma.status <> 'deleted';
end;
$$;

create or replace function public.platform_get_health()
returns table (
  checked_at timestamptz,
  active_support_sessions bigint,
  expired_support_sessions bigint,
  pending_orders bigint,
  pending_payments bigint,
  failed_ai_requests_24h bigint,
  failed_webhook_events_24h bigint,
  failed_media_assets bigint,
  last_ai_request_at timestamptz,
  last_webhook_at timestamptz,
  connected_channels bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_platform_permission('platform.system.read') then
    raise exception 'You do not have permission to view system health.'
      using errcode = '42501';
  end if;

  return query
  select
    now(),
    (
      select count(*) from public.platform_support_sessions s
      where s.ended_at is null and s.expires_at > now()
    )::bigint,
    (
      select count(*) from public.platform_support_sessions s
      where s.ended_at is null and s.expires_at <= now()
    )::bigint,
    (
      select count(*) from public.orders o
      where o.status = 'awaiting_business_approval'
    )::bigint,
    (
      select count(*) from public.payments p where p.status = 'pending'
    )::bigint,
    (
      select count(*) from public.ai_assistant_requests ar
      where ar.status in ('failed', 'rate_limited')
        and ar.created_at >= now() - interval '24 hours'
    )::bigint,
    (
      select count(*) from public.communication_webhook_events cw
      where cw.status = 'failed' and cw.created_at >= now() - interval '24 hours'
    )::bigint,
    (
      select count(*) from public.media_assets ma where ma.status = 'failed'
    )::bigint,
    (select max(created_at) from public.ai_assistant_requests),
    (select max(created_at) from public.communication_webhook_events),
    (
      select count(*) from public.business_channel_connections c
      where c.status = 'connected'
    )::bigint;
end;
$$;

create or replace function public.platform_get_settings()
returns table (
  media_provider text,
  media_max_file_bytes bigint,
  media_allowed_mime_types text[],
  subscriptions_configured boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    public.has_platform_permission('platform.permissions.manage')
    or public.has_platform_permission('platform.subscriptions.read')
    or public.has_platform_permission('platform.overview.read')
  ) then
    raise exception 'You do not have permission to view platform settings.'
      using errcode = '42501';
  end if;

  return query
  select
    config.provider,
    config.max_file_bytes,
    config.allowed_mime_types,
    exists (
      select 1 from pg_catalog.pg_tables
      where schemaname = 'public' and tablename = 'subscriptions'
    ),
    config.updated_at
  from public.media_provider_config config
  where config.id = true;
end;
$$;

create or replace function public.platform_update_platform_setting(
  p_key text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_value text := btrim(coalesce(p_value, ''));
  v_bytes bigint;
begin
  if not (
    public.super_admin_can_manage()
    or public.has_platform_permission('platform.permissions.manage')
  ) then
    raise exception 'You do not have permission to change platform settings.'
      using errcode = '42501';
  end if;

  if v_key <> 'media.max_file_bytes' then
    raise exception 'Unknown or read-only platform setting.'
      using errcode = '22023';
  end if;

  if v_value !~ '^[0-9]+$' then
    raise exception 'The setting value must be a whole number.'
      using errcode = '22023';
  end if;

  v_bytes := v_value::bigint;
  if v_bytes not between 1024 and 52428800 then
    raise exception 'The upload limit must be between 1024 and 52428800 bytes.'
      using errcode = '22023';
  end if;

  update public.media_provider_config
  set max_file_bytes = v_bytes, updated_at = now()
  where id = true;

  if not found then
    return false;
  end if;

  perform public.log_platform_action(
    'integration_config_change',
    'platform.permissions.manage',
    null,
    null,
    'platform_setting',
    null,
    jsonb_build_object('key', v_key, 'value', v_bytes),
    null,
    null
  );

  return true;
end;
$$;

create or replace function public.platform_list_grants(
  p_limit integer default 100
)
returns table (
  id uuid,
  user_id uuid,
  email_masked text,
  permission_code text,
  role_code text,
  business_id uuid,
  business_name text,
  reason text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not (
    public.super_admin_can_manage()
    or public.has_platform_permission('platform.permissions.manage')
  ) then
    raise exception 'You do not have permission to view platform grants.'
      using errcode = '42501';
  end if;

  return query
  select
    g.id,
    g.user_id,
    case
      when u.email is null then null
      when strpos(u.email, '@') > 0
        then left(split_part(u.email, '@', 1), 2)
          || '***@' || split_part(u.email, '@', 2)
      else '***'
    end,
    g.permission_code,
    g.role_code,
    g.business_id,
    b.name,
    g.reason,
    g.created_at,
    g.expires_at,
    g.revoked_at
  from public.platform_grants g
  left join auth.users u on u.id = g.user_id
  left join public.businesses b on b.id = g.business_id
  order by g.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.platform_list_permissions()
returns table (
  code text,
  label text,
  category text,
  sensitive boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    public.super_admin_can_manage()
    or public.has_platform_permission('platform.permissions.manage')
  ) then
    raise exception 'You do not have permission to view platform permissions.'
      using errcode = '42501';
  end if;

  return query
  select pp.code, pp.label, pp.category, pp.sensitive
  from public.platform_permissions pp
  order by pp.category, pp.label;
end;
$$;

revoke all on function public.platform_list_users(text, integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_storefronts(text, integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_orders_payments(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_ai_activity(integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_communications(integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_subscriptions(integer, integer) from public, anon, authenticated;
revoke all on function public.platform_list_integrations() from public, anon, authenticated;
revoke all on function public.platform_get_storage_usage() from public, anon, authenticated;
revoke all on function public.platform_get_health() from public, anon, authenticated;
revoke all on function public.platform_get_settings() from public, anon, authenticated;
revoke all on function public.platform_update_platform_setting(text, text) from public, anon, authenticated;
revoke all on function public.platform_list_grants(integer) from public, anon, authenticated;
revoke all on function public.platform_list_permissions() from public, anon, authenticated;

grant execute on function public.platform_list_users(text, integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_storefronts(text, integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_orders_payments(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_ai_activity(integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_communications(integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_subscriptions(integer, integer) to authenticated, service_role;
grant execute on function public.platform_list_integrations() to authenticated, service_role;
grant execute on function public.platform_get_storage_usage() to authenticated, service_role;
grant execute on function public.platform_get_health() to authenticated, service_role;
grant execute on function public.platform_get_settings() to authenticated, service_role;
grant execute on function public.platform_update_platform_setting(text, text) to authenticated, service_role;
grant execute on function public.platform_list_grants(integer) to authenticated, service_role;
grant execute on function public.platform_list_permissions() to authenticated, service_role;
