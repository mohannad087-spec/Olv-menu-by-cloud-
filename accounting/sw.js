// Service worker موجود فقط عشان متصفحات كروم تسمح بتثبيت البرنامج
// كتطبيق (PWA) — البرنامج معتمد بالكامل على بيانات Supabase الحية
// وجلسة الدخول، فأي تخزين مؤقت (cache) هون ممكن يعرض بيانات قديمة أو
// شاشة دخول قديمة. عمدًا ما في أي cache.match/cache.put — كل طلب يروح
// للشبكة مباشرة زي ما لو مافي service worker إطلاقًا، وبس وجوده (مع
// معالج fetch) كافي لإثبات إمكانية التثبيت.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
