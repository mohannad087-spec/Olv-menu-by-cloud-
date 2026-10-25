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
    // الكتابة على addons/products للمدير فقط بسياسات RLS، فالحفظ يمرّ عبر دالة السيرفر save_meal_price
    const { data, error } = await db.rpc("save_meal_price", { p_product_id: p.id, p_kind: kind, p_total: total });
    if (error) throw error;
    const addon = (data && data.addon) || null;
    const patch = total > 0 ? { [k.price]: total, [k.addon]: addon.id } : { [k.price]: null };
    Object.assign(p, patch);
    return { product: patch, addon };
  }

  return { KINDS, eligible, save };
})();
