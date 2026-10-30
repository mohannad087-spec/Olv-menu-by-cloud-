-- الويتر بيشطب صنف من حساب طاولة مفتوح (2026-10-30): بيضل ظاهر عند الإدارة مشطوب مع السبب واسم الويتر.
-- بيعتمد على schema-waiter-role.sql. ما بيمسح شي: بيشغّل void_sale_item نفسها (بترجّع المخزون، بتطبع تذكرة إلغاء
-- للقسم، وبتتسجّل بسجل التدقيق) بس لأصناف حسابات الطاولات المفتوحة ولحظيًا، وسبب الشطب إلزامي.
-- آمن لإعادة التشغيل.

create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public
as $$
  select case
           when p.role = 'waiter' then
             case current_setting('olv.waiter_rpc', true)
               when '1' then 'staff'
               when '2' then 'manager'  -- داخل waiter_void_item بس (بعد فحص إنه صنف بحساب طاولة مفتوح)
               else null
             end
           else p.role
         end
  from public.profiles p
  where p.id = auth.uid() and p.is_active is not false
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
            'id', si.id, 'name', si.product_name, 'qty', si.qty, 'note', si.note, 'addons', si.addons_summary,
            'unit_price', si.unit_price, 'addons_total', si.addons_total,
            'voided', si.status = 'voided', 'void_reason', si.void_reason
          ) order by si.created_at)
          from public.sale_items si where si.sale_id = s.id), '[]'::jsonb)
      ) order by s.created_at)
      from public.sales_entries s
      where s.tab_open and s.status = 'completed'), '[]'::jsonb)
  );
end;
$$;

create or replace function public.waiter_void_item(p_item_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_open boolean;
begin
  if not public._waiter_ok() then raise exception 'غير مصرّح — سجّل دخول بحساب فعّال'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'سبب الشطب مطلوب'; end if;
  select (s.tab_open and s.status = 'completed') into v_open
  from public.sale_items si join public.sales_entries s on s.id = si.sale_id
  where si.id = p_item_id;
  if v_open is not true then raise exception 'الويتر بيشطب من حساب طاولة مفتوح بس'; end if;
  perform set_config('olv.waiter_rpc', '2', true);
  perform public.void_sale_item(p_item_id, p_reason);
  perform set_config('olv.waiter_rpc', '', true);
end;
$$;

revoke execute on function public.waiter_void_item(uuid, text) from public, anon;
grant execute on function public.waiter_void_item(uuid, text) to authenticated;
