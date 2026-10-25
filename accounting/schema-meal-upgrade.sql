-- تحويل الصنف لوجبة بالبيع السريع.
-- كل صنف بيقبل التحويل بيدخل الكاشير/المدير «سعر الوجبة» على بطاقة المنتج بالإعدادات؛ وهيك بيتولّد تلقائيًا
-- «إضافة وجبة» خاصة بالصنف (سعرها = سعر الوجبة − سعر الصنف) فالسيرفر (record_sale) بيحسب السعر والمخزون
-- من نفس جدول الإضافات بدون أي تغيير بالدالة. وصفة الإضافة (بطاطا/مشروب) بتنربط من «وصفات المنتجات».
alter table public.addons add column if not exists is_meal boolean not null default false;
alter table public.products add column if not exists meal_price numeric(12,2);
alter table public.products add column if not exists meal_addon_id uuid references public.addons(id) on delete set null;

-- «وجبة دبل» بجانب «وجبة»
alter table public.products add column if not exists double_meal_price numeric(12,2);
alter table public.products add column if not exists double_addon_id uuid references public.addons(id) on delete set null;
