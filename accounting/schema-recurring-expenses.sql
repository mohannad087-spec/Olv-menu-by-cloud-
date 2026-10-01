-- مصروفات ثابتة ومتكررة (إنترنت، إيجار، اشتراكات...): بتعرّفها مرة وحدة وبتنزل لحالها بموعدها
--
--   • recurring_expenses: القالب (الاسم، التصنيف، المبلغ، يوم الشهر، كل كم شهر، من/إلى)
--   • recurring_expense_runs: سجل اللي نزل فعلًا. لو حذفت مصروف منزَّل بالغلط ما بيرجع ينزل لحاله
--   • generate_recurring_expenses(): بتنزّل كل المستحق لحد اليوم (وبتعوّض الشهور الفايتة)، وبتنادى
--     لحالها لما المالك/المدير يفتح المصروفات أو التقارير، فما بتحتاج جدولة خارجية
-- تعديل مبلغ القالب بيأثر على الدفعات الجاية بس، اللي نزل قبل بيضل زي ما هو
-- شغّله بعد schema-cashier-hardening.sql

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  category_id uuid references public.expense_categories(id),
  amount numeric(12,2) not null check (amount > 0),
  day_of_month int not null default 1 check (day_of_month between 1 and 31),
  every_months int not null default 1 check (every_months in (1, 2, 3, 6, 12)),
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.recurring_expense_runs (
  recurring_id uuid not null references public.recurring_expenses(id) on delete cascade,
  due_date date not null,
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (recurring_id, due_date)
);

alter table public.expenses add column if not exists recurring_id uuid references public.recurring_expenses(id) on delete set null;

alter table public.recurring_expenses enable row level security;
alter table public.recurring_expense_runs enable row level security;
drop policy if exists recurring_expenses_admin on public.recurring_expenses;
create policy recurring_expenses_admin on public.recurring_expenses
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists recurring_runs_admin_select on public.recurring_expense_runs;
create policy recurring_runs_admin_select on public.recurring_expense_runs
  for select using (public.is_admin());
revoke insert, update, delete on public.recurring_expense_runs from anon, authenticated;

drop trigger if exists recurring_expenses_audit on public.recurring_expenses;
create trigger recurring_expenses_audit
  after insert or update or delete on public.recurring_expenses
  for each row execute function public.log_audit('');

create or replace function public.generate_recurring_expenses()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_month date;
  v_due date;
  v_exp uuid;
  v_count int := 0;
  v_steps int;
begin
  if not public.is_admin() then return 0; end if;

  for r in select * from public.recurring_expenses where is_active loop
    v_month := date_trunc('month', r.start_date)::date;
    v_steps := 0;
    while v_steps < 240 loop
      -- يوم الاستحقاق: اليوم المحدد، أو آخر يوم بالشهر لو الشهر أقصر (31 بشباط مثلًا)
      v_due := least(
        v_month + (r.day_of_month - 1),
        (v_month + interval '1 month' - interval '1 day')::date
      );
      exit when v_due > current_date or (r.end_date is not null and v_due > r.end_date);
      if v_due >= r.start_date
         and not exists (select 1 from public.recurring_expense_runs where recurring_id = r.id and due_date = v_due) then
        insert into public.expenses (expense_date, category_id, amount, description, created_by, recurring_id)
        values (v_due, r.category_id, r.amount, r.name, auth.uid(), r.id)
        returning id into v_exp;
        insert into public.recurring_expense_runs (recurring_id, due_date, expense_id) values (r.id, v_due, v_exp);
        v_count := v_count + 1;
      end if;
      v_month := (v_month + make_interval(months => r.every_months))::date;
      v_steps := v_steps + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.generate_recurring_expenses() from public, anon;
grant execute on function public.generate_recurring_expenses() to authenticated;

notify pgrst, 'reload schema';
