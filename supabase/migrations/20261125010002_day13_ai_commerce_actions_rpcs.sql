create or replace function public.ai_get_order_charge_settings(p_business_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_settings public.ai_order_charge_settings;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this workspace.'
      using errcode = '42501';
  end if;

  select * into v_settings
  from public.ai_order_charge_settings
  where business_id = p_business_id;

  if not found then
    return jsonb_build_object(
      'found', false,
      'enabled', false,
      'deliveryFee', 0,
      'taxRateBps', 0,
      'discountAmount', 0
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'enabled', v_settings.enabled,
    'deliveryFee', v_settings.delivery_fee,
    'taxRateBps', v_settings.tax_rate_bps,
    'discountAmount', v_settings.discount_amount,
    'updatedAt', v_settings.updated_at
  );
end;
$$;

create or replace function public.ai_upsert_order_charge_settings(
  p_business_id uuid,
  p_enabled boolean,
  p_delivery_fee numeric default 0,
  p_tax_rate_bps integer default 0,
  p_discount_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ai_order_require_role(p_business_id, array['owner', 'admin']);

  if p_delivery_fee is null or p_delivery_fee < 0 or p_delivery_fee > 1000000 then
    raise exception 'Enter a valid delivery fee.'
      using errcode = '22023';
  end if;

  if p_tax_rate_bps is null or p_tax_rate_bps < 0 or p_tax_rate_bps > 2000 then
    raise exception 'Enter a valid tax rate.'
      using errcode = '22023';
  end if;

  if p_discount_amount is null or p_discount_amount < 0 or p_discount_amount > 1000000 then
    raise exception 'Enter a valid discount amount.'
      using errcode = '22023';
  end if;

  insert into public.ai_order_charge_settings (
    business_id,
    enabled,
    delivery_fee,
    tax_rate_bps,
    discount_amount,
    updated_at,
    updated_by
  )
  values (
    p_business_id,
    coalesce(p_enabled, false),
    p_delivery_fee,
    p_tax_rate_bps,
    p_discount_amount,
    now(),
    auth.uid()
  )
  on conflict (business_id) do update set
    enabled = excluded.enabled,
    delivery_fee = excluded.delivery_fee,
    tax_rate_bps = excluded.tax_rate_bps,
    discount_amount = excluded.discount_amount,
    updated_at = now(),
    updated_by = auth.uid();

  return public.ai_get_order_charge_settings(p_business_id);
end;
$$;

create or replace function public.get_customer_information(
  p_business_id uuid,
  p_customer_id uuid default null,
  p_phone text default null,
  p_email text default null,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
  v_conversation public.communication_conversations;
  v_phone_digits text;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  perform public.ai_order_actor_role(p_business_id);

  if p_conversation_id is not null and not public.ai_conversation_allows_ai(p_business_id, p_conversation_id) then
    return jsonb_build_object('found', false, 'reason', 'human_handover');
  end if;

  if p_customer_id is not null then
    select * into v_customer
    from public.customers
    where business_id = p_business_id
      and id = p_customer_id;

    if not found then
      return jsonb_build_object('found', false, 'reason', 'not_found');
    end if;
  else
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
      end if;
    end if;

    if v_customer.id is null then
      v_phone_digits := public.normalize_customer_phone_digits(p_phone);

      select * into v_customer
      from public.customers
      where business_id = p_business_id
        and (
          (v_phone_digits is not null and phone_normalized = v_phone_digits)
          or (v_email is not null and lower(btrim(email)) = v_email)
        )
      order by case when v_phone_digits is not null and phone_normalized = v_phone_digits then 0 else 1 end
      limit 1;
    end if;
  end if;

  if v_customer.id is null then
    return jsonb_build_object('found', false, 'reason', 'identity_not_verified');
  end if;

  return jsonb_build_object(
    'found', true,
    'customerId', v_customer.id,
    'name', v_customer.full_name,
    'phone', v_customer.phone,
    'email', v_customer.email,
    'status', v_customer.status,
    'verifiedBy', case
      when p_customer_id is not null then 'customer_id'
      when v_phone_digits is not null and v_customer.phone_normalized = v_phone_digits then 'phone'
      when v_email is not null and lower(btrim(v_customer.email)) = v_email then 'email'
      else 'conversation'
    end
  );
end;
$$;

create or replace function public.prepare_order_draft(
  p_business_id uuid,
  p_conversation_id uuid default null,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_items jsonb default '[]'::jsonb,
  p_delivery_method text default null,
  p_delivery_address text default null,
  p_delivery_instructions text default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_cached jsonb := public.ai_get_order_idempotency_result(p_business_id, v_key);
  v_role text;
  v_conversation public.communication_conversations;
  v_channel text := 'web_chat';
  v_customer jsonb;
  v_currency text;
  v_order_id uuid;
  v_order public.orders;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_stock jsonb;
  v_normalized_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  v_role := public.ai_order_actor_role(p_business_id);

  if p_conversation_id is not null then
    select * into v_conversation
    from public.communication_conversations
    where business_id = p_business_id
      and id = p_conversation_id;

    if not found then
      raise exception 'The conversation could not be found.'
        using errcode = '22023';
    end if;

    if not public.ai_conversation_allows_ai(p_business_id, p_conversation_id) then
      raise exception 'Human handover is active for this conversation.'
        using errcode = '42501';
    end if;

    v_channel := v_conversation.channel;
  end if;

  perform public.ai_validate_order_items_input(p_items);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(btrim(coalesce(v_item ->> 'variant_id', '')), '')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    v_stock := public.ai_validate_order_item_stock(
      p_business_id, v_product_id, v_variant_id, v_quantity
    );

    if not coalesce((v_stock ->> 'available')::boolean, false) then
      raise exception using
        message = format(
          'Only %s units are available for one of the selected items.',
          coalesce(v_stock ->> 'availableQuantity', '0')
        ),
        errcode = '22023';
    end if;
  end loop;

  if v_normalized_notes is not null and char_length(v_normalized_notes) > 2000 then
    raise exception 'Order notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  v_customer := public.ai_ensure_order_customer(
    p_business_id,
    p_customer_id,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_conversation_id
  );

  select b.currency into v_currency
  from public.businesses b
  where b.id = p_business_id;

  if v_currency is null then
    raise exception 'The business currency could not be found.'
      using errcode = '22023';
  end if;

  insert into public.orders (
    business_id,
    order_number,
    customer_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    customer_email_snapshot,
    status,
    currency,
    notes,
    source,
    channel,
    conversation_id,
    delivery_method,
    delivery_address,
    delivery_instructions,
    created_by,
    updated_by
  )
  values (
    p_business_id,
    public.next_order_number(p_business_id),
    nullif(v_customer ->> 'customerId', '')::uuid,
    v_customer ->> 'name',
    nullif(v_customer ->> 'phone', ''),
    nullif(v_customer ->> 'email', ''),
    'draft',
    v_currency,
    v_normalized_notes,
    'ai_assistant',
    v_channel,
    p_conversation_id,
    nullif(btrim(coalesce(p_delivery_method, '')), ''),
    nullif(btrim(coalesce(p_delivery_address, '')), ''),
    nullif(btrim(coalesce(p_delivery_instructions, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    perform public.create_order_item_record(
      p_business_id,
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      nullif(btrim(coalesce(v_item ->> 'variant_id', '')), '')::uuid,
      (v_item ->> 'quantity')::integer
    );
  end loop;

  insert into public.ai_order_preparations (
    business_id,
    order_id,
    conversation_id,
    channel,
    customer_id,
    source,
    status
  )
  values (
    p_business_id,
    v_order_id,
    p_conversation_id,
    v_channel,
    nullif(v_customer ->> 'customerId', '')::uuid,
    'ai_assistant',
    'preparing'
  );

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
    v_order_id,
    'order_prepared',
    'AI assistant prepared an order draft for customer review.',
    jsonb_build_object(
      'source', 'ai_assistant',
      'channel', v_channel,
      'conversationId', p_conversation_id,
      'actorRole', v_role
    ),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(v_order_id) || jsonb_build_object(
    'action', 'prepare_order_draft',
    'orderNumber', v_order.order_number,
    'customerReused', coalesce((v_customer ->> 'reused')::boolean, false)
  );

  perform public.ai_log_order_action(
    p_business_id,
    v_order_id,
    null,
    p_conversation_id,
    'prepare_order_draft',
    'ai_assistant',
    v_channel,
    jsonb_build_object('idempotencyKey', v_key, 'itemCount', jsonb_array_length(p_items))
  );

  perform public.ai_store_order_idempotency_result(p_business_id, v_key, 'prepare_order_draft', v_result);
  return v_result;
end;
$$;

create or replace function public.update_order_draft(
  p_order_id uuid,
  p_items jsonb default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_delivery_method text default null,
  p_delivery_address text default null,
  p_delivery_instructions text default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_stock jsonb;
  v_result jsonb;
  v_normalized_notes text;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'The order draft could not be found.'
      using errcode = '22023';
  end if;

  perform public.ai_order_actor_role(v_order.business_id);

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_order.business_id
    and order_id = p_order_id;

  if not found then
    raise exception 'The AI order draft could not be found.'
      using errcode = '22023';
  end if;

  if v_preparation.status not in (
    'preparing',
    'awaiting_customer_confirmation',
    'customer_confirmed',
    'awaiting_business_approval',
    'clarification_requested'
  ) then
    raise exception 'This order draft is no longer open.'
      using errcode = '22023';
  end if;

  if v_order.stock_state <> 'none'
     or v_order.status in ('confirmed', 'processing', 'ready', 'completed', 'cancelled') then
    raise exception 'This order can no longer be changed.'
      using errcode = '22023';
  end if;

  if not public.ai_conversation_allows_ai(v_order.business_id, v_preparation.conversation_id) then
    raise exception 'Human handover is active for this conversation.'
      using errcode = '42501';
  end if;

  if p_items is not null then
    perform public.ai_validate_order_items_input(p_items);

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_variant_id := nullif(btrim(coalesce(v_item ->> 'variant_id', '')), '')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;

      v_stock := public.ai_validate_order_item_stock(
        v_order.business_id, v_product_id, v_variant_id, v_quantity
      );

      if not coalesce((v_stock ->> 'available')::boolean, false) then
        raise exception using
          message = format(
            'Only %s units are available for one of the selected items.',
            coalesce(v_stock ->> 'availableQuantity', '0')
          ),
          errcode = '22023';
      end if;
    end loop;

    delete from public.order_items
    where business_id = v_order.business_id
      and order_id = p_order_id;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      perform public.create_order_item_record(
        v_order.business_id,
        p_order_id,
        (v_item ->> 'product_id')::uuid,
        nullif(btrim(coalesce(v_item ->> 'variant_id', '')), '')::uuid,
        (v_item ->> 'quantity')::integer
      );
    end loop;
  end if;

  v_normalized_notes := nullif(btrim(coalesce(p_notes, v_order.notes, '')), '');

  if v_normalized_notes is not null and char_length(v_normalized_notes) > 2000 then
    raise exception 'Order notes must be 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  update public.orders
  set
    customer_name_snapshot = coalesce(
      nullif(btrim(coalesce(p_customer_name, '')), ''), customer_name_snapshot
    ),
    customer_phone_snapshot = coalesce(
      nullif(btrim(coalesce(p_customer_phone, '')), ''), customer_phone_snapshot
    ),
    customer_email_snapshot = coalesce(
      lower(nullif(btrim(coalesce(p_customer_email, '')), '')), customer_email_snapshot
    ),
    delivery_method = coalesce(nullif(btrim(coalesce(p_delivery_method, '')), ''), delivery_method),
    delivery_address = coalesce(nullif(btrim(coalesce(p_delivery_address, '')), ''), delivery_address),
    delivery_instructions = coalesce(nullif(btrim(coalesce(p_delivery_instructions, '')), ''), delivery_instructions),
    notes = v_normalized_notes,
    status = 'draft',
    customer_confirmed_at = null,
    requires_reconfirmation = false,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_order_id;

  update public.ai_order_quotes
  set status = 'superseded', superseded_at = now()
  where business_id = v_order.business_id
    and order_id = p_order_id
    and status in ('draft', 'presented', 'accepted', 'expired');

  update public.ai_order_preparations
  set
    status = 'preparing',
    customer_confirmed_at = null,
    confirmation_source = null,
    confirmation_reference = null,
    confirmed_quote_id = null,
    clarification_reason = null,
    updated_at = now()
  where business_id = v_order.business_id
    and order_id = p_order_id;

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
    v_order.business_id,
    p_order_id,
    'quote_revised',
    'Order draft changed and must be reconfirmed by the customer.',
    jsonb_build_object('idempotencyKey', v_key),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
    'action', 'update_order_draft',
    'requiresReconfirmation', true
  );

  perform public.ai_log_order_action(
    v_order.business_id,
    p_order_id,
    null,
    v_preparation.conversation_id,
    'update_order_draft',
    'ai_assistant',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key)
  );

  perform public.ai_store_order_idempotency_result(
    v_order.business_id, v_key, 'update_order_draft', v_result
  );
  return v_result;
end;
$$;

create or replace function public.calculate_order_quote(
  p_order_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'The order draft could not be found.'
      using errcode = '22023';
  end if;

  perform public.ai_order_actor_role(v_order.business_id);

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_order.business_id
    and order_id = p_order_id;

  if not found or v_preparation.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'This order draft is no longer open.'
      using errcode = '22023';
  end if;

  if not public.ai_conversation_allows_ai(v_order.business_id, v_preparation.conversation_id) then
    raise exception 'Human handover is active for this conversation.'
      using errcode = '42501';
  end if;

  v_result := public.ai_create_order_quote(v_order.business_id, p_order_id, v_key, false)
    || jsonb_build_object('action', 'calculate_order_quote');

  perform public.ai_log_order_action(
    v_order.business_id,
    p_order_id,
    null,
    v_preparation.conversation_id,
    'calculate_order_quote',
    'ai_assistant',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key)
  );

  perform public.ai_store_order_idempotency_result(
    v_order.business_id, v_key, 'calculate_order_quote', v_result
  );
  return v_result;
end;
$$;

create or replace function public.request_customer_confirmation(
  p_order_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'The order draft could not be found.'
      using errcode = '22023';
  end if;

  perform public.ai_order_actor_role(v_order.business_id);

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_order.business_id
    and order_id = p_order_id;

  if not found
     or v_preparation.status in ('approved', 'rejected', 'cancelled', 'awaiting_business_approval') then
    raise exception 'This order draft is not ready for customer confirmation.'
      using errcode = '22023';
  end if;

  if not public.ai_conversation_allows_ai(v_order.business_id, v_preparation.conversation_id) then
    raise exception 'Human handover is active for this conversation.'
      using errcode = '42501';
  end if;

  v_result := public.ai_create_order_quote(v_order.business_id, p_order_id, v_key, true)
    || jsonb_build_object(
      'action', 'request_customer_confirmation',
      'reviewRequired', true,
      'approvalRequired', true
    );

  perform public.ai_log_order_action(
    v_order.business_id,
    p_order_id,
    null,
    v_preparation.conversation_id,
    'request_customer_confirmation',
    'ai_assistant',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key)
  );

  perform public.ai_store_order_idempotency_result(
    v_order.business_id, v_key, 'request_customer_confirmation', v_result
  );
  return v_result;
end;
$$;

create or replace function public.get_order_summary(p_order_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_result jsonb;
begin
  perform public.ai_order_actor_role(v_business_id);
  v_result := public.ai_get_order_summary_data(p_order_id);

  if not coalesce((v_result ->> 'found')::boolean, false) then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  return v_result || jsonb_build_object('action', 'get_order_summary');
end;
$$;

create or replace function public.submit_confirmed_order_for_business_approval(
  p_order_id uuid,
  p_confirmation_text text,
  p_confirmation_source text default 'chat_message',
  p_confirmation_reference text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_quote public.ai_order_quotes;
  v_source text := nullif(btrim(coalesce(p_confirmation_source, '')), '');
  v_reference text := nullif(btrim(coalesce(p_confirmation_reference, '')), '');
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'The order draft could not be found.'
      using errcode = '22023';
  end if;

  perform public.ai_order_actor_role(v_order.business_id);

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_order.business_id
    and order_id = p_order_id;

  if not found then
    raise exception 'The AI order draft could not be found.'
      using errcode = '22023';
  end if;

  if v_preparation.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'This order draft is no longer open.'
      using errcode = '22023';
  end if;

  if not public.ai_conversation_allows_ai(v_order.business_id, v_preparation.conversation_id) then
    raise exception 'Human handover is active for this conversation.'
      using errcode = '42501';
  end if;

  v_source := coalesce(v_source, 'chat_message');

  if char_length(v_source) > 40
     or char_length(coalesce(v_reference, '')) > 160
     or char_length(coalesce(p_confirmation_text, '')) > 500 then
    raise exception 'The confirmation details are too long.'
      using errcode = '22023';
  end if;

  if not public.ai_is_explicit_confirmation(p_confirmation_text) then
    v_result := jsonb_build_object(
      'accepted', false,
      'action', 'submit_confirmed_order_for_business_approval',
      'reason', 'explicit_confirmation_required',
      'requiresClarification', true,
      'message', 'Ask the customer for an explicit confirmation of this exact quote before submitting it.'
    );

    perform public.ai_log_order_action(
      v_order.business_id,
      p_order_id,
      v_preparation.current_quote_id,
      v_preparation.conversation_id,
      'customer_confirmation_rejected',
      'channel_message',
      v_source,
      jsonb_build_object('confirmationSource', v_source)
    );
  else
    select * into v_quote
    from public.ai_order_quotes
    where business_id = v_order.business_id
      and id = v_preparation.current_quote_id;

    if not found or v_quote.status not in ('presented', 'accepted', 'expired') then
      raise exception 'Present a quote for customer confirmation before submitting the order.'
        using errcode = '22023';
    end if;

    if public.ai_quote_is_stale(v_quote.id) then
      update public.ai_order_quotes
      set status = 'expired', superseded_at = now()
      where business_id = v_order.business_id
        and id = v_quote.id;

      update public.orders
      set status = 'awaiting_confirmation', requires_reconfirmation = true, updated_at = now()
      where id = p_order_id;

      update public.ai_order_preparations
      set status = 'awaiting_customer_confirmation', updated_at = now()
      where business_id = v_order.business_id
        and order_id = p_order_id;

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
        v_order.business_id,
        p_order_id,
        'customer_reconfirmation_required',
        'Price or availability changed before customer confirmation; a new quote must be presented.',
        jsonb_build_object('previousQuoteId', v_quote.id, 'version', v_quote.version),
        auth.uid(),
        public.ai_order_actor_name()
      );

      v_result := public.ai_create_order_quote(
        v_order.business_id,
        p_order_id,
        v_key || ':reconfirm',
        true
      ) || jsonb_build_object(
        'accepted', false,
        'action', 'submit_confirmed_order_for_business_approval',
        'reason', 'quote_changed',
        'requiresReconfirmation', true,
        'message', 'Price or availability changed. Present the new quote and request explicit customer confirmation again.'
      );
    else
      update public.ai_order_quotes
      set status = 'accepted', accepted_at = now()
      where business_id = v_order.business_id
        and id = v_quote.id;

      update public.orders
      set
        status = 'awaiting_business_approval',
        customer_confirmed_at = now(),
        requires_reconfirmation = false,
        updated_by = auth.uid(),
        updated_at = now()
      where id = p_order_id;

      update public.ai_order_preparations
      set
        status = 'customer_confirmed',
        customer_confirmed_at = now(),
        confirmation_source = v_source,
        confirmation_reference = v_reference,
        confirmed_quote_id = v_quote.id,
        updated_at = now()
      where business_id = v_order.business_id
        and order_id = p_order_id;

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
        v_order.business_id,
        p_order_id,
        'customer_confirmed',
        'Customer explicitly confirmed the presented order quote.',
        jsonb_build_object(
          'quoteId', v_quote.id,
          'version', v_quote.version,
          'confirmationSource', v_source,
          'confirmationReference', v_reference,
          'total', v_quote.total
        ),
        auth.uid(),
        public.ai_order_actor_name()
      );

      v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
        'accepted', true,
        'action', 'submit_confirmed_order_for_business_approval',
        'approvalRequired', true,
        'stockReserved', false,
        'message', 'Customer confirmation recorded. The order is waiting for business approval; no stock has been reserved.'
      );
    end if;

    perform public.ai_log_order_action(
      v_order.business_id,
      p_order_id,
      v_preparation.current_quote_id,
      v_preparation.conversation_id,
      'submit_confirmed_order_for_business_approval',
      'channel_message',
      v_source,
      jsonb_build_object('idempotencyKey', v_key, 'accepted', coalesce((v_result ->> 'accepted')::boolean, false))
    );
  end if;

  perform public.ai_store_order_idempotency_result(
    v_order.business_id,
    v_key,
    'submit_confirmed_order_for_business_approval',
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.approve_prepared_order(
  p_order_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_quote public.ai_order_quotes;
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.ai_order_require_role(v_business_id, array['owner', 'admin', 'manager']);

  select * into v_order
  from public.orders
  where business_id = v_business_id
    and id = p_order_id;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_business_id
    and order_id = p_order_id;

  if not found or v_preparation.status <> 'customer_confirmed' then
    raise exception 'Only customer-confirmed AI order drafts can be approved.'
      using errcode = '22023';
  end if;

  if v_order.status <> 'awaiting_business_approval' or v_order.stock_state <> 'none' then
    raise exception 'This order is not ready for business approval.'
      using errcode = '22023';
  end if;

  select * into v_quote
  from public.ai_order_quotes
  where business_id = v_business_id
    and id = v_preparation.confirmed_quote_id;

  if not found or v_quote.status <> 'accepted' then
    raise exception 'The confirmed quote could not be verified.'
      using errcode = '22023';
  end if;

  if public.ai_quote_is_stale(v_quote.id) then
    raise exception 'Price or availability changed after customer confirmation; request reconfirmation before approval.'
      using errcode = '22023';
  end if;

  perform public.update_order_status(p_order_id, 'confirmed');

  update public.ai_order_preparations
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where business_id = v_business_id
    and order_id = p_order_id;

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
    v_business_id,
    p_order_id,
    'business_approved',
    'Business approved the AI-prepared order and reserved stock.',
    jsonb_build_object('quoteId', v_quote.id, 'version', v_quote.version),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
    'action', 'approve_prepared_order',
    'approved', true,
    'stockReserved', true,
    'message', 'Order approved through the existing lifecycle; stock was reserved by the backend.'
  );

  perform public.ai_log_order_action(
    v_business_id,
    p_order_id,
    v_quote.id,
    v_preparation.conversation_id,
    'approve_prepared_order',
    'business_dashboard',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key)
  );

  perform public.ai_store_order_idempotency_result(v_business_id, v_key, 'approve_prepared_order', v_result);
  return v_result;
end;
$$;

create or replace function public.reject_prepared_order(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.ai_order_require_role(v_business_id, array['owner', 'admin', 'manager']);

  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Add a rejection reason between 3 and 500 characters.'
      using errcode = '22023';
  end if;

  select * into v_order
  from public.orders
  where business_id = v_business_id
    and id = p_order_id;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_business_id
    and order_id = p_order_id;

  if not found
     or v_preparation.status not in ('customer_confirmed', 'awaiting_business_approval') then
    raise exception 'Only customer-confirmed AI order drafts can be rejected.'
      using errcode = '22023';
  end if;

  perform public.cancel_order(p_order_id, v_reason);

  update public.ai_order_preparations
  set
    status = 'rejected',
    rejected_by = auth.uid(),
    rejected_at = now(),
    rejection_reason = v_reason,
    updated_at = now()
  where business_id = v_business_id
    and order_id = p_order_id;

  update public.ai_order_quotes
  set status = 'cancelled', cancelled_at = now()
  where business_id = v_business_id
    and order_id = p_order_id
    and status in ('draft', 'presented', 'accepted', 'expired');

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
    v_business_id,
    p_order_id,
    'business_rejected',
    'Business rejected the AI-prepared order.',
    jsonb_build_object('reason', v_reason),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
    'action', 'reject_prepared_order',
    'rejected', true,
    'reason', v_reason,
    'message', 'Order rejected through the existing cancellation path; no approval was granted.'
  );

  perform public.ai_log_order_action(
    v_business_id,
    p_order_id,
    v_preparation.current_quote_id,
    v_preparation.conversation_id,
    'reject_prepared_order',
    'business_dashboard',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key, 'reason', v_reason)
  );

  perform public.ai_store_order_idempotency_result(v_business_id, v_key, 'reject_prepared_order', v_result);
  return v_result;
end;
$$;

create or replace function public.request_order_clarification(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.ai_order_actor_role(v_business_id);

  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'Add a clarification reason between 3 and 500 characters.'
      using errcode = '22023';
  end if;

  select * into v_order
  from public.orders
  where business_id = v_business_id
    and id = p_order_id;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_business_id
    and order_id = p_order_id;

  if not found
     or v_preparation.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'This order draft is no longer open.'
      using errcode = '22023';
  end if;

  if not public.ai_conversation_allows_ai(v_business_id, v_preparation.conversation_id) then
    raise exception 'Human handover is active for this conversation.'
      using errcode = '42501';
  end if;

  update public.orders
  set status = 'draft', requires_reconfirmation = true, updated_by = auth.uid(), updated_at = now()
  where business_id = v_business_id
    and id = p_order_id;

  update public.ai_order_quotes
  set status = 'superseded', superseded_at = now()
  where business_id = v_business_id
    and order_id = p_order_id
    and status in ('draft', 'presented', 'accepted', 'expired');

  update public.ai_order_preparations
  set
    status = 'clarification_requested',
    clarification_reason = v_reason,
    updated_at = now()
  where business_id = v_business_id
    and order_id = p_order_id;

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
    v_business_id,
    p_order_id,
    'clarification_requested',
    'Customer clarification requested before order approval.',
    jsonb_build_object('reason', v_reason),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
    'action', 'request_order_clarification',
    'reason', v_reason,
    'requiresReconfirmation', true,
    'message', 'Clarification recorded. Review the draft and present a fresh quote when ready.'
  );

  perform public.ai_log_order_action(
    v_business_id,
    p_order_id,
    v_preparation.current_quote_id,
    v_preparation.conversation_id,
    'request_order_clarification',
    'business_dashboard',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key, 'reason', v_reason)
  );

  perform public.ai_store_order_idempotency_result(
    v_business_id, v_key, 'request_order_clarification', v_result
  );
  return v_result;
end;
$$;

create or replace function public.cancel_order_draft(
  p_order_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.ai_validate_order_idempotency_key(p_idempotency_key);
  v_business_id uuid := (select business_id from public.orders where id = p_order_id);
  v_cached jsonb := public.ai_get_order_idempotency_result(v_business_id, v_key);
  v_order public.orders;
  v_preparation public.ai_order_preparations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), 'Cancelled before business approval.');
  v_result jsonb;
begin
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.ai_order_actor_role(v_business_id);

  select * into v_order
  from public.orders
  where business_id = v_business_id
    and id = p_order_id;

  if not found then
    raise exception 'The order could not be found.'
      using errcode = '22023';
  end if;

  select * into v_preparation
  from public.ai_order_preparations
  where business_id = v_business_id
    and order_id = p_order_id;

  if not found then
    raise exception 'The AI order draft could not be found.'
      using errcode = '22023';
  end if;

  if v_preparation.status in ('approved', 'rejected', 'cancelled') then
    raise exception 'This order draft is already closed.'
      using errcode = '22023';
  end if;

  if v_order.status in ('confirmed', 'processing', 'ready', 'completed') then
    raise exception 'Use the existing order cancellation workflow for this order.'
      using errcode = '22023';
  end if;

  if char_length(coalesce(v_reason, '')) not between 3 and 500 then
    raise exception 'Add a cancellation reason between 3 and 500 characters.'
      using errcode = '22023';
  end if;

  perform public.cancel_order(p_order_id, v_reason);

  update public.ai_order_preparations
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where business_id = v_business_id
    and order_id = p_order_id;

  update public.ai_order_quotes
  set status = 'cancelled', cancelled_at = now()
  where business_id = v_business_id
    and order_id = p_order_id
    and status in ('draft', 'presented', 'accepted', 'expired');

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
    v_business_id,
    p_order_id,
    'customer_cancelled',
    'Order draft cancelled before business approval.',
    jsonb_build_object('reason', v_reason),
    auth.uid(),
    public.ai_order_actor_name()
  );

  v_result := public.ai_get_order_summary_data(p_order_id) || jsonb_build_object(
    'action', 'cancel_order_draft',
    'cancelled', true,
    'reason', v_reason,
    'message', 'Order draft cancelled; no approval or stock reservation occurred.'
  );

  perform public.ai_log_order_action(
    v_business_id,
    p_order_id,
    v_preparation.current_quote_id,
    v_preparation.conversation_id,
    'cancel_order_draft',
    'ai_assistant',
    v_preparation.channel,
    jsonb_build_object('idempotencyKey', v_key, 'reason', v_reason)
  );

  perform public.ai_store_order_idempotency_result(v_business_id, v_key, 'cancel_order_draft', v_result);
  return v_result;
end;
$$;

create or replace function public.ai_search_order_preparations(
  p_business_id uuid,
  p_search text default null,
  p_status text default null,
  p_customer_id uuid default null,
  p_conversation_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.ai_order_actor_role(p_business_id);

  if p_status is not null
     and p_status not in (
       'preparing', 'awaiting_customer_confirmation', 'customer_confirmed',
       'awaiting_business_approval', 'clarification_requested', 'approved',
       'rejected', 'cancelled'
     ) then
    raise exception 'Choose a valid AI order preparation status.'
      using errcode = '22023';
  end if;

  with matching as (
    select
      p.*,
      o.order_number,
      o.status as order_status,
      o.total,
      o.currency,
      q.version as quote_version
    from public.ai_order_preparations p
    join public.orders o
      on o.business_id = p.business_id
     and o.id = p.order_id
    left join public.ai_order_quotes q
      on q.business_id = p.business_id
     and q.id = p.current_quote_id
    where p.business_id = p_business_id
      and (p_status is null or p.status = p_status)
      and (p_customer_id is null or p.customer_id = p_customer_id)
      and (p_conversation_id is null or p.conversation_id = p_conversation_id)
      and (
        v_search is null
        or lower(o.order_number) like '%' || v_search || '%'
        or lower(coalesce(o.customer_name_snapshot, '')) like '%' || v_search || '%'
        or lower(coalesce(o.notes, '')) like '%' || v_search || '%'
      )
  ),
  filtered as (
    select *
    from matching
    order by updated_at desc, id desc
    limit v_limit offset v_offset
  )
  select
    (select count(*) from matching),
    jsonb_agg(
      jsonb_build_object(
        'preparationId', f.id,
        'orderId', f.order_id,
        'orderNumber', f.order_number,
        'status', f.status,
        'orderStatus', f.order_status,
        'channel', f.channel,
        'conversationId', f.conversation_id,
        'customerId', f.customer_id,
        'quoteVersion', f.quote_version,
        'currency', f.currency,
        'total', f.total,
        'customerConfirmedAt', f.customer_confirmed_at,
        'updatedAt', f.updated_at
      ) order by f.updated_at desc, f.id desc
    )
  into v_total, v_items
  from filtered f;

  return jsonb_build_object(
    'found', true,
    'action', 'ai_search_order_preparations',
    'count', coalesce(v_total, 0),
    'hasMore', v_offset + coalesce(jsonb_array_length(v_items), 0) < coalesce(v_total, 0),
    'items', coalesce(v_items, '[]'::jsonb)
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
            'name', oi.product_name_snapshot,
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

grant execute on function public.is_uuid_like(text) to authenticated, service_role;
grant execute on function public.ai_order_actor_role(uuid) to authenticated, service_role;
grant execute on function public.ai_order_require_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.ai_order_actor_name() to authenticated, service_role;
grant execute on function public.ai_conversation_allows_ai(uuid, uuid) to authenticated, service_role;
grant execute on function public.ai_validate_order_idempotency_key(text) to authenticated, service_role;
grant execute on function public.ai_get_order_idempotency_result(uuid, text) to authenticated, service_role;
grant execute on function public.ai_store_order_idempotency_result(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.ai_log_order_action(uuid, uuid, uuid, uuid, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.ai_order_payment_status(uuid, uuid, numeric) to authenticated, service_role;
grant execute on function public.ai_get_order_summary_data(uuid) to authenticated, service_role;
grant execute on function public.ai_validate_order_item_stock(uuid, uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.ai_validate_order_items_input(jsonb) to authenticated, service_role;
grant execute on function public.ai_ensure_order_customer(uuid, uuid, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.ai_refresh_draft_order_items(uuid, uuid) to authenticated, service_role;
grant execute on function public.ai_sync_order_charges(uuid) to authenticated, service_role;
grant execute on function public.ai_build_quote_preview(uuid) to authenticated, service_role;
grant execute on function public.ai_create_order_quote(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.ai_is_explicit_confirmation(text) to authenticated, service_role;
grant execute on function public.ai_quote_is_stale(uuid) to authenticated, service_role;

grant execute on function public.ai_get_order_charge_settings(uuid) to authenticated, service_role;
grant execute on function public.ai_upsert_order_charge_settings(uuid, boolean, numeric, integer, numeric) to authenticated, service_role;
grant execute on function public.get_customer_information(uuid, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.prepare_order_draft(uuid, uuid, uuid, text, text, text, jsonb, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.update_order_draft(uuid, jsonb, text, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.calculate_order_quote(uuid, text) to authenticated, service_role;
grant execute on function public.request_customer_confirmation(uuid, text) to authenticated, service_role;
grant execute on function public.get_order_summary(uuid) to authenticated, service_role;
grant execute on function public.submit_confirmed_order_for_business_approval(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.approve_prepared_order(uuid, text) to authenticated, service_role;
grant execute on function public.reject_prepared_order(uuid, text, text) to authenticated, service_role;
grant execute on function public.request_order_clarification(uuid, text, text) to authenticated, service_role;
grant execute on function public.cancel_order_draft(uuid, text, text) to authenticated, service_role;
grant execute on function public.ai_search_order_preparations(uuid, text, text, uuid, uuid, integer, integer) to authenticated, service_role;
