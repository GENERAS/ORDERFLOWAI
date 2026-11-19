create table if not exists public.ai_assistant_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default true,
  supported_languages text[] not null default array['en', 'rw', 'sw', 'fr'],
  daily_request_limit integer not null default 100 check (daily_request_limit between 1 and 10000),
  daily_token_limit integer not null default 200000 check (daily_token_limit between 1000 and 10000000),
  max_output_tokens integer not null default 700 check (max_output_tokens between 100 and 4000),
  system_prompt_extra text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_business_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null check (category in ('general', 'delivery', 'returns', 'payment', 'contact')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_assistant_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  request_key text not null check (char_length(btrim(request_key)) between 1 and 128),
  actor_id uuid,
  conversation_id uuid references public.communication_conversations(id) on delete set null,
  provider text,
  model text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'rate_limited')),
  input_chars integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(18, 8),
  latency_ms integer,
  error_code text,
  error_message text,
  language text,
  response jsonb,
  tools_used jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_assistant_requests_request_key_key unique (business_id, request_key)
);

create index if not exists ai_business_policies_business_idx
  on public.ai_business_policies (business_id, is_active, sort_order);

create index if not exists ai_assistant_requests_business_created_idx
  on public.ai_assistant_requests (business_id, created_at desc);

insert into public.communication_channels (code, name, description, status, sort_order)
values ('ai_assistant', 'AI Assistant', 'Internal assistant test sessions', 'available', 5)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  sort_order = excluded.sort_order;

alter table public.ai_assistant_settings enable row level security;
alter table public.ai_business_policies enable row level security;
alter table public.ai_assistant_requests enable row level security;

drop policy if exists ai_assistant_settings_select on public.ai_assistant_settings;
create policy ai_assistant_settings_select on public.ai_assistant_settings
  for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_business_policies_select on public.ai_business_policies;
create policy ai_business_policies_select on public.ai_business_policies
  for select to authenticated using (public.is_business_member(business_id));

drop policy if exists ai_assistant_requests_select on public.ai_assistant_requests;
create policy ai_assistant_requests_select on public.ai_assistant_requests
  for select to authenticated using (public.is_business_member(business_id));

revoke all on public.ai_assistant_settings from public, anon, authenticated;
revoke all on public.ai_business_policies from public, anon, authenticated;
revoke all on public.ai_assistant_requests from public, anon, authenticated;
grant select on public.ai_assistant_settings to authenticated;
grant select on public.ai_business_policies to authenticated;
grant select on public.ai_assistant_requests to authenticated;

