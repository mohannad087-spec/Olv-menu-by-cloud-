-- رفع دقة أسعار الوحدة من خانتين عشريتين لخمس
--
-- كان سعر مثل 0.012 (جبنة بالجرام) بينحفظ 0.01 وبيغلّط تكلفة الوصفات. بملف منفصل لأنه بيغيّر أنواع
-- أعمدة بجداول قديمة، وما لازم يعطّل ميزة الخصم والضريبة لو فشل. شغّله بعد schema-purchase-invoices-tax.sql

alter table public.ingredients alter column unit_price type numeric(14,5);
alter table public.supplies alter column unit_price type numeric(14,5);

-- purchases.total_amount عمود محسوب معتمد على unit_price، فنعيد بناءه
alter table public.purchases drop column if exists total_amount;
alter table public.purchases alter column unit_price type numeric(14,5);
alter table public.purchases
  add column total_amount numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored;


notify pgrst, 'reload schema';
