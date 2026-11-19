-- إلغاء حد الشفت الصباحي (4 العصر): الساعات = من أول بصمة لآخر بصمة باليوم. مطبّق على القاعدة بتاريخ 2026-11-06.
-- آمن لإعادة التشغيل (create or replace). attendance_summary بتستدعي attendance_daily فبتتغيّر معها تلقائياً.
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
      and e.source <> 'excluded'
  ), days as (
    select profile_id, work_date, min(punched_at) as first_punch, max(punched_at) as last_punch, count(*)::int as punch_count
    from punches group by profile_id, work_date
  )
  select p.id, p.full_name, p.device_user_id, d.work_date, d.first_punch, d.last_punch, d.punch_count,
         case when d.punch_count > 1 and d.last_punch - d.first_punch >= make_interval(mins => p_min_minutes)
              then round(extract(epoch from (d.last_punch - d.first_punch)) / 3600.0, 2) else 0 end,
         case when d.punch_count = 1 then 'missing_exit'
              when d.last_punch - d.first_punch < make_interval(mins => p_min_minutes) then 'ignored'
              else 'ok' end
  from days d join profiles p on p.id = d.profile_id
  order by d.work_date, p.device_user_id::int;
$function$;
notify pgrst, 'reload schema';