create or replace function public.ai_get_assistant_access(p_business_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_settings public.ai_assistant_settings;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_settings
  from public.ai_assistant_settings
  where business_id = p_business_id;

  return jsonb_build_object(
    'allowed', true,
    'businessId', p_business_id,
    'businessName', (select name from public.businesses where id = p_business_id),
    'enabled', coalesce(v_settings.enabled, true),
    'supportedLanguages', coalesce(v_settings.supported_languages, array['en', 'rw', 'sw', 'fr']),
    'dailyRequestLimit', coalesce(v_settings.daily_request_limit, 100),
    'dailyTokenLimit', coalesce(v_settings.daily_token_limit, 200000),
    'maxOutputTokens', coalesce(v_settings.max_output_tokens, 700),
    'hasCustomPrompt', v_settings.system_prompt_extra is not null,
    'systemPromptExtra', v_settings.system_prompt_extra
  );
end;
$$;

create or replace function public.ai_upsert_assistant_settings(
  p_business_id uuid,
  p_enabled boolean default null,
  p_supported_languages text[] default null,
  p_daily_request_limit integer default null,
  p_daily_token_limit integer default null,
  p_max_output_tokens integer default null,
  p_system_prompt_extra text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can change AI assistant settings.'
      using errcode = '42501';
  end if;

  if p_supported_languages is not null
     and not p_supported_languages <@ array['en', 'rw', 'sw', 'fr'] then
    raise exception 'Unsupported assistant language.'
      using errcode = '22023';
  end if;

  insert into public.ai_assistant_settings (
    business_id,
    enabled,
    supported_languages,
    daily_request_limit,
    daily_token_limit,
    max_output_tokens,
    system_prompt_extra,
    updated_at
  )
  values (
    p_business_id,
    coalesce(p_enabled, true),
    coalesce(p_supported_languages, array['en', 'rw', 'sw', 'fr']),
    coalesce(p_daily_request_limit, 100),
    coalesce(p_daily_token_limit, 200000),
    coalesce(p_max_output_tokens, 700),
    nullif(btrim(p_system_prompt_extra), ''),
    now()
  )
  on conflict (business_id) do update set
    enabled = coalesce(p_enabled, public.ai_assistant_settings.enabled),
    supported_languages = coalesce(p_supported_languages, public.ai_assistant_settings.supported_languages),
    daily_request_limit = coalesce(p_daily_request_limit, public.ai_assistant_settings.daily_request_limit),
    daily_token_limit = coalesce(p_daily_token_limit, public.ai_assistant_settings.daily_token_limit),
    max_output_tokens = coalesce(p_max_output_tokens, public.ai_assistant_settings.max_output_tokens),
    system_prompt_extra = coalesce(nullif(btrim(p_system_prompt_extra), ''), public.ai_assistant_settings.system_prompt_extra),
    updated_at = now();

  return public.ai_get_assistant_access(p_business_id);
end;
$$;

create or replace function public.ai_upsert_business_policy(
  p_business_id uuid,
  p_category text,
  p_title text,
  p_content text,
  p_is_active boolean default true,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare
  v_policy_id uuid;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can manage business policies.'
      using errcode = '42501';
  end if;

  insert into public.ai_business_policies (
    business_id, category, title, content, is_active, sort_order
  )
  values (
    p_business_id,
    lower(btrim(p_category)),
    btrim(p_title),
    btrim(p_content),
    coalesce(p_is_active, true),
    coalesce(p_sort_order, 0)
  )
  returning id into v_policy_id;

  return jsonb_build_object('id', v_policy_id, 'saved', true);
end;
$$;

create or replace function public.ai_get_business_policies(p_business_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_policies jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'category', p.category,
        'title', p.title,
        'content', p.content,
        'sortOrder', p.sort_order
      )
      order by p.sort_order, p.created_at, p.id
    ),
    '[]'::jsonb
  )
  into v_policies
  from public.ai_business_policies p
  where p.business_id = p_business_id
    and p.is_active;

  return jsonb_build_object('policies', v_policies, 'totalCount', jsonb_array_length(v_policies));
end;
$$;

create or replace function public.ai_get_business_information(p_business_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_business public.businesses;
  v_store public.stores;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_store from public.stores where business_id = p_business_id;

  return jsonb_build_object(
    'found', true,
    'businessId', v_business.id,
    'businessName', v_business.name,
    'industry', v_business.industry,
    'country', v_business.country,
    'currency', v_business.currency,
    'timezone', v_business.timezone,
    'storeName', v_store.name,
    'storeDescription', v_store.description,
    'storeStatus', v_store.status,
    'contactEmail', case when coalesce(v_store.show_contact, false) then v_store.contact_email else null end,
    'contactPhone', case when coalesce(v_store.show_contact, false) then v_store.contact_phone else null end,
    'contactAddress', case when coalesce(v_store.show_contact, false) then v_store.contact_address else null end
  );
end;
$$;

create or replace function public.ai_search_products(
  p_business_id uuid,
  p_query text default '',
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
  v_price_text text;
  v_max_price numeric;
  v_terms text[];
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_price_text := (
    regexp_match(
      v_query,
      '(?:under|below|less than|cheaper than|at most|max)[^0-9]{0,12}([0-9][0-9,]*(?:\.[0-9]+)?)'
    )
  )[1];

  if v_price_text is not null then
    v_max_price := replace(v_price_text, ',', '')::numeric;
  end if;

  v_terms := array(
    select distinct token
    from regexp_split_to_table(v_query, '[^[:alnum:]]+') as token
    where length(token) > 2
      and token <> all(array[
        'the', 'and', 'for', 'with', 'under', 'below', 'less', 'than', 'show',
        'me', 'do', 'you', 'have', 'what', 'is', 'are', 'my', 'any', 'please',
        'can', 'get', 'about', 'much', 'cost', 'price', 'prices'
      ])
  );

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
    where p.business_id = p_business_id
      and p.status = 'active'
      and p.storefront_visible
      and (v_max_price is null or p.price <= v_max_price)

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
    where p.business_id = p_business_id
      and p.status = 'active'
      and p.storefront_visible
      and (v_max_price is null or coalesce(v.price_override, p.price) <= v_max_price)
  ),
  product_units as (
    select
      u.product_id,
      min(u.unit_price) as price,
      max(u.unit_price) as max_price,
      bool_or(u.variant_id is not null) as has_variants,
      bool_or(case when not u.is_tracked then true else u.available_quantity > 0 end) as is_available,
      bool_or(u.is_tracked) as has_tracked
    from units u
    group by u.product_id
  ),
  scored as (
    select
      p.id,
      p.name,
      p.description,
      p.sku,
      pu.price as effective_price,
      pu.max_price,
      pu.has_variants,
      pu.is_available,
      pu.has_tracked,
      p.currency,
      c.name as category_name,
      br.name as brand_name,
      (
        case when v_query = '' then 1 else 0 end
        + case when p.id::text = v_query then 30 else 0 end
        + case when p.name ilike '%' || v_query || '%' then 10 else 0 end
        + case when coalesce(p.sku, '') ilike '%' || v_query || '%' then 5 else 0 end
        + (
          select count(*) * 3
          from unnest(v_terms) as term
          where p.name ilike '%' || term || '%'
             or coalesce(p.description, '') ilike '%' || term || '%'
             or coalesce(p.sku, '') ilike '%' || term || '%'
             or coalesce(c.name, '') ilike '%' || term || '%'
             or coalesce(br.name, '') ilike '%' || term || '%'
             or exists (
               select 1
               from public.product_variants vv
               where vv.business_id = p.business_id
                 and vv.product_id = p.id
                 and vv.status = 'active'
                 and (vv.name ilike '%' || term || '%' or coalesce(vv.sku, '') ilike '%' || term || '%')
             )
             or exists (
               select 1
               from public.product_attribute_values pav
               where pav.business_id = p.business_id
                 and pav.product_id = p.id
                 and coalesce(pav.value_text, '') ilike '%' || term || '%'
             )
        )
      ) as score
    from product_units pu
    join public.products p
      on p.id = pu.product_id
     and p.business_id = p_business_id
    left join public.categories c
      on c.id = p.category_id
     and c.business_id = p.business_id
    left join public.brands br
      on br.id = p.brand_id
     and br.business_id = p.business_id
    where v_query = ''
       or v_query = p.id::text
       or p.name ilike '%' || v_query || '%'
       or coalesce(p.description, '') ilike '%' || v_query || '%'
       or coalesce(p.sku, '') ilike '%' || v_query || '%'
       or coalesce(c.name, '') ilike '%' || v_query || '%'
       or coalesce(br.name, '') ilike '%' || v_query || '%'
       or exists (
         select 1
         from unnest(v_terms) as term
         where p.name ilike '%' || term || '%'
            or coalesce(p.description, '') ilike '%' || term || '%'
            or coalesce(p.sku, '') ilike '%' || term || '%'
            or coalesce(c.name, '') ilike '%' || term || '%'
            or coalesce(br.name, '') ilike '%' || term || '%'
            or exists (
              select 1
              from public.product_variants vv
              where vv.business_id = p.business_id
                and vv.product_id = p.id
                and vv.status = 'active'
                and (vv.name ilike '%' || term || '%' or coalesce(vv.sku, '') ilike '%' || term || '%')
            )
            or exists (
              select 1
              from public.product_attribute_values pav
              where pav.business_id = p.business_id
                and pav.product_id = p.id
                and coalesce(pav.value_text, '') ilike '%' || term || '%'
            )
       )
  ),
  ranked as (
    select *
    from scored
    order by score desc, name asc, id asc
    limit v_limit
  )
  select jsonb_build_object(
    'products', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description,
            'sku', r.sku,
            'price', r.effective_price,
            'maxPrice', r.max_price,
            'priceFrom', r.max_price > r.effective_price,
            'currency', r.currency,
            'category', r.category_name,
            'brand', r.brand_name,
            'availability', case
              when not r.has_tracked then 'untracked'
              when r.is_available then 'in_stock'
              else 'out_of_stock'
            end,
            'variants', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', v.id,
                    'name', v.name,
                    'sku', v.sku,
                    'price', coalesce(v.price_override, r.effective_price),
                    'availability', case
                      when not coalesce(i.is_tracked, false) then 'untracked'
                      when i.available_quantity > 0 then 'in_stock'
                      else 'out_of_stock'
                    end,
                    'availableQuantity', case when coalesce(i.is_tracked, false) then i.available_quantity else null end
                  )
                  order by v.sort_order, v.name, v.id
                )
                from public.product_variants v
                left join public.inventory_items i
                  on i.business_id = v.business_id
                 and i.product_id = v.product_id
                 and i.variant_id = v.id
                where v.business_id = p_business_id
                  and v.product_id = r.id
                  and v.status = 'active'
              ),
              '[]'::jsonb
            ),
            'images', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'path', pi.storage_path,
                    'alt', pi.alt_text,
                    'isPrimary', pi.is_primary,
                    'sortOrder', pi.sort_order
                  )
                  order by pi.is_primary desc, pi.sort_order asc, pi.created_at asc
                )
                from public.product_images pi
                where pi.business_id = p_business_id
                  and pi.product_id = r.id
              ),
              '[]'::jsonb
            ),
            'attributes', coalesce(
              (
                select jsonb_object_agg(
                  pa.name,
                  coalesce(pav.value_text, pav.value_number::text, pav.value_boolean::text)
                )
                from public.product_attribute_values pav
                join public.product_attributes pa
                  on pa.id = pav.attribute_id
                 and pa.business_id = pav.business_id
                where pav.business_id = p_business_id
                  and pav.product_id = r.id
                  and pav.variant_id is null
              ),
              '{}'::jsonb
            ),
            'score', r.score
          )
          order by r.score desc, r.name asc, r.id asc
        )
        from ranked r
      ),
      '[]'::jsonb
    ),
    'totalCount', (select count(*) from scored),
    'query', v_query,
    'businessId', p_business_id,
    'maxPriceFilter', v_max_price
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.ai_get_product_details(
  p_business_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_product jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_result := public.ai_search_products(p_business_id, p_product_id::text, 20);

  select value
  into v_product
  from jsonb_array_elements(coalesce(v_result -> 'products', '[]'::jsonb)) as value
  where value ->> 'id' = p_product_id::text;

  if v_product is null then
    return jsonb_build_object('found', false, 'productId', p_product_id);
  end if;

  return jsonb_build_object('found', true, 'product', v_product);
end;
$$;

create or replace function public.ai_get_product_variants(
  p_business_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_result := public.ai_get_product_details(p_business_id, p_product_id);

  if not coalesce((v_result ->> 'found')::boolean, false) then
    return jsonb_build_object('found', false, 'productId', p_product_id, 'variants', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'found', true,
    'productId', p_product_id,
    'variants', coalesce(v_result -> 'product' -> 'variants', '[]'::jsonb)
  );
end;
$$;

create or replace function public.ai_check_product_availability(
  p_business_id uuid,
  p_product_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_details jsonb;
  v_product jsonb;
  v_variant jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_details := public.ai_get_product_details(p_business_id, p_product_id);

  if not coalesce((v_details ->> 'found')::boolean, false) then
    return jsonb_build_object('found', false, 'productId', p_product_id);
  end if;

  v_product := v_details -> 'product';

  if p_variant_id is null then
    return jsonb_build_object(
      'found', true,
      'productId', p_product_id,
      'variantId', null,
      'availability', v_product ->> 'availability',
      'verifiedAt', now()
    );
  end if;

  select value
  into v_variant
  from jsonb_array_elements(coalesce(v_product -> 'variants', '[]'::jsonb)) as value
  where value ->> 'id' = p_variant_id::text;

  if v_variant is null then
    return jsonb_build_object('found', false, 'productId', p_product_id, 'variantId', p_variant_id);
  end if;

  return jsonb_build_object(
    'found', true,
    'productId', p_product_id,
    'variantId', p_variant_id,
    'availability', v_variant ->> 'availability',
    'availableQuantity', v_variant -> 'availableQuantity',
    'verifiedAt', now()
  );
end;
$$;

create or replace function public.ai_get_customer_order_status(
  p_business_id uuid,
  p_order_number text,
  p_verification text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_verification_digits text;
  v_order_digits text;
  v_verified_amount numeric;
  v_refunded_amount numeric;
  v_failed_amount numeric;
  v_pending_amount numeric;
  v_payment_status text;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where business_id = p_business_id
    and upper(btrim(order_number)) = upper(btrim(coalesce(p_order_number, '')));

  if not found then
    return jsonb_build_object('found', false, 'reason', 'not_found');
  end if;

  if p_verification is not null and btrim(p_verification) <> '' then
    v_verification_digits := regexp_replace(lower(btrim(p_verification)), '[^0-9]', '', 'g');
    v_order_digits := regexp_replace(coalesce(v_order.customer_phone_snapshot, ''), '[^0-9]', '', 'g');

    if not (
      (v_verification_digits <> '' and v_verification_digits = v_order_digits)
      or lower(btrim(p_verification)) = lower(btrim(coalesce(v_order.customer_email_snapshot, '')))
    ) then
      return jsonb_build_object('found', false, 'reason', 'verification_failed');
    end if;
  end if;

  select
    coalesce(sum(amount) filter (where status = 'verified'), 0),
    coalesce(sum(amount) filter (where status = 'failed'), 0),
    coalesce(sum(amount) filter (where status = 'pending'), 0)
  into v_verified_amount, v_failed_amount, v_pending_amount
  from public.payments
  where business_id = p_business_id
    and order_id = v_order.id;

  select coalesce(sum(pr.amount), 0)
  into v_refunded_amount
  from public.payment_refunds pr
  join public.payments p
    on p.id = pr.payment_id
   and p.business_id = p_business_id
  where p.order_id = v_order.id
    and pr.status = 'completed';

  v_payment_status := public.derive_order_payment_status(
    v_order.total, v_verified_amount, v_refunded_amount, v_failed_amount, v_pending_amount
  );

  return jsonb_build_object(
    'found', true,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'paymentStatus', v_payment_status,
    'currency', v_order.currency,
    'total', v_order.total,
    'createdAt', v_order.created_at,
    'confirmedAt', v_order.confirmed_at,
    'completedAt', v_order.completed_at,
    'cancelledAt', v_order.cancelled_at,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', oi.name_snapshot,
            'quantity', oi.quantity,
            'lineTotal', oi.line_total
          )
          order by oi.created_at, oi.id
        )
        from public.order_items oi
        where oi.business_id = p_business_id
          and oi.order_id = v_order.id
      ),
      '[]'::jsonb
    ),
    'verifiedAt', now()
  );
