-- الأحجام (صغير/كبير) بنقطة البيع. نفس فكرة «وجبة»: الصنف الصغير هو السعر الأساسي، والحجم الكبير بيتولّد له
-- «إضافة» خاصة سعرها = فرق السعر (كبير − صغير)، فالسيرفر (record_sale) بيحسب السعر والخصم من نفس جدول الإضافات
-- بدون أي تغيير بالدالة. الإضافات بتتولّد تلقائيًا من منيو الموقع عبر مزامنة الأصناف (olv-menu-proxy: sync_products).
alter table public.addons add column if not exists is_size boolean not null default false;
alter table public.addons add column if not exists external_id text;
create unique index if not exists addons_external_id_key on public.addons (external_id);
alter table public.products add column if not exists large_addon_id uuid references public.addons(id) on delete set null;
