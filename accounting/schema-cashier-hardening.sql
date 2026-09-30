-- تحصين صلاحيات الكاشير ومنع التلاعب بالفواتير والمبيعات
--
-- الثغرات اللي بيسدّها هالملف (كلها كانت شغّالة فعليًا قبله):
--   ١) أي مستخدم مسجّل دخول (حتى كاشير) كان يقدر بنداء واحد لـSupabase من
--      كونسول المتصفح يحذف/يعدّل أي فاتورة أو مصروف أو تقفيل خزينة، يغيّر
--      أسعار المنتجات، يعدّل المخزون، ويقرأ الرقم السري لمنطقة الخطر.
--      الحل: الكاشير صار يبيع ويلغي (بقيود) عبر دوال محروسة بس، والباقي
--      للمالك/المدير.
--   ٢) record_sale كانت تصدّق المبلغ المرسل من المتصفح، فالكاشير يبيع
--      بمية ويسجّل عشرة. الحل: السيرفر بيحسب المجموع الحقيقي من أسعار
--      قاعدة البيانات، وأي فرق نازل بيتسجّل "خصم" بحد أقصى للكاشير.
--   ٣) الإلغاء (بيع ← أخذ الكاش ← إلغاء) كان مفتوح بدون قيد ولا سبب
--      إلزامي. الحل: الكاشير يلغي طلباته هو بس، خلال مدة قصيرة، وبسبب
--      إلزامي؛ المدير/المالك بدون قيد بس كل شي بينسجّل.
--   ٤) الدوال (record_sale/void_sale/_loyalty_apply/record_purchase) كانت
--      قابلة للنداء حتى بدون تسجيل دخول (بمفتاح anon العام). أُغلق.
--   ٥) سجل تدقيق (audit_log) ما بيتعدّل ولا بيتمسح، يشوفه المالك بس.
--
-- إعدادات قابلة للتعديل من app_settings (المالك/المدير):
--   staff_max_discount_percent  (افتراضي 10)  أقصى خصم للكاشير % من الطلب
--   staff_void_minutes          (افتراضي 10)  مدة سماح الكاشير بإلغاء طلبه

-- ---------- أدوات مساعدة ----------
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active is not false $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.auth_role() in ('owner', 'manager'), false) $$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.auth_role() = 'owner', false) $$;

create or replace function public.app_setting_num(p_key text, p_default numeric)
returns numeric language plpgsql stable security definer set search_path = public
as $$
declare v text;
begin
  select value into v from public.app_settings where key = p_key;
  if v is null or trim(v) = '' then return p_default; end if;
  return v::numeric;
exception when others then
  return p_default;
end;
$$;

insert into public.app_settings (key, value) values
  ('staff_max_discount_percent', '10'),
  ('staff_void_minutes', '10')
on conflict (key) do nothing;

-- ---------- أعمدة جديدة ----------
alter table public.sales_entries add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.sale_items add column if not exists voided_by uuid references public.profiles(id);

-- ---------- ١) صلاحيات الجداول ----------
-- المبيعات وأصنافها: القراءة للكل، الكتابة عبر الدوال بس، الحذف للمالك
drop policy if exists sales_entries_rw on public.sales_entries;
drop policy if exists sales_entries_select on public.sales_entries;
drop policy if exists sales_entries_delete on public.sales_entries;
create policy sales_entries_select on public.sales_entries for select using (public.auth_role() is not null);
create policy sales_entries_delete on public.sales_entries for delete using (public.is_owner());

drop policy if exists sale_items_rw on public.sale_items;
drop policy if exists sale_items_select on public.sale_items;
drop policy if exists sale_items_delete on public.sale_items;
create policy sale_items_select on public.sale_items for select using (public.auth_role() is not null);
create policy sale_items_delete on public.sale_items for delete using (public.is_owner());

