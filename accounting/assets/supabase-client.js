// يهيّئ عميل Supabase باستخدام الإعدادات الموجودة في config.js
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
  window.supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
})();
