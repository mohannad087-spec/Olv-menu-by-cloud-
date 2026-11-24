// حسابات صفحة التقارير: هامش الأصناف، الربح التقديري، حركة الدرج، ونسبة العمالة/Prime cost
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBrowserScripts, ROOT } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");
const item = (product_id, qty, unit_price, extra = {}) => ({ product_id, product_name: "p" + product_id, qty, unit_price, ...extra });
const costs = new Map([["a", { cost: 1 }], ["b", { cost: 2 }]]);

test("هامش الصنف: إيراد بسعر وقت البيع + الإضافات − تكلفة الوصفة × الكمية", () => {
  const rows = c.olvProfitability([{ sale_items: [item("a", 3, 4, { addons_total: 1 })] }], costs);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revenue, 15);
  assert.equal(rows[0].cost, 3);
  assert.equal(rows[0].margin, 12);
  assert.equal(rows[0].hasRecipe, true);
});

test("الأصناف الملغاة فرادى وبدون product_id ما بتنحسب", () => {
  const rows = c.olvProfitability([{ sale_items: [item("a", 1, 5, { status: "voided" }), item(null, 1, 5), item("a", 2, 5)] }], costs);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].revenue, 10);
});

test("صنف بدون وصفة: تكلفة صفر وhasRecipe=false، والترتيب بالهامش من الأعلى", () => {
  const rows = c.olvProfitability([{ sale_items: [item("a", 1, 10), item("z", 1, 50)] }], costs);
  assert.equal(rows[0].name, "pz");
  assert.equal(rows[0].hasRecipe, false);
  assert.equal(rows[0].cost, 0);
});

test("الربح التقديري: التكلفة المقدّرة بتتوزع على الأصناف بدون وصفة، ومشتريات المخزون ما بتنطرح مرتين", () => {
  const prof = c.olvProfitability([{ sale_items: [item("a", 10, 10), item("z", 10, 10)] }], costs); // 200 إيراد، نص منه بوصفة تكلفته 10
  const r = c.olvEstimateProfit({ prof, totalSales: 200, totalExpenses: 150, stockBuys: 100 });
  assert.equal(r.covPct, 50);
  assert.equal(r.cogs, 20); // 10 معروفة ÷ 50% تغطية
  assert.equal(r.est, 200 - 20 - 50); // المصروفات غير المخزنية = 50
});

test("الربح التقديري بدون أي وصفة: تكلفة صفر وتغطية صفر (بدون قسمة على صفر)", () => {
  const prof = c.olvProfitability([{ sale_items: [item("z", 1, 10)] }], costs);
  const r = c.olvEstimateProfit({ prof, totalSales: 10, totalExpenses: 0, stockBuys: 0 });
  assert.equal(r.cogs, 0);
  assert.equal(r.covPct, 0);
  assert.equal(r.est, 10);
  const e = c.olvEstimateProfit({ prof: [], totalSales: 0, totalExpenses: 0, stockBuys: 0 });
  assert.equal(e.cogs + e.covPct + e.est, 0);
});

test("حركة الدرج: مصروف درج، مشتريات من الدرج، وفواتير كاش من برّا الدرج", () => {
  const rows = [
    { id: 1, amount: 10, from_drawer: true },   // مصروف عادي من الدرج
    { id: 2, amount: 5, from_drawer: false },   // مصروف عادي من برّا الدرج (ما بنحسبه)
    { id: 3, amount: 100, from_drawer: true },  // فاتورة شراء من الدرج
    { id: 4, amount: 40, from_drawer: false },  // فاتورة شراء من برّا الدرج
  ];
  const r = c.olvDrawerSplit(rows, new Set([3, 4]));
  assert.equal(r.exp, 10);
  assert.equal(r.buy, 100);
  assert.equal(r.invAll, 40);
  assert.equal(r.total, 110);
});

test("حارس: تقارير/مبيعات ما بترجع تقرأ مبيعات الفترة بدون olvFetchAll (الخادم بيقطع عند 1000 صف)", () => {
  for (const f of ["reports.html", "sales.html"]) {
    const s = fs.readFileSync(path.join(ROOT, "accounting", f), "utf8");
    assert.match(s, /olvFetchAll\(/, f);
    for (const m of s.matchAll(/\.limit\((\d+)\)/g)) {
      if (f === "reports.html") assert.ok(Number(m[1]) <= 1000, `${f}: limit(${m[1]}) بيتقصّ عند 1000 — استعمل olvFetchAll`);
    }
    // كل استعلام مبيعات بفترة طويلة لازم يكون داخل olvFetchAll (مقارنة اليوم بأمس بصفحة المبيعات يومين بس فمستثناة)
    const n = [...s.matchAll(/olvFetchAll\(\(\) =>[^;]{0,200}?from\("sales_entries"\)/g)].length;
    assert.ok(n >= (f === "reports.html" ? 3 : 2), `${f}: عدد استعلامات المبيعات داخل olvFetchAll = ${n}`);
  }
});

test("صفحة التقارير بتستعمل الدوال المختبرة", () => {
  const s = fs.readFileSync(path.join(ROOT, "accounting", "reports.html"), "utf8");
  for (const fn of ["olvProfitability(", "olvEstimateProfit(", "olvDrawerSplit(", "olvPrimeCost(", "olvExpensesPaid("]) assert.ok(s.includes(fn), fn);
});
