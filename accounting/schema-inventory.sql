create extension if not exists pgcrypto;

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'قطعة',
  current_stock numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  unique (product_id, ingredient_id)
);

create table if not exists public.addon_ingredients (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.addons(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  unique (addon_id, ingredient_id)
);

alter table public.ingredients enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.addon_ingredients enable row level security;

drop policy if exists ingredients_rw on public.ingredients;
create policy ingredients_rw on public.ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists product_ingredients_rw on public.product_ingredients;
create policy product_ingredients_rw on public.product_ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists addon_ingredients_rw on public.addon_ingredients;
create policy addon_ingredients_rw on public.addon_ingredients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ينفّذ عملية بيع كاملة في معاملة واحدة: يسجّل قيد المبيعات وينزل كمية
-- الخامات المستخدمة من المخزون حسب وصفة كل صنف وكل إضافة تم بيعها.
-- p_items شكلها: [{ "product_id": "...", "qty": 2, "addon_ids": ["...","..."] }, ...]
create or replace function public.record_sale(
  p_entry_date date,
  p_cash numeric,
  p_card numeric,
  p_delivery numeric,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_addon_id uuid;
  v_product_id uuid;
  v_qty numeric;
begin
  insert into public.sales_entries (entry_date, cash_amount, card_amount, delivery_amount, notes, created_by)
  values (p_entry_date, p_cash, p_card, p_delivery, p_notes, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;

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

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb) to authenticated;
