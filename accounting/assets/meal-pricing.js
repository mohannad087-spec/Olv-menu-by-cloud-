// أسعار «وجبة» و«وجبة دبل» للصنف (ساندويش/شاورما/برغر): بيت السعر بالإجمالي على بطاقة المنتج،
// والنظام بيولّد «إضافة» خاصة بالصنف (سعرها = سعر الوجبة − سعر الصنف) فالسيرفر (record_sale) بيحسب
// السعر من جدول الإضافات بدون أي تغيير. بدون وصفات/مواد: بس سعر.
const OlvMeal = (function () {
  const KINDS = {
    meal:   { label: "وجبة",      price: "meal_price",        addon: "meal_addon_id",   prefix: "وجبة " },
    double: { label: "وجبة دبل", price: "double_meal_price", addon: "double_addon_id", prefix: "وجبة دبل " },
  };

  // الأصناف اللي بيطلع عليها الاختيار: ساندويشات وشاورما السناكات + البرغر، أو أي صنف إله سعر وجبة
  function eligible(p) {
    if (!p) return false;
    if (p.meal_price || p.double_meal_price) return true;
    if (/[أا]رجيل/.test(p.category || "") || /\(وجبة\)/.test(p.name || "")) return false;
    return p.category === "برغر" || (p.category === "سناكات" && /ساندويش|سندويش|شاورما/.test(p.name || ""));
  }

  // يحفظ سعر الوجبة الإجمالي (total) للصنف ويحدّث/يولّد إضافته؛ total فاضي/0 = إلغاء الوجبة.
  // بيرجّع {product: الحقول الجديدة، addon: صف الإضافة أو null}
  async function save(p, kind, total) {
    const k = KINDS[kind];
    total = Number(total) || 0;
    const db = window.supabaseClient;
    if (total > 0 && total <= Number(p.price)) throw new Error("سعر الوجبة لازم يكون أكبر من سعر الصنف لحاله (" + olvFormatMoney(p.price) + ")");
    const patch = {};
    let addon = null;
    if (total <= 0) {
      if (p[k.addon]) await db.from("addons").update({ is_active: false }).eq("id", p[k.addon]);
      patch[k.price] = null;
    } else {
      const extra = Math.round((total - Number(p.price)) * 100) / 100;
      const row = { name: k.prefix + p.name, price: extra, is_active: true, is_meal: true };
      if (p[k.addon]) {
        const { data, error } = await db.from("addons").update(row).eq("id", p[k.addon]).select("*").single();
        if (error) throw error;
        addon = data;
      } else {
        const { data, error } = await db.from("addons").insert(row).select("*").single();
        if (error) throw error;
        addon = data;
      }
      patch[k.price] = total;
      patch[k.addon] = addon.id;
    }
    const { error } = await db.from("products").update(patch).eq("id", p.id);
    if (error) throw error;
    Object.assign(p, patch);
    return { product: patch, addon };
  }

  return { KINDS, eligible, save };
})();
