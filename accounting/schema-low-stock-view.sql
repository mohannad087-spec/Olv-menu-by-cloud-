-- يجمع المواد الخام والمستلزمات اللي وصلت (أو تحت) حدّها الأدنى المسموح
-- بمكان واحد، بالإضافة لمواد خام "متوقّع نفادها قريبًا" حتى لو لسا فوق
-- الحد الثابت: بيحسب معدل استهلاك كل مادة خام يوميًا من متوسط آخر ١٤
-- يوم من المبيعات المكتملة الحقيقية فقط (بدون الطلبات/الأصناف الملغاة)،
-- وإذا الكمية الحالية كافية لأقل من ٣ أيام بهالمعدل، بيعتبرها عاجلة —
-- حسبة رياضية بسيطة على بيانات المبيعات الموجودة أصلًا، بدون أي خدمة
-- ذكاء اصطناعي خارجية. تستخدمه شاشة تنبيه نقص المخزون الاستباقي (تفحص
-- هاد الـ view دوريًا وتنبّه بصوت/عداد لما صنف جديد يوصل الحد)، وشاشة
-- المخزون نفسها (عمود "يكفي لـ" وبانر التنبيه العاجل).
create or replace view public.ingredient_consumption as
select
  i.id as ingredient_id,
  c.daily_rate,
  case when c.daily_rate > 0 then i.current_stock / c.daily_rate else null end as days_left
from public.ingredients i
left join (
  select pi.ingredient_id, sum(pi.quantity * si.qty) / 14.0 as daily_rate
  from public.sale_items si
  join public.sales_entries se on se.id = si.sale_id
  join public.product_ingredients pi on pi.product_id = si.product_id
  where si.status = 'completed' and se.status = 'completed'
    and si.created_at >= now() - interval '14 days'
  group by pi.ingredient_id
) c on c.ingredient_id = i.id;

create or replace view public.low_stock_items as
select 'ingredient'::text as item_type, i.id, i.name, i.unit, i.current_stock, i.low_stock_threshold,
  case when i.current_stock <= i.low_stock_threshold then 'threshold' else 'forecast' end as reason,
  ic.days_left
from public.ingredients i
join public.ingredient_consumption ic on ic.ingredient_id = i.id
where i.current_stock <= i.low_stock_threshold
   or (ic.days_left is not null and ic.days_left <= 3)
union all
select 'supply'::text as item_type, id, name, unit, current_stock, low_stock_threshold,
  'threshold'::text as reason, null::numeric as days_left
from public.supplies
where current_stock <= low_stock_threshold;