end;
$$;

create or replace function public.ai_get_conversation_context(
  p_business_id uuid,
  p_conversation_id uuid,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
  v_handover boolean;
  v_messages jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_conversation
  from public.communication_conversations
  where id = p_conversation_id
    and business_id = p_business_id;

  if not found then
    return jsonb_build_object('found', false, 'conversationId', p_conversation_id);
  end if;

  v_handover := v_conversation.assigned_to is not null or v_conversation.status = 'assigned';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'role', case when page.direction = 'inbound' then 'user' else 'assistant' end,
        'content', page.text_content,
        'source', coalesce(page.metadata ->> 'source', page.message_type),
        'createdAt', page.created_at
      )
      order by page.created_at asc, page.id asc
    ),
    '[]'::jsonb
  )
  into v_messages
  from (
    select *
    from public.communication_messages
    where business_id = p_business_id
      and conversation_id = p_conversation_id
    order by created_at desc, id desc
    limit v_limit
  ) as page;

  return jsonb_build_object(
    'found', true,
    'conversationId', v_conversation.id,
    'channel', v_conversation.channel,
    'status', v_conversation.status,
    'assignedTo', v_conversation.assigned_to,
    'handoverActive', v_handover,
    'aiMayRespond', not v_handover
      and v_conversation.status not in ('resolved', 'archived'),
    'languagePreference', coalesce(v_conversation.metadata ->> 'language', ''),
    'messages', coalesce(v_messages, '[]'::jsonb)
  );
