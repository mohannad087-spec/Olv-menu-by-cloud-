-- مطبّق مسبقًا على قاعدة البيانات (مشروع Supabase) — هذا الملف للتوثيق وإعادة البناء فقط.
-- حضور الموظفين: يوم الدوام = أول وآخر بصمة باليوم (يوم العمل بيبدأ 04:00 بتوقيت عمّان)،
-- اليوم اللي فرق بصماته أقل من p_min_minutes (افتراضي 30) بينتجاهل، واليوم ببصمة وحدة = missing_exit.
-- SECURITY INVOKER: RLS على employee_punches/profiles بتنطبق على المستدعي. التنفيذ لـ authenticated فقط.

create or replace function public.attendance_daily(p_from date, p_to date, p_min_minutes integer default 30)
 returns table(profile_id uuid, full_name text, device_user_id text, work_date date, first_punch timestamp with time zone, last_punch timestamp with time zone, punch_count integer, hours numeric, status text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with punches as (
    select e.profile_id,
           ((e.punched_at at time zone 'Asia/Amman') - interval '4 hours')::date as work_date,
           e.punched_at
    from employee_punches e
    where e.punched_at >= ((p_from::timestamp + interval '4 hours') at time zone 'Asia/Amman')
      and e.punched_at <  (((p_to + 1)::timestamp + interval '4 hours') at time zone 'Asia/Amman')
  ), days as (
    select profile_id, work_date, min(punched_at) as first_punch, max(punched_at) as last_punch, count(*)::int as punch_count
    from punches group by profile_id, work_date
  )
  select p.id, p.full_name, p.device_user_id, d.work_date, d.first_punch, d.last_punch, d.punch_count,
         case when d.punch_count > 1 and d.last_punch - d.first_punch >= make_interval(mins => p_min_minutes)
              then round(extract(epoch from d.last_punch - d.first_punch) / 3600.0, 2) else 0 end,
         case when d.punch_count = 1 then 'missing_exit'
              when d.last_punch - d.first_punch < make_interval(mins => p_min_minutes) then 'ignored'
              else 'ok' end
  from days d join profiles p on p.id = d.profile_id
  order by d.work_date, p.device_user_id::int;
$function$;

create or replace function public.attendance_summary(p_from date, p_to date, p_min_minutes integer default 30)
 returns table(profile_id uuid, full_name text, device_user_id text, days_worked integer, total_hours numeric, missing_exit_days integer, hourly_wage numeric, amount_due numeric)
 language sql
 stable
 set search_path to 'public'
as $function$
  select p.id, p.full_name, p.device_user_id,
         (count(*) filter (where d.status = 'ok'))::int,
         coalesce(sum(d.hours), 0),
         (count(*) filter (where d.status = 'missing_exit'))::int,
         p.hourly_wage,
         round(coalesce(sum(d.hours), 0) * coalesce(p.hourly_wage, 0), 2)
  from profiles p
  left join attendance_daily(p_from, p_to, p_min_minutes) d on d.profile_id = p.id
  where p.device_user_id is not null
  group by p.id, p.full_name, p.device_user_id, p.hourly_wage
  order by p.device_user_id::int;
$function$;

revoke all on function public.attendance_daily(date, date, integer) from public, anon;
revoke all on function public.attendance_summary(date, date, integer) from public, anon;
grant execute on function public.attendance_daily(date, date, integer) to authenticated;
grant execute on function public.attendance_summary(date, date, integer) to authenticated;

notify pgrst, 'reload schema';
