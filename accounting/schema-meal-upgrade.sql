-- تحويل الصنف لوجبة بالبيع السريع: الوجبة = «إضافة» عادية بعلامة is_meal
-- (سعرها = الزيادة على الصنف، ووصفتها بشاشة وصفات المنتجات بتنزّل البطاطا/المشروب من المخزون).
-- التصنيفات المسموح تتحول وجبة بتنحفظ بـ app_settings (مفتاح meal_categories، فاضي = كل الأصناف).
alter table public.addons add column if not exists is_meal boolean not null default false;

insert into public.app_settings (key, value)
values ('meal_categories', '')
on conflict (key) do nothing;
