// أصناف شاشة البيع (جدول products) بتنسحب من منيو الموقع الحقيقي (olv-menu.pages.dev): الأسماء، الأسعار،
// التصنيفات والصور. الربط بـ external_id = معرّف الصنف بالموقع، فالمزامنة upsert وما بتكرّر شي.
//   OlvMenuProducts.imageUrl(src)  ← رابط كامل لصورة الصنف (صور الموقع نسبية "assets/photos/..")
//   OlvMenuProducts.sync()         ← مزامنة كاملة وبترجّع { count, added, corrected, hidden }
//   OlvMenuProducts.autoSync()     ← مزامنة صامتة (مرة كل 10 دقايق بالأكثر) لحسابات المدير بس؛ بترجّع true إذا انعملت
const OlvMenuProducts = (function () {
  const SITE = "https://olv-menu.pages.dev";
  const LAST_KEY = "olv_menu_products_sync";
  const EVERY_MS = 10 * 60 * 1000;

  function imageUrl(src) {
    if (!src) return src;
    return /^(https?:|data:|blob:)/i.test(src) ? src : SITE + "/" + String(src).replace(/^\/+/, "");
  }

  async function sync() {
    const db = window.supabaseClient;
    const res = await fetch(SITE + "/data/menu.json", { cache: "no-store" });
    if (!res.ok) throw new Error("تعذّر تحميل منيو الموقع الحقيقي");
    const menu = await res.json();
    const catById = {};
    (menu.categories || []).forEach((c) => { catById[c.id] = c.ar || c.en || "عام"; });
    const items = (menu.items || []).filter((it) => it.id && it.ar && it.price != null);
    if (!items.length) throw new Error("لم يتم العثور على أصناف بمنيو الموقع");

    const { data: existing, error: exErr } = await db
      .from("products").select("id, name, external_id, is_active").not("external_id", "is", null);
    if (exErr) throw exErr;
    const prev = {};
    (existing || []).forEach((p) => { prev[p.external_id] = p; });

    // ترتيب الأصناف بالمنيو بيصير ترتيبها بالشاشة (sort_order)
    const payload = items.map((it, i) => {
      const row = {
        external_id: it.id,
        name: it.ar,
        price: Number(it.price),
        category: catById[it.cat] || "عام",
        is_active: it.available !== false,
        sort_order: i,
      };
      if (it.image) row.image_url = imageUrl(it.image);
      if (it.descAr) row.description = it.descAr;
      return row;
    });
    const { error: syncErr } = await db.from("products").upsert(payload, { onConflict: "external_id" });
    if (syncErr) throw syncErr;

    // صنف انحذف من المنيو: بنخفيه من الشاشة (مش بنحذفه، حتى ما تضيع مبيعاته وتقاريره)
    const inMenu = new Set(items.map((it) => it.id));
    const gone = (existing || []).filter((p) => !inMenu.has(p.external_id) && p.is_active).map((p) => p.id);
    if (gone.length) {
      const { error: hideErr } = await db.from("products").update({ is_active: false }).in("id", gone);
      if (hideErr) throw hideErr;
    }
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (_) { /* التخزين غير متاح */ }
    return {
      count: payload.length,
      added: items.filter((it) => !prev[it.id]),
      corrected: items.filter((it) => prev[it.id] && prev[it.id].name !== it.ar).map((it) => ({ from: prev[it.id].name, to: it.ar })),
      hidden: gone.length,
    };
  }

  async function autoSync() {
    if (window.olvRole === "staff") return false; // الكاشير ما إله صلاحية تعديل المنتجات
    try {
      if (Date.now() - Number(localStorage.getItem(LAST_KEY) || 0) < EVERY_MS) return false;
    } catch (_) { /* نكمّل */ }
    try { await sync(); return true; } catch (_) { return false; }
  }

  return { imageUrl, sync, autoSync };
})();
window.OlvMenuProducts = OlvMenuProducts;
