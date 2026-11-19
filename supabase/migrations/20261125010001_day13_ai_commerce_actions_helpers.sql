create or replace function public.is_uuid_like(p_value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_value, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

create or replace function public.ai_order_actor_role(p_business_id uuid)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      return 'service_role';
    end if;
    raise exception 'Sign in to prepare orders.'
      using errcode = '28000';
  end if;

  select m.role into v_role
  from public.business_members m
  where m.business_id = p_business_id
    and m.user_id = auth.uid();

  if v_role is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  return v_role;
end;
$$;

create or replace function public.ai_order_require_role(p_business_id uuid, p_roles text[])
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_role text := public.ai_order_actor_role(p_business_id);
begin
  if auth.uid() is null or not (v_role = any(p_roles)) then
    raise exception 'You do not have permission to perform this order action.'
      using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function public.ai_order_actor_name()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    return 'Channel message';
  end if;

  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(btrim(auth.jwt() ->> 'email'), ''),
    'Team member'
  )
  into v_name
  from public.profiles p
  where p.id = auth.uid();

  return coalesce(v_name, 'Team member');
end;
$$;

create or replace function public.ai_conversation_allows_ai(
  p_business_id uuid,
  p_conversation_id uuid
)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_conversation public.communication_conversations;
begin
  if p_conversation_id is null then
    return true;
  end if;

  select * into v_conversation
  from public.communication_conversations
  where business_id = p_business_id
    and id = p_conversation_id;

  if not found then
    raise exception 'The conversation could not be found.'
      using errcode = '22023';
  end if;

  return v_conversation.assigned_to is null
    and v_conversation.status not in ('assigned', 'resolved', 'archived');
end;
$$;

create or replace function public.ai_validate_order_idempotency_key(p_key text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
begin
  if char_length(v_key) not between 8 and 128 then
    raise exception 'A valid idempotency key is required.'
      using errcode = '22023';
  end if;
  return v_key;
end;
$$;

create or replace function public.ai_get_order_idempotency_result(p_business_id uuid, p_key text)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':ai-order-action:' || p_key, 0)
  );

  select result into v_result
  from public.ai_order_idempotency
  where business_id = p_business_id
    and idempotency_key = p_key;

  return v_result;
end;
$$;

