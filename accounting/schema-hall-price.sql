-- سعر صالة للصنف (hall_price): لو الطلب «صالة» والصنف إله hall_price بينباع بهالسعر، وغير هيك بالسعر العادي (price = السفري/التوصيل).
-- نفس فكرة hallPrice بمنيو الزبائن. السيرفر (record_sale) هو اللي بيحسب، وشاشات البيع بتعرض نفس القاعدة.
-- شغّله بعد schema-sale-overpay-guard.sql (آخر تعديل على record_sale).
alter table public.products add column if not exists hall_price numeric check (hall_price is null or hall_price > 0);

-- المشروبات الغازية: سفري 0.25 (price) وصالة 0.50
update public.products set hall_price = 0.5
where external_id in ('soft-pepsi','soft-pepsi-diet','soft-7up','soft-mirinda','soft-mountain-dew','soft-schweppes');

create or replace function public.record_sale(
  p_entry_date date, p_cash numeric, p_card numeric, p_delivery numeric, p_notes text, p_items jsonb,
  p_client_ref uuid, p_order_type text default null, p_cash_received numeric default null,
  p_change_due numeric default null, p_table_number text default null, p_customer_phone text default null,
  p_customer_name text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := public.auth_role();
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
  v_addons_found int;
  v_addons_wanted int;
  v_total numeric;
  v_expected numeric := 0;
  v_paid numeric;
  v_discount numeric;
  v_max_pct numeric;
  v_change numeric;
  v_hall boolean := (btrim(coalesce(p_order_type, '')) = 'صالة');
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;

  -- نفس العملية وصلت قبل (إعادة إرسال بعد انقطاع النت): منرجّع البيع الموجود بدل ما يتكرر
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
    select id into v_sale_id from public.sales_entries where client_ref = p_client_ref;
    if v_sale_id is not null then
      return v_sale_id;
    end if;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'الطلب فاضي';
  end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_card, 0) < 0 or coalesce(p_delivery, 0) < 0 then
    raise exception 'مبلغ غير صالح';
  end if;
  if v_role = 'staff' and (
       p_entry_date is null or p_entry_date < current_date - 2 or p_entry_date > current_date + 1
     ) then
    raise exception 'تاريخ البيع خارج المسموح للكاشير';
  end if;

  -- مرور أول: تحقق وحساب المجموع الحقيقي من أسعار قاعدة البيانات
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 200 then
      raise exception 'كمية غير صالحة';
    end if;
    select case when v_hall and hall_price > 0 then hall_price else price end into v_unit_price
    from public.products where id = v_product_id;
    if not found then
      raise exception 'صنف غير موجود بقائمة المنتجات';
    end if;
    select coalesce(sum(price), 0), count(*) into v_addons_total, v_addons_found
    from public.addons
    where id in (select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid);
    select count(distinct x) into v_addons_wanted
    from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) x;
    if v_addons_found <> v_addons_wanted then
      raise exception 'إضافة غير موجودة';
    end if;
    v_expected := v_expected + (coalesce(v_unit_price, 0) + v_addons_total) * v_qty;
  end loop;

  v_paid := coalesce(p_cash, 0) + coalesce(p_card, 0) + coalesce(p_delivery, 0);
  if v_paid > v_expected * 2 + 0.01 then
    raise exception 'المبلغ المدفوع (%) أكبر بكثير من قيمة الطلب (%) — تأكد من المبلغ', round(v_paid, 2), round(v_expected, 2);
  end if;
  v_discount := greatest(round(v_expected - v_paid, 2), 0);
  if v_discount < 0.02 then v_discount := 0; end if;

  if v_discount > 0 and v_role = 'staff' then
    v_max_pct := public.app_setting_num('staff_max_discount_percent', 10);
    if v_discount > round(v_expected * v_max_pct / 100, 2) + 0.01 then
      raise exception 'الخصم يتعدى الحد المسموح للكاشير (% %%) — يحتاج موافقة مدير', v_max_pct;
    end if;
  end if;

  v_change := case
    when p_cash_received is not null and coalesce(p_cash, 0) > 0 then greatest(p_cash_received - p_cash, 0)
    else p_change_due
  end;

  insert into public.sales_entries (
    entry_date, cash_amount, card_amount, delivery_amount, notes, order_type,
    cash_received, change_due, table_number, customer_phone, customer_name, created_by,
    discount_amount, client_ref
  )
  values (
    p_entry_date, p_cash, p_card, p_delivery, left(p_notes, 1000), left(p_order_type, 60),
    p_cash_received, v_change, left(p_table_number, 30), left(p_customer_phone, 30),
    left(p_customer_name, 120), auth.uid(), v_discount, p_client_ref
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := left(v_item->>'note', 300);

    select name, case when v_hall and hall_price > 0 then hall_price else price end
    into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، '), coalesce(sum(price), 0)
    into v_addons_summary, v_addons_total
    from public.addons
    where id in (
      select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    );

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary, addons_total, addon_ids)
    values (v_sale_id, v_product_id, v_product_name, v_qty, v_unit_price, v_note, v_addons_summary, coalesce(v_addons_total, 0),
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) x));

    update public.ingredients i
    set current_stock = i.current_stock - (pi.quantity * v_qty)
    from public.product_ingredients pi
    where pi.product_id = v_product_id and pi.ingredient_id = i.id;

    -- distinct: نفس الإضافة مكررة بالطلب ما بتنحسب بالسعر مرتين، فما لازم تنزل من المخزون مرتين
    for v_addon_id in select distinct (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    loop
      update public.ingredients i
      set current_stock = i.current_stock - (ai.quantity * v_qty)
      from public.addon_ingredients ai
      where ai.addon_id = v_addon_id and ai.ingredient_id = i.id;
    end loop;
  end loop;

  insert into public.print_jobs (sale_id, job_type)
  values (v_sale_id, 'kitchen'), (v_sale_id, 'receipt');

  v_total := v_paid;
  perform public._loyalty_apply(p_customer_phone, p_customer_name, 1, v_total, floor(v_total)::integer);

  return v_sale_id;
end;
$function$;

revoke execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, uuid, text, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, uuid, text, numeric, numeric, text, text, text) to authenticated;
