create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null default 0,
  image_url text,
  category text not null default 'عام',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.addons enable row level security;

drop policy if exists products_rw on public.products;
create policy products_rw on public.products
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists addons_rw on public.addons;
create policy addons_rw on public.addons
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
