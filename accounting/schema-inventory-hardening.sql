-- تقوية الجرد والمشتريات (مراجعة 2026-10-03)
-- ⚠ مقترح: لسا ما انشغّل على قاعدة البيانات الحية — بينشغّل بس بعد موافقة صاحب المطعم.
-- آمن لإعادة التشغيل (idempotent).
--
-- 1) سجل حركات المخزون stock_movements + دالة تعديل ذرّية adjust_stock (بدل ما الصفحة
--    تقرأ الكمية وتكتبها من جديد، اللي بيضيّع بيعات صارت بنفس اللحظة وما بيترك أي أثر)
-- 2) دالة جرد فعلي record_stock_count: بتدخل العدّ الحقيقي وبتسجّل الفرق (عجز/زيادة) لكل مادة
-- 3) سجل تدقيق (audit_log) على المواد والمستلزمات والموردين وقيودهم والمشتريات
-- 4) المشتريات ما بتنكتب إلا من دوال التسجيل/الإلغاء (المدير ما بيقدر يعدّلها أو يحذفها مباشرة)
-- 5) قيود المورّد الجاية من فاتورة ما بتنحذف/تتعدّل إلا بإلغاء الفاتورة نفسها
-- 6) إلغاء فاتورة: قفل الصف (منع إلغاء مزدوج) + ترجيع تكلفة الصنف لآخر فاتورة فعّالة
--    (قبل: التكلفة الغلط كانت تضل وتأثر على التسعير الذكي بالمنيو)
-- 7) حد حجم ونوع لملفات صور الفواتير على السيرفر

-- ---------- 1) سجل الحركات ----------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_kind text not null check (item_kind in ('ingredient', 'supply')),
  item_id uuid not null,
  item_name text,
  delta numeric not null,
  stock_after numeric,
  reason text not null check (reason in ('adjust', 'count', 'waste')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on public.stock_movements (item_kind, item_id, created_at desc);
create index if not exists stock_movements_created_by_idx on public.stock_movements (created_by);
alter table public.stock_movements enable row level security;
drop policy if exists stock_movements_admin_select on public.stock_movements;
create policy stock_movements_admin_select on public.stock_movements for select using ((select public.is_admin()));
revoke insert, update, delete on public.stock_movements from anon, authenticated;
revoke all on public.stock_movements from anon;
grant select on public.stock_movements to authenticated;

create or replace function public.adjust_stock(p_kind text, p_id uuid, p_delta numeric, p_reason text default 'adjust', p_note text default null)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_after numeric;
  v_name text;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'adjust');
begin
  if not public.is_admin() then
    raise exception 'تعديل المخزون للمالك والمدير فقط';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    raise exception 'كمية التعديل غير صالحة';
  end if;
  if v_reason not in ('adjust', 'waste') then
    raise exception 'سبب التعديل غير صالح';
  end if;
  if p_kind = 'ingredient' then
    update public.ingredients set current_stock = current_stock + p_delta
    where id = p_id returning current_stock, name into v_after, v_name;
  elsif p_kind = 'supply' then
    update public.supplies set current_stock = current_stock + p_delta
    where id = p_id returning current_stock, name into v_after, v_name;
  else
    raise exception 'نوع الصنف غير صالح';
  end if;
  if v_name is null then
    raise exception 'الصنف غير موجود';
  end if;
  insert into public.stock_movements (item_kind, item_id, item_name, delta, stock_after, reason, note)
  values (p_kind, p_id, v_name, p_delta, v_after, v_reason, left(p_note, 300));
  return v_after;
end;
$$;
revoke all on function public.adjust_stock(text, uuid, numeric, text, text) from public, anon;
grant execute on function public.adjust_stock(text, uuid, numeric, text, text) to authenticated;

-- ---------- 2) الجرد الفعلي ----------
-- p_counts: [{ "kind": "ingredient"|"supply", "id": "...", "counted": 12.5 }, ...]
-- بيحط الكمية = العدّ الفعلي، وبيسجّل الفرق بـ stock_movements (reason = count)
create or replace function public.record_stock_count(p_counts jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row jsonb;
  v_kind text;
  v_id uuid;
  v_counted numeric;
  v_before numeric;
  v_name text;
  v_changed int := 0;
  v_value_diff numeric := 0;
  v_cost numeric;
begin
  if not public.is_admin() then
    raise exception 'الجرد للمالك والمدير فقط';
  end if;
  if jsonb_typeof(p_counts) is distinct from 'array' or jsonb_array_length(p_counts) = 0 then
    raise exception 'ما في أصناف بالجرد';
  end if;
  if jsonb_array_length(p_counts) > 2000 then
    raise exception 'عدد الأصناف كبير زيادة';
  end if;
  for v_row in select * from jsonb_array_elements(p_counts) loop
    v_kind := v_row->>'kind';
    v_id := (v_row->>'id')::uuid;
    v_counted := (v_row->>'counted')::numeric;
    if v_counted is null or v_counted < 0 or v_counted > 1000000 then
      raise exception 'كمية جرد غير صالحة';
    end if;
    if v_kind = 'ingredient' then
      select current_stock, name, coalesce(unit_price, 0) into v_before, v_name, v_cost
      from public.ingredients where id = v_id for update;
    elsif v_kind = 'supply' then
      select current_stock, name, coalesce(unit_price, 0) into v_before, v_name, v_cost
      from public.supplies where id = v_id for update;
    else
      raise exception 'نوع الصنف غير صالح';
    end if;
    if v_name is null then
      raise exception 'صنف غير موجود بالجرد';
    end if;
    continue when v_before = v_counted;
    if v_kind = 'ingredient' then
      update public.ingredients set current_stock = v_counted where id = v_id;
    else
      update public.supplies set current_stock = v_counted where id = v_id;
    end if;
    insert into public.stock_movements (item_kind, item_id, item_name, delta, stock_after, reason, note)
    values (v_kind, v_id, v_name, v_counted - v_before, v_counted, 'count', left(p_note, 300));
    v_changed := v_changed + 1;
    v_value_diff := v_value_diff + (v_counted - v_before) * v_cost;
  end loop;
  return jsonb_build_object('changed', v_changed, 'value_diff', round(v_value_diff, 2));
end;
$$;
revoke all on function public.record_stock_count(jsonb, text) from public, anon;
grant execute on function public.record_stock_count(jsonb, text) to authenticated;

-- ---------- 3) التدقيق ----------
-- الكمية (current_stock) بتتغير مع كل بيعة، فما بنسجّلها هون (حركاتها اليدوية بـ stock_movements)
drop trigger if exists ingredients_audit on public.ingredients;
create trigger ingredients_audit after update or delete on public.ingredients
  for each row execute function public.log_audit('current_stock,menu_price,menu_hidden');
