-- Fixes an ambiguous PL/pgSQL variable name in update_product.

create or replace function public.update_product(
  p_product_id uuid,
  p_name text,
  p_description text default null,
  p_category_id uuid default null,
  p_brand_id uuid default null,
  p_sku text default null,
  p_barcode text default null,
  p_price numeric default 0,
  p_status text default 'draft',
  p_attributes jsonb default '[]'::jsonb,
  p_variants jsonb default '[]'::jsonb
)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_product public.products;
  current_variant public.product_variants;
  attribute_item jsonb;
  variant_item jsonb;
  target_variant_id uuid;
  processed_variant_ids uuid[] := '{}';
  normalized_name text := nullif(btrim(p_name), '');
  normalized_status text := coalesce(nullif(btrim(p_status), ''), 'draft');
begin
  select * into current_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found or you do not have access to it.'
      using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 200 then
    raise exception 'Product name must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'Product price cannot be negative.'
      using errcode = '22023';
  end if;

  if normalized_status not in ('draft', 'active', 'archived') then
    raise exception 'Product status is not valid.'
      using errcode = '22023';
  end if;

  update public.products
  set
    category_id = p_category_id,
    brand_id = p_brand_id,
    name = normalized_name,
    description = nullif(btrim(p_description), ''),
    status = normalized_status,
    sku = nullif(upper(btrim(p_sku)), ''),
    barcode = nullif(upper(btrim(p_barcode)), ''),
    price = p_price
  where id = p_product_id
  returning * into current_product;

  delete from public.product_attribute_values
  where business_id = current_product.business_id
    and product_id = current_product.id
    and variant_id is null;

  for attribute_item in
    select value from jsonb_array_elements(coalesce(p_attributes, '[]'::jsonb))
  loop
    insert into public.product_attribute_values (
      business_id,
      product_id,
      variant_id,
      attribute_id,
      option_id,
      value_text,
      value_number,
      value_boolean
    )
    values (
      current_product.business_id,
      current_product.id,
      null,
      (attribute_item ->> 'attribute_id')::uuid,
      nullif(attribute_item ->> 'option_id', '')::uuid,
      nullif(attribute_item ->> 'value_text', ''),
      nullif(attribute_item ->> 'value_number', '')::numeric,
      case
        when attribute_item ? 'value_boolean'
          and attribute_item ->> 'value_boolean' <> ''
        then (attribute_item ->> 'value_boolean')::boolean
        else null
      end
    );
  end loop;

  for variant_item in
    select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
  loop
    target_variant_id := nullif(variant_item ->> 'id', '')::uuid;

    if target_variant_id is not null then
      select * into current_variant
      from public.product_variants
      where id = target_variant_id
        and business_id = current_product.business_id
        and product_id = current_product.id
      for update;

      if not found then
        raise exception 'Variant not found for this product.'
          using errcode = '42501';
      end if;

      update public.product_variants
      set
        name = btrim(variant_item ->> 'name'),
        sku = nullif(upper(btrim(variant_item ->> 'sku')), ''),
        barcode = nullif(upper(btrim(variant_item ->> 'barcode')), ''),
        price_override = nullif(variant_item ->> 'price_override', '')::numeric,
        status = coalesce(nullif(btrim(variant_item ->> 'status'), ''), 'active'),
        sort_order = coalesce((variant_item ->> 'sort_order')::integer, 0)
      where id = target_variant_id
      returning * into current_variant;
    else
      insert into public.product_variants (
        business_id,
        product_id,
        name,
        sku,
        barcode,
        price_override,
        status,
        sort_order
      )
      values (
        current_product.business_id,
        current_product.id,
        btrim(variant_item ->> 'name'),
        nullif(upper(btrim(variant_item ->> 'sku')), ''),
        nullif(upper(btrim(variant_item ->> 'barcode')), ''),
        nullif(variant_item ->> 'price_override', '')::numeric,
        coalesce(nullif(btrim(variant_item ->> 'status'), ''), 'active'),
        coalesce((variant_item ->> 'sort_order')::integer, 0)
      )
      returning * into current_variant;

      target_variant_id := current_variant.id;
    end if;

    processed_variant_ids := array_append(
      processed_variant_ids,
      target_variant_id
    );

    delete from public.product_attribute_values
    where business_id = current_product.business_id
      and product_id = current_product.id
      and variant_id = target_variant_id;

    for attribute_item in
      select value
      from jsonb_array_elements(
        coalesce(variant_item -> 'attributes', '[]'::jsonb)
      )
    loop
      insert into public.product_attribute_values (
        business_id,
        product_id,
        variant_id,
        attribute_id,
        option_id,
        value_text,
        value_number,
        value_boolean
      )
      values (
        current_product.business_id,
        current_product.id,
        target_variant_id,
        (attribute_item ->> 'attribute_id')::uuid,
        nullif(attribute_item ->> 'option_id', '')::uuid,
        nullif(attribute_item ->> 'value_text', ''),
        nullif(attribute_item ->> 'value_number', '')::numeric,
        case
          when attribute_item ? 'value_boolean'
            and attribute_item ->> 'value_boolean' <> ''
          then (attribute_item ->> 'value_boolean')::boolean
          else null
        end
      );
    end loop;
  end loop;

  update public.product_variants
  set status = 'inactive'
  where business_id = current_product.business_id
    and product_id = current_product.id
    and status = 'active'
    and not (id = any(processed_variant_ids));

  return current_product;
end;
$$;

