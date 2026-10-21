-- فتح درج الكاش: الدرج موصول بسلك بطابعة الكاشير، وبرنامج الطباعة بيبعت
-- لها أمر الفتح بعد فاتورة كل بيع (مش إعادة الطباعة). التفعيل لكل طابعة
-- كاشير من الإعدادات > الطابعات.

alter table public.printers add column if not exists open_drawer boolean not null default false;
