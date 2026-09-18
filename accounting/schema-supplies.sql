-- المستلزمات/الورقيات (أكواب، أكياس، علب...) — جدول جرد منفصل تمامًا عن
-- المواد الخام (ingredients) لأنه غير مرتبط بوصفات المنتجات، ولا يخصم
-- تلقائيًا عند البيع. الهدف بس تتبّع الكمية الحالية وتجهيز طلبية شراء
-- جديدة من المورد لما تقارب تنفد.

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'عام',
  unit text not null default 'قطعة',
  current_stock numeric not null default 0,
  low_stock_threshold numeric not null default 0,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supplies_category_idx on public.supplies (category);

alter table public.supplies enable row level security;

drop policy if exists supplies_rw on public.supplies;
create policy supplies_rw on public.supplies
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- مورد المطبوعات/الورقيات (مستخرج من عرض سعر شركة سيما للدعاية والأعمال)
-- حتى تقدر شاشة "تجهيز طلبية" تعرض رقم التواصل تلقائيًا بدون إدخاله يدويًا
insert into public.suppliers (name, phone, notes)
select 'شركة سيما للدعاية والأعمال', '0798350706', 'م. هادي نصير — Seemaprintingservice@gmail.com — 0790744785'
where not exists (select 1 from public.suppliers where name = 'شركة سيما للدعاية والأعمال');

-- الأصناف الفعلية الاستهلاكية من عرض السعر (استُثنيت بنود "الكاليش" لأنها
-- تكلفة تجهيز قالب طباعة تُدفع مرة، مش مادة بتتكرر طلبها كستوك). الكمية
-- الحالية صفر افتراضيًا — لازم تُدخل الجرد الفعلي بعد التشغيل من شاشة
-- "المستلزمات"، وحدود التنبيه أرقام بداية تقديرية بس، عدّلها حسب استهلاكك
insert into public.supplies (name, category, unit, current_stock, low_stock_threshold, supplier_id)
select v.name, v.category, v.unit, 0, v.threshold, s.id
from (values
  ('أكواب كافيه 300 ملم (مع غطا)', 'كافيه', 'قطعة', 100),
  ('أكواب كافيه 500 ملم U-shape (مع غطا)', 'كافيه', 'قطعة', 100),
  ('أكواب دبل 8 أونصة (بدون غطا)', 'كافيه', 'قطعة', 100),
  ('أكواب دبل 12 أونصة (بدون غطا)', 'كافيه', 'قطعة', 100),
  ('غطا أكواب دبل 8', 'كافيه', 'قطعة', 100),
  ('غطا أكواب دبل 12', 'كافيه', 'قطعة', 100),
  ('سكر شفرات', 'كافيه', 'قطعة', 200),
  ('طقم سفرة (وافل وكريب)', 'كافيه', 'طقم', 20),
  ('كيس ورق 22 سم أبيض', 'مطعم', 'قطعة', 100),
  ('نايلون (لودن) شفاف حجم كبير', 'مطعم', 'كيلوغرام', 5),
  ('ورق شاورما', 'مطعم', 'كيلوغرام', 5),
  ('ورق زبدة مصقول', 'مطعم', 'كيلوغرام', 5),
  ('علبة بطاطا كاسة', 'مطعم', 'قطعة', 100),
  ('صحن قارب', 'مطعم', 'قطعة', 100),
  ('علبة برجر', 'مطعم', 'قطعة', 100),
  ('علبة فرنسي (هوت دوغ)', 'مطعم', 'قطعة', 100),
  ('كيس ساندويش شاورما', 'مطعم', 'قطعة', 100)
) as v(name, category, unit, threshold)
cross join (select id from public.suppliers where name = 'شركة سيما للدعاية والأعمال' limit 1) as s
where not exists (select 1 from public.supplies sp where sp.name = v.name);
