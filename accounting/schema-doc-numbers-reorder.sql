-- (اختياري، مرة وحدة) إعادة ترتيب أرقام فواتير البيع القديمة بحسب وقتها بالضبط.
-- الأرقام الأصلية انعطت بترتيب تقريبي، وبعض الفواتير القديمة أرقامها مش متسلسلة بالوقت.
-- بيمشي على مرحلتين حتى ما يصطدم بالفهرس الفريد، وبعدها بيضبط العدّاد.
update public.sales_entries s set doc_no = -o.rn
from (select id, row_number() over (order by created_at, id) rn from public.sales_entries) o where s.id = o.id;
update public.sales_entries set doc_no = -doc_no where doc_no < 0;
select setval('public.sale_doc_seq', (select coalesce(max(doc_no), 1) from public.sales_entries));
