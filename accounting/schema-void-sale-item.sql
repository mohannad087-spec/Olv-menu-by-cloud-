-- إلغاء صنف واحد فقط من طلب فيه أكثر من صنف (بدل إلغاء الطلب كله):
-- يرجّع وصفة هذا الصنف بس للمخزون، وينقص قيمته من إجمالي الطلب، ويعلّم
-- الصنف نفسه "ملغى" مع إبقاء باقي أصناف الطلب كما هي.

alter table public.sale_items add column if not exists status text not null default 'completed' check (status in ('completed', 'voided'));
alter table public.sale_items add column if not exists void_reason text;
alter table public.sale_items add column if not exists voided_at timestamptz;
alter table public.sale_items add column if not exists addons_total numeric not null default 0;

-- record_sale بنفس التوقيع (بدون drop)، فقط عدّلنا الجسم ليحسب ويخزّن
-- إجمالي سعر الإضافات لكل سطر (مطلوب لحساب المبلغ الصحيح عند إلغاء صنف
-- فيه إضافات لاحقًا)
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
  p_customer_phone text default null
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
    cash_received, change_due, table_number, customer_phone, created_by
  )
  values (
    p_entry_date, p_cash, p_card, p_delivery, p_notes, p_order_type,
    p_cash_received, p_change_due, p_table_number, p_customer_phone, auth.uid()
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

  -- يرجّع وصفة هذا الصنف بس (لا يشمل استهلاك الإضافات، لنفس سبب عدم
  -- وجود ربط محفوظ بين سطر البيع والإضافات المختارة فيه)
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

  -- لو صارت كل أصناف الطلب ملغاة فرادى، يُلغى الطلب بالكامل تلقائيًا
  -- (المخزون صار مرجوعًا أصلًا صنف صنف، فقط نعلّم الطلب ونلغي طباعته المعلّقة)
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

-- يستثني الأصناف الملغاة فرادى من ترتيب "الأكثر مبيعًا"، إضافة لاستثناء الطلبات الملغاة بالكامل
create or replace view public.product_sales_totals as
select si.product_id, sum(si.qty) as total_qty
from public.sale_items si
join public.sales_entries se on se.id = si.sale_id
where si.product_id is not null and se.status = 'completed' and si.status = 'completed'
group by si.product_id;