end;
$$;

create or replace function public.ai_ensure_test_conversation(p_business_id uuid)
returns uuid
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare
  v_external_id text;
  v_conversation_id uuid;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  v_external_id := 'ai-test:' || p_business_id::text || ':' || auth.uid()::text;

  insert into public.communication_conversations (
    business_id,
    channel,
    external_customer_id,
    external_customer_id_type,
    display_name,
    status,
    metadata
  )
  values (
    p_business_id,
    'ai_assistant',
    v_external_id,
    'ai_test_session',
    'AI Assistant Test',
    'open',
    jsonb_build_object('source', 'ai_dashboard_test')
  )
  on conflict (business_id, channel, external_customer_id) do update set
    updated_at = now()
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

create or replace function public.ai_record_assistant_turn(
  p_business_id uuid,
  p_conversation_id uuid,
  p_user_message text,
  p_assistant_message text,
  p_sources jsonb default '[]'::jsonb,
  p_usage jsonb default '{}'::jsonb,
  p_language text default 'en',
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_conversation
  from public.communication_conversations
  where id = p_conversation_id
    and business_id = p_business_id;

  if not found or v_conversation.channel <> 'ai_assistant' then
    raise exception 'The AI assistant conversation was not found.'
      using errcode = '22023';
  end if;

  if v_conversation.assigned_to is not null
     or v_conversation.status in ('assigned', 'resolved', 'archived') then
    raise exception 'AI responses are paused for this conversation.'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_user_message, ''))) not between 1 and 4000
     or char_length(btrim(coalesce(p_assistant_message, ''))) not between 1 and 8000 then
    raise exception 'The assistant turn contains invalid message content.'
      using errcode = '22023';
  end if;

  insert into public.communication_messages (
    business_id,
    conversation_id,
    direction,
    message_type,
    text_content,
    status,
    metadata,
    created_by,
    occurred_at
  )
  values (
    p_business_id,
    p_conversation_id,
    'inbound',
    'ai_prompt',
    btrim(p_user_message),
    'received',
    jsonb_build_object(
      'source', 'ai_assistant',
      'language', p_language,
      'requestId', p_request_id
    ),
    auth.uid(),
    now()
  )
  returning id into v_user_message_id;

  insert into public.communication_messages (
    business_id,
    conversation_id,
    direction,
    message_type,
    text_content,
    status,
    metadata,
    created_by,
    occurred_at
  )
  values (
    p_business_id,
    p_conversation_id,
    'outbound',
    'ai_answer',
    btrim(p_assistant_message),
    'sent',
    jsonb_build_object(
      'source', 'ai_assistant',
      'language', p_language,
      'requestId', p_request_id,
      'sources', coalesce(p_sources, '[]'::jsonb),
      'usage', coalesce(p_usage, '{}'::jsonb)
    ),
    auth.uid(),
    now()
  )
  returning id into v_assistant_message_id;

  update public.communication_conversations
  set
    last_incoming_at = now(),
    last_outgoing_at = now(),
    last_message_at = now(),
    unread_count = 0,
    updated_at = now()
  where id = p_conversation_id;

  insert into public.communication_audit_log (
    business_id, actor_id, action, entity_type, entity_id, details
  )
  values (
    p_business_id,
    auth.uid(),
    'ai_assistant_turn',
    'conversation',
    p_conversation_id,
    jsonb_build_object(
      'requestId', p_request_id,
      'language', p_language,
      'userMessageId', v_user_message_id,
      'assistantMessageId', v_assistant_message_id
    )
  );

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'userMessageId', v_user_message_id,
    'assistantMessageId', v_assistant_message_id
  );