-- تقفيل الخزينة: الكاشير يضيف تقفيل (باسمه غصبًا)، بس ما يعدّل ولا يمسح
drop policy if exists cash_closings_rw on public.cash_closings;
drop policy if exists cash_closings_select on public.cash_closings;
drop policy if exists cash_closings_insert on public.cash_closings;
drop policy if exists cash_closings_admin on public.cash_closings;
drop policy if exists cash_closings_admin_del on public.cash_closings;
create policy cash_closings_select on public.cash_closings for select using (public.auth_role() is not null);
create policy cash_closings_insert on public.cash_closings for insert with check (public.auth_role() is not null);
create policy cash_closings_admin on public.cash_closings for update using (public.is_admin()) with check (public.is_admin());
create policy cash_closings_admin_del on public.cash_closings for delete using (public.is_admin());

-- المصروفات: الكاشير يضيف (باسمه غصبًا)، بس ما يعدّل ولا يمسح
drop policy if exists expenses_rw on public.expenses;
drop policy if exists expenses_select on public.expenses;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_admin_upd on public.expenses;
drop policy if exists expenses_admin_del on public.expenses;
create policy expenses_select on public.expenses for select using (public.auth_role() is not null);
create policy expenses_insert on public.expenses for insert with check (public.auth_role() is not null);
create policy expenses_admin_upd on public.expenses for update using (public.is_admin()) with check (public.is_admin());
create policy expenses_admin_del on public.expenses for delete using (public.is_admin());

-- جداول القراءة للكل والكتابة للمالك/المدير
do $$
declare
  t text;
