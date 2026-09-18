-- يربط صنف بجدول المنتجات (products) هون بنفس الصنف على موقع المنيو الحقيقي
-- (olv-menu.pages.dev) عبر external_id = معرّف الصنف هناك (مثال: "olv-burger").
-- مطلوب حتى تقدر شاشة "الطلبات الواردة" تعرف أي منتج بالمحاسبة يقابل كل
-- صنف بطلب جاي من موقع المنيو، وتخصم المخزون الصح تلقائيًا.

alter table public.products add column if not exists external_id text;

-- قيد فريد عادي (بدون شرط WHERE): يسمح بأي عدد من المنتجات بـ external_id
-- فاضي (NULL لا تُعتبر متساوية لنفسها بـ Postgres)، بس يمنع تكرار نفس
-- المعرّف الحقيقي بأكتر من منتج. لازم يكون عادي (مش جزئي) حتى تقدر
-- عملية upsert (ON CONFLICT) بصفحة الإعدادات تستخدمه كمرجع.
drop index if exists public.products_external_id_key;
create unique index products_external_id_key
  on public.products (external_id);