end;
$$;

create or replace function public.ai_begin_assistant_request(
  p_business_id uuid,
  p_request_key text,
  p_input_chars integer,
  p_model text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare
  v_settings public.ai_assistant_settings;
  v_existing public.ai_assistant_requests;
  v_request_id uuid;
  v_used_requests integer;
  v_used_tokens bigint;
  v_request_limit integer;
  v_token_limit integer;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(p_request_key, ''))) not between 1 and 128 then
    raise exception 'Invalid AI request key.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':ai-usage:' || current_date::text, 0)
  );

  select * into v_existing
  from public.ai_assistant_requests
  where business_id = p_business_id
    and request_key = btrim(p_request_key);

  if found then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'duplicate',
      'requestId', v_existing.id,
      'status', v_existing.status,
      'response', v_existing.response
    );
  end if;

  select * into v_settings
  from public.ai_assistant_settings
  where business_id = p_business_id;

  if v_settings.business_id is not null and not v_settings.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;

  v_request_limit := coalesce(v_settings.daily_request_limit, 100);
  v_token_limit := coalesce(v_settings.daily_token_limit, 200000);

  select count(*), coalesce(sum(input_tokens + output_tokens), 0)
  into v_used_requests, v_used_tokens
  from public.ai_assistant_requests
  where business_id = p_business_id
    and created_at >= current_date
    and created_at < current_date + interval '1 day';

  if v_used_requests >= v_request_limit or v_used_tokens >= v_token_limit then
    insert into public.ai_assistant_requests (
      business_id, request_key, actor_id, provider, model, status, input_chars,
      error_code, error_message, completed_at
    )
    values (
      p_business_id, btrim(p_request_key), auth.uid(), p_provider, p_model,
      'rate_limited', p_input_chars, 'AI_RATE_LIMITED',
      'The workspace AI usage limit was reached.', now()
    );

    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'usedRequests', v_used_requests,
      'usedTokens', v_used_tokens,
      'dailyRequestLimit', v_request_limit,
      'dailyTokenLimit', v_token_limit
    );
  end if;

  insert into public.ai_assistant_requests (
    business_id, request_key, actor_id, provider, model, status, input_chars
  )
  values (
    p_business_id, btrim(p_request_key), auth.uid(), p_provider, p_model,
    'pending', p_input_chars
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'allowed', true,
    'requestId', v_request_id,
    'usedRequests', v_used_requests + 1,
    'usedTokens', v_used_tokens,
    'dailyRequestLimit', v_request_limit,
    'dailyTokenLimit', v_token_limit,
    'maxOutputTokens', coalesce(v_settings.max_output_tokens, 700)
  );
