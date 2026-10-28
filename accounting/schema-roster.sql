-- الجدول الأسبوعي للحضور (للتوثيق فقط: مطبّق على القاعدة مسبقًا، لا تشغّله من جديد)

create table if not exists work_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,            -- end_time <= start_time يعني ينتهي اليوم التالي
  grace_late_min int not null default 10,
  grace_early_min int not null default 10,
  min_hours numeric,
  overtime_after_hours numeric default 10,
  color text,
  sort_order int not null default 0,
  is_active boolean not null default true
);
-- الورديات الموجودة: «صباحي» 07:00-17:00، «مسائي» 15:00-00:00

create table if not exists roster_days (
  profile_id uuid not null references profiles(id) on delete cascade,
  work_date date not null,
  shift_id uuid references work_shifts(id),
  is_rest boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  primary key (profile_id, work_date),
  check (is_rest or shift_id is not null)
);
-- RLS: الكتابة owner/manager، والقراءة لهم ولصاحب السطر

-- attendance_report(p_from date, p_to date) — دالة مطبّقة على القاعدة (تعريفها هناك)، ترجع لكل موظف/يوم:
--   full_name, device_user_id, work_date, shift_name, sched_start, sched_end, first_punch, last_punch,
--   worked_hours, late_min, early_leave_min, overtime_hours, status
--   status: ok / late / early_leave / late_early / absent / missing_exit / rest / rest_worked / unscheduled / scheduled
