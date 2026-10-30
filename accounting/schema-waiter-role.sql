-- دور «ويتر» (2026-10-30): حساب لتابلت الطاولات. بيشوف صفحة waiter-orders.html بس.
-- الفكرة: auth_role() بترجّع null للويتر، فكل سياسات RLS والدوال الحالية (اللي بتشترط auth_role() is not null)
-- بترفضه تلقائيًا، حتى لو فتح API مباشرة. وبنعطيه 3 دوال ضيقة بدلها:
--   waiter_menu()        قائمة الأصناف والإضافات (قراءة)
--   waiter_tables()      الطاولات والحسابات المفتوحة (قراءة، بدون دفعات)
--   waiter_place_order() إرسال طلب لحساب الطاولة (بيشغّل place_table_order بصلاحية كاشير، لحظيًا)
-- الدوال بتشغّل SQL عادي، قابلة للإعادة بدون ضرر.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles drop constraint profiles_role_check;
  end if;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('owner', 'manager', 'staff', 'waiter'));
end $$;

create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public
as $$
  select case
           when p.role = 'waiter' then
             case when current_setting('olv.waiter_rpc', true) = '1' then 'staff' else null end
           else p.role
         end
  from public.profiles p
  where p.id = auth.uid() and p.is_active is not false
$$;

create or replace function public._waiter_ok()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and is_active is not false) $$;

create or replace function public.waiter_menu()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  return jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'category', p.category, 'price', p.price, 'hall_price', p.hall_price,
        'meal_addon_id', p.meal_addon_id, 'double_addon_id', p.double_addon_id, 'large_addon_id', p.large_addon_id
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

create or replace function public.waiter_tables()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  return jsonb_build_object(
    'tables', coalesce((select jsonb_agg(t.table_number order by t.sort_order, t.created_at) from public.restaurant_tables t), '[]'::jsonb),
    'tabs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sale_id', s.id, 'table_number', s.table_number, 'opened_at', s.created_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', si.product_name, 'qty', si.qty, 'note', si.note, 'addons', si.addons_summary,
            'unit_price', si.unit_price, 'addons_total', si.addons_total
          ) order by si.created_at)
          from public.sale_items si where si.sale_id = s.id and si.status is distinct from 'voided'), '[]'::jsonb)
      ) order by s.created_at)
      from public.sales_entries s
      where s.tab_open and s.status = 'completed'), '[]'::jsonb)
  );
end;
$$;

create or replace function public.waiter_place_order(
  p_entry_date date,
  p_total numeric,
  p_items jsonb,
  p_client_ref uuid,
  p_table_number text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  perform set_config('olv.waiter_rpc', '1', true);
  v_id := public.place_table_order(p_entry_date, p_total, null, p_items, p_client_ref, p_table_number, null, null);
  perform set_config('olv.waiter_rpc', '', true);
  return v_id;
end;
$$;

revoke execute on function public._waiter_ok() from public, anon;
revoke execute on function public.waiter_menu() from public, anon;
revoke execute on function public.waiter_tables() from public, anon;
revoke execute on function public.waiter_place_order(date, numeric, jsonb, uuid, text) from public, anon;
grant execute on function public.waiter_menu() to authenticated;
grant execute on function public.waiter_tables() to authenticated;
grant execute on function public.waiter_place_order(date, numeric, jsonb, uuid, text) to authenticated;
