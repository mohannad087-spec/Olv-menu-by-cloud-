-- تخصيص فاتورة الزبون المطبوعة: عنوان ورقم هاتف المطعم (يظهروا تحت
-- الاسم بأعلى الفاتورة)، بالإضافة لطباعة اسم الكاشير/الموظف اللي سجّل
-- عملية البيع (من عمود sales_entries.created_by الموجود أصلًا —
-- بدون حاجة لعمود جديد، فقط print-bridge صار يقرأه ويطبعه).

alter table public.printer_settings add column if not exists restaurant_address text;
alter table public.printer_settings add column if not exists restaurant_phone text;
