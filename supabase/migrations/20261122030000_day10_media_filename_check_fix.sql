alter table public.media_assets
drop constraint if exists media_assets_filename_check;

alter table public.media_assets
add constraint media_assets_filename_check
check (
  char_length(btrim(original_filename)) between 1 and 255
  and original_filename !~ '[[:cntrl:]]'
);

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
