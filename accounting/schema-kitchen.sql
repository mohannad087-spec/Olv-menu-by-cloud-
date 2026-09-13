alter table public.sales_entries add column if not exists order_type text;
alter table public.sales_entries add column if not exists kitchen_status text not null default 'قيد التحضير';
alter table public.sale_items add column if not exists note text;
alter table public.sale_items add column if not exists addons_summary text;

create index if not exists sales_entries_kitchen_status_idx on public.sales_entries (kitchen_status);

drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb);

create or replace function public.record_sale(
  p_entry_date date,
  p_cash numeric,
  p_card numeric,
  p_delivery numeric,
  p_notes text,
  p_items jsonb,
  p_order_type text default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_addon_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_product_name text;
  v_unit_price numeric;
  v_note text;
  v_addons_summary text;
begin
  insert into public.sales_entries (entry_date, cash_amount, card_amount, delivery_amount, notes, order_type, created_by)
  values (p_entry_date, p_cash, p_card, p_delivery, p_notes, p_order_type, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := v_item->>'note';

    select name, price into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، ') into v_addons_summary
    from public.addons
    where id in (
      select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    );

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary)
    values (v_sale_id, v_product_id, coalesce(v_product_name, 'غير معروف'), v_qty, coalesce(v_unit_price, 0), v_note, v_addons_summary);

    update public.ingredients i
    set current_stock = i.current_stock - (pi.quantity * v_qty)
    from public.product_ingredients pi
    where pi.product_id = v_product_id and pi.ingredient_id = i.id;

    for v_addon_id in select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    loop
      update public.ingredients i
      set current_stock = i.current_stock - (ai.quantity * v_qty)
      from public.addon_ingredients ai
      where ai.addon_id = v_addon_id and ai.ingredient_id = i.id;
    end loop;
  end loop;

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text) to authenticated;
