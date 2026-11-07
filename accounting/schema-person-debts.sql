-- «ذمم الأشخاص» (صفحة الذمم): ديون علينا لأشخاص مش موردين (أصحاب، شركاء، معارف).
-- كل حركة سطر: دين (kind=debt) أو دفعة (kind=payment). الرصيد = الديون - الدفعات، وبنحسبه بالصفحة.
-- للمالك والمدير بس. آمن للتشغيل أكثر من مرة. ما إلو علاقة بالدرج ولا بالمصاريف.
create table if not exists public.person_debts (
  id uuid primary key default gen_random_uuid(),
  person_name text not null check (length(btrim(person_name)) > 0),
  kind text not null check (kind in ('debt', 'payment')),
  amount numeric(10,2) not null check (amount > 0),
  entry_date date not null default current_date,
  note text,
  method text check (method is null or method in ('cash', 'bank', 'click')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists person_debts_name_idx on public.person_debts (person_name);
alter table public.person_debts enable row level security;
drop policy if exists person_debts_rw on public.person_debts;
create policy person_debts_rw on public.person_debts
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager')));