begin
  foreach t in array array[
    'expense_categories', 'products', 'addons', 'ingredients', 'product_ingredients',
    'addon_ingredients', 'supplies', 'restaurant_tables', 'customers'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for select using (public.auth_role() is not null)', t || '_select', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- جداول للمالك/المدير بالكامل (قراءة وكتابة): مشتريات وموردين
do $$
declare
  t text;
begin
  foreach t in array array['purchases', 'suppliers', 'supplier_transactions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- مهام الطباعة: القراءة للكل، الكتابة للمالك/المدير (البيع بينشئها عبر الدوال)
drop policy if exists print_jobs_rw on public.print_jobs;
drop policy if exists print_jobs_select on public.print_jobs;
drop policy if exists print_jobs_admin_write on public.print_jobs;
create policy print_jobs_select on public.print_jobs for select using (public.auth_role() is not null);
create policy print_jobs_admin_write on public.print_jobs for all using (public.is_admin()) with check (public.is_admin());

-- عدّاد رقم الطلب: بيتحدّث من trigger بس، ما حدا يلمسه مباشرة
drop policy if exists daily_order_counters_rw on public.daily_order_counters;

-- الإعدادات العامة: الرقم السري ما بينقرا ولا بيتعدّل إلا عبر دوال المالك
drop policy if exists app_settings_rw on public.app_settings;
drop policy if exists app_settings_select on public.app_settings;
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (public.auth_role() is not null and key <> 'reset_pin');
create policy app_settings_admin_write on public.app_settings
  for all using (public.is_admin() and key <> 'reset_pin')
  with check (public.is_admin() and key <> 'reset_pin');

-- الملفات الشخصية: كل واحد يشوف نفسه، والمالك/المدير يشوفوا الكل (الأجور
-- سرية عن باقي الكاشيرية)
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id and role = 'staff');

-- ما حدا غير المالك/المدير يغيّر الدور أو الأجر أو التفعيل أو الاسم أو رقم
-- البصمة على حسابه هو (رقم البصمة والاسم كان ممكن يستغلهم كاشير ينتحل
-- شخصية زميله بسجل الحضور والفواتير)
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  caller_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role in ('owner', 'manager') then
    -- المدير ما يقدر يرفّع أحد لمدير/مالك ولا يعدّل حساب مالك
    if caller_role = 'manager' and (
         new.role is distinct from old.role or old.role = 'owner'
       ) then
      raise exception 'تعديل الأدوار وحسابات المالك لصاحب المطعم فقط';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.hourly_wage is distinct from old.hourly_wage
     or new.is_active is distinct from old.is_active
     or new.full_name is distinct from old.full_name
     or new.device_user_id is distinct from old.device_user_id then
    raise exception 'غير مسموح تعديل الدور أو الأجر أو الاسم أو رقم البصمة — راجع مديرك';
  end if;
  return new;
end;
$$;

-- الـviews كانت بتشتغل بصلاحيات صاحبها (بتتخطى RLS) — نخليها بصلاحيات
-- المستخدم اللي بيقراها
alter view public.employee_shifts set (security_invoker = true);
alter view public.ingredient_consumption set (security_invoker = true);
alter view public.low_stock_items set (security_invoker = true);
do $$
begin
  if to_regclass('public.product_sales_totals') is not null then
    execute 'alter view public.product_sales_totals set (security_invoker = true)';
  end if;
end $$;

-- ---------- تسجيل ذاتي من الإنترنت ----------
-- مفتاح anon موجود بكود الموقع (عام، وهيك المفروض)، فلو "Enable sign ups"
-- شغّال بإعدادات Supabase Auth أي زائر يقدر يسجّل حساب لحاله. حتى لو نسيت
-- تسكّره: أي حساب جديد (غير أول حساب بالنظام) بيتعمله بروفايل "موقوف" فما
-- بيقرا ولا بيكتب أي شي. الموظف الجديد الحقيقي بينشئه المدير من صفحة الموظفين
-- (Edge Function manage-employees) وهي بتفعّله صراحة.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'staff',
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- سياسات كانت تكتفي بـ"أي مسجّل دخول" — نربطها بحساب فعّال
drop policy if exists printers_select on public.printers;
create policy printers_select on public.printers for select using (public.auth_role() is not null);
drop policy if exists printer_settings_select on public.printer_settings;
create policy printer_settings_select on public.printer_settings for select using (public.auth_role() is not null);
drop policy if exists table_occupancy_rw on public.table_occupancy;
create policy table_occupancy_rw on public.table_occupancy
  for all using (public.auth_role() is not null) with check (public.auth_role() is not null);

-- ---------- فرض هوية الفاعل على المصروفات وتقفيل الخزينة ----------
create or replace function public.force_actor()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    if tg_table_name = 'expenses' then new.created_by := auth.uid(); end if;
    if tg_table_name = 'cash_closings' then new.closed_by := auth.uid(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists expenses_force_actor on public.expenses;
create trigger expenses_force_actor before insert on public.expenses
  for each row execute function public.force_actor();
drop trigger if exists cash_closings_force_actor on public.cash_closings;
create trigger cash_closings_force_actor before insert on public.cash_closings
  for each row execute function public.force_actor();

-- ---------- تنظيف نسخ قديمة من الدوال (بتتخطى الحماية لو بقيت) ----------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and ((p.proname = 'record_sale' and p.pronargs <> 12)
        or (p.proname = 'void_sale' and p.pronargs <> 2)
        or (p.proname = 'void_sale_item' and p.pronargs <> 2)
        or (p.proname = 'record_purchase' and p.pronargs <> 7))
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- ---------- ٢) record_sale: السيرفر بيحسب ويتحقق ----------
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
  p_customer_phone text default null,
  p_customer_name text default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
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
  v_addons_found int;
  v_addons_wanted int;
  v_total numeric;
  v_expected numeric := 0;
  v_paid numeric;
  v_discount numeric;
  v_max_pct numeric;
  v_change numeric;
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'الطلب فاضي';
  end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_card, 0) < 0 or coalesce(p_delivery, 0) < 0 then
    raise exception 'مبلغ غير صالح';
  end if;
  if v_role = 'staff' and (
       p_entry_date is null or p_entry_date < current_date - 2 or p_entry_date > current_date + 1
     ) then
    raise exception 'تاريخ البيع خارج المسموح للكاشير';
  end if;

  -- مرور أول: تحقق وحساب المجموع الحقيقي من أسعار قاعدة البيانات
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 200 then
      raise exception 'كمية غير صالحة';
    end if;
    select price into v_unit_price from public.products where id = v_product_id;
    if not found then
      raise exception 'صنف غير موجود بقائمة المنتجات';
    end if;
    select coalesce(sum(price), 0), count(*) into v_addons_total, v_addons_found
    from public.addons
    where id in (select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid);
    select count(distinct x) into v_addons_wanted
    from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) x;
    if v_addons_found <> v_addons_wanted then
      raise exception 'إضافة غير موجودة';
    end if;
    v_expected := v_expected + (coalesce(v_unit_price, 0) + v_addons_total) * v_qty;
  end loop;

  v_paid := coalesce(p_cash, 0) + coalesce(p_card, 0) + coalesce(p_delivery, 0);
  v_discount := greatest(round(v_expected - v_paid, 2), 0);
  if v_discount < 0.02 then v_discount := 0; end if;

  if v_discount > 0 and v_role = 'staff' then
    v_max_pct := public.app_setting_num('staff_max_discount_percent', 10);
    if v_discount > round(v_expected * v_max_pct / 100, 2) + 0.01 then
      raise exception 'الخصم يتعدى الحد المسموح للكاشير (% %%) — يحتاج موافقة مدير', v_max_pct;
    end if;
  end if;

  v_change := case
    when p_cash_received is not null and coalesce(p_cash, 0) > 0 then greatest(p_cash_received - p_cash, 0)
    else p_change_due
  end;

  insert into public.sales_entries (
    entry_date, cash_amount, card_amount, delivery_amount, notes, order_type,
    cash_received, change_due, table_number, customer_phone, customer_name, created_by,
    discount_amount
  )
  values (
    p_entry_date, p_cash, p_card, p_delivery, left(p_notes, 1000), left(p_order_type, 60),
    p_cash_received, v_change, left(p_table_number, 30), left(p_customer_phone, 30),
    left(p_customer_name, 120), auth.uid(), v_discount
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := left(v_item->>'note', 300);

    select name, price into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، '), coalesce(sum(price), 0)
    into v_addons_summary, v_addons_total
    from public.addons
    where id in (
      select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    );

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary, addons_total)
    values (v_sale_id, v_product_id, v_product_name, v_qty, v_unit_price, v_note, v_addons_summary, coalesce(v_addons_total, 0));

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

  v_total := v_paid;
  perform public._loyalty_apply(p_customer_phone, p_customer_name, 1, v_total, floor(v_total)::integer);

  return v_sale_id;
