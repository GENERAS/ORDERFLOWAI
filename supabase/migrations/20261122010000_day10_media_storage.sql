create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.media_provider_config (
  id boolean primary key default true check (id),
  provider text not null default 'supabase'
    check (provider in ('supabase', 'cloudinary')),
  cloudinary_cloud_name text
    check (
      cloudinary_cloud_name is null
      or cloudinary_cloud_name ~ '^[A-Za-z0-9_-]{1,80}$'
    ),
  max_file_bytes bigint not null default 5242880
    check (max_file_bytes between 1024 and 52428800),
  allowed_mime_types text[] not null default array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif'
  ]::text[],
  updated_at timestamptz not null default now()
);

insert into public.media_provider_config (
  id, provider, cloudinary_cloud_name, max_file_bytes, allowed_mime_types
)
values (
  true, 'supabase', null, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
on conflict (id) do nothing;

create table if not exists public.media_upload_limits (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  max_files integer check (max_files is null or max_files >= 0),
  max_total_bytes bigint check (max_total_bytes is null or max_total_bytes >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('supabase', 'cloudinary')),
  provider_file_id text not null,
  bucket text,
  asset_category text not null
    check (asset_category in ('product_image', 'store_logo')),
  original_filename text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  delivery_url text,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed', 'deleted')),
  client_request_id uuid not null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  constraint media_assets_request_key unique (business_id, client_request_id),
  constraint media_assets_provider_file_key unique (provider, provider_file_id),
  constraint media_assets_reference_check check (
    (provider = 'supabase' and bucket is not null and delivery_url is null)
    or (provider = 'cloudinary' and bucket is null)
  ),
  constraint media_assets_filename_check check (
    char_length(btrim(original_filename)) between 1 and 255
    and original_filename !~ '[[:cntrl:]]'
  )
);

alter table public.product_images
add column if not exists media_asset_id uuid
references public.media_assets(id) on delete set null;

alter table public.stores
add column if not exists logo_media_asset_id uuid
references public.media_assets(id) on delete set null;

create index if not exists media_assets_business_status_created_idx
on public.media_assets (business_id, status, created_at desc);

create index if not exists media_assets_business_category_idx
on public.media_assets (business_id, asset_category);

create unique index if not exists product_images_media_asset_unique
on public.product_images (media_asset_id)
where media_asset_id is not null;

create index if not exists stores_logo_media_asset_idx
on public.stores (logo_media_asset_id)
where logo_media_asset_id is not null;

alter table public.platform_admins enable row level security;
alter table public.media_provider_config enable row level security;
alter table public.media_upload_limits enable row level security;
alter table public.media_assets enable row level security;

drop policy if exists media_provider_config_select on public.media_provider_config;
create policy media_provider_config_select
on public.media_provider_config
for select
to authenticated
using (true);

drop policy if exists media_upload_limits_select_members on public.media_upload_limits;
create policy media_upload_limits_select_members
on public.media_upload_limits
for select
to authenticated
using (public.is_business_member(business_id));

drop policy if exists media_assets_select_members on public.media_assets;
create policy media_assets_select_members
on public.media_assets
for select
to authenticated
using (public.is_business_member(business_id));

revoke all on public.platform_admins from anon, authenticated;
revoke all on public.media_provider_config from anon, authenticated;
revoke all on public.media_upload_limits from anon, authenticated;
revoke all on public.media_assets from anon, authenticated;
grant select on public.media_provider_config to authenticated;
grant select on public.media_upload_limits to authenticated;
grant select on public.media_assets to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = auth.uid()
    );
$$;

create or replace function public.media_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.media_set_updated_at();

drop trigger if exists media_provider_config_set_updated_at on public.media_provider_config;
create trigger media_provider_config_set_updated_at
before update on public.media_provider_config
for each row execute function public.media_set_updated_at();

drop trigger if exists media_upload_limits_set_updated_at on public.media_upload_limits;
create trigger media_upload_limits_set_updated_at
before update on public.media_upload_limits
for each row execute function public.media_set_updated_at();

create or replace function public.media_asset_reference(p_asset public.media_assets)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_asset.provider = 'cloudinary' then
    return 'cloudinary:' || p_asset.provider_file_id;
  end if;

  return p_asset.provider_file_id;
end;
$$;

create or replace function public.media_build_cloudinary_url(
  p_public_id text,
  p_width integer default null
)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_cloud_name text;
  v_public_id text := btrim(coalesce(p_public_id, ''));
  v_safe_width integer;
begin
  if left(v_public_id, 11) = 'cloudinary:' then
    v_public_id := substring(v_public_id from 12);
  end if;

  if v_public_id !~ '^[A-Za-z0-9._/-]+$' or position('..' in v_public_id) > 0 then
    return null;
  end if;

  select mc.cloudinary_cloud_name into v_cloud_name
  from public.media_provider_config mc
  where mc.id;

  if v_cloud_name is null then
    return null;
  end if;

  v_safe_width := case
    when p_width is null then null
    else least(greatest(p_width, 16), 4096)
  end;

  return 'https://res.cloudinary.com/' || v_cloud_name
    || '/image/upload/f_auto,q_auto'
    || case when v_safe_width is null then '' else ',w_' || v_safe_width::text end
    || '/' || v_public_id;
