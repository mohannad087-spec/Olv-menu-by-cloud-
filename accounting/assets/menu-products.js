// أصناف شاشة البيع (جدول products) بتنسحب من منيو الموقع الحقيقي (olv-menu.pages.dev): الأسماء، الأسعار،
// التصنيفات والصور. المزامنة نفسها بتصير بالسيرفر (olv-menu-proxy: sync_products) حتى تشتغل من أي حساب، الكاشير كمان.
//   OlvMenuProducts.imageUrl(src)  ← رابط كامل لصورة الصنف (صور الموقع نسبية "assets/photos/..")
//   OlvMenuProducts.sync()         ← مزامنة كاملة وبترجّع { count, added, hidden }
//   OlvMenuProducts.autoSync()     ← مزامنة صامتة (مرة كل 10 دقايق بالأكثر بهالجهاز)؛ بترجّع true إذا انعملت
const OlvMenuProducts = (function () {
  const SITE = "https://olv-menu.pages.dev";
  const LAST_KEY = "olv_menu_products_sync";
  const EVERY_MS = 10 * 60 * 1000;

  function imageUrl(src) {
    if (!src) return src;
    return /^(https?:|data:|blob:)/i.test(src) ? src : SITE + "/" + String(src).replace(/^\/+/, "");
  }

  async function sync() {
    const { data } = await window.supabaseClient.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("لا توجد جلسة دخول");
    const base = ((window.OLV_ACCOUNTING_CONFIG || {}).SUPABASE_URL || "").replace(/\/$/, "");
    const res = await fetch(base + "/functions/v1/olv-menu-proxy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "sync_products" }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || "فشلت مزامنة الأصناف من المنيو");
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (_) { /* التخزين غير متاح */ }
    return out;
  }

  async function autoSync() {
    try {
      if (Date.now() - Number(localStorage.getItem(LAST_KEY) || 0) < EVERY_MS) return false;
    } catch (_) { /* نكمّل */ }
    try { await sync(); return true; } catch (e) { console.warn("menu sync:", e); return false; }
  }

  return { imageUrl, sync, autoSync };
})();
window.OlvMenuProducts = OlvMenuProducts;
