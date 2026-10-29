-- إضافة أصناف على طلب انطبع وانحفظ (بدون إعادة طباعة الأصناف القديمة).
-- add_items_to_sale بتضيف الأصناف الجديدة على نفس الطلب بنفس حسابات record_sale (سعر الصالة، الإضافات، المخزون)،
-- وبتسجّل دفعة الفرق، وبتبعت تذكرة تحضير للأقسام فيها الأصناف الجديدة بس (item_ids = الجدد فقط)،
-- فالأصناف اللي انطبعت قبل ما بتنطبع مرة تانية أبدًا. الشطب موجود أصلًا (void_sale_item + تذكرة إلغاء تلقائية).
-- آمن لإعادة التشغيل (idempotent). شغّله بعد schema-sale-overpay-guard.sql و schema-hall-price.sql.

alter table public.print_jobs add column if not exists is_addition boolean not null default false;

-- سجل الإضافات (ما بيتعدّل): مين أضاف شو ومتى، ومفتاح منع التكرار لو انعاد الإرسال
create table if not exists public.sale_additions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sale_id uuid not null references public.sales_entries(id) on delete cascade,
  client_ref uuid unique,
  actor uuid,
  actor_name text,
  item_ids uuid[] not null,
  items_total numeric not null,
  paid numeric not null
);
create index if not exists sale_additions_sale_idx on public.sale_additions (sale_id, at);
alter table public.sale_additions enable row level security;
drop policy if exists sale_additions_select on public.sale_additions;
create policy sale_additions_select on public.sale_additions for select using (public.auth_role() is not null);
revoke insert, update, delete on public.sale_additions from anon, authenticated;

create or replace function public.add_items_to_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_cash numeric default 0,
  p_card numeric default 0,
  p_delivery numeric default 0,
  p_client_ref uuid default null
) returns uuid[]
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := public.auth_role();
  v_sale record;
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
  v_expected numeric := 0;
  v_paid numeric;
  v_discount numeric;
  v_max_pct numeric;
  v_hours numeric;
  v_hall boolean;
  v_new_id uuid;
  v_new_ids uuid[] := '{}';
  v_printer record;
  v_ids uuid[];
  v_claimed text[];
  v_prev uuid[];
