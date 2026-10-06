-- تجهيز طلبيات المشتريات: بتختار المورّد، وبتطلع لك مواده (الخام والمستلزمات) مع المخزون الحالي
-- والكمية المقترحة، بتعدّل الكميات وبتحفظ الطلبية وبترسلها (واتساب/نسخ)، ولما تستلمها بتتحول لفاتورة
-- مشتريات بضغطة وحدة (purchase-invoices.html?po=...).
--
--   • supplier_items: ربط المورّد بالمواد اللي بنشتريها منه (مادة خام أو مستلزم) — مرة وحدة وبتضل
--   • purchase_orders / purchase_order_lines: الطلبية وسطورها (نسخة من اسم الصنف ووحدته وقت الطلب)
--   • save_purchase_order(): بتحفظ/بتعدّل مسودة بعملية وحدة. set_purchase_order_status(): مسودة → مُرسلة → مستلمة/ملغاة
--
-- للمالك والمدير فقط (is_admin). شغّله بعد schema-purchase-invoices.sql

-- ---------- ربط المورّد بالمواد ----------
create table if not exists public.supplier_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  supply_id uuid references public.supplies(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint supplier_items_one_kind check ((ingredient_id is not null) <> (supply_id is not null))
);
create unique index if not exists supplier_items_ing_uq on public.supplier_items (supplier_id, ingredient_id) where ingredient_id is not null;
create unique index if not exists supplier_items_sup_uq on public.supplier_items (supplier_id, supply_id) where supply_id is not null;

-- ---------- الطلبيات ----------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  notes text,
  est_total numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz
);
create index if not exists purchase_orders_created_idx on public.purchase_orders (created_at desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  supply_id uuid references public.supplies(id) on delete set null,
  item_name text not null,
  qty numeric(14,3) not null check (qty > 0),
  -- وحدة الطلب (كرتونة مثلًا أو نفس وحدة المخزون) وكم وحدة مخزون فيها
  order_unit text not null,
  factor numeric(12,3) not null default 1 check (factor > 0),
  stock_unit text not null,
  est_unit_price numeric(12,2),
  created_at timestamptz not null default now(),
  constraint purchase_order_lines_one_kind check (not (ingredient_id is not null and supply_id is not null))
);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (order_id);

