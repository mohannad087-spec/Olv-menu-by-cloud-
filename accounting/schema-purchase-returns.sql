-- مرتجعات المشتريات وإشعارات الدائن (2026-11-26)
-- المرتجع: بضاعة رجّعتها للمورّد (بتنقص من المخزون وبتنقص من الذمة) أو خصم/إشعار دائن بمبلغ بدون بضاعة.
-- الكتابة عبر الدوال فقط (مثل فواتير المشتريات). آمن لإعادة التشغيل.

-- 1) نوع حركة جديد 'credit' بحركات المورّد
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.supplier_transactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type%invoice%payment%' and pg_get_constraintdef(oid) not ilike '%credit%'
  loop
    execute format('alter table public.supplier_transactions drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.supplier_transactions'::regclass and conname = 'supplier_transactions_type_chk2') then
    alter table public.supplier_transactions add constraint supplier_transactions_type_chk2 check (type in ('invoice', 'payment', 'credit'));
  end if;
end $$;

-- 2) جدول المرتجعات
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  return_date date not null default current_date,
  reason text not null,
  total_amount numeric(14,2) not null check (total_amount > 0),
  lines jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists purchase_returns_supplier_idx on public.purchase_returns (supplier_id, return_date desc);
alter table public.purchase_returns enable row level security;
revoke insert, update, delete on public.purchase_returns from anon, authenticated;
alter table public.supplier_transactions add column if not exists return_id uuid references public.purchase_returns(id) on delete set null;

-- 3) رصيد المورّد: الفواتير - الدفعات - المرتجعات
create or replace view public.supplier_balances as
select
  supplier_id,
  coalesce(sum(case when type = 'invoice' then amount else 0 end), 0) as total_invoiced,
  coalesce(sum(case when type = 'payment' then amount else 0 end), 0) as total_paid,
  coalesce(sum(case when type = 'invoice' then amount else -amount end), 0) as balance,
  coalesce(sum(case when type = 'credit' then amount else 0 end), 0) as total_credits
from public.supplier_transactions
group by supplier_id;
alter view public.supplier_balances set (security_invoker = true);
revoke all on public.supplier_balances from anon;
grant select on public.supplier_balances to authenticated;

