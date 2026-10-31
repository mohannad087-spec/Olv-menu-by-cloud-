-- إضافات وخصومات الرواتب: مكافأة شهرية، بدل، خصم تأخير... لكل موظف
-- amount موجب = إله، سالب = عليه. تبقى «غير مسوّاة» (settled_payroll_id فاضي)
-- لحد ما تنحسب بدفعة راتب، متل السلف بالضبط.
create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount <> 0),
  adj_date date not null default current_date,
  note text,
  settled_payroll_id uuid references public.payroll_payments(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists payroll_adjustments_profile_idx on public.payroll_adjustments (profile_id, adj_date);
create index if not exists payroll_adjustments_settled_idx on public.payroll_adjustments (settled_payroll_id);
create index if not exists payroll_adjustments_created_by_idx on public.payroll_adjustments (created_by);

alter table public.payroll_adjustments enable row level security;

drop policy if exists payroll_adjustments_select on public.payroll_adjustments;
create policy payroll_adjustments_select on public.payroll_adjustments
  for select using (
    profile_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager'))
  );

drop policy if exists payroll_adjustments_write on public.payroll_adjustments;
create policy payroll_adjustments_write on public.payroll_adjustments
  for all using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'manager'))
  );
