-- ساعة بداية دوام مخصّصة لكل موظف (اختياري، فوق الشفت): بتحل محل بداية الشفت، ونهاية الدوام بتتحرك بنفس الفرق.
alter table public.profiles add column if not exists custom_start_time time;

create or replace function public.attendance_report(p_from date, p_to date)
 returns table(profile_id uuid, full_name text, device_user_id text, work_date date, shift_name text, sched_start timestamp with time zone, sched_end timestamp with time zone, first_punch timestamp with time zone, last_punch timestamp with time zone, worked_hours numeric, late_min integer, early_leave_min integer, overtime_hours numeric, status text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with att as (select * from attendance_daily(p_from, p_to)),
  ros as (
    select r.profile_id, r.work_date, r.is_rest, s.name as shift_name, s.start_time, s.end_time,
           s.grace_late_min, s.grace_early_min, s.overtime_after_hours
    from roster_days r left join work_shifts s on s.id = r.shift_id
    where r.work_date between p_from and p_to
    union all
    -- الشفت الافتراضي للأيام اللي فيها بصمة وما إلها سطر بالجدول الأسبوعي
    select a.profile_id, a.work_date, false, s.name,
           coalesce(p.custom_start_time, s.start_time),
           case when p.custom_start_time is null then s.end_time
                else s.end_time + (p.custom_start_time - s.start_time) end,
           s.grace_late_min, s.grace_early_min, s.overtime_after_hours
    from att a
    join profiles p on p.id = a.profile_id and p.default_shift_id is not null
    join work_shifts s on s.id = p.default_shift_id
    where a.status in ('ok', 'missing_exit')
      and not exists (select 1 from roster_days r where r.profile_id = a.profile_id and r.work_date = a.work_date)
  ),
  joined as (
    select coalesce(a.profile_id, r.profile_id) as pid, coalesce(a.work_date, r.work_date) as d,
           a.first_punch, a.last_punch, a.hours, a.status as att_status,
           r.is_rest, r.shift_name, r.start_time, r.end_time, r.grace_late_min, r.grace_early_min, r.overtime_after_hours,
           (r.profile_id is not null) as has_roster
    from att a full join ros r on r.profile_id = a.profile_id and r.work_date = a.work_date
  ),
  calc as (
    select j.*,
      case when j.start_time is not null then ((j.d + j.start_time) at time zone 'Asia/Amman') end as s_start,
      case when j.end_time is not null then ((j.d + j.end_time + case when j.end_time <= j.start_time then interval '1 day' else interval '0' end) at time zone 'Asia/Amman') end as s_end,
      (j.att_status = 'ok') as worked
    from joined j
  )
  select c.pid, p.full_name, p.device_user_id, c.d, c.shift_name, c.s_start, c.s_end, c.first_punch, c.last_punch,
    case when c.worked then c.hours else 0 end,
    case when c.worked and c.s_start is not null and c.first_punch > c.s_start + make_interval(mins => c.grace_late_min)
         then floor(extract(epoch from c.first_punch - c.s_start) / 60)::int else 0 end,
    case when c.worked and c.s_end is not null and c.last_punch < c.s_end - make_interval(mins => c.grace_early_min)
         then floor(extract(epoch from c.s_end - c.last_punch) / 60)::int else 0 end,
    case when not c.worked then 0
         when c.is_rest then c.hours
         else greatest(0, c.hours - coalesce(c.overtime_after_hours, 10)) end,
    case
      when c.has_roster and c.is_rest then case when c.worked then 'rest_worked' else 'rest' end
      when c.has_roster and c.shift_name is not null then
        case when c.worked then
               case when c.s_start is not null and c.first_punch > c.s_start + make_interval(mins => c.grace_late_min)
                         and c.s_end is not null and c.last_punch < c.s_end - make_interval(mins => c.grace_early_min) then 'late_early'
                    when c.s_start is not null and c.first_punch > c.s_start + make_interval(mins => c.grace_late_min) then 'late'
                    when c.s_end is not null and c.last_punch < c.s_end - make_interval(mins => c.grace_early_min) then 'early_leave'
                    else 'ok' end
             when c.att_status = 'missing_exit' then 'missing_exit'
             when c.s_end is not null and now() < c.s_end then 'scheduled'
             else 'absent' end
      when c.worked then 'unscheduled'
      else coalesce(c.att_status, 'none')
    end
  from calc c join profiles p on p.id = c.pid
  where p.device_user_id is not null
  order by c.d, p.device_user_id::int;
$function$;