-- 4) تسجيل مرتجع
-- p_lines: [{ "ingredient_id" | "supply_id": uuid, "qty": رقم, "unit_price": رقم }, ...] بوحدة المخزون
-- لو p_lines فاضية لازم p_amount (إشعار دائن بمبلغ بدون بضاعة)
create or replace function public.record_purchase_return(
  p_supplier_id uuid, p_date date, p_reason text, p_lines jsonb, p_amount numeric default null
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_line jsonb; v_ing uuid; v_sup uuid; v_qty numeric; v_price numeric;
  v_total numeric := 0; v_ret uuid; v_name text; v_unit text; v_after numeric;
  v_out jsonb := '[]'::jsonb; v_has boolean;
begin
  if not public.is_admin() then raise exception 'المرتجعات للمالك والمدير فقط'; end if;
  if p_supplier_id is null or not exists (select 1 from public.suppliers where id = p_supplier_id) then raise exception 'اختر المورّد'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'سبب المرتجع مطلوب (3 أحرف على الأقل)'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 400 then raise exception 'تاريخ غير منطقي'; end if;
  v_has := jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0;
  if v_has and jsonb_array_length(p_lines) > 100 then raise exception 'عدد الأصناف كبير'; end if;

  if v_has then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_ing := nullif(v_line->>'ingredient_id', '')::uuid; v_sup := nullif(v_line->>'supply_id', '')::uuid;
      v_qty := (v_line->>'qty')::numeric; v_price := (v_line->>'unit_price')::numeric;
      if (v_ing is null) = (v_sup is null) then raise exception 'كل سطر لازم يكون مادة خام أو مستلزم (واحد بس)'; end if;
      if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'كمية غير صالحة'; end if;
      if v_price is null or v_price < 0 or v_price > 1000000 then raise exception 'سعر غير صالح'; end if;
      v_total := v_total + round(v_qty * v_price, 2);
    end loop;
  else
    v_total := round(coalesce(p_amount, 0), 2);
  end if;
  if v_total <= 0 then raise exception 'مبلغ المرتجع لازم يكون أكبر من صفر'; end if;
  if v_total > 1000000 then raise exception 'مبلغ غير منطقي'; end if;

  insert into public.purchase_returns (supplier_id, return_date, reason, total_amount, lines)
  values (p_supplier_id, p_date, left(trim(p_reason), 300), v_total, '[]'::jsonb) returning id into v_ret;

  if v_has then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_ing := nullif(v_line->>'ingredient_id', '')::uuid; v_sup := nullif(v_line->>'supply_id', '')::uuid;
      v_qty := (v_line->>'qty')::numeric; v_price := (v_line->>'unit_price')::numeric;
      if v_ing is not null then
        update public.ingredients set current_stock = coalesce(current_stock, 0) - v_qty where id = v_ing
          returning name, unit, current_stock into v_name, v_unit, v_after;
      else
        update public.supplies set current_stock = coalesce(current_stock, 0) - v_qty where id = v_sup
          returning name, unit, current_stock into v_name, v_unit, v_after;
      end if;
      if v_name is null then raise exception 'مادة غير موجودة بالمخزون'; end if;
      insert into public.stock_movements (item_kind, item_id, item_name, delta, stock_after, reason, note)
      values (case when v_ing is not null then 'ingredient' else 'supply' end, coalesce(v_ing, v_sup), v_name, -v_qty, v_after, 'adjust', 'مرتجع للمورّد: ' || left(trim(p_reason), 120));
      v_out := v_out || jsonb_build_object('item_id', coalesce(v_ing, v_sup), 'kind', case when v_ing is not null then 'ingredient' else 'supply' end, 'name', v_name, 'unit', v_unit, 'qty', v_qty, 'unit_price', v_price);
      v_name := null;
    end loop;
    update public.purchase_returns set lines = v_out where id = v_ret;
  end if;

  insert into public.supplier_transactions (supplier_id, type, amount, description, transaction_date, created_by, return_id)
  values (p_supplier_id, 'credit', v_total, case when v_has then 'مرتجع بضاعة' else 'إشعار دائن / خصم' end || ' — ' || left(trim(p_reason), 120), p_date, auth.uid(), v_ret);
  return v_ret;
end;
$$;

-- 5) إلغاء مرتجع (للمالك): بيرجّع المخزون وبيشيل القيد من حساب المورّد
create or replace function public.void_purchase_return(p_return_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare v_r record; v_l jsonb; v_after numeric;
begin
  if not public.is_owner() then raise exception 'إلغاء المرتجع لصاحب المطعم فقط'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into v_r from public.purchase_returns where id = p_return_id;
  if v_r.id is null then raise exception 'المرتجع غير موجود'; end if;
  if v_r.status = 'voided' then raise exception 'المرتجع ملغي أصلًا'; end if;
  for v_l in select * from jsonb_array_elements(v_r.lines) loop
    if v_l->>'kind' = 'ingredient' then
      update public.ingredients set current_stock = coalesce(current_stock, 0) + (v_l->>'qty')::numeric where id = (v_l->>'item_id')::uuid returning current_stock into v_after;
    else
      update public.supplies set current_stock = coalesce(current_stock, 0) + (v_l->>'qty')::numeric where id = (v_l->>'item_id')::uuid returning current_stock into v_after;
    end if;
    insert into public.stock_movements (item_kind, item_id, item_name, delta, stock_after, reason, note)
    values (v_l->>'kind', (v_l->>'item_id')::uuid, v_l->>'name', (v_l->>'qty')::numeric, v_after, 'adjust', 'إلغاء مرتجع: ' || left(trim(p_reason), 120));
  end loop;
  delete from public.supplier_transactions where return_id = p_return_id;
  update public.purchase_returns set status = 'voided', void_reason = left(trim(p_reason), 300) where id = p_return_id;
end;
$$;

revoke execute on function public.record_purchase_return(uuid, date, text, jsonb, numeric) from public, anon;
revoke execute on function public.void_purchase_return(uuid, text) from public, anon;
grant execute on function public.record_purchase_return(uuid, date, text, jsonb, numeric) to authenticated;
grant execute on function public.void_purchase_return(uuid, text) to authenticated;
