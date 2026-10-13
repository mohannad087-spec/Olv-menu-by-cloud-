-- قسم المادة الخام بصفحة المخزون والجرد (اختياري).
-- فاضي = البرنامج بيخمّن القسم من الاسم (assets/inv-groups.js)، فما في داعي تعبّيه لكل مادة؛
-- بينحفظ بس لما حدا يغيّر القسم يدويًا من تفاصيل المادة.
alter table public.ingredients add column if not exists category text;
comment on column public.ingredients.category is 'قسم المادة بصفحة المخزون (اختياري). فاضي = البرنامج بيخمّنه من الاسم';
