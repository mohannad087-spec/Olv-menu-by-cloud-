-- حد أقصى لساعات اليوم المحسوبة بالراتب (اختياري لكل موظف، فاضي = بدون حد). آمن للتشغيل أكتر من مرة.
-- الساعات فوق الحد بتضل ظاهرة بكشف الحضور والرواتب بس ما بتنحسب مصاري.
alter table public.profiles
  add column if not exists max_daily_hours numeric
  check (max_daily_hours is null or (max_daily_hours > 0 and max_daily_hours <= 24));
comment on column public.profiles.max_daily_hours is 'حد أقصى لساعات اليوم المحسوبة بالراتب (فاضي = بدون حد)';
notify pgrst, 'reload schema';
