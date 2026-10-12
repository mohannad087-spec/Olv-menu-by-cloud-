-- الطاولات (2026-10): جهوزية الطاولة + الحجوزات. آمن تشغيله أكتر من مرة.

-- 1) جهوزية: بعد «حرّر الطاولة» بتصير «بدها ترتيب» لحد ما حدا يكبس «صارت جاهزة».
--    بدها ترتيب = freed_at أحدث من cleaned_at
alter table public.table_occupancy add column if not exists cleaned_at timestamptz;

-- 2) الحجوزات: الطاولة اختيارية (بتنحدد وقت الحجز أو لما يوصلوا)
create table if not exists public.table_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 30),
  party_size integer not null default 2 check (party_size between 1 and 200),
  reserved_at timestamptz not null,
  table_number text check (table_number is null or char_length(table_number) <= 30),
  notes text check (notes is null or char_length(notes) <= 300),
  status text not null default 'booked' check (status in ('booked', 'seated', 'cancelled', 'no_show')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists table_reservations_time_idx on public.table_reservations (reserved_at);
create index if not exists table_reservations_created_by_idx on public.table_reservations (created_by);

alter table public.table_reservations enable row level security;

-- 3) صلاحيات: أي موظف فعّال بيشوف ويضيف ويعدّل (الحجز شغل الكاشير والجرسون)، والحذف للمالك والمدير
drop policy if exists table_reservations_select on public.table_reservations;
create policy table_reservations_select on public.table_reservations
  for select using ((select public.auth_role()) is not null);
drop policy if exists table_reservations_insert on public.table_reservations;
create policy table_reservations_insert on public.table_reservations
  for insert with check ((select public.auth_role()) is not null);
drop policy if exists table_reservations_update on public.table_reservations;
create policy table_reservations_update on public.table_reservations
  for update using ((select public.auth_role()) is not null) with check ((select public.auth_role()) is not null);
drop policy if exists table_reservations_delete on public.table_reservations;
create policy table_reservations_delete on public.table_reservations
  for delete using ((select public.is_admin()));

-- 4) أي تغيير بيبيّن عالأجهزة التانية فورًا
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_reservations') then
    alter publication supabase_realtime add table public.table_reservations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_occupancy') then
    alter publication supabase_realtime add table public.table_occupancy;
  end if;
end $$;

-- 5) الطاولة اللي انكتبت وهي مش بالقائمة لازم كمان تنحرّر (من schema-tables-live.sql)
alter table public.table_occupancy drop constraint if exists table_occupancy_table_number_fkey;