create or replace function public.ai_store_order_idempotency_result(
  p_business_id uuid,
  p_key text,
  p_action text,
  p_result jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.ai_order_idempotency (
    business_id,
    idempotency_key,
    action,
    result
  )
  values (p_business_id, p_key, p_action, p_result)
  on conflict (business_id, idempotency_key) do nothing;
end;
$$;

create or replace function public.ai_log_order_action(
  p_business_id uuid,
  p_order_id uuid,
  p_quote_id uuid,
  p_conversation_id uuid,
  p_action text,
  p_source text,
  p_channel text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.ai_order_action_log (
    business_id,
    order_id,
    quote_id,
    conversation_id,
    action,
    actor_id,
    actor_name,
    actor_role,
    source,
    channel,
    details
  )
  values (
    p_business_id,
    p_order_id,
    p_quote_id,
    p_conversation_id,
    p_action,
    auth.uid(),
    public.ai_order_actor_name(),
    public.ai_order_actor_role(p_business_id),
    p_source,
    p_channel,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.ai_order_payment_status(
  p_business_id uuid,
  p_order_id uuid,
  p_order_total numeric
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_verified numeric;
  v_failed numeric;
  v_pending numeric;
  v_refunded numeric;
begin
  select
    coalesce(sum(amount) filter (where status = 'verified'), 0),
    coalesce(sum(amount) filter (where status = 'failed'), 0),
    coalesce(sum(amount) filter (where status = 'pending'), 0)
  into v_verified, v_failed, v_pending
  from public.payments
  where business_id = p_business_id
    and order_id = p_order_id;

  select coalesce(sum(pr.amount), 0)
  into v_refunded
  from public.payment_refunds pr
  join public.payments p
    on p.id = pr.payment_id
   and p.business_id = p_business_id
  where p.order_id = p_order_id
    and pr.status = 'completed';

  return public.derive_order_payment_status(
    p_order_total, v_verified, v_refunded, v_failed, v_pending
  );
end;
$$;

create or replace function public.ai_get_order_summary_data(p_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_quote public.ai_order_quotes;
begin
  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_order.business_id
    and order_id = p_order_id;

  select * into v_quote
  from public.ai_order_quotes
  where business_id = v_order.business_id
    and id = v_preparation.current_quote_id;

  return jsonb_build_object(
    'found', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'orderNumber', v_order.order_number,
      'businessId', v_order.business_id,
      'customerId', v_order.customer_id,
      'customerName', v_order.customer_name_snapshot,
      'customerPhone', v_order.customer_phone_snapshot,
      'customerEmail', v_order.customer_email_snapshot,
      'status', v_order.status,
      'stockState', v_order.stock_state,
      'currency', v_order.currency,
      'subtotal', v_order.subtotal,
      'discountAmount', v_order.discount_amount,
      'deliveryFee', v_order.delivery_fee,
      'taxAmount', v_order.tax_amount,
      'total', v_order.total,
      'deliveryMethod', v_order.delivery_method,
      'deliveryAddress', v_order.delivery_address,
      'deliveryInstructions', v_order.delivery_instructions,
      'notes', v_order.notes,
      'requiresReconfirmation', v_order.requires_reconfirmation,
      'customerConfirmedAt', v_order.customer_confirmed_at,
      'confirmedAt', v_order.confirmed_at,
      'createdAt', v_order.created_at,
      'source', v_order.source,
      'channel', v_order.channel,
      'conversationId', v_order.conversation_id
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', oi.id,
            'productId', oi.product_id,
            'variantId', oi.variant_id,
            'productName', oi.product_name_snapshot,
            'variantName', oi.variant_name_snapshot,
            'sku', oi.sku_snapshot,
            'unitPrice', oi.unit_price,
            'quantity', oi.quantity,
            'lineTotal', oi.line_total,
            'reservedQuantity', oi.reserved_quantity
          )
          order by oi.created_at, oi.id
        )
        from public.order_items oi
        where oi.business_id = v_order.business_id
          and oi.order_id = v_order.id
      ),
      '[]'::jsonb
    ),
    'quote', case
      when v_quote.id is null then null
      else jsonb_build_object(
        'id', v_quote.id,
        'version', v_quote.version,
        'status', v_quote.status,
        'currency', v_quote.currency,
        'subtotal', v_quote.subtotal,
        'discountAmount', v_quote.discount_amount,
        'deliveryFee', v_quote.delivery_fee,
        'taxAmount', v_quote.tax_amount,
        'total', v_quote.total,
        'createdAt', v_quote.created_at,
        'presentedAt', v_quote.presented_at,
        'expiresAt', v_quote.expires_at,
        'acceptedAt', v_quote.accepted_at
      )
    end,
    'quoteItems', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'productId', qi.product_id,
            'variantId', qi.variant_id,
            'productName', qi.product_name_snapshot,
            'variantName', qi.variant_name_snapshot,
            'sku', qi.sku_snapshot,
            'unitPrice', qi.unit_price,
            'quantity', qi.quantity,
            'lineTotal', qi.line_total,
            'availableQuantity', qi.available_quantity
          )
          order by qi.created_at, qi.id
        )
        from public.ai_order_quote_items qi
        where qi.business_id = v_quote.business_id
          and qi.quote_id = v_quote.id
      ),
      '[]'::jsonb
    ),
    'preparation', case
      when v_preparation.id is null then null
      else jsonb_build_object(
        'id', v_preparation.id,
        'status', v_preparation.status,
        'source', v_preparation.source,
        'channel', v_preparation.channel,
        'conversationId', v_preparation.conversation_id,
        'customerId', v_preparation.customer_id,
        'customerConfirmedAt', v_preparation.customer_confirmed_at,
        'confirmationSource', v_preparation.confirmation_source,
        'confirmationReference', v_preparation.confirmation_reference,
        'approvedBy', v_preparation.approved_by,
        'approvedAt', v_preparation.approved_at,
        'rejectedBy', v_preparation.rejected_by,
        'rejectedAt', v_preparation.rejected_at,
        'rejectionReason', v_preparation.rejection_reason,
        'clarificationReason', v_preparation.clarification_reason,
        'updatedAt', v_preparation.updated_at
      )
    end,
    'paymentStatus', public.ai_order_payment_status(
      v_order.business_id, v_order.id, v_order.total
    ),
    'verifiedAt', now()
  );
