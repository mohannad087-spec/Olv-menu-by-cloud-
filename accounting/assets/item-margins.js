// ربح كل صنف من المنيو: تكلفة الوصفة (كمية × آخر سعر شراء للمادة) مقابل
// سعر البيع الحالي، ومين من المواد غلي سعرها بآخر فاتورتين شراء.
// مشترك بين «الأصناف والوصفات» (القائمة الكاملة) والرئيسية (تنبيه صغير):
//   olvLoadItemMargins() ← { items, rises, worst, avgCostPct }
//     items: صنف فعّال إله وصفة → { id, name, price, cost, profit, costPct, level,
//            missing[] (مواد بلا سعر), rose[] (مواد غليت), oldCost }
//     level: "loss" (التكلفة ≥ السعر) | "low" (التكلفة فوق OLV_MARGIN_LOW% من السعر)
//            | "ok" | "unknown" (ما في سعر بيع أو مادة بلا سعر)
//     rises: Map ingredient_id → { name, from, to, pct, date }
// الحساب تقديري للعرض بس، ما بيغيّر أي سعر (التسعير بيضل يدوي أو من «المنيو من المخزون»)
(function () {
  const OLV_MARGIN_LOW = 40;   // تكلفة المواد فوق 40% من السعر = ربح قليل
  const OLV_TARGET = 35;       // السعر المقترح بيرجّع التكلفة لـ 35%
  const OLV_RISE_MIN = 10;     // غلاء أقل من 10% ما منعتبره
  const OLV_RISE_DAYS = 60;    // بنقارن فواتير آخر شهرين بس

  // سعر مقترح: التكلفة ÷ 35% مقرّب لفوق لأقرب 0.05 (نفس تقريب التسعير الذكي)
  function olvSuggestPrice(cost) {
    if (!(cost > 0)) return null;
    return Math.round(Math.ceil(cost / (OLV_TARGET / 100) / 0.05 - 1e-9) * 0.05 * 100) / 100;
  }

  async function olvLoadItemMargins() {
    const db = window.supabaseClient;
    const since = new Date(Date.now() - OLV_RISE_DAYS * 864e5).toISOString().slice(0, 10);
    const [p, r, i, b] = await Promise.all([
      db.from("products").select("id, name, price, is_active"),
      db.from("product_ingredients").select("product_id, ingredient_id, quantity"),
      db.from("ingredients").select("id, name, unit, unit_price"),
      db.from("purchases").select("ingredient_id, unit_price, purchase_date, created_at")
        .not("ingredient_id", "is", null).gte("purchase_date", since)
        .order("purchase_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
    ]);
    if (p.error) throw p.error;
    if (r.error) throw r.error;
    if (i.error) throw i.error;
    const ing = new Map((i.data || []).map((x) => [x.id, x]));

    // غلاء: آخر سعر شراء مقابل آخر سعر قبله (فاتورة أقدم بسعر مختلف)
    const rises = new Map();
    if (!b.error) {
      const seen = new Map(); // ingredient_id → { to, date, from }
      (b.data || []).forEach((x) => {
        const v = Number(x.unit_price);
        if (!(v > 0)) return;
        const s = seen.get(x.ingredient_id);
        if (!s) { seen.set(x.ingredient_id, { to: v, date: x.purchase_date, from: null }); return; }
        if (s.from == null && v !== s.to) s.from = v;
      });
      seen.forEach((s, id) => {
        if (s.from == null || !ing.has(id)) return;
        const pct = Math.round((s.to - s.from) / s.from * 100);
        if (pct >= OLV_RISE_MIN) rises.set(id, { name: ing.get(id).name, from: s.from, to: s.to, pct, date: s.date });
      });
    }

    const byProduct = new Map();
    (r.data || []).forEach((x) => {
      if (!byProduct.has(x.product_id)) byProduct.set(x.product_id, []);
      byProduct.get(x.product_id).push(x);
    });

    const items = [];
    (p.data || []).forEach((prod) => {
      if (prod.is_active === false || !byProduct.has(prod.id)) return;
      let cost = 0, oldCost = 0;
      const missing = [], rose = [];
      byProduct.get(prod.id).forEach((line) => {
        const m = ing.get(line.ingredient_id);
        if (!m) return;
        const q = Number(line.quantity) || 0;
        const unit = Number(m.unit_price) || 0;
        if (!(unit > 0)) missing.push(m.name);
        cost += q * unit;
        const rise = rises.get(line.ingredient_id);
        if (rise) { rose.push({ name: m.name, pct: rise.pct }); oldCost += q * rise.from; }
        else oldCost += q * unit;
      });
      const price = Number(prod.price) || 0;
      const costPct = price > 0 ? Math.round(cost / price * 100) : null;
      let level = "ok";
      if (!(price > 0) || missing.length) level = "unknown";
      else if (cost >= price) level = "loss";
      else if (costPct > OLV_MARGIN_LOW) level = "low";
      items.push({
        id: prod.id, name: prod.name, price, cost, profit: price - cost, costPct, level, missing, rose,
        oldCost: rose.length ? oldCost : null, suggest: level === "low" || level === "loss" ? olvSuggestPrice(cost) : null,
      });
    });

    const known = items.filter((x) => x.level !== "unknown");
    const avgCostPct = known.length ? Math.round(known.reduce((s, x) => s + x.costPct, 0) / known.length) : null;
    const worst = items.filter((x) => x.level === "loss" || x.level === "low").length;
    return { items, rises, worst, avgCostPct };
  }

  window.olvLoadItemMargins = olvLoadItemMargins;
  window.OLV_MARGIN_LOW = OLV_MARGIN_LOW;
  window.OLV_MARGIN_TARGET = OLV_TARGET;
})();