end;
$$;

-- ---------- ٣) الإلغاء: قيود الكاشير + سبب إلزامي ----------
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

  select * into v_sale from public.sales_entries where id = p_sale_id;
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

  for v_item in select product_id, qty from public.sale_items where sale_id = p_sale_id and status = 'completed'
  loop
    update public.ingredients i
    set current_stock = i.current_stock + (pi.quantity * v_item.qty)
    from public.product_ingredients pi
    where pi.product_id = v_item.product_id and pi.ingredient_id = i.id;
  end loop;

  update public.print_jobs set status = 'skipped'
  where sale_id = p_sale_id and status = 'pending';

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
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;

  select * into v_item from public.sale_items where id = p_sale_item_id;
  if v_item.id is null then
    raise exception 'صنف البيع غير موجود';
  end if;
  if v_item.status = 'voided' then
    raise exception 'هذا الصنف ملغى أصلًا';
  end if;

  select * into v_sale from public.sales_entries where id = v_item.sale_id;
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
  set status = 'voided', void_reason = left(trim(p_reason), 300), voided_at = now(), voided_by = auth.uid()
  where id = p_sale_item_id;

  perform public._loyalty_apply(v_sale.customer_phone, null, 0, -v_line_total, -floor(v_line_total)::integer);

  select count(*) into v_remaining_count from public.sale_items
  where sale_id = v_item.sale_id and status = 'completed';
  if v_remaining_count = 0 then
    update public.print_jobs set status = 'skipped' where sale_id = v_item.sale_id and status = 'pending';
    update public.sales_entries
    set status = 'voided', void_reason = coalesce(void_reason, 'كل أصناف الطلب أُلغيت فرادى'), voided_at = now(), voided_by = auth.uid()
    where id = v_item.sale_id;

    perform public._loyalty_apply(v_sale.customer_phone, null, -1, 0, 0);
  end if;