end;
$$;

create or replace function public.ai_validate_order_item_stock(
  p_business_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity integer
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory_items;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'Order item quantity must be between 1 and 100000.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_business_id::text || ':ai-stock:' || p_product_id::text || ':'
        || coalesce(p_variant_id::text, 'none'),
      0
    )
  );

  select * into v_inventory
  from public.inventory_items
  where business_id = p_business_id
    and product_id = p_product_id
    and variant_id is not distinct from p_variant_id;

  if not found or not v_inventory.is_tracked then
    return jsonb_build_object('tracked', false, 'available', true, 'availableQuantity', null);
  end if;

  if v_inventory.available_quantity < p_quantity then
    return jsonb_build_object(
      'tracked', true,
      'available', false,
      'availableQuantity', v_inventory.available_quantity,
      'requestedQuantity', p_quantity
    );
  end if;

  return jsonb_build_object(
    'tracked', true,
    'available', true,
    'availableQuantity', v_inventory.available_quantity
  );
end;
$$;

create or replace function public.ai_validate_order_items_input(p_items jsonb)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
begin
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 100 then
    raise exception 'Provide between 1 and 100 valid order items.'
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each order item must be an object.'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(v_item) as key
      where key not in ('product_id', 'variant_id', 'quantity')
    ) then
      raise exception 'Order items may only contain product_id, variant_id and quantity.'
        using errcode = '22023';
    end if;

    if not public.is_uuid_like(v_item ->> 'product_id') then
      raise exception 'Each order item needs a valid product_id.'
        using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(v_item ->> 'variant_id', '')), '') is not null
       and not public.is_uuid_like(v_item ->> 'variant_id') then
      raise exception 'Each order item variant_id must be a valid UUID.'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.ai_ensure_order_customer(
  p_business_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
  v_conversation public.communication_conversations;
  v_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_customer_phone, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_customer_email, '')), ''));
  v_phone_digits text;
begin
  if p_customer_id is not null then
    select * into v_customer
    from public.customers
    where business_id = p_business_id
      and id = p_customer_id;

    if not found then
      raise exception 'Choose a customer from this workspace.'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'customerId', v_customer.id,
      'name', v_customer.full_name,
      'phone', v_customer.phone,
      'email', v_customer.email,
      'reused', true
    );
  end if;

  if p_conversation_id is not null then
    select * into v_conversation
    from public.communication_conversations
    where business_id = p_business_id
      and id = p_conversation_id;

    if found and v_conversation.customer_id is not null then
      select * into v_customer
      from public.customers
      where business_id = p_business_id
        and id = v_conversation.customer_id;

      if found then
        return jsonb_build_object(
          'customerId', v_customer.id,
          'name', v_customer.full_name,
          'phone', v_customer.phone,
          'email', v_customer.email,
          'reused', true
        );
      end if;
    end if;

    if found and v_name is null then
      v_name := nullif(btrim(coalesce(v_conversation.display_name, '')), '');
    end if;
  end if;

  if v_email is not null
     and (char_length(v_email) not between 3 and 254 or position('@' in v_email) <= 1) then
    raise exception 'Enter a valid customer email address.'
      using errcode = '22023';
  end if;

  if v_phone is not null and char_length(v_phone) not between 7 and 32 then
    raise exception 'Enter a valid customer phone number.'
      using errcode = '22023';
  end if;

  if v_phone is null and v_email is null then
    if v_name is null or char_length(v_name) not between 1 and 160 then
      raise exception 'Provide a customer name before preparing an order.'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'customerId', null,
      'name', v_name,
      'phone', null,
      'email', null,
      'reused', false
    );
  end if;

  v_phone_digits := public.normalize_customer_phone_digits(v_phone);

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_business_id::text || ':ai-customer:' || coalesce(v_phone_digits, '') || ':' || coalesce(v_email, ''),
      0
    )
  );

  select * into v_customer
  from public.customers
  where business_id = p_business_id
    and (
      (v_phone_digits is not null and phone_normalized = v_phone_digits)
      or (v_email is not null and lower(btrim(email)) = v_email)
    )
  order by case when v_phone_digits is not null and phone_normalized = v_phone_digits then 0 else 1 end
  limit 1;

  if found then
    return jsonb_build_object(
      'customerId', v_customer.id,
      'name', v_customer.full_name,
      'phone', v_customer.phone,
      'email', v_customer.email,
      'reused', true
    );
  end if;

  v_name := coalesce(v_name, v_email, v_phone, 'Customer');

  insert into public.customers (
    business_id,
    full_name,
    phone,
    phone_normalized,
    email,
    status,
    created_by,
    updated_by
  )
  values (
    p_business_id,
    v_name,
    v_phone,
    v_phone_digits,
    v_email,
    'active',
    auth.uid(),
    auth.uid()
  )
  returning * into v_customer;

  return jsonb_build_object(
    'customerId', v_customer.id,
    'name', v_customer.full_name,
    'phone', v_customer.phone,
    'email', v_customer.email,
    'reused', false
  );
