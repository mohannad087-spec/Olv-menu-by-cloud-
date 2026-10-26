-- بطاقة المادة: صفحة وحدة (item-cards.html) لكل ما يظهر بالمنيو العام ونقطة البيع.
-- بنضيف على جدول products الحقول اللي كانت موجودة بالمنيو بس (الاسم الإنجليزي، الوصف الإنجليزي، قسم المنيو، المجموعة، «الأكثر طلبًا»)
-- حتى تكتمل البطاقة، ووضع المصدر item_cards_mode:
--   'menu'  = (الافتراضي) المنيو هو المصدر والمزامنة القديمة بتنسخ منه لنقطة البيع كل 10 دقايق
--   'cards' = البطاقة هي المصدر: المزامنة ما بتكتب فوق بطاقة موجودة، وكل حفظ ببطاقة بينعكس على المنيو
-- كله additive وآمن لإعادة التشغيل.
alter table public.products add column if not exists name_en text;
alter table public.products add column if not exists description_en text;
alter table public.products add column if not exists menu_cat text;
alter table public.products add column if not exists subcat_ar text;
alter table public.products add column if not exists subcat_en text;
alter table public.products add column if not exists popular boolean not null default false;

insert into public.app_settings (key, value) values ('item_cards_mode', 'menu')
on conflict (key) do nothing;
