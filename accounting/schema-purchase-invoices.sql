-- فواتير المشتريات: فاتورة مورّد واحدة بعدة أصناف، مع دفع كاش/آجل/جزئي وصورة الفاتورة
--
-- كل فاتورة (record_purchase_invoice) بتعمل بعملية وحدة:
--   ١) تزيد مخزون كل صنف وتحدّث آخر سعر شراء له (نفس سلوك تسجيل الشراء المفرد)
--   ٢) قيد مصروف واحد بإجمالي الفاتورة (تصنيف "مشتريات ومخزون") بتاريخ الفاتورة
--      — يعني الشراء بينحسب مصروف يوم الفاتورة سواء اندفع كاش أو آجل
--   ٣) بحساب المورّد: فاتورة بالإجمالي + دفعة بالمبلغ المدفوع، فالرصيد المستحق
--      (supplier_balances) هو المتبقي عليك تلقائيًا
-- الدفعات اللاحقة للمورّد بتنسجّل من صفحة الموردين (بحسابه فقط، بدون مصروف جديد
-- لأن المصروف انحسب وقت الفاتورة).
--
-- للمالك والمدير فقط. الفاتورة ما بتتعدّل: لو في غلطة، المالك بيلغيها (بسبب) وبتنعمل
-- من جديد — والإلغاء بيرجّع المخزون وبيشيل المصروف وقيود المورّد. كل شي بينسجّل
-- بسجل التدقيق. رقم الفاتورة ما بيتكرر لنفس المورّد.
--
-- شغّله بعد schema-cashier-hardening.sql

-- ---------- وحدة الشراء (كرتونة 12 كغ مثلًا) ----------
alter table public.ingredients add column if not exists purchase_unit text;
alter table public.ingredients add column if not exists purchase_unit_factor numeric(12,3);
alter table public.supplies add column if not exists purchase_unit text;
alter table public.supplies add column if not exists purchase_unit_factor numeric(12,3);
alter table public.ingredients drop constraint if exists ingredients_purchase_factor_pos;
alter table public.ingredients add constraint ingredients_purchase_factor_pos
  check (purchase_unit_factor is null or purchase_unit_factor > 0);
alter table public.supplies drop constraint if exists supplies_purchase_factor_pos;
alter table public.supplies add constraint supplies_purchase_factor_pos
  check (purchase_unit_factor is null or purchase_unit_factor > 0);

-- ---------- الفواتير ----------
create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_no text,
  invoice_date date not null default current_date,
  total_amount numeric(14,2) not null check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  payment_type text not null check (payment_type in ('cash', 'credit', 'partial')),
  notes text,
  attachment_path text,
  expense_id uuid references public.expenses(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (paid_amount <= total_amount)
);
create index if not exists purchase_invoices_date_idx on public.purchase_invoices (invoice_date desc);
create index if not exists purchase_invoices_supplier_idx on public.purchase_invoices (supplier_id);
-- منع تسجيل نفس الفاتورة مرتين (نفس المورّد ونفس الرقم)، بس للفواتير الفعّالة
create unique index if not exists purchase_invoices_dup_idx
  on public.purchase_invoices (supplier_id, lower(btrim(invoice_no)))
  where invoice_no is not null and btrim(invoice_no) <> '' and status = 'active';

alter table public.purchases add column if not exists invoice_id uuid references public.purchase_invoices(id) on delete set null;
create index if not exists purchases_invoice_idx on public.purchases (invoice_id);
alter table public.supplier_transactions add column if not exists invoice_id uuid references public.purchase_invoices(id) on delete set null;

alter table public.purchase_invoices enable row level security;
drop policy if exists purchase_invoices_admin_select on public.purchase_invoices;
create policy purchase_invoices_admin_select on public.purchase_invoices
  for select using (public.is_admin());
-- الكتابة عبر الدوال فقط
revoke insert, update, delete on public.purchase_invoices from anon, authenticated;

