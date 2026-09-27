-- الرواتب والمستحقات: يبني فوق بيانات الحضور الفعلية (schema-attendance.sql)
-- والأجر بالساعة (schema-employees.sql) ليحسب راتب كل موظف تلقائيًا،
-- مع دعم تسجيل سلف على الحساب وخصمها من أقرب راتب مستحق.

-- سلف تُعطى للموظف على حساب راتبه — تبقى "غير مسوّاة" (settled_payroll_id
-- فاضي) لحد ما تُخصم فعليًا من راتب مدفوع، بغض النظر كم فترة راتب تعدّت
-- بينها، حتى ما تنسى أو تنخصم مرتين
create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  advance_date date not null default current_date,
  note text,
  settled_payroll_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists salary_advances_profile_idx on public.salary_advances (profile_id, advance_date);
create index if not exists salary_advances_unsettled_idx on public.salary_advances (profile_id) where settled_payroll_id is null;

-- سجل رواتب مدفوعة فعليًا — كل صف "يقفل" فترة معينة بأرقامها النهائية
-- (نسخة/snapshot وقت الدفع)، حتى لو تغيّر الأجر بالساعة لاحقًا ما يتغيّر
-- تاريخ مدفوعات قديمة
create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  hours_worked numeric(8,2) not null default 0,
  hourly_wage numeric(10,2) not null default 0,
  gross_amount numeric(10,2) not null default 0,
  advances_deducted numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  note text,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id)
);

create index if not exists payroll_payments_profile_idx on public.payroll_payments (profile_id, period_start);

alter table public.salary_advances
  drop constraint if exists salary_advances_settled_payroll_fk;
alter table public.salary_advances
  add constraint salary_advances_settled_payroll_fk
  foreign key (settled_payroll_id) references public.payroll_payments(id) on delete set null;

alter table public.salary_advances enable row level security;
alter table public.payroll_payments enable row level security;

-- نفس منطق الأدوار المستخدم بكل مكان تاني بالبرنامج بالضبط: الموظف يشوف
-- سجله هو بس (شفافية: يتأكد قديش انخصم/انصرفله)، owner/manager يشوفوا
-- ويكتبوا على الكل
drop policy if exists salary_advances_select on public.salary_advances;
create policy salary_advances_select on public.salary_advances
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

drop policy if exists salary_advances_write on public.salary_advances;
create policy salary_advances_write on public.salary_advances
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

drop policy if exists payroll_payments_select on public.payroll_payments;
create policy payroll_payments_select on public.payroll_payments
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

-- الرواتب المدفوعة سجل محاسبي نهائي — owner/manager يقدروا يسجّلوا دفعة
-- جديدة، بس ما بنسمح بتعديل أو حذف صف دفع سابق من هون (لو صار خطأ فعلي،
-- يُصحَّح يدويًا من Supabase Table Editor لصاحب المطعم نفسه، تمامًا متل
-- أي قيد محاسبي نهائي تاني بالنظام)
drop policy if exists payroll_payments_insert on public.payroll_payments;
create policy payroll_payments_insert on public.payroll_payments
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );
