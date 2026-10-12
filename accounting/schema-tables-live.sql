-- صفحة الطاولات (2026-10): الطاولة "مشغولة" صارت تنحسب من طلبات الصالة نفسها
-- (آخر 12 ساعة، بعد آخر «تحرير»)، بدل علامة بيحطها الكاشير. هيك طلبات المنيو (QR)
-- بتبيّن كمان، وما في طاولة بتضل "مشغولة" لأيام لأن حدا نسي يحرّرها.
-- table_occupancy صار بس دفتر «آخر مرة انحرّرت الطاولة» (freed_at).

-- الطاولة اللي انكتبت بالكاشير وهي مش مضافة بالإعدادات لازم كمان تنحرّر،
-- فمنشيل الربط الإجباري مع restaurant_tables
alter table public.table_occupancy drop constraint if exists table_occupancy_table_number_fkey;

-- التحرير من جهاز بيبيّن عالأجهزة التانية فورًا
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_occupancy'
  ) then
    alter publication supabase_realtime add table public.table_occupancy;
  end if;
end $$;
