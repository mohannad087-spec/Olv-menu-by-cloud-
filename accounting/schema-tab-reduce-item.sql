-- الكاشير بيقلّل كمية صنف على حساب طاولة مفتوح (مثلاً 3 لاتيه صاروا 2)، بسبب إلزامي.
-- التقليل بس (للزيادة «زيد طلب» عشان ينطبع للمطبخ، ولإلغاء الصنف كله «شطب»).
-- بيرجّع المخزون بالفرق وبيتسجّل بسجل التعديلات sale_edit_log. آمن لإعادة التشغيل.

create or replace function public.tab_reduce_item(p_sale_item_id uuid, p_new_qty numeric, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale record;
  v_item record;
  v_old_line numeric;
  v_new_line numeric;
begin
  if public.auth_role() is null then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'سبب التعديل مطلوب (3 أحرف على الأقل)'; end if;
  select sale_id into v_sale_id from public.sale_items where id = p_sale_item_id;
  if v_sale_id is null then raise exception 'صنف البيع غير موجود'; end if;
  select * into v_sale from public.sales_entries where id = v_sale_id for update;
  select * into v_item from public.sale_items where id = p_sale_item_id for update;
  if not (coalesce(v_sale.tab_open, false) and v_sale.status = 'completed') then
    raise exception 'التعديل لحساب الطاولة المفتوح بس';
  end if;
  if v_item.status = 'voided' then raise exception 'الصنف ملغى — ما بينعدّل'; end if;
  if p_new_qty is null or p_new_qty <= 0 or p_new_qty >= v_item.qty then
    raise exception 'الكمية الجديدة لازم تكون أقل من الحالية (%) وأكبر من صفر. للإلغاء استخدم «شطب»، وللزيادة «زيد طلب»', v_item.qty;
  end if;

  perform public._restore_sale_item_stock(v_item.product_id, v_item.qty - p_new_qty, v_item.addon_ids);
  v_old_line := (v_item.unit_price + coalesce(v_item.addons_total, 0)) * v_item.qty;
  v_new_line := (v_item.unit_price + coalesce(v_item.addons_total, 0)) * p_new_qty;
  update public.sale_items set qty = p_new_qty where id = p_sale_item_id;

  insert into public.sale_edit_log (actor, actor_name, sale_id, sale_item_id, product_name, old_qty, new_qty,
                                    old_unit_price, new_unit_price, old_total, new_total, reason)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), v_sale_id, p_sale_item_id,
          v_item.product_name, v_item.qty, p_new_qty, v_item.unit_price, v_item.unit_price, v_old_line, v_new_line,
          left(trim(p_reason), 300));
end;
$$;

revoke execute on function public.tab_reduce_item(uuid, numeric, text) from public, anon;
grant execute on function public.tab_reduce_item(uuid, numeric, text) to authenticated;
