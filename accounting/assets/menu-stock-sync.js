// يزامن أصناف المخزون المعروضة على المنيو (schema-menu-stock.sql) مع الموقع العام بشكل تلقائي:
// كل ٤٥ ثانية بيفحص مخزون المواد المعلّمة "على المنيو"، ولو تغيّرت حالتها (خلصت أو رجعت) أو لسا ما
// انعملت مزامنة بهالجهاز، بينادي olv-menu-proxy (sync_stock). الموقع بيعمل commit بس لو في فرق فعلي.
// يشتغل بأي صفحة مفتوحة وبأي دور (الكاشير يبيع فيخلص الصنف → ينشال من المنيو)، وما بيعمل أي شي لو ما في
// أصناف معروضة أو لو الجدول/الأعمدة لسا ما انعملت (SQL ما انشغّل).
//   OlvMenuSync.syncNow()  ← مزامنة فورية (بترجّع نتيجة الموقع) — تستعملها شاشة "المنيو من المخزون"
//   OlvMenuSync.kick()     ← فحص فوري (مثلًا بعد بيعة)
const OlvMenuSync = (function () {
  const SIG_KEY = "olv_menu_stock_sig";
  const POLL_MS = 45000;
  let busy = false;
  let started = false;

  function proxyUrl() {
    const base = (window.OLV_ACCOUNTING_CONFIG || {}).SUPABASE_URL || "";
    return base.replace(/\/$/, "") + "/functions/v1/olv-menu-proxy";
  }

  async function syncNow() {
    const { data } = await window.supabaseClient.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("لا توجد جلسة دخول");
    const res = await fetch(proxyUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "sync_stock" }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || "فشلت مزامنة المنيو");
    return out;
  }

  async function currentSignature() {
    const { data, error } = await window.supabaseClient
      .from("ingredients").select("id, current_stock, menu_price, menu_cat, name").eq("menu_enabled", true);
    if (error || !data) return null; // الأعمدة غير موجودة (SQL ما انشغّل) أو مشكلة شبكة — ما نعمل شي
    if (!data.length) return "";
    return data.map((r) => `${r.id}:${Number(r.current_stock) > 0 ? 1 : 0}:${r.menu_price}:${r.menu_cat}:${r.name}`).sort().join("|");
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const sig = await currentSignature();
      if (sig === null) return;
      let last = null;
      try { last = localStorage.getItem(SIG_KEY); } catch (_) {}
      // ما في أصناف معروضة وما كان في قبل → ما في شي نزامنه. لو كان في أصناف وانشالت كلها، لازم نزامن لننشلها من الموقع
      if (sig === "" && (last === null || last === "")) return;
      if (sig === last) return;
      await syncNow();
      try { localStorage.setItem(SIG_KEY, sig); } catch (_) {}
    } catch (_) {
      // بنحاول من جديد بالدورة الجاية
    } finally {
      busy = false;
    }
  }

  function start() {
    if (started) return;
    started = true;
    setTimeout(() => { tick(); setInterval(tick, POLL_MS); }, 6000);
  }

  return { start, syncNow, kick: tick };
})();
OlvMenuSync.start();
