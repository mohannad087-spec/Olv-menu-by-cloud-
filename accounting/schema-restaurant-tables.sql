-- طاولات الصالة — تُدار مرة وحدة من شاشة الإعدادات، وتُستخدم لعرض خريطة
-- حية (مشغولة/فاضية) بدل ما رقم الطاولة يضل مجرد نص بلا معنى بالتقارير

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  table_number text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists restaurant_tables_sort_idx on public.restaurant_tables (sort_order);

alter table public.restaurant_tables enable row level security;
drop policy if exists restaurant_tables_rw on public.restaurant_tables;
create policy restaurant_tables_rw on public.restaurant_tables
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- حالة إشغال كل طاولة — تتحدّث تلقائيًا لـ"مشغولة" لما يُسجَّل طلب صالة
-- عليها من شاشة البيع السريع (pos.html)، وترجع "فاضية" فقط لما الموظف
-- يضغط زر "تحرير الطاولة" يدويًا من شاشة الطاولات — ما في إشارة تلقائية
-- تدل إن الزبون قام عن الطاولة، فالتحرير اليدوي هو الحل الأدق والأبسط
create table if not exists public.table_occupancy (
  table_number text primary key references public.restaurant_tables(table_number) on delete cascade,
  is_occupied boolean not null default false,
  occupied_at timestamptz,
  freed_at timestamptz
);

alter table public.table_occupancy enable row level security;
drop policy if exists table_occupancy_rw on public.table_occupancy;
create policy table_occupancy_rw on public.table_occupancy
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