end;
$$;

create or replace function public.media_resolve_image_url(
  p_storage_path text,
  p_width integer default null
)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when left(coalesce(p_storage_path, ''), 11) = 'cloudinary:'
      then public.media_build_cloudinary_url(p_storage_path, p_width)
    else null
  end;
$$;

create or replace function public.media_get_provider_config()
returns table (
  provider text,
  cloud_name text,
  max_file_bytes bigint,
  allowed_mime_types text[]
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    mc.provider,
    case when mc.provider = 'cloudinary' then mc.cloudinary_cloud_name else null end,
    mc.max_file_bytes,
    mc.allowed_mime_types
  from public.media_provider_config mc
  where mc.id;
$$;

create or replace function public.set_media_provider_config(
  p_provider text,
  p_cloudinary_cloud_name text default null,
  p_max_file_bytes bigint default null,
  p_allowed_mime_types text[] default null
)
returns public.media_provider_config
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.media_provider_config;
  v_normalized_provider text := lower(btrim(coalesce(p_provider, '')));
  v_normalized_cloud text := nullif(btrim(coalesce(p_cloudinary_cloud_name, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators can change media provider settings.'
      using errcode = '42501';
  end if;

  if v_normalized_provider not in ('supabase', 'cloudinary') then
    raise exception 'Choose either supabase or cloudinary as the media provider.'
      using errcode = '22023';
  end if;

  if v_normalized_provider = 'cloudinary' and v_normalized_cloud is null then
    raise exception 'A Cloudinary cloud name is required for Cloudinary uploads.'
      using errcode = '22023';
  end if;

  if p_max_file_bytes is not null and p_max_file_bytes not between 1024 and 52428800 then
    raise exception 'The media file size limit must be between 1 KB and 50 MB.'
      using errcode = '22023';
  end if;

  if p_allowed_mime_types is not null and (
    cardinality(p_allowed_mime_types) = 0
    or not p_allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
  ) then
    raise exception 'Allowed media types must be supported image MIME types.'
      using errcode = '22023';
  end if;

  update public.media_provider_config
  set
    provider = v_normalized_provider,
    cloudinary_cloud_name = case
      when v_normalized_provider = 'cloudinary' then v_normalized_cloud
      else null
    end,
    max_file_bytes = coalesce(p_max_file_bytes, max_file_bytes),
    allowed_mime_types = coalesce(p_allowed_mime_types, allowed_mime_types)
  where id
  returning * into v_config;

  return v_config;
end;
$$;

create or replace function public.set_business_media_limits(
  p_business_id uuid,
  p_max_files integer default null,
  p_max_total_bytes bigint default null
)
returns public.media_upload_limits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limits public.media_upload_limits;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators can change media upload limits.'
      using errcode = '42501';
  end if;

  if p_max_files is not null and p_max_files < 0 then
    raise exception 'The file limit cannot be negative.'
      using errcode = '22023';
  end if;

  if p_max_total_bytes is not null and p_max_total_bytes < 0 then
    raise exception 'The storage limit cannot be negative.'
      using errcode = '22023';
  end if;

  insert into public.media_upload_limits (business_id, max_files, max_total_bytes)
  values (p_business_id, p_max_files, p_max_total_bytes)
  on conflict (business_id) do update
  set
    max_files = excluded.max_files,
    max_total_bytes = excluded.max_total_bytes
  returning * into v_limits;

  return v_limits;
end;
$$;

create or replace function public.media_start_upload(
  p_business_id uuid,
  p_client_request_id uuid,
  p_provider text,
  p_asset_category text,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint,
  p_product_id uuid default null
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.media_provider_config;
  v_existing public.media_assets;
  v_asset public.media_assets;
  v_limits public.media_upload_limits;
  v_ready_files bigint;
  v_ready_bytes bigint;
  v_extension text;
  v_provider_file_id text;
  v_bucket text;
  v_metadata jsonb;
  v_normalized_category text := lower(btrim(coalesce(p_asset_category, '')));
  v_normalized_provider text := lower(btrim(coalesce(p_provider, '')));
  v_filename text := btrim(coalesce(p_original_filename, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to upload media.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have permission to upload media for this business.'
      using errcode = '42501';
  end if;

  if p_client_request_id is null then
    raise exception 'A valid upload request id is required.'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.media_assets ma
  where ma.business_id = p_business_id
    and ma.client_request_id = p_client_request_id;

  if found then
    return v_existing;
  end if;

  select * into v_config
  from public.media_provider_config mc
  where mc.id;

  if v_normalized_provider <> v_config.provider then
    raise exception 'The media provider changed. Refresh and try again.'
      using errcode = '22023';
  end if;

  if v_normalized_category not in ('product_image', 'store_logo') then
    raise exception 'Unsupported media category.'
      using errcode = '22023';
  end if;

  if not (v_config.allowed_mime_types @> array[lower(btrim(coalesce(p_mime_type, '')))]) then
    raise exception 'Use a JPEG, PNG, WebP or AVIF image.'
      using errcode = '22023';
  end if;

  if p_file_size is null or p_file_size <= 0 or p_file_size > v_config.max_file_bytes then
    raise exception 'Images must be % bytes or smaller.'
      , v_config.max_file_bytes
      using errcode = '22023';
  end if;

  if char_length(v_filename) not between 1 and 255 or v_filename ~ '[[:cntrl:]]' then
    raise exception 'The original file name is invalid.'
      using errcode = '22023';
  end if;

  v_extension := case lower(btrim(p_mime_type))
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/avif' then 'avif'
  end;

  if v_config.provider = 'supabase' then
    if v_normalized_category = 'product_image' then
      if p_product_id is null or not exists (
        select 1
        from public.products p
        where p.id = p_product_id
          and p.business_id = p_business_id
      ) then
        raise exception 'Choose a valid product for this image.'
          using errcode = '22023';
      end if;
      v_bucket := 'product-images';
      v_provider_file_id := p_business_id::text || '/' || p_product_id::text || '/'
        || gen_random_uuid()::text || '.' || v_extension;
    else
      v_bucket := 'store-logos';
      v_provider_file_id := p_business_id::text || '/'
        || gen_random_uuid()::text || '.' || v_extension;
    end if;
    v_metadata := jsonb_build_object('bucket', v_bucket, 'category', v_normalized_category);
  else
    if v_config.cloudinary_cloud_name is null then
      raise exception 'Cloudinary is not configured.'
        using errcode = '503';
    end if;
    v_provider_file_id := 'business/' || p_business_id::text || '/'
      || case when v_normalized_category = 'product_image' then 'products' else 'logos' end
      || '/' || gen_random_uuid()::text;
    v_metadata := jsonb_build_object(
      'cloud_name', v_config.cloudinary_cloud_name,
      'category', v_normalized_category
    );
  end if;

  select * into v_limits
  from public.media_upload_limits mul
  where mul.business_id = p_business_id;

  if found then
    select
      count(*)::bigint,
      coalesce(sum(ma.file_size), 0)::bigint
    into v_ready_files, v_ready_bytes
    from public.media_assets ma
    where ma.business_id = p_business_id
      and ma.status = 'ready';

    if v_limits.max_files is not null and v_ready_files >= v_limits.max_files then
      raise exception 'This workspace has reached its configured media file limit.'
        using errcode = '22023';
    end if;

    if v_limits.max_total_bytes is not null
       and v_ready_bytes + p_file_size > v_limits.max_total_bytes then
      raise exception 'This workspace has reached its configured media storage limit.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.media_assets (
    business_id,
    provider,
    provider_file_id,
    bucket,
    asset_category,
    original_filename,
    mime_type,
    file_size,
    status,
    client_request_id,
    metadata
  )
  values (
    p_business_id,
    v_config.provider,
    v_provider_file_id,
    v_bucket,
    v_normalized_category,
    v_filename,
    lower(btrim(p_mime_type)),
    p_file_size,
    'pending',
    p_client_request_id,
    v_metadata
  )
  returning * into v_asset;

  return v_asset;
end;
$$;

create or replace function public.media_get_upload_authorization(p_media_asset_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
  v_config public.media_provider_config;
begin
  if auth.uid() is null then
    raise exception 'Sign in to upload media.'
      using errcode = '28000';
  end if;

  select * into v_asset
  from public.media_assets ma
  where ma.id = p_media_asset_id;

  if not found or not public.has_business_role(
    v_asset.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have access to this media asset.'
      using errcode = '42501';
  end if;

  select * into v_config
  from public.media_provider_config mc
  where mc.id;

  return jsonb_build_object(
    'id', v_asset.id,
    'businessId', v_asset.business_id,
    'provider', v_asset.provider,
    'providerFileId', v_asset.provider_file_id,
    'bucket', v_asset.bucket,
    'assetCategory', v_asset.asset_category,
    'status', v_asset.status,
    'mimeType', v_asset.mime_type,
    'fileSize', v_asset.file_size,
    'metadata', v_asset.metadata,
    'currentProvider', v_config.provider,
    'cloudName', coalesce(v_asset.metadata ->> 'cloud_name', v_config.cloudinary_cloud_name),
    'maxFileBytes', v_config.max_file_bytes,
    'allowedMimeTypes', v_config.allowed_mime_types
  );
end;
$$;

create or replace function public.media_complete_upload(
  p_media_asset_id uuid,
  p_provider_file_id text,
  p_delivery_url text default null,
  p_bytes bigint default null,
  p_width integer default null,
  p_height integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
begin
  if auth.uid() is null then
    raise exception 'Sign in to upload media.'
      using errcode = '28000';
  end if;

  select * into v_asset
  from public.media_assets ma
  where ma.id = p_media_asset_id
  for update;

  if not found or not public.has_business_role(
    v_asset.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have access to this media asset.'
      using errcode = '42501';
  end if;

  if v_asset.status = 'ready' and v_asset.provider_file_id = p_provider_file_id then
    return v_asset;
  end if;

  if v_asset.status <> 'pending' then
    raise exception 'This media upload is no longer pending.'
      using errcode = '22023';
  end if;

  if p_provider_file_id is null or btrim(p_provider_file_id) <> v_asset.provider_file_id then
    raise exception 'The uploaded file reference does not match this media asset.'
      using errcode = '22023';
  end if;

  if v_asset.provider = 'cloudinary' then
    if p_delivery_url is null
       or p_delivery_url !~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/'
       or position(v_asset.provider_file_id in p_delivery_url) = 0 then
      raise exception 'Cloudinary did not return a valid image URL.'
        using errcode = '22023';
    end if;
  elsif p_delivery_url is not null then
    raise exception 'Private media cannot use a public delivery URL.'
      using errcode = '22023';
  end if;

  update public.media_assets
  set
    status = 'ready',
    file_size = case
      when p_bytes is not null and p_bytes > 0 then p_bytes
      else file_size
    end,
    width = case when p_width is not null and p_width > 0 then p_width else null end,
    height = case when p_height is not null and p_height > 0 then p_height else null end,
    delivery_url = p_delivery_url,
    error_message = null,
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
    completed_at = now()
  where id = v_asset.id
  returning * into v_asset;

  return v_asset;
end;
$$;

create or replace function public.media_fail_upload(
  p_media_asset_id uuid,
  p_error_message text
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
  v_message text := left(btrim(coalesce(p_error_message, 'Upload failed.')), 500);
begin
  if auth.uid() is null then
    raise exception 'Sign in to upload media.'
      using errcode = '28000';
  end if;

  select * into v_asset
  from public.media_assets ma
  where ma.id = p_media_asset_id
  for update;

  if not found or not public.has_business_role(
    v_asset.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have access to this media asset.'
      using errcode = '42501';
  end if;

  if v_asset.status in ('ready', 'deleted') then
    return v_asset;
  end if;

  update public.media_assets
  set
    status = 'failed',
    error_message = v_message,
    completed_at = now()
  where id = v_asset.id
  returning * into v_asset;

  return v_asset;
end;
$$;

create or replace function public.media_mark_deleted(p_media_asset_id uuid)
returns public.media_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage media.'
      using errcode = '28000';
  end if;

  select * into v_asset
  from public.media_assets ma
  where ma.id = p_media_asset_id
  for update;

  if not found or not public.has_business_role(
    v_asset.business_id,
    array['owner', 'admin', 'manager', 'staff']
  ) then
    raise exception 'You do not have access to this media asset.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.product_images pi
    where pi.media_asset_id = v_asset.id
  ) or exists (
    select 1
    from public.stores s
    where s.logo_media_asset_id = v_asset.id
  ) then
    raise exception 'This image is still in use and cannot be deleted.'
      using errcode = '23503';
  end if;

  update public.media_assets
  set
    status = 'deleted',
    deleted_at = now()
  where id = v_asset.id
  returning * into v_asset;

  return v_asset;
end;
$$;

create or replace function public.media_attach_product_image(
  p_media_asset_id uuid,
  p_product_id uuid,
  p_alt_text text default null,
  p_is_primary boolean default false
)
returns public.product_images
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
  v_image public.product_images;
  v_sort_order integer;
  v_reference text;
  v_alt_text text := nullif(btrim(coalesce(p_alt_text, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage product images.'
      using errcode = '28000';
  end if;

  select * into v_asset
  from public.media_assets ma
  where ma.id = p_media_asset_id
  for update;

  if not found
     or v_asset.status <> 'ready'
     or v_asset.asset_category <> 'product_image'
     or not public.has_business_role(
       v_asset.business_id,
       array['owner', 'admin', 'manager', 'staff']
     )
     or not exists (
       select 1
       from public.products p
       where p.id = p_product_id
         and p.business_id = v_asset.business_id
     ) then
    raise exception 'This image cannot be attached to the product.'
      using errcode = '42501';
  end if;

  select pi.* into v_image
  from public.product_images pi
  where pi.media_asset_id = v_asset.id;

  if found then
    return v_image;
  end if;

  if v_alt_text is not null and char_length(v_alt_text) > 300 then
    raise exception 'Image descriptions must be 300 characters or fewer.'
      using errcode = '22023';
  end if;

  select coalesce(max(pi.sort_order) + 1, 0) into v_sort_order
  from public.product_images pi
  where pi.business_id = v_asset.business_id
    and pi.product_id = p_product_id;

  if coalesce(p_is_primary, false) then
    update public.product_images pi
    set is_primary = false
    where pi.business_id = v_asset.business_id
      and pi.product_id = p_product_id;
  end if;

  v_reference := public.media_asset_reference(v_asset);

  insert into public.product_images (
    business_id,
    product_id,
    storage_path,
    alt_text,
    sort_order,
    is_primary,
    media_asset_id
  )
  values (
    v_asset.business_id,
    p_product_id,
    v_reference,
    v_alt_text,
    v_sort_order,
    coalesce(p_is_primary, false),
    v_asset.id
  )
  returning * into v_image;

  return v_image;
end;
$$;

create or replace function public.get_business_media_usage(p_business_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_limits public.media_upload_limits;
  v_ready_files bigint;
  v_image_files bigint;
  v_total_bytes bigint;
  v_pending_files bigint;
  v_failed_files bigint;
  v_has_limits boolean := false;
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  select * into v_limits
  from public.media_upload_limits mul
  where mul.business_id = p_business_id;

  v_has_limits := found;

  select
    count(*) filter (where ma.status = 'ready')::bigint,
    count(*) filter (where ma.status = 'ready' and ma.mime_type like 'image/%')::bigint,
    coalesce(sum(ma.file_size) filter (where ma.status = 'ready'), 0)::bigint,
    count(*) filter (where ma.status = 'pending')::bigint,
    count(*) filter (where ma.status = 'failed')::bigint
  into v_ready_files, v_image_files, v_total_bytes, v_pending_files, v_failed_files
  from public.media_assets ma
  where ma.business_id = p_business_id;

  return jsonb_build_object(
    'readyFiles', v_ready_files,
    'imageFiles', v_image_files,
    'totalBytes', v_total_bytes,
    'pendingFiles', v_pending_files,
    'failedFiles', v_failed_files,
    'maxFiles', case when v_has_limits then v_limits.max_files else null end,
    'maxTotalBytes', case when v_has_limits then v_limits.max_total_bytes else null end
  );
end;
$$;

create or replace function public.media_list_abandoned(
  p_older_than interval default interval '1 day'
)
returns setof public.media_assets
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage media.'
      using errcode = '28000';
  end if;

  return query
  select ma.*
  from public.media_assets ma
  where ma.status in ('pending', 'failed')
    and ma.created_at < now() - p_older_than
    and public.has_business_role(
      ma.business_id,
      array['owner', 'admin', 'manager']
    )
  order by ma.created_at asc;
end;
$$;

create or replace function public.validate_product_image_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
  v_public_id text;
begin
  if left(coalesce(new.storage_path, ''), 11) = 'cloudinary:' then
    if new.media_asset_id is null then
      raise exception 'Cloudinary product images require a media asset.'
        using errcode = '22023';
    end if;

    select * into v_asset
    from public.media_assets ma
    where ma.id = new.media_asset_id;

    v_public_id := substring(new.storage_path from 12);

    if not found
       or v_asset.business_id <> new.business_id
       or v_asset.provider <> 'cloudinary'
       or v_asset.asset_category <> 'product_image'
       or v_asset.status <> 'ready'
       or v_asset.provider_file_id <> v_public_id
       or v_public_id !~ '^[A-Za-z0-9._/-]+$'
       or position('..' in v_public_id) > 0 then
      raise exception 'Cloudinary product image reference is invalid.'
        using errcode = '22023';
    end if;

    return new;
  end if;

  if new.storage_path !~ (
    '^' || new.business_id::text || '/' || new.product_id::text
    || '/[A-Za-z0-9._-]+$'
  ) then
    raise exception 'Product image paths must use business/product/file format.'
      using errcode = '22023';
  end if;

  if position('..' in new.storage_path) > 0 then
    raise exception 'Product image paths cannot contain traversal segments.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists product_images_validate_path on public.product_images;
create trigger product_images_validate_path
before insert or update of business_id, product_id, storage_path, media_asset_id
on public.product_images
for each row execute function public.validate_product_image_path();

create or replace function public.validate_store_logo_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_asset public.media_assets;
  v_public_id text;
begin
  if new.logo_path is null then
    if new.logo_media_asset_id is not null then
      raise exception 'A removed store logo cannot keep a media asset reference.'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if left(new.logo_path, 11) = 'cloudinary:' then
    if new.logo_media_asset_id is null then
      raise exception 'Cloudinary store logos require a media asset.'
        using errcode = '22023';
    end if;

    select * into v_asset
    from public.media_assets ma
    where ma.id = new.logo_media_asset_id;

    v_public_id := substring(new.logo_path from 12);

    if not found
       or v_asset.business_id <> new.business_id
       or v_asset.provider <> 'cloudinary'
       or v_asset.asset_category <> 'store_logo'
       or v_asset.status <> 'ready'
       or v_asset.provider_file_id <> v_public_id
       or v_public_id !~ '^[A-Za-z0-9._/-]+$'
       or position('..' in v_public_id) > 0 then
      raise exception 'Cloudinary store logo reference is invalid.'
        using errcode = '22023';
    end if;

    return new;
  end if;

  if new.logo_path !~ (
    '^' || new.business_id::text
    || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    || '\.[A-Za-z0-9]+$'
  ) then
    raise exception 'Store logo paths must use business/file format.'
      using errcode = '22023';
  end if;

  if position('..' in new.logo_path) > 0 then
    raise exception 'Store logo paths cannot contain traversal segments.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists stores_validate_logo_path on public.stores;
create trigger stores_validate_logo_path
before insert or update of business_id, logo_path, logo_media_asset_id
on public.stores
for each row execute function public.validate_store_logo_path();

drop function if exists public.get_store_profile(uuid);
create or replace function public.get_store_profile(p_business_id uuid)
returns table (
  id uuid,
  business_id uuid,
  slug text,
  name text,
  description text,
  logo_path text,
  logo_media_asset_id uuid,
  logo_url text,
  contact_email text,
  contact_phone text,
  contact_address text,
  show_contact boolean,
  brand_color text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
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
    s.id,
    s.business_id,
    s.slug,
    s.name,
    s.description,
    s.logo_path,
    s.logo_media_asset_id,
    public.media_resolve_image_url(s.logo_path),
    s.contact_email,
    s.contact_phone,
    s.contact_address,
    s.show_contact,
    s.brand_color,
    s.status,
    s.created_at,
    s.updated_at
  from public.stores s
  where s.business_id = p_business_id;
end;
$$;

drop function if exists public.get_public_store(text);
create or replace function public.get_public_store(p_store_slug text)
returns table (
  store_slug text,
  store_name text,
  description text,
  logo_path text,
  logo_url text,
  brand_color text,
  contact_email text,
  contact_phone text,
  contact_address text,
  currency text
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
begin
  return query
  select
    s.slug,
    s.name,
    s.description,
    s.logo_path,
    public.media_resolve_image_url(s.logo_path),
    s.brand_color,
    case when s.show_contact then s.contact_email else null end,
    case when s.show_contact then s.contact_phone else null end,
    case when s.show_contact then s.contact_address else null end,
    b.currency
  from public.stores s
  join public.businesses b on b.id = s.business_id
  where s.slug = normalized_slug
    and s.status = 'active';

  if not found then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;
end;
$$;

drop function if exists public.update_store_profile(uuid, text, text, text, text, text, text, text, boolean, text, text);
drop function if exists public.update_store_profile(uuid, text, text, text, text, text, text, text, boolean, text, text, uuid);
create or replace function public.update_store_profile(
  p_business_id uuid,
  p_slug text,
  p_name text,
  p_description text default null,
  p_logo_path text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_contact_address text default null,
  p_show_contact boolean default false,
  p_brand_color text default '#4f46e5',
  p_status text default 'active',
  p_logo_media_asset_id uuid default null
)
returns public.stores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_store public.stores;
  v_logo_asset public.media_assets;
  normalized_slug text := lower(btrim(p_slug));
  normalized_name text := btrim(p_name);
  normalized_color text := lower(btrim(p_brand_color));
  normalized_status text := lower(btrim(p_status));
  resolved_logo_path text := nullif(btrim(p_logo_path), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your online store.'
      using errcode = '28000';
  end if;

  if not public.has_business_role(
    p_business_id,
    array['owner', 'admin', 'manager']
  ) then
    raise exception 'You do not have permission to manage this online store.'
      using errcode = '42501';
  end if;

  if normalized_slug is null
     or char_length(normalized_slug) not between 2 and 80
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Store links must be 2-80 lowercase letters, numbers, or hyphens.'
      using errcode = '22023';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'Store name must be between 1 and 160 characters.'
      using errcode = '22023';
  end if;

  if normalized_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Choose a valid brand color.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('active', 'inactive') then
    raise exception 'Choose a valid store status.'
      using errcode = '22023';
  end if;

  if p_logo_media_asset_id is not null then
    select * into v_logo_asset
    from public.media_assets ma
    where ma.id = p_logo_media_asset_id
    for update;

    if not found
       or v_logo_asset.business_id <> p_business_id
       or v_logo_asset.asset_category <> 'store_logo'
       or v_logo_asset.status <> 'ready' then
      raise exception 'Choose a valid uploaded logo.'
        using errcode = '22023';
    end if;

    resolved_logo_path := public.media_asset_reference(v_logo_asset);
  end if;

  update public.stores
  set
    slug = normalized_slug,
    name = normalized_name,
    description = nullif(btrim(p_description), ''),
    logo_path = resolved_logo_path,
    logo_media_asset_id = p_logo_media_asset_id,
    contact_email = nullif(btrim(p_contact_email), ''),
    contact_phone = nullif(btrim(p_contact_phone), ''),
    contact_address = nullif(btrim(p_contact_address), ''),
    show_contact = coalesce(p_show_contact, false),
    brand_color = normalized_color,
    status = normalized_status
  where business_id = p_business_id
  returning * into current_store;

  if not found then
    raise exception 'This online store could not be found.'
      using errcode = '22023';
  end if;

  return current_store;
exception
  when unique_violation then
    raise exception 'That store link is already taken.'
      using errcode = '23505';
end;
$$;

drop function if exists public.search_storefront_management_products(uuid, text, text, integer, integer);
create or replace function public.search_storefront_management_products(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  status text,
  sku text,
  price numeric,
  currency text,
  category_name text,
  storefront_visible boolean,
  primary_image_path text,
  primary_image_url text,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  normalized_status text := nullif(lower(btrim(p_status)), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.'
      using errcode = '42501';
  end if;

  return query
  with filtered as (
    select
      p.*,
      c.name as category_name,
      (
        select pi.storage_path
        from public.product_images pi
        where pi.business_id = p.business_id
          and pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
        limit 1
      ) as image_path
    from public.products p
    left join public.categories c
      on c.id = p.category_id
     and c.business_id = p.business_id
    where p.business_id = p_business_id
      and (
        normalized_search is null
        or p.name ilike '%' || normalized_search || '%'
        or coalesce(p.description, '') ilike '%' || normalized_search || '%'
        or coalesce(p.sku, '') ilike '%' || normalized_search || '%'
      )
      and (normalized_status is null or p.status = normalized_status)
  )
  select
    f.id,
    f.name,
    f.status,
    f.sku,
    f.price,
    f.currency,
    f.category_name,
    f.storefront_visible,
    f.image_path,
    public.media_resolve_image_url(f.image_path),
    count(*) over ()::bigint as total_count
  from filtered f
  order by lower(f.name), f.id
  limit safe_limit
  offset safe_offset;
end;
$$;

drop function if exists public.search_storefront_products(text, text, uuid, text, integer, integer);
create or replace function public.search_storefront_products(
  p_store_slug text,
  p_search text default null,
  p_category_id uuid default null,
  p_sort text default 'featured',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  currency text,
  category_name text,
  brand_name text,
  primary_image_path text,
  primary_image_url text,
  primary_image_alt text,
  availability text,
  has_variants boolean,
  price_from boolean,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  normalized_search text := nullif(btrim(p_search), '');
  normalized_sort text := lower(btrim(p_sort));
  safe_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  store_business_id uuid;
begin
  select s.business_id into store_business_id
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if store_business_id is null then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  if normalized_sort not in ('featured', 'name', 'price_asc', 'price_desc', 'newest') then
    normalized_sort := 'featured';
  end if;

  return query
  with units as (
    select
      p.id as product_id,
      p.price as unit_price,
      null::uuid as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id is null
    where p.business_id = store_business_id
      and p.status = 'active'
      and p.storefront_visible
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
      )

    union all

    select
      p.id as product_id,
      coalesce(v.price_override, p.price) as unit_price,
      v.id as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
     and v.product_id = p.id
     and v.status = 'active'
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id = v.id
    where p.business_id = store_business_id
      and p.status = 'active'
      and p.storefront_visible
  ),
  product_units as (
    select
      u.product_id,
      min(u.unit_price) as price,
      bool_or(u.variant_id is not null) as has_variants,
      count(distinct u.unit_price) > 1 as price_from,
      bool_or(
        case
          when not u.is_tracked then true
          else u.available_quantity > 0
        end
      ) as is_available,
      bool_or(u.is_tracked) as has_tracked
    from units u
    group by u.product_id
  )
  select
    p.id,
    p.name,
    p.description,
    pu.price,
    p.currency,
    c.name as category_name,
    b.name as brand_name,
    img.primary_image_path,
    public.media_resolve_image_url(img.primary_image_path),
    img.primary_image_alt,
    case
      when not pu.has_tracked then 'untracked'
      when pu.is_available then 'in_stock'
      else 'out_of_stock'
    end as availability,
    coalesce(pu.has_variants, false) as has_variants,
    coalesce(pu.price_from, false) as price_from,
    count(*) over ()::bigint as total_count
  from product_units pu
  join public.products p
    on p.id = pu.product_id
  left join public.categories c
    on c.id = p.category_id
   and c.business_id = p.business_id
  left join public.brands b
    on b.id = p.brand_id
   and b.business_id = p.business_id
  left join lateral (
    select pi.storage_path as primary_image_path,
      pi.alt_text as primary_image_alt
    from public.product_images pi
    where pi.business_id = p.business_id
      and pi.product_id = p.id
    order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
    limit 1
  ) img on true
  where (
    normalized_search is null
    or p.name ilike '%' || normalized_search || '%'
    or coalesce(p.description, '') ilike '%' || normalized_search || '%'
    or coalesce(p.sku, '') ilike '%' || normalized_search || '%'
    or coalesce(c.name, '') ilike '%' || normalized_search || '%'
  )
  and (
    p_category_id is null
    or p.category_id = p_category_id
  )
  order by
    case
      when normalized_sort = 'name' then lower(p.name)
      else null
    end asc,
    case
      when normalized_sort = 'price_asc' then pu.price
      else null
    end asc,
    case
      when normalized_sort = 'price_desc' then pu.price
      else null
    end desc,
    case
      when normalized_sort = 'newest' then p.created_at
      else null
    end desc,
    p.id asc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function public.get_storefront_product(
  p_store_slug text,
  p_product_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  price numeric,
  currency text,
  category_name text,
  brand_name text,
  availability text,
  has_variants boolean,
  price_from boolean,
  variants jsonb,
  images jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(p_store_slug));
  store_business_id uuid;
  current_product public.products;
begin
  select s.business_id into store_business_id
  from public.stores s
  where s.slug = normalized_slug
    and s.status = 'active';

  if store_business_id is null then
    raise exception 'This online store is not available.'
      using errcode = '22023';
  end if;

  select * into current_product
  from public.products p
  where p.id = p_product_id
    and p.business_id = store_business_id
    and p.status = 'active'
    and p.storefront_visible;

  if not found then
    raise exception 'This product is not available.'
      using errcode = '22023';
  end if;

  return query
  with units as (
    select
      p.price as unit_price,
      null::uuid as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id is null
    where p.id = current_product.id
      and not exists (
        select 1
        from public.product_variants v
        where v.business_id = p.business_id
          and v.product_id = p.id
          and v.status = 'active'
      )

    union all

    select
      coalesce(v.price_override, p.price) as unit_price,
      v.id as variant_id,
      coalesce(i.is_tracked, false) as is_tracked,
      coalesce(i.available_quantity, 0) as available_quantity
    from public.products p
    join public.product_variants v
      on v.business_id = p.business_id
     and v.product_id = p.id
     and v.status = 'active'
    left join public.inventory_items i
      on i.business_id = p.business_id
     and i.product_id = p.id
     and i.variant_id = v.id
    where p.id = current_product.id
  ),
  summary as (
    select
      count(*) > 0 as has_units,
      min(u.unit_price) as price,
      bool_or(u.variant_id is not null) as has_variants,
      count(distinct u.unit_price) > 1 as price_from,
      bool_or(
        case
          when not u.is_tracked then true
          else u.available_quantity > 0
        end
      ) as is_available,
      bool_or(u.is_tracked) as has_tracked
    from units u
  )
  select
    current_product.id,
    current_product.name,
    current_product.description,
    s.price,
    current_product.currency,
    c.name as category_name,
    b.name as brand_name,
    case
      when not s.has_tracked then 'untracked'
      when s.is_available then 'in_stock'
      else 'out_of_stock'
    end as availability,
    coalesce(s.has_variants, false) as has_variants,
    coalesce(s.price_from, false) as price_from,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'name', v.name,
          'sku', coalesce(v.sku, current_product.sku),
          'price', coalesce(v.price_override, current_product.price),
          'isTracked', coalesce(i.is_tracked, false),
          'availableQuantity', case when coalesce(i.is_tracked, false) then i.available_quantity else null end,
          'inStock', case
            when not coalesce(i.is_tracked, false) then true
            else coalesce(i.available_quantity, 0) > 0
          end
        )
        order by v.sort_order asc, lower(v.name) asc, v.id asc
      )
      from public.product_variants v
      left join public.inventory_items i
        on i.business_id = v.business_id
       and i.product_id = v.product_id
       and i.variant_id = v.id
      where v.business_id = current_product.business_id
        and v.product_id = current_product.id
        and v.status = 'active'
    ), '[]'::jsonb) as variants,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'path', pi.storage_path,
          'url', public.media_resolve_image_url(pi.storage_path),
          'alt', pi.alt_text,
          'sortOrder', pi.sort_order
        )
        order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.business_id = current_product.business_id
        and pi.product_id = current_product.id
    ), '[]'::jsonb) as images
  from summary s
  left join public.categories c
    on c.id = current_product.category_id
   and c.business_id = current_product.business_id
  left join public.brands b
    on b.id = current_product.brand_id
   and b.business_id = current_product.business_id
  where s.has_units;
end;
$$;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
revoke all on function public.media_set_updated_at() from public, anon, authenticated;
revoke all on function public.media_asset_reference(public.media_assets) from public, anon, authenticated;
revoke all on function public.media_build_cloudinary_url(text, integer) from public, anon, authenticated;
revoke all on function public.media_resolve_image_url(text, integer) from public, anon, authenticated;
revoke all on function public.media_get_provider_config() from public, anon, authenticated;
revoke all on function public.set_media_provider_config(text, text, bigint, text[]) from public, anon, authenticated;
revoke all on function public.set_business_media_limits(uuid, integer, bigint) from public, anon, authenticated;
revoke all on function public.media_start_upload(uuid, uuid, text, text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.media_get_upload_authorization(uuid) from public, anon, authenticated;
revoke all on function public.media_complete_upload(uuid, text, text, bigint, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.media_fail_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.media_mark_deleted(uuid) from public, anon, authenticated;
revoke all on function public.media_attach_product_image(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.get_business_media_usage(uuid) from public, anon, authenticated;
revoke all on function public.media_list_abandoned(interval) from public, anon, authenticated;
revoke all on function public.validate_product_image_path() from public, anon, authenticated;
revoke all on function public.validate_store_logo_path() from public, anon, authenticated;
revoke all on function public.get_store_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_public_store(text) from public, anon, authenticated;
revoke all on function public.update_store_profile(
  uuid, text, text, text, text, text, text, text, boolean, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.search_storefront_management_products(
  uuid, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.search_storefront_products(
  text, text, uuid, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.media_build_cloudinary_url(text, integer) to anon, authenticated, service_role;
grant execute on function public.media_resolve_image_url(text, integer) to anon, authenticated, service_role;
grant execute on function public.media_get_provider_config() to authenticated, service_role;
grant execute on function public.set_media_provider_config(text, text, bigint, text[]) to authenticated, service_role;
grant execute on function public.set_business_media_limits(uuid, integer, bigint) to authenticated, service_role;
grant execute on function public.media_start_upload(uuid, uuid, text, text, text, text, bigint, uuid) to authenticated, service_role;
grant execute on function public.media_get_upload_authorization(uuid) to authenticated, service_role;
grant execute on function public.media_complete_upload(uuid, text, text, bigint, integer, integer, jsonb) to authenticated, service_role;
grant execute on function public.media_fail_upload(uuid, text) to authenticated, service_role;
grant execute on function public.media_mark_deleted(uuid) to authenticated, service_role;
grant execute on function public.media_attach_product_image(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.get_business_media_usage(uuid) to authenticated, service_role;
grant execute on function public.media_list_abandoned(interval) to authenticated, service_role;
grant execute on function public.get_store_profile(uuid) to authenticated, service_role;
grant execute on function public.get_public_store(text) to anon, authenticated, service_role;
grant execute on function public.update_store_profile(
  uuid, text, text, text, text, text, text, text, boolean, text, text, uuid
) to authenticated, service_role;
grant execute on function public.search_storefront_management_products(
  uuid, text, text, integer, integer
) to authenticated, service_role;
grant execute on function public.search_storefront_products(
  text, text, uuid, text, integer, integer
) to anon, authenticated, service_role;
grant execute on function public.get_storefront_product(text, uuid)
to anon, authenticated, service_role;
