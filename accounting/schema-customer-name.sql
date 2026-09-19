-- يضيف اسم الزبون لطلبات "صالة" و"سفري" (شاشة البيع السريع تفرضه
-- إجباريًا لهالنوعين قبل إتمام الطلب). record_sale بنفس التوقيع
-- القديم (بدون drop) — بس زدنا عليه معامل اختياري جديد بالآخر
-- (p_customer_name)، فما بيأثر على أي استدعاء قديم ما بيبعت هالمعامل.

alter table public.sales_entries add column if not exists customer_name text;

-- لازم نحذف التوقيع القديم صراحة (١١ معامل) قبل إنشاء الجديد (١٢ معامل)،
-- لأن بوستغرس بيعتبرهم دالتين مختلفتين (overload) حسب عدد/نوع المعاملات
-- مو نفس الدالة، فـ"create or replace" وحدها ما بتكفي لتستبدلها — وبقاء
-- الاتنين سوا بيسبب لبس عند نداء PostgREST
drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text);

create or replace function public.record_sale(
  p_entry_date date,
  p_cash numeric,
  p_card numeric,
  p_delivery numeric,
  p_notes text,
  p_items jsonb,
  p_order_type text default null,
  p_cash_received numeric default null,
  p_change_due numeric default null,
  p_table_number text default null,
  p_customer_phone text default null,
  p_customer_name text default null
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
  v_addons_total numeric;
begin
  insert into public.sales_entries (
    entry_date, cash_amount, card_amount, delivery_amount, notes, order_type,
    cash_received, change_due, table_number, customer_phone, customer_name, created_by
  )
  values (
    p_entry_date, p_cash, p_card, p_delivery, p_notes, p_order_type,
    p_cash_received, p_change_due, p_table_number, p_customer_phone, p_customer_name, auth.uid()
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := v_item->>'note';

    select name, price into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، '), coalesce(sum(price), 0)
    into v_addons_summary, v_addons_total
    from public.addons
    where id in (
      select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    );

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary, addons_total)
    values (v_sale_id, v_product_id, coalesce(v_product_name, 'غير معروف'), v_qty, coalesce(v_unit_price, 0), v_note, v_addons_summary, coalesce(v_addons_total, 0));

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

  insert into public.print_jobs (sale_id, job_type)
  values (v_sale_id, 'kitchen'), (v_sale_id, 'receipt');

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text, text) to authenticated;
