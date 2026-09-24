-- برنامج ولاء بسيط للعملاء المتكررين: بيتعرّف على الزبون برقم هاتفه (نفس
-- الرقم المطلوب أصلًا لطلبات التوصيل)، وبيحسب له عدد زياراته، إجمالي
-- مصروفه، ونقاط ولاء (نقطة واحدة لكل وحدة عملة — يعني لو الفاتورة ١٢.٥٠
-- بياخد ١٢ نقطة، مبسّطة عمدًا بدون كسور).
--
-- التسجيل اختياري بالكامل: لو الكاشير ما دخل رقم هاتف، ما بينحفظ أي شي
-- بجدول customers، وباقي عملية البيع بتضل شغالة عادي بدون أي تأثير.
--
-- الإلغاء (سواء إلغاء طلب كامل أو صنف واحد منه) بيرجّع نفس عدد الزيارات/
-- المبلغ/النقاط يلي كانوا انحسبوا، حتى رصيد الزبون يضل مطابق فعليًا
-- لعمليات البيع المكتملة بس.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  visit_count integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  points_balance integer not null default 0,
  created_at timestamptz not null default now(),
  last_visit_at timestamptz
);

alter table public.customers enable row level security;
drop policy if exists customers_rw on public.customers;
create policy customers_rw on public.customers for all to authenticated using (true) with check (true);

-- دالة مساعدة داخلية مشتركة بين record_sale/void_sale/void_sale_item —
-- بتضيف أو ترجّع (بفرق سالب) زيارة/مبلغ/نقاط لزبون معيّن برقم هاتفه،
-- وبتنشئه تلقائيًا لو أول مرة. ما بتخلي أي رقم ينزل تحت صفر.
create or replace function public._loyalty_apply(
  p_phone text,
  p_name text,
  p_visit_delta integer,
  p_spent_delta numeric,
  p_points_delta integer
) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_phone is null or trim(p_phone) = '' then
    return;
  end if;

  insert into public.customers (phone, name, visit_count, total_spent, points_balance, last_visit_at)
  values (
    trim(p_phone),
    nullif(trim(coalesce(p_name, '')), ''),
    greatest(p_visit_delta, 0),
    greatest(p_spent_delta, 0),
    greatest(p_points_delta, 0),
    case when p_visit_delta > 0 then now() else null end
  )
  on conflict (phone) do update set
    name = coalesce(nullif(trim(coalesce(excluded.name, '')), ''), public.customers.name),
    visit_count = greatest(public.customers.visit_count + p_visit_delta, 0),
    total_spent = greatest(public.customers.total_spent + p_spent_delta, 0),
    points_balance = greatest(public.customers.points_balance + p_points_delta, 0),
    last_visit_at = case when p_visit_delta > 0 then now() else public.customers.last_visit_at end;
end;
$$;

-- record_sale بنفس توقيع schema-customer-name.sql بالضبط (بدون drop) —
-- فقط أضفنا نداء الولاء بالآخر قبل return
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
  v_total numeric;
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

  v_total := coalesce(p_cash, 0) + coalesce(p_card, 0) + coalesce(p_delivery, 0);
  perform public._loyalty_apply(p_customer_phone, p_customer_name, 1, v_total, floor(v_total)::integer);

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text, text) to authenticated;

-- void_sale بنفس منطقها الأصلي بالكامل (schema-void-sale.sql) — أضفنا
-- بس إرجاع الزيارة/المبلغ/النقاط للزبون (لو الطلب كان مرتبط برقم هاتف)
-- قبل ما نعلّم الطلب "ملغى"
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_item record;
  v_sale record;
begin
  select * into v_sale from public.sales_entries where id = p_sale_id;
  v_status := v_sale.status;
  if v_status is null then
    raise exception 'عملية البيع غير موجودة';
  end if;
  if v_status = 'voided' then
    raise exception 'هذه العملية ملغاة أصلًا';
  end if;

  for v_item in select product_id, qty from public.sale_items where sale_id = p_sale_id
  loop
    update public.ingredients i
    set current_stock = i.current_stock + (pi.quantity * v_item.qty)
    from public.product_ingredients pi
    where pi.product_id = v_item.product_id and pi.ingredient_id = i.id;
  end loop;

  update public.print_jobs set status = 'skipped'
  where sale_id = p_sale_id and status = 'pending';

  update public.sales_entries
  set status = 'voided', void_reason = p_reason, voided_at = now(), voided_by = auth.uid()
  where id = p_sale_id;

  perform public._loyalty_apply(
    v_sale.customer_phone, null, -1,
    -(coalesce(v_sale.cash_amount, 0) + coalesce(v_sale.card_amount, 0) + coalesce(v_sale.delivery_amount, 0)),
    -floor(coalesce(v_sale.cash_amount, 0) + coalesce(v_sale.card_amount, 0) + coalesce(v_sale.delivery_amount, 0))::integer
  );
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;

-- void_sale_item بنفس منطقها الأصلي بالكامل (schema-void-sale-item.sql) —
-- أضفنا إرجاع نقاط/مبلغ هذا الصنف بس، وإرجاع الزيارة نفسها كمان لو هذا
-- كان آخر صنف بالطلب (يعني الطلب صار ملغى بالكامل تلقائيًا)
create or replace function public.void_sale_item(p_sale_item_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_item record;
  v_sale record;
  v_line_total numeric;
  v_remaining_count int;
begin
  select * into v_item from public.sale_items where id = p_sale_item_id;
  if v_item is null then
    raise exception 'صنف البيع غير موجود';
  end if;
  if v_item.status = 'voided' then
    raise exception 'هذا الصنف ملغى أصلًا';
  end if;

  select * into v_sale from public.sales_entries where id = v_item.sale_id;
  if v_sale.status = 'voided' then
    raise exception 'الطلب بالكامل ملغى أصلًا';
  end if;

  update public.ingredients i
  set current_stock = i.current_stock + (pi.quantity * v_item.qty)
  from public.product_ingredients pi
  where pi.product_id = v_item.product_id and pi.ingredient_id = i.id;

  v_line_total := (v_item.unit_price + coalesce(v_item.addons_total, 0)) * v_item.qty;

  update public.sales_entries
  set
    cash_amount = case when cash_amount > 0 then greatest(cash_amount - v_line_total, 0) else cash_amount end,
    card_amount = case when card_amount > 0 then greatest(card_amount - v_line_total, 0) else card_amount end,
    delivery_amount = case when delivery_amount > 0 then greatest(delivery_amount - v_line_total, 0) else delivery_amount end
  where id = v_item.sale_id;

  update public.sale_items
  set status = 'voided', void_reason = p_reason, voided_at = now()
  where id = p_sale_item_id;

  perform public._loyalty_apply(v_sale.customer_phone, null, 0, -v_line_total, -floor(v_line_total)::integer);

  select count(*) into v_remaining_count from public.sale_items
  where sale_id = v_item.sale_id and status = 'completed';
  if v_remaining_count = 0 then
    update public.print_jobs set status = 'skipped' where sale_id = v_item.sale_id and status = 'pending';
    update public.sales_entries
    set status = 'voided', void_reason = coalesce(void_reason, 'كل أصناف الطلب أُلغيت فرادى'), voided_at = now(), voided_by = auth.uid()
    where id = v_item.sale_id;

    perform public._loyalty_apply(v_sale.customer_phone, null, -1, 0, 0);
  end if;
end;
$$;

grant execute on function public.void_sale_item(uuid, text) to authenticated;
