-- تعديل صنف بعد إتمام البيع (الكمية و/أو السعر) — للمالك والمدير فقط.
-- الإلغاء (void_sale / void_sale_item) موجود أصلًا؛ هالملف بيضيف "تعديل":
--  * بيرجّع/بيخصم فرق المخزون (الوصفة + الإضافات) حسب الكمية الجديدة
--  * بيعدّل مبلغ الدفع بنفس فرق الإجمالي (بالقناة الأكبر إن كان الدفع مختلط)
--  * بيعدّل نقاط وإنفاق الزبون
--  * بيسجّل كل تعديل (من/متى/قبل/بعد/السبب) بجدول sale_edit_log اللي ما بيتعدّل ولا بيتمسح
-- آمن لإعادة التشغيل (idempotent). شغّله بعد schema-cashier-hardening.sql.

create table if not exists public.sale_edit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  sale_id uuid not null,
  sale_item_id uuid not null,
  product_name text,
  old_qty numeric not null,
  new_qty numeric not null,
  old_unit_price numeric not null,
  new_unit_price numeric not null,
  old_total numeric not null,
  new_total numeric not null,
  reason text not null
);
create index if not exists sale_edit_log_sale_idx on public.sale_edit_log (sale_id, at);
alter table public.sale_edit_log enable row level security;
drop policy if exists sale_edit_log_select on public.sale_edit_log;
create policy sale_edit_log_select on public.sale_edit_log for select using (public.is_admin());
revoke insert, update, delete on public.sale_edit_log from anon, authenticated;

create or replace function public.edit_sale_item(
  p_sale_item_id uuid,
  p_new_qty numeric,
  p_new_unit_price numeric default null,
  p_reason text default null
) returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale record;
  v_item record;
  v_new_price numeric;
  v_old_line numeric;
  v_new_line numeric;
  v_delta numeric;
begin
  if not public.is_admin() then
    raise exception 'تعديل الفاتورة بعد البيع للمالك والمدير فقط';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'سبب التعديل مطلوب (3 أحرف على الأقل)';
  end if;
  if p_new_qty is null or p_new_qty <= 0 or p_new_qty > 1000 then
    raise exception 'الكمية لازم تكون أكبر من صفر (لحذف الصنف استخدم إلغاء الصنف)';
  end if;
  if p_new_unit_price is not null and (p_new_unit_price < 0 or p_new_unit_price > 100000) then
    raise exception 'سعر غير صالح';
  end if;

  -- القفل بنفس ترتيب void_sale_item: الطلب أول، بعدين الصنف
  select sale_id into v_sale_id from public.sale_items where id = p_sale_item_id;
  if v_sale_id is null then
    raise exception 'صنف البيع غير موجود';
  end if;
  select * into v_sale from public.sales_entries where id = v_sale_id for update;
  select * into v_item from public.sale_items where id = p_sale_item_id for update;
  if v_sale.status = 'voided' then
    raise exception 'الطلب ملغى — ما بينعدّل';
  end if;
  if v_item.status = 'voided' then
    raise exception 'الصنف ملغى — ما بينعدّل';
  end if;

  v_new_price := coalesce(p_new_unit_price, v_item.unit_price);
  if p_new_qty = v_item.qty and v_new_price = v_item.unit_price then
    raise exception 'ما في أي تغيير';
  end if;

  v_old_line := (v_item.unit_price + coalesce(v_item.addons_total, 0)) * v_item.qty;
  v_new_line := (v_new_price + coalesce(v_item.addons_total, 0)) * p_new_qty;
  v_delta := v_new_line - v_old_line;

  -- فرق المخزون: موجب = رجّع، سالب = اخصم (الدالة بتضرب بالكمية)
  if p_new_qty <> v_item.qty then
    perform public._restore_sale_item_stock(v_item.product_id, v_item.qty - p_new_qty, v_item.addon_ids);
  end if;

  -- فرق المبلغ على قناة الدفع الأكبر (الدفع المختلط بيتحمّله الأكبر)
  update public.sales_entries
     set cash_amount = case when cash_amount >= card_amount and cash_amount >= delivery_amount then greatest(cash_amount + v_delta, 0) else cash_amount end,
         card_amount = case when not (cash_amount >= card_amount and cash_amount >= delivery_amount) and card_amount >= delivery_amount then greatest(card_amount + v_delta, 0) else card_amount end,
         delivery_amount = case when not (cash_amount >= card_amount and cash_amount >= delivery_amount) and not (card_amount >= delivery_amount) then greatest(delivery_amount + v_delta, 0) else delivery_amount end
   where id = v_sale_id;

  update public.sale_items set qty = p_new_qty, unit_price = v_new_price where id = p_sale_item_id;

  perform public._loyalty_apply(v_sale.customer_phone, null, 0, v_delta, trunc(v_delta)::integer);

  insert into public.sale_edit_log (actor, actor_name, sale_id, sale_item_id, product_name, old_qty, new_qty,
                                    old_unit_price, new_unit_price, old_total, new_total, reason)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), v_sale_id, p_sale_item_id,
          v_item.product_name, v_item.qty, p_new_qty, v_item.unit_price, v_new_price, v_old_line, v_new_line,
          left(trim(p_reason), 300));
end;
$$;
revoke all on function public.edit_sale_item(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.edit_sale_item(uuid, numeric, numeric, text) to authenticated;