-- ---------- تسجيل فاتورة ----------
-- p_lines: [{ "ingredient_id" | "supply_id": uuid, "qty": رقم, "unit_price": رقم }, ...]
-- الكمية والسعر بوحدة المخزون (الواجهة بتحوّل من وحدة الشراء)
create or replace function public.record_purchase_invoice(
  p_supplier_id uuid,
  p_invoice_no text,
  p_invoice_date date,
  p_paid numeric,
  p_notes text,
  p_attachment text,
  p_lines jsonb
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_line jsonb;
  v_ing uuid;
  v_sup uuid;
  v_qty numeric;
  v_price numeric;
  v_name text;
  v_unit text;
  v_total numeric := 0;
  v_paid numeric := coalesce(p_paid, 0);
  v_type text;
  v_inv uuid;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_supplier_name text;
  v_category uuid;
  v_expense uuid;
begin
  if not public.is_admin() then
    raise exception 'فواتير المشتريات للمالك والمدير فقط';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'الفاتورة فاضية — أضف صنف واحد على الأقل';
  end if;
  if jsonb_array_length(p_lines) > 150 then
    raise exception 'عدد الأصناف كبير زيادة بالفاتورة الواحدة';
  end if;
  if p_invoice_date is null or p_invoice_date > current_date + 1 or p_invoice_date < current_date - 400 then
    raise exception 'تاريخ الفاتورة غير منطقي';
  end if;

  -- مرور أول: تحقق وحساب الإجمالي
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line->>'ingredient_id', '')::uuid;
    v_sup := nullif(v_line->>'supply_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    if (v_ing is null) = (v_sup is null) then
      raise exception 'كل سطر لازم يكون مادة خام أو مستلزم (واحد بس)';
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
      raise exception 'كمية غير صالحة بأحد الأصناف';
    end if;
    if v_price is null or v_price < 0 or v_price > 1000000 then
      raise exception 'سعر غير صالح بأحد الأصناف';
    end if;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  if v_paid < 0 or v_paid > v_total + 0.004 then
    raise exception 'المبلغ المدفوع لازم يكون بين 0 وإجمالي الفاتورة';
  end if;
  v_paid := least(v_paid, v_total);
  v_type := case when v_paid >= v_total then 'cash' when v_paid <= 0 then 'credit' else 'partial' end;
  if v_type <> 'cash' and p_supplier_id is null then
    raise exception 'الدفع الآجل أو الجزئي لازم يكون معه مورّد';
  end if;
  if p_supplier_id is not null then
    select name into v_supplier_name from public.suppliers where id = p_supplier_id;
    if v_supplier_name is null then raise exception 'المورّد غير موجود'; end if;
  end if;

  begin
    insert into public.purchase_invoices (
      supplier_id, invoice_no, invoice_date, total_amount, paid_amount, payment_type,
      notes, attachment_path, created_by
    ) values (
      p_supplier_id, v_no, p_invoice_date, v_total, v_paid, v_type,
      left(p_notes, 500), left(p_attachment, 300), auth.uid()
    ) returning id into v_inv;
  exception when unique_violation then
    raise exception 'فاتورة بنفس الرقم (%) مسجّلة قبل لهذا المورّد', v_no;
  end;

  -- مرور ثاني: تطبيق الأصناف
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line->>'ingredient_id', '')::uuid;
    v_sup := nullif(v_line->>'supply_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_price := (v_line->>'unit_price')::numeric;

    if v_ing is not null then
      select name, unit into v_name, v_unit from public.ingredients where id = v_ing;
      if v_name is null then raise exception 'مادة خام غير موجودة'; end if;
      update public.ingredients
        set current_stock = current_stock + v_qty, unit_price = v_price
        where id = v_ing;
    else
      select name, unit into v_name, v_unit from public.supplies where id = v_sup;
      if v_name is null then raise exception 'مستلزم غير موجود'; end if;
      update public.supplies
        set current_stock = current_stock + v_qty, unit_price = v_price
        where id = v_sup;
    end if;

    insert into public.purchases (
      ingredient_id, supply_id, item_name, unit, quantity, unit_price,
      supplier_id, purchase_date, notes, created_by, invoice_id
    ) values (
      v_ing, v_sup, v_name, v_unit, v_qty, v_price,
      p_supplier_id, p_invoice_date, left(p_notes, 500), auth.uid(), v_inv
    );
  end loop;

  select id into v_category from public.expense_categories where name = 'مشتريات ومخزون' limit 1;
  insert into public.expenses (expense_date, category_id, amount, description, created_by)
  values (
    p_invoice_date, v_category, v_total,
    'فاتورة مشتريات' || coalesce(' #' || v_no, '') || coalesce(' — ' || v_supplier_name, '')
      || case v_type when 'credit' then ' (آجل)' when 'partial' then ' (دفع جزئي)' else '' end,
    auth.uid()
  ) returning id into v_expense;
  update public.purchase_invoices set expense_id = v_expense where id = v_inv;

  if p_supplier_id is not null and v_total > 0 then
    insert into public.supplier_transactions (supplier_id, type, amount, description, transaction_date, created_by, invoice_id)
    values (p_supplier_id, 'invoice', v_total, 'فاتورة مشتريات' || coalesce(' #' || v_no, ''), p_invoice_date, auth.uid(), v_inv);
    if v_paid > 0 then
      insert into public.supplier_transactions (supplier_id, type, amount, description, transaction_date, created_by, invoice_id)
      values (p_supplier_id, 'payment', v_paid, 'دفعة عند الفاتورة' || coalesce(' #' || v_no, ''), p_invoice_date, auth.uid(), v_inv);
    end if;
  end if;

  return v_inv;
end;
$$;

-- ---------- إلغاء فاتورة (للمالك، بسبب) ----------
create or replace function public.void_purchase_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
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
  select * into v_inv from public.purchase_invoices where id = p_invoice_id;
  if v_inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status = 'voided' then raise exception 'هذه الفاتورة ملغاة أصلًا'; end if;

  for v_p in select * from public.purchases where invoice_id = p_invoice_id loop
    if v_p.ingredient_id is not null then
      update public.ingredients set current_stock = current_stock - v_p.quantity where id = v_p.ingredient_id;
    elsif v_p.supply_id is not null then
      update public.supplies set current_stock = current_stock - v_p.quantity where id = v_p.supply_id;
    end if;
  end loop;
  delete from public.supplier_transactions where invoice_id = p_invoice_id;
  update public.purchase_invoices
    set status = 'voided', void_reason = left(trim(p_reason), 300), voided_by = auth.uid(), voided_at = now(), expense_id = null
    where id = p_invoice_id;
  if v_inv.expense_id is not null then
    delete from public.expenses where id = v_inv.expense_id;
  end if;
end;
$$;

revoke execute on function public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb) from public, anon;
revoke execute on function public.void_purchase_invoice(uuid, text) from public, anon;
grant execute on function public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb) to authenticated;
grant execute on function public.void_purchase_invoice(uuid, text) to authenticated;

drop trigger if exists purchase_invoices_audit on public.purchase_invoices;
create trigger purchase_invoices_audit
  after insert or update or delete on public.purchase_invoices
  for each row execute function public.log_audit('');

-- ---------- صور الفواتير (Supabase Storage، خاصة، للمالك والمدير) ----------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('purchase-invoices', 'purchase-invoices', false)
    on conflict (id) do nothing;

    drop policy if exists purchase_invoices_files_select on storage.objects;
    drop policy if exists purchase_invoices_files_insert on storage.objects;
    create policy purchase_invoices_files_select on storage.objects
      for select using (bucket_id = 'purchase-invoices' and public.is_admin());
    create policy purchase_invoices_files_insert on storage.objects
      for insert with check (bucket_id = 'purchase-invoices' and public.is_admin());
  end if;
end $$;

-- تحديث ذاكرة PostgREST حتى تظهر الدوال والأعمدة الجديدة فورًا بدون انتظار
notify pgrst, 'reload schema';
