-- سعر الصالة لأصناف المخزون المعروضة بالمنيو (بطاقة المادة): menu_price = سعر السفري، menu_hall_price = سعر الصالة (اختياري).
-- بيروح للمنيو عبر مزامنة المخزون (olv-menu-proxy: sync_stock) وبعدها لنقطة البيع عبر hall_price. فاضي = نفس سعر السفري.
alter table public.ingredients add column if not exists menu_hall_price numeric(10,2) check (menu_hall_price is null or menu_hall_price > 0);
