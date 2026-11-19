-- «النا عند جهات أخرى» (صفحة الذمم): مبلغ لإلنا عند أي جهة مش موظف ولا مورّد
-- (زبون، صديق، جار، شريك...). موظفين = salary_advances، موردين = رصيد supplier_balances السالب.
-- للمالك والمدير بس. آمن للتشغيل أكثر من مرة.
create table if not exists public.other_receivables (
  id uuid primary key default gen_random_uuid(),
  party_name text not null check (length(btrim(party_name)) > 0),
  amount numeric(10,2) not null check (amount > 0),
  receivable_date date not null default current_date,
  note text,
  paid_at timestamptz,
  paid_method text check (paid_method is null or paid_method in ('cash', 'bank', 'click')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists other_receivables_open_idx on public.other_receivables (party_name) where paid_at is null;
alter table public.other_receivables enable row level security;
drop policy if exists other_receivables_rw on public.other_receivables;
create policy other_receivables_rw on public.other_receivables
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager')));