end;
$$;

create or replace function public.ai_refresh_draft_order_items(p_business_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items;
  v_product public.products;
  v_variant public.product_variants;
  v_price numeric(14, 2);
  v_available integer;
  v_tracked boolean;
  v_variant_name text;
  v_variant_sku text;
  v_items jsonb := '[]'::jsonb;
begin
  for v_item in
    select *
    from public.order_items
    where business_id = p_business_id
      and order_id = p_order_id
    order by created_at, id
    for update
  loop
    select * into v_product
    from public.products
    where business_id = p_business_id
      and id = v_item.product_id;

    if not found or v_product.status <> 'active' then
      raise exception 'A product in this draft is no longer available.'
        using errcode = '22023';
    end if;

    if v_item.variant_id is not null then
      select * into v_variant
      from public.product_variants
      where business_id = p_business_id
        and product_id = v_item.product_id
        and id = v_item.variant_id;

      if not found or v_variant.status <> 'active' then
        raise exception 'A variant in this draft is no longer available.'
          using errcode = '22023';
      end if;

      v_price := coalesce(v_variant.price_override, v_product.price);
    else
      if exists (
        select 1
        from public.product_variants
        where business_id = p_business_id
          and product_id = v_item.product_id
      ) then
        raise exception 'Choose a variant for a product in this draft.'
          using errcode = '22023';
      end if;

      v_price := v_product.price;
    end if;

    if v_price is null or v_price < 0 then
      raise exception 'A product in this draft does not have a valid price.'
        using errcode = '22023';
    end if;

    v_variant_name := case when v_item.variant_id is null then null else v_variant.name end;
    v_variant_sku := case when v_item.variant_id is null then v_product.sku else v_variant.sku end;

    v_available := null;
    v_tracked := false;

    select i.is_tracked, i.available_quantity
    into v_tracked, v_available
    from public.inventory_items i
    where i.business_id = p_business_id
      and i.product_id = v_item.product_id
      and i.variant_id is not distinct from v_item.variant_id;

    if found and v_tracked and coalesce(v_available, 0) < v_item.quantity then
      raise exception using
        message = format(
          'Only %s units are available for %s.',
          coalesce(v_available, 0),
          coalesce(v_item.variant_name_snapshot, v_item.product_name_snapshot)
        ),
        errcode = '22023';
    end if;

    update public.order_items oi
    set
      unit_price = v_price,
      product_name_snapshot = v_product.name,
      variant_name_snapshot = v_variant_name,
      sku_snapshot = v_variant_sku,
      updated_at = now()
    where oi.id = v_item.id;

    v_items := v_items || jsonb_build_object(
      'id', v_item.id,
      'productId', v_item.product_id,
      'variantId', v_item.variant_id,
      'productName', v_product.name,
      'variantName', v_variant_name,
      'sku', v_variant_sku,
      'unitPrice', v_price,
      'quantity', v_item.quantity,
      'lineTotal', round(v_price * v_item.quantity, 2),
      'availableQuantity', v_available
    );
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one item before creating a quote.'
      using errcode = '22023';
  end if;

  return v_items;
end;
$$;

create or replace function public.ai_sync_order_charges(p_order_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_settings public.ai_order_charge_settings;
  v_discount numeric(14, 2) := 0;
  v_delivery numeric(14, 2) := 0;
  v_tax numeric(14, 2) := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return;
  end if;

  select * into v_settings
  from public.ai_order_charge_settings
  where business_id = v_order.business_id;

  if found and v_settings.enabled then
    v_discount := least(v_order.subtotal, coalesce(v_settings.discount_amount, 0));
    v_delivery := coalesce(v_settings.delivery_fee, 0);
    v_tax := round((v_order.subtotal - v_discount) * coalesce(v_settings.tax_rate_bps, 0) / 10000.0, 2);
  end if;

  update public.orders
  set
    discount_amount = v_discount,
    delivery_fee = v_delivery,
    tax_amount = v_tax,
    total = greatest(0, subtotal - v_discount + v_delivery + v_tax),
    updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.ai_build_quote_preview(p_order_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_items jsonb;
begin
  v_items := public.ai_refresh_draft_order_items(
    (select business_id from public.orders where id = p_order_id),
    p_order_id
  );
  perform public.ai_sync_order_charges(p_order_id);

  select * into v_order
  from public.orders
  where id = p_order_id;

  return jsonb_build_object(
    'currency', v_order.currency,
    'subtotal', v_order.subtotal,
    'discountAmount', v_order.discount_amount,
    'deliveryFee', v_order.delivery_fee,
    'taxAmount', v_order.tax_amount,
    'total', v_order.total,
    'items', v_items
  );
end;
$$;

create or replace function public.ai_create_order_quote(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key text,
  p_present boolean default false
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_preview jsonb;
  v_version integer;
  v_quote_id uuid;
  v_quote_key text;
begin
  select * into v_order
  from public.orders
  where business_id = p_business_id
    and id = p_order_id;

  if not found then
    raise exception 'The order draft could not be found.'
      using errcode = '22023';
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = p_business_id
    and order_id = p_order_id;

  if not found then
    raise exception 'The AI order draft could not be found.'
      using errcode = '22023';
  end if;

  if v_preparation.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'This order draft is no longer open.'
      using errcode = '22023';
  end if;

  if v_order.stock_state <> 'none' then
    raise exception 'Stock has already been changed for this order.'
      using errcode = '22023';
  end if;

  v_preview := public.ai_build_quote_preview(p_order_id);

  update public.ai_order_quotes
  set status = 'superseded', superseded_at = now()
  where business_id = p_business_id
    and order_id = p_order_id
    and status in ('draft', 'presented', 'expired');

  select coalesce(max(version), 0) + 1 into v_version
  from public.ai_order_quotes
  where business_id = p_business_id
    and order_id = p_order_id;

  v_quote_key := public.ai_validate_order_idempotency_key(p_idempotency_key)
    || ':quote:' || v_version::text;

  insert into public.ai_order_quotes (
    business_id,
    order_id,
    conversation_id,
    channel,
    customer_id,
    version,
    status,
    currency,
    subtotal,
    discount_amount,
    delivery_fee,
    tax_amount,
    total,
    idempotency_key,
    presented_at,
    expires_at
  )
  values (
    p_business_id,
    p_order_id,
    v_preparation.conversation_id,
    v_preparation.channel,
    v_order.customer_id,
    v_version,
    case when p_present then 'presented' else 'draft' end,
    v_order.currency,
    (v_preview ->> 'subtotal')::numeric,
    (v_preview ->> 'discountAmount')::numeric,
    (v_preview ->> 'deliveryFee')::numeric,
    (v_preview ->> 'taxAmount')::numeric,
    (v_preview ->> 'total')::numeric,
    v_quote_key,
    case when p_present then now() else null end,
    case when p_present then now() + interval '30 minutes' else null end
  )
  returning id into v_quote_id;

  insert into public.ai_order_quote_items (
    business_id,
    quote_id,
    product_id,
    variant_id,
    product_name_snapshot,
    variant_name_snapshot,
    sku_snapshot,
    unit_price,
    quantity,
    line_total,
    available_quantity
  )
  select
    p_business_id,
    v_quote_id,
    (item ->> 'productId')::uuid,
    nullif(item ->> 'variantId', '')::uuid,
    item ->> 'productName',
    item ->> 'variantName',
    item ->> 'sku',
    (item ->> 'unitPrice')::numeric,
    (item ->> 'quantity')::integer,
    (item ->> 'lineTotal')::numeric,
    (item ->> 'availableQuantity')::integer
  from jsonb_array_elements(v_preview -> 'items') as item;

  update public.ai_order_preparations
  set
    current_quote_id = v_quote_id,
    status = case when p_present then 'awaiting_customer_confirmation' else status end,
    updated_at = now()
  where business_id = p_business_id
    and order_id = p_order_id;

  if p_present then
    update public.orders
    set status = 'awaiting_confirmation', updated_at = now()
    where business_id = p_business_id
      and id = p_order_id;

    insert into public.order_events (
      business_id,
      order_id,
      event_type,
      summary,
      details,
      actor_id,
      actor_name
    )
    values (
      p_business_id,
      p_order_id,
      'quote_presented',
      'Order quote version ' || v_version::text || ' was presented for customer review.',
      jsonb_build_object(
        'quoteId', v_quote_id,
        'version', v_version,
        'total', (v_preview ->> 'total')::numeric,
        'currency', v_order.currency
      ),
      auth.uid(),
      public.ai_order_actor_name()
    );
  end if;

  return public.ai_get_order_summary_data(p_order_id);
end;
$$;

create or replace function public.ai_is_explicit_confirmation(p_text text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_text text := lower(
    regexp_replace(coalesce(p_text, ''), '[^a-z0-9 ]', ' ', 'g')
  );
begin
  v_text := btrim(regexp_replace(v_text, '\s+', ' ', 'g'));

  if v_text = '' or char_length(v_text) > 500 then
    return false;
  end if;

  if v_text ~ '(^| )(no|not|dont|don t|never|cancel|stop|hold|wait|maybe|perhaps|probably|possibly|might|unsure|unclear|deliberate|thinking|later|tomorrow|ask me again|tell me more|more info|more information|interested|considering)( |$)' then
    return false;
  end if;

  if v_text ~ '(^| )(confirm|confirmed|place|submit|proceed|order it|buy it|go ahead|yes|yeah|yep|sure|ok|okay|do it|approved)( |$)' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.ai_quote_is_stale(p_quote_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_quote public.ai_order_quotes;
  v_preview jsonb;
  v_snapshot jsonb;
  v_current jsonb;
  v_quote_count integer;
  v_current_count integer;
begin
  select * into v_quote
  from public.ai_order_quotes
  where id = p_quote_id;

  if not found then
    return true;
  end if;

  v_preview := public.ai_build_quote_preview(v_quote.order_id);

  if (v_preview ->> 'currency') is distinct from v_quote.currency
     or (v_preview ->> 'subtotal')::numeric is distinct from v_quote.subtotal
     or (v_preview ->> 'discountAmount')::numeric is distinct from v_quote.discount_amount
     or (v_preview ->> 'deliveryFee')::numeric is distinct from v_quote.delivery_fee
     or (v_preview ->> 'taxAmount')::numeric is distinct from v_quote.tax_amount
     or (v_preview ->> 'total')::numeric is distinct from v_quote.total then
    return true;
  end if;

  select count(*) into v_quote_count
  from public.ai_order_quote_items
  where business_id = v_quote.business_id
    and quote_id = v_quote.id;

  select jsonb_array_length(v_preview -> 'items') into v_current_count;

  if v_quote_count <> v_current_count then
    return true;
  end if;

  for v_snapshot in
    select jsonb_build_object(
      'productId', qi.product_id,
      'variantId', qi.variant_id,
      'unitPrice', qi.unit_price,
      'quantity', qi.quantity,
      'availableQuantity', qi.available_quantity
    )
    from public.ai_order_quote_items qi
    where qi.business_id = v_quote.business_id
      and qi.quote_id = v_quote.id
  loop
    select item into v_current
    from jsonb_array_elements(v_preview -> 'items') as item
    where (item ->> 'productId')::uuid = (v_snapshot ->> 'productId')::uuid
      and nullif(item ->> 'variantId', '')::uuid is not distinct from nullif(v_snapshot ->> 'variantId', '')::uuid;

    if not found
       or (v_current ->> 'unitPrice')::numeric is distinct from (v_snapshot ->> 'unitPrice')::numeric
       or (v_current ->> 'quantity')::integer is distinct from (v_snapshot ->> 'quantity')::integer
       or (v_current ->> 'availableQuantity')::integer is distinct from (v_snapshot ->> 'availableQuantity')::integer then
      return true;
    end if;
  end loop;

  return false;
end;
$$;