-- ---------- الصلاحيات: للمالك والمدير فقط ----------
alter table public.supplier_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['supplier_items', 'purchase_orders', 'purchase_order_lines'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_select') then
      execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_select', t);
    end if;
  end loop;
  -- ربط المورّد بالمواد بيتعدّل مباشرة (بدون دالة)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supplier_items' and policyname = 'supplier_items_admin_insert') then
    create policy supplier_items_admin_insert on public.supplier_items for insert with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supplier_items' and policyname = 'supplier_items_admin_delete') then
    create policy supplier_items_admin_delete on public.supplier_items for delete using (public.is_admin());
  end if;
end $$;
-- الطلبيات وسطورها بتتكتب عبر الدوال فقط، إلا حذف سطور المسودة (لإعادة حفظها) مسموح بسياسة خاصة
revoke insert, update, delete on public.purchase_orders from anon, authenticated;
revoke insert, update on public.purchase_order_lines from anon, authenticated;
revoke all on public.supplier_items from anon;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_order_lines' and policyname = 'purchase_order_lines_admin_delete_draft') then
    create policy purchase_order_lines_admin_delete_draft on public.purchase_order_lines for delete
      using (public.is_admin() and exists (select 1 from public.purchase_orders o where o.id = order_id and o.status = 'draft'));
  end if;
end $$;
grant delete on public.purchase_order_lines to authenticated;

-- ---------- التدقيق ----------
create or replace trigger purchase_orders_audit after insert or update or delete on public.purchase_orders
  for each row execute function public.log_audit('');
create or replace trigger supplier_items_audit after insert or delete on public.supplier_items
  for each row execute function public.log_audit('');

-- ---------- حفظ طلبية (مسودة جديدة أو تعديل مسودة موجودة) ----------
-- p_lines: [{ "ingredient_id" | "supply_id": uuid, "qty": رقم, "order_unit": نص, "factor": رقم, "est_unit_price": رقم }, ...]
-- الكمية بوحدة الطلب؛ factor = كم وحدة مخزون بوحدة الطلب. الاسم ووحدة المخزون بيتقروا من السيرفر
create or replace function public.save_purchase_order(
  p_order_id uuid,
  p_supplier_id uuid,
  p_notes text,
  p_lines jsonb
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_status text;
  v_line jsonb;
  v_ing uuid;
  v_sup uuid;
  v_item_name text;
  v_stock_unit text;
  v_qty numeric;
  v_factor numeric;
  v_price numeric;
  v_total numeric := 0;
begin
  if not public.is_admin() then raise exception 'غير مسموح'; end if;
  if p_supplier_id is null then raise exception 'اختر المورّد'; end if;
  select name into v_name from public.suppliers where id = p_supplier_id;
  if v_name is null then raise exception 'المورّد غير موجود'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'الطلبية فاضية — أضف كمية لصنف واحد على الأقل';
  end if;

  if p_order_id is null then
    insert into public.purchase_orders (supplier_id, supplier_name, notes, created_by)
    values (p_supplier_id, v_name, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.purchase_orders where id = p_order_id for update;
    if v_status is null then raise exception 'الطلبية غير موجودة'; end if;
    if v_status <> 'draft' then raise exception 'بس المسودة بتنعدّل'; end if;
    -- تعديل مسودة: الواجهة بتمسح السطور القديمة أولًا (سياسة حذف للمسودة بس)، والدالة بتضيف الجديدة
    if exists (select 1 from public.purchase_order_lines where order_id = p_order_id) then
      raise exception 'سطور المسودة القديمة لازم تنشال قبل الحفظ';
    end if;
    v_id := p_order_id;
    update public.purchase_orders
       set supplier_id = p_supplier_id, supplier_name = v_name, notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line->>'ingredient_id', '')::uuid;
    v_sup := nullif(v_line->>'supply_id', '')::uuid;
    if (v_ing is null) = (v_sup is null) then raise exception 'سطر بدون صنف صحيح'; end if;
    v_qty := (v_line->>'qty')::numeric;
    v_factor := coalesce(nullif(v_line->>'factor', '')::numeric, 1);
    v_price := nullif(v_line->>'est_unit_price', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'الكمية لازم تكون أكبر من صفر'; end if;
    if v_factor <= 0 then raise exception 'معامل وحدة الطلب غير صحيح'; end if;
    if v_price is not null and v_price < 0 then raise exception 'السعر غير صحيح'; end if;
    if v_ing is not null then
      select name, unit into v_item_name, v_stock_unit from public.ingredients where id = v_ing;
    else
      select name, unit into v_item_name, v_stock_unit from public.supplies where id = v_sup;
    end if;
    if v_item_name is null then raise exception 'صنف غير موجود'; end if;
    insert into public.purchase_order_lines (order_id, ingredient_id, supply_id, item_name, qty, order_unit, factor, stock_unit, est_unit_price)
    values (v_id, v_ing, v_sup, v_item_name, v_qty, coalesce(nullif(btrim(v_line->>'order_unit'), ''), v_stock_unit), v_factor, v_stock_unit, v_price);
    v_total := v_total + round(v_qty * coalesce(v_price, 0), 2);
  end loop;

  update public.purchase_orders set est_total = round(v_total, 2) where id = v_id;
  return v_id;
end;
$$;
grant execute on function public.save_purchase_order(uuid, uuid, text, jsonb) to authenticated;

-- ---------- تغيير حالة طلبية ----------
-- مسودة → مُرسلة → مستلمة، أو ملغاة من أي حالة غير مستلمة. المستلمة والملغاة نهائية
create or replace function public.set_purchase_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'غير مسموح'; end if;
  if p_status not in ('sent', 'received', 'cancelled') then raise exception 'حالة غير صحيحة'; end if;
  select status into v_status from public.purchase_orders where id = p_order_id for update;
  if v_status is null then raise exception 'الطلبية غير موجودة'; end if;
  if v_status in ('received', 'cancelled') then raise exception 'الطلبية انتهت وما بتتغير'; end if;
  update public.purchase_orders
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         received_at = case when p_status = 'received' then now() else received_at end
   where id = p_order_id;
end;
$$;
grant execute on function public.set_purchase_order_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
