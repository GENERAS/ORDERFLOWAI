create or replace function public.reserve_storefront_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_order public.orders;
  locked_inventory record;
  item record;
  next_reserved integer;
begin
  select * into current_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.'
      using errcode = '22023';
  end if;

  for locked_inventory in
    select inv.id
    from public.inventory_items inv
    where inv.business_id = current_order.business_id
      and exists (
        select 1
        from public.order_items oi
        where oi.business_id = current_order.business_id
          and oi.order_id = p_order_id
          and oi.product_id = inv.product_id
          and oi.variant_id is not distinct from inv.variant_id
      )
    order by inv.id
    for update
  loop
    null;
  end loop;

  for item in
    select
      oi.id,
      oi.quantity,
      oi.product_id,
      oi.variant_id,
      inv.id as inventory_item_id,
      inv.is_tracked,
      inv.physical_quantity,
      inv.reserved_quantity,
      inv.available_quantity,
      p.name as product_name,
      v.name as variant_name,
      coalesce(v.sku, p.sku) as sku
    from public.order_items oi
    join public.products p
      on p.business_id = oi.business_id
     and p.id = oi.product_id
    left join public.product_variants v
      on v.business_id = oi.business_id
     and v.product_id = oi.product_id
     and v.id = oi.variant_id
    left join public.inventory_items inv
      on inv.business_id = oi.business_id
     and inv.product_id = oi.product_id
     and inv.variant_id is not distinct from oi.variant_id
    where oi.business_id = current_order.business_id
      and oi.order_id = p_order_id
    order by oi.created_at, oi.id
  loop
    if item.inventory_item_id is null or not item.is_tracked then
      continue;
    end if;

    if item.available_quantity < item.quantity then
      raise exception 'One or more items are no longer available in the requested quantity.'
        using errcode = '22023';
    end if;

    next_reserved := item.reserved_quantity + item.quantity;

    insert into public.stock_movements (
      business_id,
      inventory_item_id,
      product_id,
      variant_id,
      operation,
      quantity_change,
      previous_physical,
      new_physical,
      previous_reserved,
      new_reserved,
      reason,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      performed_by,
      performed_by_name,
      idempotency_key
    )
    values (
      current_order.business_id,
      item.inventory_item_id,
      item.product_id,
      item.variant_id,
      'reserve',
      item.quantity,
      item.physical_quantity,
      item.physical_quantity,
      item.reserved_quantity,
      next_reserved,
      'Online store order ' || current_order.order_number,
      item.product_name,
      item.variant_name,
      item.sku,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'Online storefront',
      'order:' || p_order_id::text || ':reserve:' || item.id::text
    );

    update public.inventory_items
    set reserved_quantity = next_reserved
    where id = item.inventory_item_id;

    update public.order_items
    set reserved_quantity = item.quantity
    where id = item.id;
  end loop;

  update public.orders
  set stock_state = 'reserved'
  where id = p_order_id;
end;
$$;
