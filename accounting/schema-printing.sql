-- طباعة تلقائية: نسخة للمطبخ ونسخة للكاشير/الفاتورة عند كل عملية بيع،
-- عبر برنامج جسر صغير (print-bridge) يعمل على جهاز داخل شبكة المطعم
-- ويرسل الطلبات لطابعات حرارية شبكية (Epson/Star). راجع مجلد print-bridge/README.md

alter table public.sales_entries add column if not exists cash_received numeric;
alter table public.sales_entries add column if not exists change_due numeric;

create table if not exists public.printer_settings (
  id int primary key default 1,
  restaurant_name text not null default 'OLV',
  kitchen_enabled boolean not null default false,
  kitchen_ip text,
  kitchen_port int not null default 9100,
  receipt_enabled boolean not null default false,
  receipt_ip text,
  receipt_port int not null default 9100,
  updated_at timestamptz not null default now(),
  constraint printer_settings_singleton check (id = 1)
);
insert into public.printer_settings (id) values (1) on conflict (id) do nothing;

alter table public.printer_settings enable row level security;
drop policy if exists printer_settings_rw on public.printer_settings;
create policy printer_settings_rw on public.printer_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_entries(id) on delete cascade,
  job_type text not null check (job_type in ('kitchen','receipt')),
  status text not null default 'pending' check (status in ('pending','printed','error','skipped')),
  error_message text,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);
create index if not exists print_jobs_status_idx on public.print_jobs (status);
create index if not exists print_jobs_sale_idx on public.print_jobs (sale_id);

alter table public.print_jobs enable row level security;
drop policy if exists print_jobs_rw on public.print_jobs;
create policy print_jobs_rw on public.print_jobs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop function if exists public.record_sale(date, numeric, numeric, numeric, text, jsonb, text);

create or replace function public.record_sale(
  p_entry_date date,
  p_cash numeric,
  p_card numeric,
  p_delivery numeric,
  p_notes text,
  p_items jsonb,
  p_order_type text default null,
  p_cash_received numeric default null,
  p_change_due numeric default null
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
  v_note text;
  v_addons_summary text;
begin
  insert into public.sales_entries (
    entry_date, cash_amount, card_amount, delivery_amount, notes, order_type,
    cash_received, change_due, created_by
  )
  values (
    p_entry_date, p_cash, p_card, p_delivery, p_notes, p_order_type,
    p_cash_received, p_change_due, auth.uid()
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_note := v_item->>'note';

    select name, price into v_product_name, v_unit_price from public.products where id = v_product_id;

    select string_agg(name, '، ') into v_addons_summary
    from public.addons
    where id in (
      select (jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)))::uuid
    );

    insert into public.sale_items (sale_id, product_id, product_name, qty, unit_price, note, addons_summary)
    values (v_sale_id, v_product_id, coalesce(v_product_name, 'غير معروف'), v_qty, coalesce(v_unit_price, 0), v_note, v_addons_summary);

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

  return v_sale_id;
end;
$$;

grant execute on function public.record_sale(date, numeric, numeric, numeric, text, jsonb, text, numeric, numeric) to authenticated;
