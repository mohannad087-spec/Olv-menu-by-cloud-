-- وصف قصير اختياري لكل منتج، يظهر تحت اسمه بشاشة البيع السريع
alter table public.products add column if not exists description text;
