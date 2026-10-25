-- فتح الدرج: رصيد أول اليوم (مطبّق على القاعدة 2026-10-25)
create table if not exists public.cash_openings (
  id uuid primary key default gen_random_uuid(),
  opening_date date not null default current_date,
  amount numeric not null default 0 check (amount >= 0),
  notes text,
  opened_by uuid,
  created_at timestamptz not null default now()
);
alter table public.cash_openings enable row level security;
create policy cash_openings_select on public.cash_openings for select using (auth_role() is not null);
create policy cash_openings_insert on public.cash_openings for insert with check (auth_role() is not null);
create policy cash_openings_admin on public.cash_openings for update using (is_admin()) with check (is_admin());
create policy cash_openings_admin_del on public.cash_openings for delete using (is_admin());