end;
$$;

-- ---------- حالة المطبخ: نداء محروس بدل تعديل مباشر على جدول المبيعات ----------
create or replace function public.set_kitchen_status(p_sale_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if public.auth_role() is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;
  if p_status not in ('قيد التحضير', 'جاهز') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.sales_entries set kitchen_status = p_status where id = p_sale_id;
end;
$$;

-- ---------- المشتريات: للمالك/المدير بس ----------
create or replace function public.record_purchase(
  p_ingredient_id uuid,
  p_supply_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_supplier_id uuid,
  p_purchase_date date,
  p_notes text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_item_name text;
  v_unit text;
  v_total numeric;
  v_category_id uuid;
  v_expense_id uuid;
begin
  if not public.is_admin() then
    raise exception 'تسجيل المشتريات للمالك والمدير فقط';
  end if;
  if (p_ingredient_id is null) = (p_supply_id is null) then
    raise exception 'لازم تحدد مادة خام أو مستلزم واحد بس';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'الكمية لازم تكون أكبر من صفر';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'سعر الوحدة غير صالح';
  end if;

  v_total := p_quantity * p_unit_price;

  if p_ingredient_id is not null then
    select name, unit into v_item_name, v_unit from public.ingredients where id = p_ingredient_id;
    if v_item_name is null then
      raise exception 'المادة الخام غير موجودة';
    end if;
    update public.ingredients
      set current_stock = current_stock + p_quantity, unit_price = p_unit_price
      where id = p_ingredient_id;
  else
    select name, unit into v_item_name, v_unit from public.supplies where id = p_supply_id;
    if v_item_name is null then
      raise exception 'المستلزم غير موجود';
    end if;
    update public.supplies
      set current_stock = current_stock + p_quantity, unit_price = p_unit_price
      where id = p_supply_id;
  end if;

  select id into v_category_id from public.expense_categories where name = 'مشتريات ومخزون' limit 1;

  insert into public.expenses (expense_date, category_id, amount, description, created_by)
  values (
    p_purchase_date,
    v_category_id,
    v_total,
    v_item_name || ' — ' || p_quantity || ' ' || v_unit ||
      case when p_notes is not null and p_notes <> '' then ' (' || p_notes || ')' else '' end,
    auth.uid()
  )
  returning id into v_expense_id;

  insert into public.purchases (
    ingredient_id, supply_id, item_name, unit, quantity, unit_price,
    supplier_id, purchase_date, notes, expense_id, created_by
  ) values (
    p_ingredient_id, p_supply_id, v_item_name, v_unit, p_quantity, p_unit_price,
    p_supplier_id, p_purchase_date, p_notes, v_expense_id, auth.uid()
  )
  returning id into v_purchase_id;

  return v_purchase_id;
end;
$$;

-- ---------- الرقم السري لمنطقة الخطر: بيتحقق منه السيرفر، ما بينقرا أبدًا ----------
create or replace function public.verify_reset_pin(p_pin text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_pin text;
begin
  if not public.is_admin() then
    raise exception 'منطقة الخطر للمالك والمدير فقط';
  end if;
  select value into v_pin from public.app_settings where key = 'reset_pin';
  return p_pin is not null and p_pin = coalesce(v_pin, '1234');
end;
$$;

create or replace function public.set_reset_pin(p_old text, p_new text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_pin text;
begin
  if not public.is_owner() then
    raise exception 'تغيير الرقم السري لصاحب المطعم فقط';
  end if;
  select value into v_pin from public.app_settings where key = 'reset_pin';
  if p_old is distinct from coalesce(v_pin, '1234') then
    raise exception 'الرقم السري الحالي غير صحيح';
  end if;
  if p_new is null or length(p_new) < 4 then
    raise exception 'الرقم السري الجديد لازم يكون 4 خانات على الأقل';
  end if;
  insert into public.app_settings (key, value) values ('reset_pin', p_new)
  on conflict (key) do update set value = excluded.value;
end;
$$;

-- ---------- ٤) إغلاق النداء المجهول: التنفيذ للمسجّلين بس ----------
revoke execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text, text) from public, anon;
revoke execute on function public.void_sale(uuid, text) from public, anon;
revoke execute on function public.void_sale_item(uuid, text) from public, anon;
revoke execute on function public.record_purchase(uuid, uuid, numeric, numeric, uuid, date, text) from public, anon;
revoke execute on function public.set_kitchen_status(uuid, text) from public, anon;
revoke execute on function public.verify_reset_pin(text) from public, anon;
revoke execute on function public.set_reset_pin(text, text) from public, anon;
revoke execute on function public._loyalty_apply(text, text, integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.void_sale_item(uuid, text) to authenticated;
grant execute on function public.record_purchase(uuid, uuid, numeric, numeric, uuid, date, text) to authenticated;
grant execute on function public.set_kitchen_status(uuid, text) to authenticated;
grant execute on function public.verify_reset_pin(text) to authenticated;
grant execute on function public.set_reset_pin(text, text) to authenticated;

-- ---------- ٥) سجل التدقيق: ما بيتعدّل ولا بيتمسح، يشوفه المالك بس ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  table_name text not null,
  op text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_owner_select on public.audit_log;
create policy audit_log_owner_select on public.audit_log for select using (public.is_owner());
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- الوسيط الأول (اختياري) = أعمدة تُتجاهل عند التقاط التعديل (ضجيج)
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_ignore text[] := case when tg_nargs > 0 then string_to_array(tg_argv[0], ',') else '{}'::text[] end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  d_old jsonb;
  d_new jsonb;
begin
  if tg_table_name = 'app_settings' and v_row->>'key' = 'print_bridge_heartbeat' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    v_old := v_old - v_ignore;
    v_new := v_new - v_ignore;
    if v_old = v_new then return new; end if;
    select coalesce(jsonb_object_agg(k, v), '{}') into d_old
      from jsonb_each(v_old) e(k, v) where v_new->k is distinct from v;
    select coalesce(jsonb_object_agg(k, v), '{}') into d_new
      from jsonb_each(v_new) e(k, v) where v_old->k is distinct from v;
    v_old := d_old;
    v_new := d_new;
  end if;

  if tg_table_name = 'app_settings' and v_row->>'key' = 'reset_pin' then
    v_old := case when v_old is null then null else '{"value":"***"}'::jsonb end;
    v_new := case when v_new is null then null else '{"value":"***"}'::jsonb end;
  end if;

  insert into public.audit_log (actor, actor_name, table_name, op, row_id, old_data, new_data)
  values (
    auth.uid(),
    coalesce((select full_name from public.profiles where id = auth.uid()), case when auth.uid() is null then 'النظام' end),
    tg_table_name, tg_op, v_row->>'id', v_old, v_new
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('sales_entries',   'update or delete',          'kitchen_status'),
      ('sale_items',      'update or delete',          ''),
      ('products',        'update or delete',          'sort_order,image_url,description,external_id'),
      ('addons',          'update or delete',          ''),
      ('expenses',        'insert or update or delete', ''),
      ('cash_closings',   'insert or update or delete', ''),
      ('customers',       'delete',                    ''),
      ('ingredients',     'delete',                    ''),
      ('app_settings',    'insert or update or delete', ''),
      ('profiles',        'update',                    ''),
      ('employee_punches','insert or update or delete', ''),
      ('salary_advances', 'insert or update or delete', ''),
      ('payroll_payments','insert or update or delete', '')
    ) as v(tbl, ops, ignore_cols)
  loop
    execute format('drop trigger if exists %I on public.%I', spec.tbl || '_audit', spec.tbl);
    execute format(
      'create trigger %I after %s on public.%I for each row execute function public.log_audit(%L)',
      spec.tbl || '_audit', spec.ops, spec.tbl, spec.ignore_cols
    );
  end loop;
end $$;
