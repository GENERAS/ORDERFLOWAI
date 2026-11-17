create or replace function public.media_resolve_image_urls(
  p_paths text[],
  p_width integer default null
)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(path, public.media_resolve_image_url(path, p_width)),
    '{}'::jsonb
  )
  from unnest(coalesce(p_paths, array[]::text[])) as path
  where path is not null;
$$;

revoke all on function public.media_resolve_image_urls(text[], integer)
from public, anon, authenticated;

grant execute on function public.media_resolve_image_urls(text[], integer)
to anon, authenticated, service_role;
