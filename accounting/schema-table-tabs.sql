-- حساب مفتوح للطاولة: طلبات الوايتر بتنضاف على نفس الحساب لحد ما الزبون يحاسب.
-- place_table_order: أول طلب بيفتح الحساب (بيطبع للمطبخ والبار بس، بدون فاتورة وبدون دفع).
--   أي طلب تاني لنفس الطاولة بينضاف على نفس الحساب وبينطبع فيه الأصناف الجديدة بس (add_items_to_sale).
-- settle_table_tab: «حاسب الطاولة» بتجمع حسابات الطاولة، بتسجّل الدفع (كاش/شبكة/خصم)، بتطبع الفاتورة وبتحرّر الطاولة.
-- المبيعات والتقارير بتحسب المدفوع بس، فالحساب المفتوح ما بيدخل بالمبيعات إلا لما ينسدّد.
-- لا بيعدّل record_sale ولا add_items_to_sale. آمن لإعادة التشغيل.

alter table public.sales_entries add column if not exists tab_open boolean not null default false;
create index if not exists sales_entries_tab_open_idx on public.sales_entries (table_number) where tab_open;

create or replace function public.place_table_order(
  p_entry_date date,
  p_total numeric,
  p_notes text,
  p_items jsonb,
  p_client_ref uuid,
  p_table_number text,
  p_customer_phone text default null,
  p_customer_name text default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_table text := btrim(coalesce(p_table_number, ''));
  v_sale public.sales_entries%rowtype;
  v_id uuid;
  v_item jsonb;
  v_unit numeric;
  v_addons numeric;
  v_expected numeric := 0;
  v_hall boolean;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if v_table = '' then
    raise exception 'رقم الطاولة ناقص';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'الطلب فاضي';
  end if;

  -- طلبين لنفس الطاولة بنفس اللحظة ما لازم يفتحوا حسابين
  perform pg_advisory_xact_lock(hashtextextended('tab:' || lower(v_table), 0));

  -- إعادة إرسال نفس الطلب: منرجّع الحساب اللي انحسب عليه أول مرة
  if p_client_ref is not null then
    select id into v_id from public.sales_entries where client_ref = p_client_ref;
    if v_id is not null then return v_id; end if;
    select sale_id into v_id from public.sale_additions where client_ref = p_client_ref;
    if v_id is not null then return v_id; end if;
  end if;

  select * into v_sale from public.sales_entries
  where tab_open and status = 'completed' and lower(btrim(table_number)) = lower(v_table)
  order by created_at limit 1 for update;

  if v_sale.id is null then
    -- حساب جديد: record_sale بتحسب وبتطبع للأقسام، وبعدين بنرجّع الدفع صفر ونعلّم الحساب مفتوح
    v_id := public.record_sale(
      p_entry_date, p_total, 0, 0, p_notes, p_items, p_client_ref,
      'صالة', null, null, v_table, p_customer_phone, p_customer_name
    );
    update public.sales_entries
       set cash_amount = 0, card_amount = 0, delivery_amount = 0, discount_amount = 0,
           cash_received = null, change_due = null, tab_open = true
     where id = v_id and created_at = now();
    -- الفاتورة بتنطبع عند الحساب مو عند الفتح
    delete from public.print_jobs
     where sale_id = v_id and job_type = 'receipt' and created_at = now();
    return v_id;
  end if;

  -- حساب موجود: نضيف الأصناف الجديدة. add_items_to_sale بتحسب الفرق «خصم» لو الدفع أقل،
  -- فبنعطيها قيمة الأصناف كاملة كدفعة وبعدين بنرجّع أرقام الدفع لما كانت عليه (صفر)
  v_hall := (btrim(coalesce(v_sale.order_type, '')) = 'صالة');
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select case when v_hall and hall_price > 0 then hall_price else price end into v_unit
    from public.products where id = (v_item->>'product_id')::uuid;
    if not found then raise exception 'صنف غير موجود بقائمة المنتجات'; end if;
    select coalesce(sum(price), 0) into v_addons
    from public.addons
    where id in (select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid);
    v_expected := v_expected + (coalesce(v_unit, 0) + v_addons) * (v_item->>'qty')::numeric;
  end loop;

  perform public.add_items_to_sale(v_sale.id, p_items, v_expected, 0, 0, p_client_ref);
  update public.sales_entries
     set cash_amount = v_sale.cash_amount, card_amount = v_sale.card_amount,
         delivery_amount = v_sale.delivery_amount, discount_amount = v_sale.discount_amount
   where id = v_sale.id;
  return v_sale.id;
end;
$$;

revoke execute on function public.place_table_order(date, numeric, text, jsonb, uuid, text, text, text) from public, anon;
grant execute on function public.place_table_order(date, numeric, text, jsonb, uuid, text, text, text) to authenticated;

create or replace function public.settle_table_tab(
  p_sale_ids uuid[],
  p_cash numeric,
  p_card numeric,
  p_discount numeric default 0,
  p_entry_date date default current_date,
  p_cash_received numeric default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_target uuid;
  v_n int;
  v_total numeric;
  v_disc numeric := coalesce(p_discount, 0);
  v_max_pct numeric;
  v_table text;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if coalesce(array_length(p_sale_ids, 1), 0) = 0 then
    raise exception 'ما في حساب للتسديد';
  end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_card, 0) < 0 or v_disc < 0 then
    raise exception 'مبلغ غير صالح';
  end if;
  if v_role = 'staff' and (p_entry_date is null or p_entry_date < current_date - 2 or p_entry_date > current_date + 1) then
    raise exception 'تاريخ البيع خارج المسموح للكاشير';
  end if;

  select count(*) into v_n from (
    select id from public.sales_entries
    where id = any(p_sale_ids) and tab_open and status = 'completed' order by id for update
  ) x;
  if v_n <> (select count(distinct u) from unnest(p_sale_ids) u) then
    raise exception 'الحساب انسدّد أو انلغى قبل، حدّث الصفحة';
  end if;

  select id into v_target from public.sales_entries
  where id = any(p_sale_ids) order by created_at limit 1;
  if v_n > 1 then
    perform public.merge_sales(v_target, array(select u from unnest(p_sale_ids) u where u <> v_target));
  end if;

  select coalesce(sum((unit_price + coalesce(addons_total, 0)) * qty), 0) into v_total
  from public.sale_items where sale_id = v_target and status = 'completed';
  if v_total <= 0 then
    raise exception 'الحساب فاضي — ما في أصناف للتسديد';
  end if;
  if v_disc > v_total then
    raise exception 'الخصم أكبر من الحساب';
  end if;
  if v_disc > 0 and v_role = 'staff' then
    v_max_pct := public.app_setting_num('staff_max_discount_percent', 10);
    if v_disc > round(v_total * v_max_pct / 100, 2) + 0.01 then
      raise exception 'الخصم يتعدى الحد المسموح للكاشير (% %%) — يحتاج موافقة مدير', v_max_pct;
    end if;
  end if;
  if abs(coalesce(p_cash, 0) + coalesce(p_card, 0) - (v_total - v_disc)) > 0.011 then
    raise exception 'الكاش + الشبكة (%) لازم يساوي المطلوب (%)',
      round(coalesce(p_cash, 0) + coalesce(p_card, 0), 2), round(v_total - v_disc, 2);
  end if;

  update public.sales_entries
     set cash_amount = coalesce(p_cash, 0), card_amount = coalesce(p_card, 0), delivery_amount = 0,
         discount_amount = v_disc, tab_open = false, entry_date = coalesce(p_entry_date, current_date),
         cash_received = case when coalesce(p_cash, 0) > 0 then p_cash_received else null end,
         change_due = case when coalesce(p_cash, 0) > 0 and p_cash_received is not null
                           then greatest(p_cash_received - p_cash, 0) else null end
   where id = v_target
  returning btrim(table_number) into v_table;

  insert into public.print_jobs (sale_id, job_type) values (v_target, 'receipt');

  -- الطاولة بتصير «بدها ترتيب»
  if v_table is not null and v_table <> '' then
    insert into public.table_occupancy (table_number, is_occupied, freed_at)
    values (v_table, false, now())
    on conflict (table_number) do update set is_occupied = false, freed_at = now();
  end if;

  return v_target;
end;
$$;

revoke execute on function public.settle_table_tab(uuid[], numeric, numeric, numeric, date, numeric) from public, anon;
grant execute on function public.settle_table_tab(uuid[], numeric, numeric, numeric, date, numeric) to authenticated;

-- 30 طاولة (الموجودة ما بتنكرر) وترتيبها بالأرقام
update public.restaurant_tables set sort_order = table_number::int where table_number ~ '^[0-9]{1,4}$';
insert into public.restaurant_tables (table_number, sort_order)
select n::text, n from generate_series(1, 30) n
where not exists (select 1 from public.restaurant_tables t where lower(btrim(t.table_number)) = n::text);
