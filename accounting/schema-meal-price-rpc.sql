-- إصلاح: الكاشير (staff) ما كان يقدر يحفظ «سعر الوجبة» من شاشة البيع السريع.
-- الجدولين addons وproducts سياسات الكتابة عليهم للمدير/المالك فقط (is_admin())، فكان الحفظ يفشل برسالة
-- «new row violates row-level security policy for table "addons"».
-- الحل: دالة save_meal_price (security definer) تقبل أي مستخدم مسجّل دخول، وتكتب بس هالحقول المحددة
-- (سعر الوجبة + إضافتها الخاصة) بعد تحقق من السيرفر؛ وما بنفتح سياسة الكتابة العامة للجدولين.
create or replace function public.save_meal_price(p_product_id uuid, p_kind text, p_total numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products%rowtype;
  v_addon public.addons%rowtype;
  v_addon_id uuid;
  v_label text;
  v_extra numeric;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح';
  end if;
  if p_kind not in ('meal', 'double') then
    raise exception 'نوع الوجبة غير معروف';
  end if;
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'الصنف غير موجود';
  end if;
  v_addon_id := case p_kind when 'meal' then v_prod.meal_addon_id else v_prod.double_addon_id end;
  v_label := case p_kind when 'meal' then 'وجبة ' else 'وجبة دبل ' end || v_prod.name;
  p_total := coalesce(p_total, 0);

  if p_total <= 0 then
    if v_addon_id is not null then
      update public.addons set is_active = false where id = v_addon_id;
    end if;
    if p_kind = 'meal' then
      update public.products set meal_price = null where id = p_product_id;
    else
      update public.products set double_meal_price = null where id = p_product_id;
    end if;
    return jsonb_build_object('addon', null);
  end if;

  if p_total > 100000 then
    raise exception 'سعر الوجبة غير منطقي';
  end if;
  if p_total <= v_prod.price then
    raise exception 'سعر الوجبة لازم يكون أكبر من سعر الصنف لحاله (%)', v_prod.price;
  end if;
  v_extra := round((p_total - v_prod.price)::numeric, 2);

  if v_addon_id is not null then
    update public.addons set name = v_label, price = v_extra, is_active = true, is_meal = true
    where id = v_addon_id returning * into v_addon;
  end if;
  if v_addon.id is null then
    insert into public.addons (name, price, is_active, is_meal)
    values (v_label, v_extra, true, true) returning * into v_addon;
  end if;

  if p_kind = 'meal' then
    update public.products set meal_price = p_total, meal_addon_id = v_addon.id where id = p_product_id;
  else
    update public.products set double_meal_price = p_total, double_addon_id = v_addon.id where id = p_product_id;
  end if;
  return jsonb_build_object('addon', to_jsonb(v_addon));
end;
$$;

revoke execute on function public.save_meal_price(uuid, text, numeric) from public, anon;
grant execute on function public.save_meal_price(uuid, text, numeric) to authenticated;
