-- =====================================================================
-- OLV Accounting — Supabase schema
-- شغّل هذا الملف مرة واحدة في: Supabase Dashboard → SQL Editor → New query
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles: بيانات إضافية لكل مستخدم (اسمه ودوره)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now()
);

-- إنشاء صف profile تلقائيًا عند تسجيل مستخدم جديد في Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- expense_categories: تصنيفات المصروفات
-- ---------------------------------------------------------------------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.expense_categories (name) values
  ('مشتريات ومخزون'),
  ('رواتب وأجور'),
  ('إيجار'),
  ('فواتير (كهرباء / مياه / غاز)'),
  ('صيانة'),
  ('تسويق وإعلان'),
  ('مصاريف أخرى')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- sales_entries: تسجيل المبيعات اليومية
-- ---------------------------------------------------------------------
create table if not exists public.sales_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  cash_amount numeric(12,2) not null default 0,
  card_amount numeric(12,2) not null default 0,
  delivery_amount numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists sales_entries_date_idx on public.sales_entries (entry_date);

-- ---------------------------------------------------------------------
-- expenses: تسجيل المصروفات
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id uuid references public.expense_categories(id),
  amount numeric(12,2) not null,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses (expense_date);

-- ---------------------------------------------------------------------
-- cash_closings: تقفيل الخزينة اليومي
-- ---------------------------------------------------------------------
create table if not exists public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null default current_date,
  opening_balance numeric(12,2) not null default 0,
  expected_closing numeric(12,2) not null default 0,
  actual_closing numeric(12,2) not null default 0,
  difference numeric(12,2) generated always as (actual_closing - expected_closing) stored,
  notes text,
  closed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists cash_closings_date_idx on public.cash_closings (closing_date);

-- =====================================================================
-- Row Level Security
-- كل الجداول تتطلب تسجيل دخول (Supabase Auth). لأن المطعم واحد وفريق
-- العمل موثوق، أي مستخدم مسجّل دخول يقدر يقرأ/يكتب في بيانات المحاسبة.
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.expense_categories enable row level security;
alter table public.sales_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_closings enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

drop policy if exists expense_categories_rw on public.expense_categories;
create policy expense_categories_rw on public.expense_categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists sales_entries_rw on public.sales_entries;
create policy sales_entries_rw on public.sales_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists expenses_rw on public.expenses;
create policy expenses_rw on public.expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists cash_closings_rw on public.cash_closings;
create policy cash_closings_rw on public.cash_closings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
