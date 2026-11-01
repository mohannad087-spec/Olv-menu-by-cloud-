-- تكلفة المادة داخل «بطاقة المادة»: تكلفة يدوية اختيارية + مصدر الرقم.
--   cost_manual: تكلفة يدوية للصنف (إذا انكتبت بتغلب على المحسوبة من الوصفة)
--   cost_source: 'manual' يدوي | 'recipe' محسوبة من الوصفة | 'ai' اقتراح ذكاء راجعه المستخدم واعتمده
-- additive وآمن لإعادة التشغيل.
alter table public.products add column if not exists cost_manual numeric(12,4);
alter table public.products add column if not exists cost_source text;
