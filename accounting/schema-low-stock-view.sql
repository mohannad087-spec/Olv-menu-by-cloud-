-- يجمع المواد الخام والمستلزمات اللي وصلت (أو تحت) حدّها الأدنى
-- المسموح بمكان واحد، تستخدمه شاشة تنبيه نقص المخزون الاستباقي (تفحص
-- هاد الـ view دوريًا وتنبّه بصوت/عداد لما صنف جديد يوصل الحد الأدنى)
create or replace view public.low_stock_items as
select 'ingredient'::text as item_type, id, name, unit, current_stock, low_stock_threshold
from public.ingredients
where current_stock <= low_stock_threshold
union all
select 'supply'::text as item_type, id, name, unit, current_stock, low_stock_threshold
from public.supplies
where current_stock <= low_stock_threshold;
