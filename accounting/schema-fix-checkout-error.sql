-- إصلاح خطأ "column addons_total of relation sale_items does not exist"
-- اللي ظهر عند إتمام الدفع بشاشة البيع السريع.
--
-- السبب: schema-customer-name.sql (اللي شغّلته أخيرًا) بيفترض إن عمود
-- sale_items.addons_total موجود أصلًا — وهو بيتضاف من ملف قديم اسمه
-- schema-void-sale-item.sql. يبدو إنه هالملف بالذات ما انشغّل على قاعدة
-- البيانات الحقيقية، فصار تعارض. هاذ الملف بيصلّح الموضوع نهائيًا
-- ويضمن رجوع كل شي للعمل صح، بغض النظر شو كان ناقص بالضبط — آمن تمامًا
-- تشغّله حتى لو بعض أجزاءه أصلًا موجودة (كله IF NOT EXISTS / OR REPLACE).

-- 1) كل الأعمدة اللي دالة record_sale النهائية بتعتمد عليها — بنضيفها
-- كلها مرة وحدة (IF NOT EXISTS بكل سطر، آمن تمامًا لو كانت موجودة
-- أصلًا)، عشان نضمن قاعدة البيانات صارت متوافقة مع كل الملفات اللي
-- كان المفروض تنشغّل بالترتيب من قبل، مهما كان بالضبط اللي انفاتك منها
alter table public.sales_entries add column if not exists order_type text;
alter table public.sales_entries add column if not exists kitchen_status text not null default 'قيد التحضير';
alter table public.sales_entries add column if not exists cash_received numeric;
alter table public.sales_entries add column if not exists change_due numeric;
alter table public.sales_entries add column if not exists table_number text;
alter table public.sales_entries add column if not exists customer_phone text;
alter table public.sales_entries add column if not exists status text not null default 'completed' check (status in ('completed', 'voided'));
alter table public.sales_entries add column if not exists void_reason text;
alter table public.sales_entries add column if not exists voided_at timestamptz;
alter table public.sales_entries add column if not exists voided_by uuid references public.profiles(id);
alter table public.sales_entries add column if not exists customer_name text;

alter table public.sale_items add column if not exists note text;
alter table public.sale_items add column if not exists addons_summary text;
alter table public.sale_items add column if not exists status text not null default 'completed' check (status in ('completed', 'voided'));
alter table public.sale_items add column if not exists void_reason text;
alter table public.sale_items add column if not exists voided_at timestamptz;
alter table public.sale_items add column if not exists addons_total numeric not null default 0;

create index if not exists sales_entries_kitchen_status_idx on public.sales_entries (kitchen_status);
create index if not exists sales_entries_status_idx on public.sales_entries (status);

-- 2) نحذف صراحة كل التوقيعات القديمة المحتملة لـ record_sale (لو كانت
-- موجودة) حتى نضمن ما يضل أكثر من نسخة متعارضة بقاعدة البيانات
drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb);
drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb, text);
drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric);
drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text);

-- 3) النسخة النهائية الصحيحة (١٢ معامل، فيها اسم الزبون)
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

-- 4) وظيفة إلغاء طلب كامل — بنفس سلسلة الأعمدة، نعيد تعريفها للتأكد
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_item record;
begin
  select status into v_status from public.sales_entries where id = p_sale_id;
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
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;

-- 5) وظيفة إلغاء صنف مفرد — نعيد تعريفها كمان لضمان توفرها، لأنها
-- بتعتمد على نفس الأعمدة فوق
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

  select count(*) into v_remaining_count from public.sale_items
  where sale_id = v_item.sale_id and status = 'completed';
  if v_remaining_count = 0 then
    update public.print_jobs set status = 'skipped' where sale_id = v_item.sale_id and status = 'pending';
    update public.sales_entries
    set status = 'voided', void_reason = coalesce(void_reason, 'كل أصناف الطلب أُلغيت فرادى'), voided_at = now(), voided_by = auth.uid()
    where id = v_item.sale_id;
  end if;
end;
$$;

grant execute on function public.void_sale_item(uuid, text) to authenticated;

-- 6) عرض "الأكثر مبيعًا" (يستثني الأصناف/الطلبات الملغاة)
create or replace view public.product_sales_totals as
select si.product_id, sum(si.qty) as total_qty
from public.sale_items si
join public.sales_entries se on se.id = si.sale_id
where si.product_id is not null and se.status = 'completed' and si.status = 'completed'
group by si.product_id;
