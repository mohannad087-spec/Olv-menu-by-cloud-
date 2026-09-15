-- الموردون (شركات): قائمة موردين، وسجل فواتير/دفعات لكل واحد يحسب منه
-- الرصيد المستحق تلقائيًا، مع كشف حساب قابل للطباعة من suppliers.html

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  type text not null check (type in ('invoice','payment')),
  amount numeric(12,2) not null check (amount > 0),
  description text,
  transaction_date date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists supplier_transactions_supplier_idx on public.supplier_transactions (supplier_id);
create index if not exists supplier_transactions_date_idx on public.supplier_transactions (transaction_date);

-- الرصيد المستحق لكل مورد = مجموع الفواتير - مجموع الدفعات
create or replace view public.supplier_balances as
select
  supplier_id,
  coalesce(sum(case when type = 'invoice' then amount else 0 end), 0) as total_invoiced,
  coalesce(sum(case when type = 'payment' then amount else 0 end), 0) as total_paid,
  coalesce(sum(case when type = 'invoice' then amount else -amount end), 0) as balance
from public.supplier_transactions
group by supplier_id;

alter table public.suppliers enable row level security;
alter table public.supplier_transactions enable row level security;

drop policy if exists suppliers_rw on public.suppliers;
create policy suppliers_rw on public.suppliers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists supplier_transactions_rw on public.supplier_transactions;
create policy supplier_transactions_rw on public.supplier_transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
