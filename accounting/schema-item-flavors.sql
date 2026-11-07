-- نكهات الصنف (بطاقة المادة): قائمة مفصولة بـ | مثل «عادي|حار|باربكيو». فاضي = بدون نكهات.
alter table public.products add column if not exists flavors text;