begin
  if v_role is null then
    raise exception 'غير مصرّح — سجّل دخول بحساب فعّال';
  end if;

  -- نفس الطلب وصل قبل (إعادة إرسال): منرجّع نتيجته بدل ما تتكرر الأصناف
  if p_client_ref is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
    select item_ids into v_prev from public.sale_additions where client_ref = p_client_ref;
    if v_prev is not null then
      return v_prev;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ما في أصناف للإضافة';
  end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_card, 0) < 0 or coalesce(p_delivery, 0) < 0 then
    raise exception 'مبلغ غير صالح';
  end if;

  select * into v_sale from public.sales_entries where id = p_sale_id for update;
  if v_sale.id is null then
    raise exception 'الطلب غير موجود';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'الطلب ملغى — ما بتنضاف عليه أصناف';
  end if;
  if v_role = 'staff' then
    v_hours := public.app_setting_num('staff_reprint_hours', 24);
    if v_sale.created_by is distinct from auth.uid() then
      raise exception 'الكاشير بيضيف على طلباته هو بس — بلّغ المدير';
    end if;
    if now() - v_sale.created_at > v_hours * interval '1 hour' then
      raise exception 'مرّت أكتر من % ساعة على هذا الطلب — بلّغ المدير', v_hours;
    end if;
  end if;

  v_hall := (btrim(coalesce(v_sale.order_type, '')) = 'صالة');

  -- مرور أول: تحقق وحساب المجموع من أسعار قاعدة البيانات
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 200 then
      raise exception 'كمية غير صالحة';
    end if;
    select case when v_hall and hall_price > 0 then hall_price else price end into v_unit_price
    from public.products where id = v_product_id;
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
  if v_paid > v_expected + 0.01 then
    raise exception 'المبلغ المدفوع (%) أكبر من قيمة الأصناف المضافة (%)', round(v_paid, 2), round(v_expected, 2);
  end if;
  v_discount := greatest(round(v_expected - v_paid, 2), 0);
  if v_discount < 0.02 then v_discount := 0; end if;
  if v_discount > 0 and v_role = 'staff' then
    v_max_pct := public.app_setting_num('staff_max_discount_percent', 10);
    if v_discount > round(v_expected * v_max_pct / 100, 2) + 0.01 then
      raise exception 'الخصم يتعدى الحد المسموح للكاشير (% %%) — يحتاج موافقة مدير', v_max_pct;
    end if;
  end if;

  -- مرور ثاني: إدخال الأصناف وخصم المخزون
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := left(v_item->>'note', 300);

    select name, case when v_hall and hall_price > 0 then hall_price else price end
    into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، '), coalesce(sum(price), 0)
    into v_addons_summary, v_addons_total
    from public.addons
    where id in (select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid);

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary, addons_total, addon_ids)
    values (p_sale_id, v_product_id, v_product_name, v_qty, v_unit_price, v_note, v_addons_summary, coalesce(v_addons_total, 0),
      (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) x))
    returning id into v_new_id;
    v_new_ids := v_new_ids || v_new_id;

    update public.ingredients i
    set current_stock = i.current_stock - (pi.quantity * v_qty)
    from public.product_ingredients pi
    where pi.product_id = v_product_id and pi.ingredient_id = i.id;

    for v_addon_id in select distinct (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    loop
      update public.ingredients i
      set current_stock = i.current_stock - (ai.quantity * v_qty)
      from public.addon_ingredients ai
      where ai.addon_id = v_addon_id and ai.ingredient_id = i.id;
    end loop;
  end loop;

  -- الدفعة والخصم على نفس الطلب، والمطبخ يرجع «قيد التحضير» لو كان جاهز
  update public.sales_entries
     set cash_amount = coalesce(cash_amount, 0) + coalesce(p_cash, 0),
         card_amount = coalesce(card_amount, 0) + coalesce(p_card, 0),
         delivery_amount = coalesce(delivery_amount, 0) + coalesce(p_delivery, 0),
         discount_amount = coalesce(discount_amount, 0) + v_discount,
         kitchen_status = 'قيد التحضير',
         kitchen_ready_at = null
   where id = p_sale_id;

  -- تذكرة تحضير للأقسام: الأصناف الجديدة بس (item_ids)، والقديمة ما بتنطبع
  if exists (select 1 from public.printers) then
    select coalesce(array_agg(distinct c), '{}') into v_claimed
    from public.printers p, unnest(p.categories) c
    where p.enabled and p.kind = 'station';

    for v_printer in select * from public.printers where enabled and kind = 'station' order by sort_order loop
      select array_agg(si.id) into v_ids
      from public.sale_items si
      left join public.products pr on pr.id = si.product_id
      where si.id = any(v_new_ids)
        and (
          coalesce(pr.category, '') = any(v_printer.categories)
          or (v_printer.catch_unassigned and not (coalesce(pr.category, '') = any(v_claimed)))
        );
      if v_ids is not null then
        insert into public.print_jobs (sale_id, job_type, printer_id, item_ids, is_addition)
        values (p_sale_id, 'kitchen', v_printer.id, v_ids, true);
      end if;
    end loop;
  end if;

  perform public._loyalty_apply(v_sale.customer_phone, v_sale.customer_name, 0, v_paid, floor(v_paid)::integer);

  insert into public.sale_additions (sale_id, client_ref, actor, actor_name, item_ids, items_total, paid)
  values (p_sale_id, p_client_ref, auth.uid(), (select full_name from public.profiles where id = auth.uid()),
          v_new_ids, v_expected, v_paid);

  return v_new_ids;
end;
$$;

revoke all on function public.add_items_to_sale(uuid, jsonb, numeric, numeric, numeric, uuid) from public, anon;
grant execute on function public.add_items_to_sale(uuid, jsonb, numeric, numeric, numeric, uuid) to authenticated;
