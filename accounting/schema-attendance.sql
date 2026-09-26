-- الحضور والدوام: بصمات خام (وقت الدخول/الخروج) توصل من جهاز بصمة
-- فعلي عبر برنامج جسر محلي (attendance-bridge/، بنفس مبدأ print-bridge)،
-- بالإضافة لإمكانية إدخال/تصحيح يدوي من صاحب المطعم أو المدير.
--
-- ليش "بصمات خام" بس، بدل "دخول" و"خروج" صريحين؟ أجهزة البصمة الرخيصة
-- (بروتوكول ZK وما شابه) ما بترجع دايمًا إشارة موثوقة تفرّق بين بصمة
-- دخول وبصمة خروج — بعض الأجهزة/الإصدارات ترجعها وبعضها لأ. الحل الأسلم
-- يلي ما بيعتمد على جهاز معيّن: نخزّن كل بصمة كوقت مجرّد، وترتيبها
-- الزمني بالنسبة لليوم هو يلي بيحدد دخول/خروج (الأولى دخول، الثانية
-- خروج، الثالثة دخول تاني... إلخ) — نفس المبدأ المستخدم بمعظم أنظمة
-- البصمة البسيطة.

alter table public.profiles add column if not exists device_user_id text;
create unique index if not exists profiles_device_user_id_idx
  on public.profiles (device_user_id) where device_user_id is not null;

create table if not exists public.employee_punches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  punched_at timestamptz not null,
  source text not null default 'fingerprint' check (source in ('fingerprint', 'manual')),
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, punched_at)
);

create index if not exists employee_punches_profile_idx on public.employee_punches (profile_id, punched_at);

alter table public.employee_punches enable row level security;

-- staff يقدر يشوف بصماته هو بس؛ owner/manager يشوفوا الكل — نفس منطق
-- الأدوار المستخدم بـschema-employees.sql بالضبط
drop policy if exists employee_punches_select on public.employee_punches;
create policy employee_punches_select on public.employee_punches
  for select using (
    profile_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

-- الإدخال/التعديل/الحذف اليدوي لصاحب المطعم والمدير بس (تصحيح بصمة
-- فائتة أو عطل بالجهاز) — بيانات الجسر نفسه بتوصل عبر service_role
-- (بيتخطى RLS تلقائيًا، زي باقي الوسطاء بالبرنامج)
drop policy if exists employee_punches_write on public.employee_punches;
create policy employee_punches_write on public.employee_punches
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'manager'))
  );

-- يحوّل قائمة بصمات مجرّدة إلى "ورديات" (دخول/خروج مزدوجة) بالترتيب
-- الزمني ليوم واحد — لو عدد البصمات فردي بيوم معيّن (نسي يبصم خروج
-- مثلاً)، آخر وردية بتضل مفتوحة (clock_out = null) حتى تصحيحها يدويًا
create or replace view public.employee_shifts as
with numbered as (
  select
    profile_id,
    punched_at,
    row_number() over (partition by profile_id, punched_at::date order by punched_at) as punch_no
  from public.employee_punches
)
select
  profile_id,
  punched_at::date as work_date,
  min(punched_at) filter (where punch_no % 2 = 1) as clock_in,
  max(punched_at) filter (where punch_no % 2 = 0) as clock_out
from numbered
group by profile_id, punched_at::date, ceil(punch_no::numeric / 2)
order by work_date desc;
