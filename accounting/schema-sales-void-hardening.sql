-- تقوية الإلغاء ومنطقة الخطر (2026-10-04)
-- آمن لإعادة التشغيل (idempotent).
--
-- 1) منطقة الخطر: الرقم السري كان بينفحص لحاله، وبعدين المتصفح بيعمل الحذف مباشرة على الجداول،
--    فأي حساب مدير بيقدر يتخطى الرقم السري. هلأ الإجراء نفسه دالة على السيرفر بتفحص الرقم
--    السري جواها، مع حد لمحاولات التخمين (5 غلط بربع ساعة = قفل ربع ساعة).
-- 2) إلغاء بيعة / صنف كان يرجّع مواد الوصفة بس، مش مواد الإضافات (حليب إضافي، شوت...).
--    هلأ كل صنف مباع بيحفظ أرقام إضافاته (addon_ids)، والإلغاء بيرجّعها.
--    (المبيعات القديمة قبل هالتعديل ما إلها أرقام إضافات، فإلغاؤها بيرجّع الوصفة بس متل قبل.)
-- 3) الإلغاء بيقفل السطر (FOR UPDATE)، فضغطتين بنفس اللحظة ما بيرجّعوا المخزون مرتين.

-- ---------- 1) منطقة الخطر ----------
create table if not exists public.pin_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists pin_attempts_user_idx on public.pin_attempts (user_id, created_at desc);
alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from anon, authenticated;

