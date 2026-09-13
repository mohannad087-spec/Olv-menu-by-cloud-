create extension if not exists pgcrypto;

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_entries(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  qty numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sale_items_product_idx on public.sale_items (product_id);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

alter table public.sale_items enable row level security;

drop policy if exists sale_items_rw on public.sale_items;
create policy sale_items_rw on public.sale_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace view public.product_sales_totals as
select product_id, sum(qty) as total_qty
from public.sale_items
where product_id is not null
group by product_id;

-- يستبدل دالة record_sale لتسجّل أيضًا كل صنف مباع في sale_items،
-- وهو ما يعتمد عليه ترتيب "الأكثر مبيعًا" في شاشة البيع السريع
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
  v_product_name text;
  v_unit_price numeric;
begin
  insert into public.sales_entries (entry_date, cash_amount, card_amount, delivery_amount, notes, created_by)
  values (p_entry_date, p_cash, p_card, p_delivery, p_notes, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;

    select name, price into v_product_name, v_unit_price from public.products where id = v_product_id;

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price)
    values (v_sale_id, v_product_id, coalesce(v_product_name, 'غير معروف'), v_qty, coalesce(v_unit_price, 0));

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
