-- يربط صنف بجدول المنتجات (products) هون بنفس الصنف على موقع المنيو الحقيقي
-- (olv-menu.pages.dev) عبر external_id = معرّف الصنف هناك (مثال: "olv-burger").
-- مطلوب حتى تقدر شاشة "الطلبات الواردة" تعرف أي منتج بالمحاسبة يقابل كل
-- صنف بطلب جاي من موقع المنيو، وتخصم المخزون الصح تلقائيًا.

alter table public.products add column if not exists external_id text;

create unique index if not exists products_external_id_key
  on public.products (external_id)
  where external_id is not null;
