-- تقسيم حساب طاولة مفتوح: بتختار أصناف (أو جزء من كميّة صنف) وبتنفصل بحساب مفتوح جديد على نفس الطاولة،
-- وبعدين بتنسدّد لحالها بـ settle_table_tab، والباقي بيضل مفتوح. المخزون ما بيتغيّر (نفس الأصناف بس بتغيّر مكانها).
-- p_items: [{"id": "<sale_item id>", "qty": 1}, ...]. بترجّع رقم الحساب الجديد. آمن لإعادة التشغيل.
create or replace function public.split_table_tab(p_sale_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale public.sales_entries%rowtype;
  v_new uuid;
  v_el jsonb;
  v_item public.sale_items%rowtype;
  v_qty numeric;
  v_left numeric;
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'اختار الأصناف اللي بدك تفصلها';
  end if;

  select * into v_sale from public.sales_entries
   where id = p_sale_id and tab_open and status = 'completed' for update;
  if v_sale.id is null then
    raise exception 'الحساب انسدّد أو انلغى قبل، حدّث الصفحة';
  end if;

  -- الحساب الجديد: نسخة من الأساسي بدون دفع، والأرقام بتتعيّن لحالها
  insert into public.sales_entries
  select (jsonb_populate_record(null::public.sales_entries,
            to_jsonb(v_sale) - 'id' - 'doc_no' - 'order_no' - 'client_ref'
            || jsonb_build_object('id', gen_random_uuid(), 'cash_amount', 0, 'card_amount', 0, 'delivery_amount', 0, 'discount_amount', 0,
                                  'cash_received', null, 'change_due', null, 'tab_open', true))).*
  returning id into v_new;

  for v_el in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_el->>'qty')::numeric;
    select * into v_item from public.sale_items
     where id = (v_el->>'id')::uuid and sale_id = p_sale_id and status <> 'voided' for update;
    if v_item.id is null then
      raise exception 'في صنف مش من هالحساب أو انشطب، حدّث الصفحة';
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > v_item.qty then
      raise exception 'كميّة غير صالحة لـ %', v_item.product_name;
    end if;
    if v_qty = v_item.qty then
      update public.sale_items set sale_id = v_new where id = v_item.id;
    else
      update public.sale_items set qty = qty - v_qty where id = v_item.id;
      insert into public.sale_items
      select (jsonb_populate_record(null::public.sale_items,
                to_jsonb(v_item) || jsonb_build_object('id', gen_random_uuid(), 'sale_id', v_new, 'qty', v_qty))).*;
    end if;
  end loop;

  select coalesce(sum(qty), 0) into v_left from public.sale_items where sale_id = p_sale_id and status <> 'voided';
  if v_left <= 0 then
    raise exception 'اخترت كل الحساب — استخدم «حاسب الطاولة» عادي';
  end if;

  return v_new;
end;
$$;

revoke execute on function public.split_table_tab(uuid, jsonb) from public, anon;
grant execute on function public.split_table_tab(uuid, jsonb) to authenticated;
