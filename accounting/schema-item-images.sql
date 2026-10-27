-- مخزن صور الأصناف اللي بيولّدها «المساعد الذكي» (item-cards-ai): عام للقراءة (المنيو بيعرض الصورة بالرابط المباشر).
-- الرفع بس من السيرفر (دالة item-cards-ai بمفتاح الخدمة)، فما في سياسات كتابة للمتصفح.
-- الدالة كمان بتعمله لحالها أول مرة إذا مش موجود.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
