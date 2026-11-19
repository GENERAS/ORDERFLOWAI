create or replace function public.platform_list_support_sessions(
  p_business_id uuid default null
)
returns table (
  id uuid,
  actor_user_id uuid,
  business_id uuid,
  business_name text,
  business_slug text,
  business_industry text,
  business_country text,
  business_currency text,
  business_timezone text,
  business_created_at timestamptz,
  business_updated_at timestamptz,
  purpose text,
  permissions text[],
  business_roles text[],
  started_at timestamptz,
  expires_at timestamptz,
  request_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view support sessions.'
      using errcode = '28000';
  end if;

  return query
  select
    s.id,
    s.actor_user_id,
    s.business_id,
    b.name,
    b.slug,
    b.industry,
    b.country,
    b.currency,
    b.timezone,
    b.created_at,
    b.updated_at,
    s.purpose,
    s.permissions,
    s.business_roles,
    s.started_at,
    s.expires_at,
    s.request_id
  from public.platform_support_sessions s
  join public.businesses b on b.id = s.business_id
  where (p_business_id is null or s.business_id = p_business_id)
    and s.ended_at is null
    and s.expires_at > now()
    and (
      s.actor_user_id = auth.uid()
      or public.super_admin_can_manage()
      or public.has_platform_permission('platform.audit.read')
    )
  order by s.expires_at asc;
end;
$$;

revoke all on function public.platform_list_support_sessions(uuid) from public, anon, authenticated;

grant execute on function public.platform_list_support_sessions(uuid) to authenticated, service_role;