drop trigger if exists supplies_audit on public.supplies;
create trigger supplies_audit after update or delete on public.supplies
  for each row execute function public.log_audit('current_stock');
drop trigger if exists suppliers_audit on public.suppliers;
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.log_audit('');
drop trigger if exists supplier_transactions_audit on public.supplier_transactions;
create trigger supplier_transactions_audit after insert or update or delete on public.supplier_transactions
  for each row execute function public.log_audit('');
drop trigger if exists purchases_audit on public.purchases;
create trigger purchases_audit after update or delete on public.purchases
  for each row execute function public.log_audit('');

-- ---------- 4) المشتريات: قراءة فقط من الواجهة ----------
drop policy if exists purchases_admin on public.purchases;
drop policy if exists purchases_admin_select on public.purchases;
create policy purchases_admin_select on public.purchases for select using ((select public.is_admin()));

-- ---------- 5) قيود المورّد المربوطة بفاتورة ----------
drop policy if exists supplier_transactions_admin on public.supplier_transactions;
drop policy if exists supplier_transactions_admin_select on public.supplier_transactions;
drop policy if exists supplier_transactions_admin_insert on public.supplier_transactions;
drop policy if exists supplier_transactions_admin_update on public.supplier_transactions;
drop policy if exists supplier_transactions_admin_delete on public.supplier_transactions;
create policy supplier_transactions_admin_select on public.supplier_transactions for select
  using ((select public.is_admin()));
create policy supplier_transactions_admin_insert on public.supplier_transactions for insert
  with check ((select public.is_admin()) and invoice_id is null);
create policy supplier_transactions_admin_update on public.supplier_transactions for update
  using ((select public.is_admin()) and invoice_id is null)
  with check ((select public.is_admin()) and invoice_id is null);
create policy supplier_transactions_admin_delete on public.supplier_transactions for delete
  using ((select public.is_admin()) and invoice_id is null);

-- ---------- 6) إلغاء فاتورة مشتريات ----------
create or replace function public.void_purchase_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv record;
  v_p record;
begin
  if not public.is_owner() then
    raise exception 'إلغاء فاتورة مشتريات لصاحب المطعم فقط';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'سبب الإلغاء مطلوب (3 أحرف على الأقل)';
  end if;
  -- قفل الفاتورة حتى ضغطتين متزامنتين ما يرجّعوا المخزون مرتين
  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status = 'voided' then raise exception 'هذه الفاتورة ملغاة أصلًا'; end if;

  update public.purchase_invoices
  set status = 'voided', void_reason = left(trim(p_reason), 300), voided_by = auth.uid(), voided_at = now(), expense_id = null
  where id = p_invoice_id;

  for v_p in select * from public.purchases where invoice_id = p_invoice_id loop
    -- التكلفة بترجع لآخر شراء فعّال لنفس الصنف (أو بتضل زي ما هي لو ما في غيره)
    if v_p.ingredient_id is not null then
      update public.ingredients i
      set current_stock = i.current_stock - v_p.quantity,
          unit_price = coalesce((
            select p.unit_price from public.purchases p
            left join public.purchase_invoices pi on pi.id = p.invoice_id
            where p.ingredient_id = v_p.ingredient_id and p.invoice_id is distinct from p_invoice_id
              and (p.invoice_id is null or pi.status = 'active')
            order by p.purchase_date desc, p.created_at desc limit 1
          ), i.unit_price)
      where i.id = v_p.ingredient_id;
    elsif v_p.supply_id is not null then
      update public.supplies s
      set current_stock = s.current_stock - v_p.quantity,
          unit_price = coalesce((
            select p.unit_price from public.purchases p
            left join public.purchase_invoices pi on pi.id = p.invoice_id
            where p.supply_id = v_p.supply_id and p.invoice_id is distinct from p_invoice_id
              and (p.invoice_id is null or pi.status = 'active')
            order by p.purchase_date desc, p.created_at desc limit 1
          ), s.unit_price)
      where s.id = v_p.supply_id;
    end if;
  end loop;

  delete from public.supplier_transactions where invoice_id = p_invoice_id;
  if v_inv.expense_id is not null then
    delete from public.expenses where id = v_inv.expense_id;
  end if;
end;
$$;

-- ---------- 7) ملفات صور الفواتير ----------
update storage.buckets
set file_size_limit = 8 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
where id = 'purchase-invoices';
