-- الحجم الوسط (صغير / وسط / كبير) ببطاقة المادة. نفس فكرة الكبير تمامًا: الصغير = سعر الصنف الأساسي،
-- والوسط إضافة خاصة بالصنف سعرها = فرق (وسط − صغير)، فـ record_sale بيحسب السعر والصالة من جدول الإضافات بدون أي تغيير.
-- سعر الصالة للوسط = سعر صالة الصنف + الإضافة (زي الكبير). كل الأعمدة اختيارية: الأصناف الحالية ما بتتغير.
alter table public.products add column if not exists medium_addon_id uuid references public.addons(id) on delete set null;

-- شاشة الويتر: بتجيب كمان إضافة الوسط
create or replace function public.waiter_menu()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'category', p.category, 'price', p.price, 'hall_price', p.hall_price,
        'meal_addon_id', p.meal_addon_id, 'double_addon_id', p.double_addon_id,
        'large_addon_id', p.large_addon_id, 'medium_addon_id', p.medium_addon_id
      ) order by p.category, p.sort_order)
      from public.products p where p.is_active), '[]'::jsonb),
    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'price', a.price, 'is_meal', a.is_meal, 'is_size', a.is_size
      ) order by a.name)
      from public.addons a where a.is_active), '[]'::jsonb)
  );
end;
$$;
