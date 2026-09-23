-- تسجيل شراء المواد الخام والمستلزمات بسعر الوحدة الفعلي (كيلو/كرتونة/
-- قطعة... حسب وحدة كل صنف) — بدل ما الشراء يتسجّل كرقم إجمالي مفصول
-- عن الكمية والمادة بالمصروفات. كل عملية شراء تحدّث تلقائيًا:
--   ١) كمية المخزون الحالية للصنف (current_stock)
--   ٢) آخر سعر وحدة معروف للصنف (unit_price)
--   ٣) قيد مصروف تلقائي بتصنيف "مشتريات ومخزون" بنفس الإجمالي

alter table public.ingredients add column if not exists unit_price numeric(12,2);
alter table public.supplies add column if not exists unit_price numeric(12,2);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid references public.ingredients(id) on delete set null,
  supply_id uuid references public.supplies(id) on delete set null,
  -- نسخة من اسم الصنف ووحدته وقت الشراء، تضل صحيحة حتى لو الصنف
  -- انحذف أو تغيّرت وحدته لاحقًا
  item_name text not null,
  unit text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_amount numeric(14,2) generated always as (quantity * unit_price) stored,
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_date date not null default current_date,
  notes text,
  expense_id uuid references public.expenses(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint purchases_one_item_type check (
    (ingredient_id is not null and supply_id is null) or
    (ingredient_id is null and supply_id is not null)
  )
);

create index if not exists purchases_date_idx on public.purchases (purchase_date);
create index if not exists purchases_ingredient_idx on public.purchases (ingredient_id);
create index if not exists purchases_supply_idx on public.purchases (supply_id);

alter table public.purchases enable row level security;
drop policy if exists purchases_rw on public.purchases;
create policy purchases_rw on public.purchases
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop function if exists public.record_purchase(uuid, uuid, numeric, numeric, uuid, date, text);
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
