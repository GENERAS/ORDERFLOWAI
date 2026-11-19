create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role text not null,
  token_hash text not null unique,
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_invitations_role_check check (
    role in ('owner', 'admin', 'manager', 'staff')
  ),
  constraint business_invitations_status_check check (
    status in ('pending', 'accepted', 'cancelled', 'expired')
  ),
  constraint business_invitations_email_check check (
    char_length(btrim(email)) between 3 and 320
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

create index business_invitations_business_idx
on public.business_invitations (business_id, created_at desc);

create unique index business_invitations_pending_email_key
on public.business_invitations (business_id, email)
where status = 'pending';

create trigger business_invitations_set_updated_at
before update on public.business_invitations
for each row execute function public.set_updated_at();

alter table public.business_invitations enable row level security;

revoke all on public.business_invitations from public, anon, authenticated;
grant all on public.business_invitations to service_role;

create or replace function public.workspace_list_members(p_business_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text,
  status text,
  created_at timestamptz,
  is_last_active_owner boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  return query
  select
    bm.user_id,
    p.full_name,
    u.email::text,
    p.avatar_url,
    bm.role,
    bm.status,
    bm.created_at,
    (
      bm.role = 'owner'
      and bm.status = 'active'
      and (
        select count(*)::integer
        from public.business_members owners
        where owners.business_id = bm.business_id
          and owners.role = 'owner'
          and owners.status = 'active'
      ) <= 1
    ) as is_last_active_owner
  from public.business_members bm
  left join public.profiles p on p.id = bm.user_id
  left join auth.users u on u.id = bm.user_id
  where bm.business_id = p_business_id
  order by
    case bm.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
    coalesce(p.full_name, u.email) asc;
end;
$$;

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

create or replace function public.workspace_list_invitations(p_business_id uuid)
returns table (
  id uuid,
  email text,
  role text,
  status text,
  invited_by_name text,
  invited_by_email text,
  expires_at timestamptz,
  created_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  update public.business_invitations bi
  set status = 'expired'
  where bi.business_id = p_business_id
    and bi.status = 'pending'
    and bi.expires_at <= now();

  return query
  select
    bi.id,
    bi.email,
    bi.role,
    bi.status,
    p.full_name,
    u.email::text,
    bi.expires_at,
    bi.created_at,
    bi.accepted_at
  from public.business_invitations bi
  left join public.profiles p on p.id = bi.invited_by
  left join auth.users u on u.id = bi.invited_by
  where bi.business_id = p_business_id
    and bi.status in ('pending', 'expired')
  order by bi.created_at desc;
end;
$$;

create or replace function public.workspace_cancel_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_email text;
begin
  select bi.business_id, bi.email into v_business_id, v_email
  from public.business_invitations bi
  where bi.id = p_invitation_id;

  if not found then
    raise exception 'The invitation could not be found.'
      using errcode = 'PGRST116';
  end if;

  if v_business_id is null
     or not public.has_business_role(v_business_id, array['owner', 'admin']) then
    raise exception 'You do not have permission to manage this workspace team.'
      using errcode = '42501';
  end if;

  update public.business_invitations bi
  set status = 'cancelled'
  where bi.id = p_invitation_id
    and bi.status in ('pending', 'expired');

  if not found then
    raise exception 'Only pending invitations can be cancelled.'
      using errcode = '22023';
  end if;

  perform public.communication_log_audit(
    v_business_id,
    'workspace_invitation_cancelled',
    'business_invitation',
    p_invitation_id::text,
    jsonb_build_object('email', v_email)
  );

  return true;
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

create or replace function public.workspace_get_invitation(p_token text)
returns table (
  business_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_token_hash text := encode(
    extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'),
    'hex'
  );
begin
  if auth.uid() is null then
    raise exception 'Sign in to view this invitation.'
      using errcode = '42501';
  end if;

  return query
  select
    b.name,
    bi.email,
    bi.role,
    case when bi.status = 'pending' and bi.expires_at <= now() then 'expired' else bi.status end,
    bi.expires_at
  from public.business_invitations bi
  join public.businesses b on b.id = bi.business_id
  where bi.token_hash = v_token_hash;

  if not found then
    raise exception 'This invitation link is invalid.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.workspace_accept_invitation(p_token text)
returns table (
  business_id uuid,
  business_name text,
  email text,
  role text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token_hash text := encode(
    extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'),
    'hex'
  );
  v_invitation public.business_invitations%rowtype;
  v_caller_email text;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign in to accept this invitation.'
      using errcode = '42501';
  end if;

  select * into v_invitation
  from public.business_invitations bi
  where bi.token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'This invitation link is invalid.'
      using errcode = '22023';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer pending.'
      using errcode = '22023';
  end if;

  if v_invitation.expires_at <= now() then
    update public.business_invitations bi
    set status = 'expired'
    where bi.id = v_invitation.id;

    raise exception 'This invitation has expired.'
      using errcode = '22023';
  end if;

  select lower(btrim(coalesce(u.email, ''))) into v_caller_email
  from auth.users u
  where u.id = v_user_id;

  if v_caller_email is null or v_caller_email <> v_invitation.email then
    raise exception 'Sign in with the email address that received this invitation.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.business_members bm
    where bm.business_id = v_invitation.business_id
      and bm.user_id = v_user_id
      and bm.status = 'active'
  ) then
    raise exception 'You are already a member of this workspace.'
      using errcode = '23505';
  end if;

  insert into public.business_members (business_id, user_id, role, status)
  values (v_invitation.business_id, v_user_id, v_invitation.role, 'active')
  on conflict (business_id, user_id) do update
  set role = excluded.role, status = 'active';

  update public.business_invitations bi
  set status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = now()
  where bi.id = v_invitation.id;

  perform public.communication_log_audit(
    v_invitation.business_id,
    'workspace_invitation_accepted',
    'business_invitation',
    v_invitation.id::text,
    jsonb_build_object('email', v_invitation.email, 'role', v_invitation.role)
  );

  return query
  select b.id, b.name, v_invitation.email, v_invitation.role
  from public.businesses b
  where b.id = v_invitation.business_id;
end;
$$;

revoke all on function public.workspace_list_members(uuid) from public, anon, authenticated;
revoke all on function public.workspace_invite_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.workspace_list_invitations(uuid) from public, anon, authenticated;
revoke all on function public.workspace_cancel_invitation(uuid) from public, anon, authenticated;
revoke all on function public.workspace_update_member_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_set_member_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_remove_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.workspace_get_invitation(text) from public, anon, authenticated;
revoke all on function public.workspace_accept_invitation(text) from public, anon, authenticated;

grant execute on function public.workspace_list_members(uuid) to authenticated, service_role;
grant execute on function public.workspace_invite_member(uuid, text, text) to authenticated, service_role;
grant execute on function public.workspace_list_invitations(uuid) to authenticated, service_role;
grant execute on function public.workspace_cancel_invitation(uuid) to authenticated, service_role;
grant execute on function public.workspace_update_member_role(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.workspace_set_member_status(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.workspace_remove_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_get_invitation(text) to authenticated, service_role;
grant execute on function public.workspace_accept_invitation(text) to authenticated, service_role;
