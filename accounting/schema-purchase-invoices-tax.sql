-- خصم وضريبة على فواتير المشتريات + دقة أسعار أعلى
--
-- بيضيف لفاتورة المشتريات (بعد schema-purchase-invoices.sql):
--   • خصم: نسبة % أو مبلغ ثابت على مجموع الأصناف
--   • ضريبة المشتريات: نسبة %، والأسعار غير شاملة الضريبة (بتنضاف فوق) أو شاملة (مضمّنة)
--   • "قابلة للاسترداد": لو نعم، تكلفة الصنف (آخر سعر شراء) بتنحسب بدون الضريبة؛ لو لأ
--     بتدخل بالتكلفة
-- الإجمالي المستحق = (المجموع − الخصم) + الضريبة (أو بدونها لو الأسعار شاملة). هالإجمالي هو
-- اللي بينكتب مصروف وعلى حساب المورّد. والخصم بيتوزع على الأصناف بالتناسب، فتكلفة كل صنف
-- (وآخر سعر شراء له) هي السعر الفعلي بعد الخصم — مش السعر بالورقة.
--
-- (رفع دقة أسعار الوحدة لخمس خانات عشرية بملف منفصل: schema-purchase-invoices-precision.sql)
--
-- شغّله بعد schema-purchase-invoices.sql

alter table public.purchases add column if not exists list_price numeric(14,5);

-- ---------- أعمدة الفاتورة ----------
alter table public.purchase_invoices add column if not exists subtotal_amount numeric(14,2);
alter table public.purchase_invoices add column if not exists discount_amount numeric(14,2) not null default 0;
alter table public.purchase_invoices add column if not exists discount_pct numeric(6,3);
alter table public.purchase_invoices add column if not exists tax_rate numeric(6,3) not null default 0;
alter table public.purchase_invoices add column if not exists tax_amount numeric(14,2) not null default 0;
alter table public.purchase_invoices add column if not exists tax_inclusive boolean not null default false;
alter table public.purchase_invoices add column if not exists tax_recoverable boolean not null default true;
update public.purchase_invoices set subtotal_amount = total_amount where subtotal_amount is null;

-- ---------- تسجيل فاتورة (نسخة جديدة بالخصم والضريبة) ----------
drop function if exists public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb);
drop function if exists public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb, numeric, numeric, numeric, boolean, boolean);

