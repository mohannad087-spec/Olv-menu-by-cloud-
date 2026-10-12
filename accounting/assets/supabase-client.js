// يهيّئ عميل Supabase باستخدام الإعدادات الموجودة في config.js

// ---- تسجيل الدخول وقت انقطاع النت (راجع olvAuthRelease بـauth-guard.js) ----
// توكن الدخول بينتهي كل ساعة وبيتجدد من السيرفر. إذا النت مقطوع، مكتبة Supabase بتضل تحاول
// تجدّده (لحد 30 ثانية) وكل شي بيستنى، فالكاشير بيستنى كتير قبل ما ينحفظ البيع محليًا.
// الحل: وقت الانقطاع منأجّل موعد انتهاء الجلسة المحفوظة (التوكن نفسه ما بيتغيّر وما بيصير
// صالح أكتر عند السيرفر)، وأول ما يرجع النت منجدّدها فعليًا.
const OLV_AUTH_HOLD_KEY = "olv_auth_hold_v1";

function olvAuthStorageKey() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) return k;
    }
  } catch (_) { /* ما في خزنة */ }
  return null;
}

// النت مقطوع: إذا الجلسة منتهية أو قرّبت، منأجّل موعدها 6 ساعات (ومنحفظ الموعد الأصلي)
function olvAuthHold() {
  try {
    const k = olvAuthStorageKey();
    const s = k && JSON.parse(localStorage.getItem(k) || "null");
    if (!s || !s.expires_at || s.expires_at * 1000 - Date.now() > 5 * 60e3) return;
    if (!localStorage.getItem(OLV_AUTH_HOLD_KEY)) localStorage.setItem(OLV_AUTH_HOLD_KEY, String(s.expires_at));
    s.expires_at = Math.floor(Date.now() / 1000) + 6 * 3600;
    localStorage.setItem(k, JSON.stringify(s));
  } catch (_) { /* ما في خزنة */ }
}

(function () {
  const cfg = window.OLV_ACCOUNTING_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.indexOf("YOUR_") === 0) {
    document.addEventListener("DOMContentLoaded", function () {
      const box = document.createElement("div");
      box.className = "olv-config-warning";
      box.innerHTML =
        "⚠️ لم يتم ضبط إعدادات Supabase بعد. افتح ملف <code>accounting/config.js</code> وحط رابط ومفتاح مشروعك.";
      document.body.prepend(box);
    });
    return;
  }
  // الصفحة انفتحت من كمبيوتر المحل والنت مقطوع (هو بيعرف وبيحط OLV_LOCAL_OFFLINE): منثبّت الجلسة
  // قبل ما ينخلق العميل، لأنه أول ما ينخلق بيحاول يجدّدها
  if (window.OLV_LOCAL_OFFLINE) olvAuthHold();
  // fetch مخصَّص (olvOfflineFetch من offline-queue.js إن وُجد) يعترض
  // فشل الكتابة بسبب انقطاع إنترنت حقيقي ويخزّنها محليًا بدل ما تضيع —
  // راجع تعليق offline-queue.js لتفاصيل الآلية الكاملة
  const opts = window.olvOfflineFetch ? { global: { fetch: window.olvOfflineFetch } } : undefined;
  window.supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, opts);
})();