end;
$$;

create or replace function public.ai_complete_assistant_request(
  p_request_id uuid,
  p_status text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_estimated_cost_usd numeric default null,
  p_latency_ms integer default null,
  p_response jsonb default null,
  p_tools_used jsonb default '[]'::jsonb,
  p_language text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid AI request status.'
      using errcode = '22023';
  end if;

  update public.ai_assistant_requests
  set
    status = p_status,
    input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
    output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
    estimated_cost_usd = p_estimated_cost_usd,
    latency_ms = p_latency_ms,
    response = p_response,
    tools_used = coalesce(p_tools_used, '[]'::jsonb),
    language = p_language,
    error_code = p_error_code,
    error_message = left(coalesce(p_error_message, ''), 500),
    completed_at = now()
  where id = p_request_id;

  if not found then
    return jsonb_build_object('updated', false);
  end if;

  return jsonb_build_object('updated', true, 'requestId', p_request_id);
end;
$$;

create or replace function public.ai_get_assistant_request(
  p_business_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_request public.ai_assistant_requests;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_request
  from public.ai_assistant_requests
  where business_id = p_business_id
    and request_key = btrim(p_request_key);

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'id', v_request.id,
    'status', v_request.status,
    'provider', v_request.provider,
    'model', v_request.model,
    'inputTokens', v_request.input_tokens,
    'outputTokens', v_request.output_tokens,
    'estimatedCostUsd', v_request.estimated_cost_usd,
    'latencyMs', v_request.latency_ms,
    'errorCode', v_request.error_code,
    'createdAt', v_request.created_at,
    'completedAt', v_request.completed_at,
    'response', v_request.response
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
  where cc.code <> 'ai_assistant'
  order by cc.sort_order, cc.code;
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
      and c.channel <> 'ai_assistant'
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

revoke all on function public.ai_get_assistant_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_upsert_assistant_settings(uuid, boolean, text[], integer, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.ai_upsert_business_policy(uuid, text, text, text, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_business_policies(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_business_information(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_search_products(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_product_details(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_product_variants(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_check_product_availability(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_customer_order_status(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_conversation_context(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.ai_ensure_test_conversation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_record_assistant_turn(uuid, uuid, text, text, jsonb, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ai_begin_assistant_request(uuid, text, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ai_complete_assistant_request(uuid, text, integer, integer, numeric, integer, jsonb, jsonb, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ai_get_assistant_request(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.ai_get_assistant_access(uuid) to authenticated, service_role;
grant execute on function public.ai_upsert_assistant_settings(uuid, boolean, text[], integer, integer, integer, text) to authenticated, service_role;
grant execute on function public.ai_upsert_business_policy(uuid, text, text, text, boolean, integer) to authenticated, service_role;
grant execute on function public.ai_get_business_policies(uuid) to authenticated, service_role;
grant execute on function public.ai_get_business_information(uuid) to authenticated, service_role;
grant execute on function public.ai_search_products(uuid, text, integer) to authenticated, service_role;
grant execute on function public.ai_get_product_details(uuid, uuid) to authenticated, service_role;
grant execute on function public.ai_get_product_variants(uuid, uuid) to authenticated, service_role;
grant execute on function public.ai_check_product_availability(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.ai_get_customer_order_status(uuid, text, text) to authenticated, service_role;
grant execute on function public.ai_get_conversation_context(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.ai_ensure_test_conversation(uuid) to authenticated, service_role;
grant execute on function public.ai_record_assistant_turn(uuid, uuid, text, text, jsonb, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.ai_begin_assistant_request(uuid, text, integer, text, text) to authenticated, service_role;
grant execute on function public.ai_get_assistant_request(uuid, text) to authenticated, service_role;
grant execute on function public.ai_complete_assistant_request(uuid, text, integer, integer, numeric, integer, jsonb, jsonb, text, text, text) to service_role;