-- بيرجّع false لو الرقم غلط (بدون exception، حتى تنحفظ المحاولة الغلط وما تنلغي مع الـrollback)
create or replace function public._check_reset_pin(p_pin text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_pin text;
  v_fails int;
begin
  if not public.is_admin() then
    raise exception 'منطقة الخطر للمالك والمدير فقط';
  end if;
  select count(*) into v_fails from public.pin_attempts
   where user_id = auth.uid() and not ok and created_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    raise exception 'محاولات كثيرة غلط — جرّب بعد ربع ساعة';
  end if;
  select value into v_pin from public.app_settings where key = 'reset_pin';
  if p_pin is null or p_pin is distinct from coalesce(v_pin, '1234') then
    insert into public.pin_attempts (ok) values (false);
    return false;
  end if;
  insert into public.pin_attempts (ok) values (true);
  delete from public.pin_attempts where created_at < now() - interval '30 days';
  return true;
end;
$$;
revoke all on function public._check_reset_pin(text) from public, anon, authenticated;

-- الإجراء الخطر نفسه: 'reset_stock' | 'delete_ingredients' (مالك أو مدير)، 'delete_sales' (مالك بس)
-- بيرجّع عدد السطور، أو null لو الرقم السري غلط
create or replace function public.danger_zone_action(p_action text, p_pin text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int := 0;
begin
  if p_action not in ('reset_stock', 'delete_ingredients', 'delete_sales') then
    raise exception 'إجراء غير معروف';
  end if;
  if p_action = 'delete_sales' and not public.is_owner() then
    raise exception 'حذف سجل المبيعات لصاحب المطعم فقط';
  end if;
  if not public._check_reset_pin(p_pin) then
    return null;
  end if;

  if p_action = 'reset_stock' then
    insert into public.stock_movements (item_kind, item_id, item_name, delta, stock_after, reason, note)
    select 'ingredient', id, name, -current_stock, 0, 'count', 'تصفير من منطقة الخطر'
      from public.ingredients where current_stock <> 0;
    update public.ingredients set current_stock = 0 where current_stock <> 0;
    get diagnostics v_n = row_count;
  elsif p_action = 'delete_ingredients' then
    delete from public.ingredients where id is not null;
    get diagnostics v_n = row_count;
  else
    delete from public.sales_entries where id is not null;
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end;
$$;
revoke all on function public.danger_zone_action(text, text) from public, anon;
grant execute on function public.danger_zone_action(text, text) to authenticated;

-- الفحص لحاله (قبل سؤال "متأكد؟") صار كمان محدود المحاولات
create or replace function public.verify_reset_pin(p_pin text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  return public._check_reset_pin(p_pin);
end;
$$;
revoke all on function public.verify_reset_pin(text) from public, anon;
grant execute on function public.verify_reset_pin(text) to authenticated;

-- حذف المبيعات بالجملة صار من الدالة بس (حذف بيعة لحالها ما كان مستخدم بالواجهة؛ الإلغاء هو الطريق)
drop policy if exists sales_entries_delete on public.sales_entries;
drop policy if exists sale_items_delete on public.sale_items;

-- ---------- 2) أرقام الإضافات مع كل صنف مباع ----------
alter table public.sale_items add column if not exists addon_ids uuid[];

-- record_sale: بنضيف addon_ids على الـinsert بدون ما نعيد كتابة الدالة كلها
do $$
declare
  v_def text := pg_get_functiondef('public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text, text)'::regprocedure);
  v_new text;
begin
  if v_def ~ 'addon_ids\)\s*values' then
    return; -- متعدّلة أصلًا
  end if;
  v_new := regexp_replace(v_def,
    'insert into public\.sale_items\s*\(\s*sale_id,\s*product_id,\s*product_name,\s*qty,\s*unit_price,\s*note,\s*addons_summary,\s*addons_total\s*\)\s*values\s*\(\s*v_sale_id,\s*v_product_id,\s*v_product_name,\s*v_qty,\s*v_unit_price,\s*v_note,\s*v_addons_summary,\s*coalesce\(v_addons_total,\s*0\)\s*\)',
    'insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary, addons_total, addon_ids)
      values (v_sale_id, v_product_id, v_product_name, v_qty, v_unit_price, v_note, v_addons_summary, coalesce(v_addons_total, 0),
        (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->''addon_ids'', ''[]''::jsonb)) x))');
  if v_new = v_def then
    raise exception 'record_sale: ما لقيت سطر إدخال sale_items المتوقع — ما تعدّل شي';
  end if;
  execute v_new;
end;
$$;

-- بيرجّع مواد صنف مباع (الوصفة + الإضافات) للمخزون
create or replace function public._restore_sale_item_stock(p_product_id uuid, p_qty numeric, p_addon_ids uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_addon uuid;
begin
  update public.ingredients i
     set current_stock = i.current_stock + (pi.quantity * p_qty)
    from public.product_ingredients pi
   where pi.product_id = p_product_id and pi.ingredient_id = i.id;
  -- نفس طريقة الخصم بـrecord_sale: إضافة إضافة (لو تكررت إضافة، بتنخصم وبترجع مرتين)
  foreach v_addon in array coalesce(p_addon_ids, '{}'::uuid[]) loop
    update public.ingredients i
       set current_stock = i.current_stock + (ai.quantity * p_qty)
      from public.addon_ingredients ai
     where ai.addon_id = v_addon and ai.ingredient_id = i.id;
  end loop;
end;
$$;
revoke all on function public._restore_sale_item_stock(uuid, numeric, uuid[]) from public, anon, authenticated;

-- ---------- 3) الإلغاء مع قفل السطر ----------
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_item record;
  v_sale record;
  v_minutes numeric;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;
  select * into v_sale from public.sales_entries where id = p_sale_id for update;
  if v_sale.id is null then
    raise exception 'عملية البيع غير موجودة';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'هذه العملية ملغاة أصلًا';
  end if;
  if v_role = 'staff' then
    v_minutes := public.app_setting_num('staff_void_minutes', 10);
    if v_sale.created_by is distinct from auth.uid() then
      raise exception 'الكاشير يقدر يلغي طلباته هو بس — بلّغ المدير';
    end if;
    if now() - v_sale.created_at > v_minutes * interval '1 minute' then
      raise exception 'انتهت مدة الإلغاء المسموحة للكاشير (% دقيقة) — بلّغ المدير', v_minutes;
    end if;
  end if;
  for v_item in
    select id, product_id, qty, addon_ids from public.sale_items
     where sale_id = p_sale_id and status = 'completed'
     for update
  loop
    perform public._restore_sale_item_stock(v_item.product_id, v_item.qty, v_item.addon_ids);
  end loop;
  update public.print_jobs set status = 'skipped' where sale_id = p_sale_id and status = 'pending';
  update public.sales_entries
     set status = 'voided', void_reason = left(trim(p_reason), 300), voided_at = now(), voided_by = auth.uid()
   where id = p_sale_id;
  perform public._loyalty_apply(
    v_sale.customer_phone, null, -1,
    -(coalesce(v_sale.cash_amount, 0) + coalesce(v_sale.card_amount, 0) + coalesce(v_sale.delivery_amount, 0)),
    -floor(coalesce(v_sale.cash_amount, 0) + coalesce(v_sale.card_amount, 0) + coalesce(v_sale.delivery_amount, 0))::integer
  );
end;
$$;

create or replace function public.void_sale_item(p_sale_item_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_item record;
  v_sale record;
  v_line_total numeric;
  v_remaining_count int;
  v_minutes numeric;
  v_sale_id uuid;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;
  -- القفل بنفس ترتيب void_sale (الطلب أول، بعدين الصنف) حتى ما يعلقوا ببعض
  select sale_id into v_sale_id from public.sale_items where id = p_sale_item_id;
  if v_sale_id is null then
    raise exception 'صنف البيع غير موجود';
  end if;
  select * into v_sale from public.sales_entries where id = v_sale_id for update;
  select * into v_item from public.sale_items where id = p_sale_item_id for update;
  if v_item.status = 'voided' then
    raise exception 'هذا الصنف ملغى أصلًا';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'الطلب بالكامل ملغى أصلًا';
  end if;
  if v_role = 'staff' then
    v_minutes := public.app_setting_num('staff_void_minutes', 10);
    if v_sale.created_by is distinct from auth.uid() then
      raise exception 'الكاشير يقدر يلغي أصناف طلباته هو بس — بلّغ المدير';
    end if;
    if now() - v_sale.created_at > v_minutes * interval '1 minute' then
      raise exception 'انتهت مدة الإلغاء المسموحة للكاشير (% دقيقة) — بلّغ المدير', v_minutes;
    end if;
  end if;
  perform public._restore_sale_item_stock(v_item.product_id, v_item.qty, v_item.addon_ids);
  v_line_total := (v_item.unit_price + coalesce(v_item.addons_total, 0)) * v_item.qty;
  update public.sales_entries
     set cash_amount = case when cash_amount > 0 then greatest(cash_amount - v_line_total, 0) else cash_amount end,
         card_amount = case when card_amount > 0 then greatest(card_amount - v_line_total, 0) else card_amount end,
         delivery_amount = case when delivery_amount > 0 then greatest(delivery_amount - v_line_total, 0) else delivery_amount end
   where id = v_item.sale_id;
  update public.sale_items
     set status = 'voided', void_reason = left(trim(p_reason), 300), voided_at = now(), voided_by = auth.uid()
   where id = p_sale_item_id;
  perform public._loyalty_apply(v_sale.customer_phone, null, 0, -v_line_total, -floor(v_line_total)::integer);
  select count(*) into v_remaining_count from public.sale_items where sale_id = v_item.sale_id and status = 'completed';
  if v_remaining_count = 0 then
    update public.print_jobs set status = 'skipped' where sale_id = v_item.sale_id and status = 'pending';
    update public.sales_entries
       set status = 'voided', void_reason = coalesce(void_reason, 'كل أصناف الطلب أُلغيت فرادى'), voided_at = now(), voided_by = auth.uid()
     where id = v_item.sale_id;
    perform public._loyalty_apply(v_sale.customer_phone, null, -1, 0, 0);
  end if;
end;
$$;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.void_sale_item(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.void_sale_item(uuid, text) to authenticated;