create or replace function public.record_purchase_invoice(
  p_supplier_id uuid,
  p_invoice_no text,
  p_invoice_date date,
  p_paid numeric,
  p_notes text,
  p_attachment text,
  p_lines jsonb,
  p_discount_amount numeric default 0,
  p_discount_pct numeric default null,
  p_tax_rate numeric default 0,
  p_tax_inclusive boolean default false,
  p_tax_recoverable boolean default true
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
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_net numeric;
  v_rate numeric := coalesce(p_tax_rate, 0);
  v_tax numeric := 0;
  v_total numeric;
  v_paid numeric := coalesce(p_paid, 0);
  v_type text;
  v_inv uuid;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_supplier_name text;
  v_category uuid;
  v_expense uuid;
  v_share numeric;     -- نسبة ما بعد الخصم من المجموع (توزيع الخصم بالتناسب)
  v_cost numeric;      -- تكلفة وحدة الصنف الفعلية
  v_desc text;
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
  if v_rate < 0 or v_rate > 100 then
    raise exception 'نسبة الضريبة لازم تكون بين 0 و100';
  end if;
  if p_discount_pct is not null and (p_discount_pct < 0 or p_discount_pct > 100) then
    raise exception 'نسبة الخصم لازم تكون بين 0 و100';
  end if;
  if coalesce(p_discount_amount, 0) < 0 then
    raise exception 'مبلغ الخصم غير صالح';
  end if;

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
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
  end loop;

  -- الخصم: النسبة (لو موجودة) أولًا، وإلا المبلغ؛ وما بيتعدى المجموع
  if p_discount_pct is not null and p_discount_pct > 0 then
    v_discount := round(v_subtotal * p_discount_pct / 100, 2);
  else
    v_discount := least(coalesce(p_discount_amount, 0), v_subtotal);
  end if;
  v_net := v_subtotal - v_discount;
  if coalesce(p_tax_inclusive, false) then
    v_tax := round(v_net - v_net / (1 + v_rate / 100), 2);
    v_total := v_net;
  else
    v_tax := round(v_net * v_rate / 100, 2);
    v_total := v_net + v_tax;
  end if;

  if v_paid < 0 or v_paid > v_total + 0.004 then
    raise exception 'المبلغ المدفوع لازم يكون بين 0 وإجمالي الفاتورة المستحق (%)', v_total;
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
      notes, attachment_path, created_by,
      subtotal_amount, discount_amount, discount_pct, tax_rate, tax_amount, tax_inclusive, tax_recoverable
    ) values (
      p_supplier_id, v_no, p_invoice_date, v_total, v_paid, v_type,
      left(p_notes, 500), left(p_attachment, 300), auth.uid(),
      v_subtotal, v_discount, case when p_discount_pct > 0 then p_discount_pct end,
      v_rate, v_tax, coalesce(p_tax_inclusive, false), coalesce(p_tax_recoverable, true)
    ) returning id into v_inv;
  exception when unique_violation then
    raise exception 'فاتورة بنفس الرقم (%) مسجّلة قبل لهذا المورّد', v_no;
  end;

  -- تكلفة الوحدة الفعلية = السعر × (1 − حصة الخصم) ثم تعديل الضريبة حسب الحالة
  v_share := case when v_subtotal > 0 then v_net / v_subtotal else 1 end;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing := nullif(v_line->>'ingredient_id', '')::uuid;
    v_sup := nullif(v_line->>'supply_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_price := (v_line->>'unit_price')::numeric;

    v_cost := v_price * v_share;
    if coalesce(p_tax_inclusive, false) then
      -- السعر شامل الضريبة: التكلفة بدون ضريبة لو قابلة للاسترداد
      if coalesce(p_tax_recoverable, true) then v_cost := v_cost / (1 + v_rate / 100); end if;
    else
      -- السعر بدون ضريبة: التكلفة مع الضريبة لو غير قابلة للاسترداد
      if not coalesce(p_tax_recoverable, true) then v_cost := v_cost * (1 + v_rate / 100); end if;
    end if;
    v_cost := round(v_cost, 5);

    if v_ing is not null then
      select name, unit into v_name, v_unit from public.ingredients where id = v_ing;
      if v_name is null then raise exception 'مادة خام غير موجودة'; end if;
      update public.ingredients
        set current_stock = current_stock + v_qty, unit_price = v_cost
        where id = v_ing;
    else
      select name, unit into v_name, v_unit from public.supplies where id = v_sup;
      if v_name is null then raise exception 'مستلزم غير موجود'; end if;
      update public.supplies
        set current_stock = current_stock + v_qty, unit_price = v_cost
        where id = v_sup;
    end if;

    insert into public.purchases (
      ingredient_id, supply_id, item_name, unit, quantity, unit_price, list_price,
      supplier_id, purchase_date, notes, created_by, invoice_id
    ) values (
      v_ing, v_sup, v_name, v_unit, v_qty, v_cost, v_price,
      p_supplier_id, p_invoice_date, left(p_notes, 500), auth.uid(), v_inv
    );
  end loop;

  v_desc := 'فاتورة مشتريات' || coalesce(' #' || v_no, '') || coalesce(' — ' || v_supplier_name, '')
    || case when v_discount > 0 then ' (خصم ' || v_discount || ')' else '' end
    || case when v_tax > 0 then ' (ضريبة ' || v_tax || ')' else '' end
    || case v_type when 'credit' then ' (آجل)' when 'partial' then ' (دفع جزئي)' else '' end;

  select id into v_category from public.expense_categories where name = 'مشتريات ومخزون' limit 1;
  insert into public.expenses (expense_date, category_id, amount, description, created_by)
  values (p_invoice_date, v_category, v_total, v_desc, auth.uid())
  returning id into v_expense;
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

revoke execute on function public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb, numeric, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function public.record_purchase_invoice(uuid, text, date, numeric, text, text, jsonb, numeric, numeric, numeric, boolean, boolean) to authenticated;

-- تحديث ذاكرة PostgREST حتى تظهر الدوال والأعمدة الجديدة فورًا بدون انتظار
notify pgrst, 'reload schema';
